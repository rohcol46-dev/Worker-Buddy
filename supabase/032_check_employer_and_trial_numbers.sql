-- 032: "Check this employer" for workers, and trial numbers for admins.
--  1. check_employer(phone): a signed-in worker types an employer's phone number (for work found
--     outside the app) and sees that employer's record: jobs, paid on time, star rating, "not paid"
--     reports, unpaid cancels and the welfare tags workers gave. Never the name, phone or place.
--     If any profile with that number confirmed it by SMS, only those count; otherwise the answer
--     says the number is not confirmed (anyone can type someone else's number into a profile).
--     30 checks a day per worker, counted in employer_checks (kept 2 days) so nobody can sweep numbers.
--  2. admin_trial_numbers(weeks): the Chennai trial's numbers per week, for /admin/:
--     confirmed-paid jobs (the north-star), repeat hires, active workers and employers, new sign-ups.

-- ---------- 1. Check this employer ----------
create table public.employer_checks (
  id bigint generated always as identity primary key,
  auth_id uuid not null,
  at timestamptz not null default now()
);
create index employer_checks_auth_at on public.employer_checks (auth_id, at);
alter table public.employer_checks enable row level security;   -- no policies: only the function below writes
revoke all on public.employer_checks from anon, authenticated;

create function public.check_employer(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me public.workers;
  p text;
  ids uuid[];
  verified boolean;
  r jsonb;
begin
  select * into me from public.workers where auth_id = auth.uid() and device_id not like 'deleted-%' limit 1;
  if auth.uid() is null or me.id is null then
    raise exception 'workers_only' using errcode = '42501';
  end if;
  if public.suspended(auth.uid()) then
    raise exception 'suspended' using errcode = '42501';
  end if;
  p := public.phone_e164(p_phone, me.country);
  if p is null then
    raise exception 'bad_phone' using errcode = '22023';
  end if;
  -- One check at a time per person, so many calls at once can't all slip under the limit
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('employer_checks:' || auth.uid()::text));
  if (select count(*) from public.employer_checks where auth_id = auth.uid() and at > now() - interval '1 day') >= 30 then
    raise exception 'slow_down' using errcode = '54000';
  end if;
  insert into public.employer_checks (auth_id) values (auth.uid());

  verified := exists (select 1 from public.employers
                       where phone = p and device_id not like 'deleted-%' and phone_verified);
  select array_agg(id) into ids from public.employers
   where phone = p and device_id not like 'deleted-%' and (phone_verified or not verified);
  if ids is null then
    return jsonb_build_object('found', false);
  end if;

  select jsonb_build_object(
    'found', true,
    'verified', verified,
    'since', min(e.created_at),
    'jobs', coalesce(sum(e.jobs), 0),
    'paid_on_time', coalesce(sum(e.paid_on_time), 0),
    'rating_sum', coalesce(sum(e.rating_sum), 0),
    'rating_count', coalesce(sum(e.rating_count), 0),
    'not_paid', coalesce(sum(e.disputes), 0),
    'gst_verified', bool_or(e.gstin is not null),
    'on_hold', bool_or(public.suspended(e.auth_id)),
    'unpaid_cancels', (select count(*) from public.bookings
                        where employer_id = any(ids) and cancel_reason = 'employer_unpaid'),
    'tags', coalesce((select jsonb_object_agg(tag, n) from (
               select tag, count(*) as n from public.bookings b, unnest(b.employer_tags) as tag
                where b.employer_id = any(ids) group by tag) x), '{}'::jsonb))
    into r
    from public.employers e where e.id = any(ids);
  return r;
end $$;
revoke all on function public.check_employer(text) from public, anon;
grant execute on function public.check_employer(text) to authenticated;

-- Check rows are only needed for the daily limit
create function public.purge_employer_checks() returns void
language sql security definer set search_path = '' as $$
  delete from public.employer_checks where at < now() - interval '2 days'
$$;
revoke all on function public.purge_employer_checks() from public, anon, authenticated;
select cron.schedule('worker-buddy-purge-employer-checks', '45 21 * * *', 'select public.purge_employer_checks()');

-- ---------- 2. Trial numbers (admins only) ----------
-- Workers had no sign-up time. Existing workers get their sign-in account's creation time.
alter table public.workers add column created_at timestamptz;
update public.workers w set created_at = coalesce((select u.created_at from auth.users u where u.id = w.auth_id), w.updated_at);
alter table public.workers alter column created_at set default now(), alter column created_at set not null;

-- One row per week (Monday start, in the given time zone), newest first. Sample workers are left out.
--   posted_jobs      jobs posted that week (a team of 3 counts as 3)
--   paid_jobs        jobs the worker confirmed as paid (the north-star metric)
--   repeat_jobs      of those, jobs where the employer already had an earlier confirmed-paid job
--   rehired_jobs     of those, jobs with the same worker as an earlier confirmed-paid job
--   active_workers   workers with a confirmed-paid job that week; active_employers the same for employers
--   workers_4w       workers with a confirmed-paid job in that week or the 3 before it (the trial's 15+ bar)
--   new_workers / new_employers  sign-ups that week
--   paid_amount      agreed wages of the paid jobs
create function public.admin_trial_numbers(p_weeks int default 8, p_tz text default 'Asia/Kolkata')
returns table (week_start date, posted_jobs bigint, paid_jobs bigint, repeat_jobs bigint, rehired_jobs bigint,
               active_workers bigint, active_employers bigint, workers_4w bigint, new_workers bigint,
               new_employers bigint, paid_amount bigint)
language plpgsql stable security definer set search_path = '' as $$
declare first_week date; since timestamptz;
begin
  perform public.assert_admin();
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'unknown time zone %', p_tz using errcode = '22023';
  end if;
  p_weeks := least(greatest(coalesce(p_weeks, 8), 1), 104);
  first_week := (date_trunc('week', now() at time zone p_tz))::date - 7 * (p_weeks - 1);
  since := (first_week - 21)::timestamp at time zone p_tz;   -- 3 weeks more, for workers_4w
  return query
  with weeks as (
    select (first_week + 7 * n) as ws from generate_series(0, p_weeks - 1) as n
  ),
  paid as (
    select b.employer_id, b.worker_id, b.agreed_wage,
           (date_trunc('week', b.worker_confirmed_at at time zone p_tz))::date as ws,
           exists (select 1 from public.bookings o
                    where o.employer_id = b.employer_id and o.worker_confirmed_at < b.worker_confirmed_at) as repeat_employer,
           exists (select 1 from public.bookings o
                    where o.employer_id = b.employer_id and o.worker_id = b.worker_id
                      and o.worker_confirmed_at < b.worker_confirmed_at) as same_worker
      from public.bookings b
      join public.workers w on w.id = b.worker_id
     where b.worker_confirmed_at >= since and not w.is_sample
  ),
  paid_by_week as (
    select paid.ws, count(*) as jobs, count(*) filter (where repeat_employer) as repeats,
           count(*) filter (where same_worker) as rehires, count(distinct worker_id) as workers,
           count(distinct employer_id) as employers, coalesce(sum(agreed_wage), 0)::bigint as amount
      from paid group by paid.ws
  ),
  posted as (
    select (date_trunc('week', b.created_at at time zone p_tz))::date as ws, count(*) as n
      from public.bookings b where b.created_at >= since group by 1
  ),
  new_w as (
    select (date_trunc('week', w.created_at at time zone p_tz))::date as ws, count(*) as n
      from public.workers w where w.created_at >= since and not w.is_sample group by 1
  ),
  new_e as (
    select (date_trunc('week', e.created_at at time zone p_tz))::date as ws, count(*) as n
      from public.employers e where e.created_at >= since group by 1
  )
  select wk.ws,
         coalesce(po.n, 0), coalesce(pw.jobs, 0), coalesce(pw.repeats, 0), coalesce(pw.rehires, 0),
         coalesce(pw.workers, 0), coalesce(pw.employers, 0),
         (select count(distinct paid.worker_id) from paid where paid.ws between wk.ws - 21 and wk.ws),
         coalesce(nw.n, 0), coalesce(ne.n, 0), coalesce(pw.amount, 0)
    from weeks wk
    left join paid_by_week pw on pw.ws = wk.ws
    left join posted po on po.ws = wk.ws
    left join new_w nw on nw.ws = wk.ws
    left join new_e ne on ne.ws = wk.ws
   order by wk.ws desc;
end $$;
revoke all on function public.admin_trial_numbers(int, text) from public, anon;
grant execute on function public.admin_trial_numbers(int, text) to authenticated;
