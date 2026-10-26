-- 020: keep working when many people use it
-- 1. A "now" job expires on the server 10 minutes after it is posted, even if the employer's
--    phone is closed, and can't be accepted after that.
-- 2. "Online" times out: the worker app says "still here" every 4 minutes while online, and a
--    worker with no sign for 30 minutes is set offline.
-- 3. The six sample workers from 001 no longer show to employers as if they were real.
-- 4. Employers' phones load only nearby online workers (index for the area search).
-- 5. Script errors from phones are saved in client_errors, a few per person per hour.
-- 6. admin_weekly_metrics: jobs posted, taken, started, paid and confirmed each week
--    (confirmed-paid jobs per week is the main number to grow). Only readable in the SQL editor.
create extension if not exists pg_cron;

-- ---------- 1. Jobs expire on the server ----------
create function public.expire_old_jobs() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.bookings
     set status = 'expired', cancel_reason = 'expired', showup_pay = 0
   where status = 'searching' and scheduled_for is null
     and created_at < now() - interval '10 minutes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_old_jobs() from public, anon, authenticated;

select cron.schedule('worker-buddy-expire-jobs', '* * * * *', 'select public.expire_old_jobs()');

-- Accepting: same as 006 (with the ownership check 012 added), plus a "now" job older than
-- 10 minutes can't be taken even in the minute before expire_old_jobs runs
create or replace function public.accept_booking(p_booking uuid, p_worker uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; w public.workers;
begin
  perform public.assert_mine(p_worker, null);
  select * into w from public.workers where id = p_worker and not is_sample;
  if w.id is null then return null; end if;
  update public.bookings
     set status = 'assigned', worker_id = p_worker, accepted_at = now(),
         travel_pay = public.travel_pay_for(lat, lng, w.lat, w.lng)
   where id = p_booking and status = 'searching' and type = w.skill
     and (preferred_worker_id is null or preferred_worker_id = p_worker)
     and (priority_ids is null or p_worker = any(priority_ids) or now() > created_at + interval '60 seconds')
     and (w.online or scheduled_for is not null)
     and (scheduled_for is not null or created_at > now() - interval '10 minutes')
  returning * into b;
  return b;
end $$;

-- ---------- 2. "Online" times out ----------
alter table public.workers add column last_seen_at timestamptz not null default now();

-- Going online (or moving) counts as a sign of life
create function public.touch_worker_seen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.online and (not old.online or new.lat is distinct from old.lat or new.lng is distinct from old.lng) then
    new.last_seen_at := now();
  end if;
  return new;
end $$;
create trigger workers_touch_seen before update on public.workers
  for each row execute function public.touch_worker_seen();

-- The worker app calls this every 4 minutes while online
create function public.worker_seen(p_worker uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_mine(p_worker, null);
  update public.workers set last_seen_at = now() where id = p_worker and online;
  return found;
end $$;
revoke all on function public.worker_seen(uuid) from public, anon;
grant execute on function public.worker_seen(uuid) to authenticated;

create function public.offline_quiet_workers() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.workers set online = false
   where online and last_seen_at < now() - interval '30 minutes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.offline_quiet_workers() from public, anon, authenticated;

select cron.schedule('worker-buddy-offline-quiet', '*/5 * * * *', 'select public.offline_quiet_workers()');

-- ---------- 3. Sample workers ----------
update public.workers set online = false where is_sample;
-- Same view as 018, without the sample workers
create or replace view public.workers_public with (security_barrier) as
  select id, name, skill, online, rating_sum, rating_count, jobs_done, is_sample, updated_at, experience_years,
         iti_cert, tools, home_state, city, lessons, available_days, clean_streak, is_mestri,
         round(lat::numeric, 2)::double precision as lat, round(lng::numeric, 2)::double precision as lng,
         phone_verified
    from public.workers
   where not is_sample
     and ((not public.suspended(auth_id) and device_id not like 'deleted-%')
          or exists (select 1 from public.bookings b join public.employers e on e.id = b.employer_id
                      where b.worker_id = workers.id and e.auth_id = auth.uid()));

-- ---------- 4. Area search for the employer map ----------
create index workers_online_area_idx on public.workers (lat, lng) where online;

-- ---------- 5. Script errors from phones ----------
create table public.client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  auth_id uuid,
  page text,
  message text,
  stack text,
  agent text
);
create index client_errors_at_idx on public.client_errors (at);
alter table public.client_errors enable row level security;
-- No policies: nobody reads or writes it directly; log_client_error writes, the team reads in the SQL editor
revoke all on public.client_errors from anon, authenticated;

create function public.log_client_error(p_page text, p_message text, p_stack text, p_agent text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  -- 20 per person per hour, and 500 an hour from people not signed in, so it can't fill the database
  if auth.uid() is not null then
    if (select count(*) from public.client_errors
         where auth_id = auth.uid() and at > now() - interval '1 hour') >= 20 then return false; end if;
  elsif (select count(*) from public.client_errors
          where auth_id is null and at > now() - interval '1 hour') >= 500 then return false;
  end if;
  insert into public.client_errors (auth_id, page, message, stack, agent)
  values (auth.uid(), left(p_page, 100), left(p_message, 300), left(p_stack, 2000), left(p_agent, 300));
  -- keep 30 days
  delete from public.client_errors where at < now() - interval '30 days';
  return true;
end $$;
revoke all on function public.log_client_error(text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text) to anon, authenticated;

-- ---------- 6. Weekly numbers ----------
-- Weeks start on Monday, UTC. "Confirmed paid" = the worker confirmed the money arrived.
-- "Repeat hires" = paid jobs where the same employer had paid the same worker before.
create view public.admin_weekly_metrics with (security_invoker = true) as
  with b as (
    select *, date_trunc('week', created_at at time zone 'UTC')::date as week,
           exists (select 1 from public.bookings p
                    where p.employer_id = x.employer_id and p.worker_id = x.worker_id
                      and p.worker_confirmed_at is not null and p.created_at < x.created_at) as repeat_pair
      from public.bookings x
  )
  select week,
         count(*)                                                    as jobs_posted,
         count(*) filter (where accepted_at is not null)             as jobs_taken,
         count(*) filter (where started_at is not null)              as jobs_started,
         count(*) filter (where status = 'paid' or paid_at is not null) as jobs_paid,
         count(*) filter (where worker_confirmed_at is not null)     as jobs_confirmed_paid,
         count(*) filter (where worker_confirmed_at is not null and repeat_pair) as repeat_hires,
         count(*) filter (where status = 'expired')                  as jobs_expired,
         count(*) filter (where status = 'cancelled')                as jobs_cancelled,
         count(distinct employer_id)                                 as employers,
         count(distinct worker_id)                                   as workers
    from b
   group by week
   order by week desc;
revoke all on public.admin_weekly_metrics from anon, authenticated;
