-- 018: trust and safety
-- 1. A switch to require a real account (Google or a verified mobile number) before posting or
--    taking a job. It starts off, so the live app keeps working until sign-in is set up; turn it on
--    with:  update public.app_settings set value = 'true' where key = 'require_verified';
-- 2. The phone number on a profile comes from the verified sign-in number when there is one.
-- 3. Limits on how fast one account can post jobs, send offers and file reports.
-- 4. Report and block: either side of a job can report the other and stop working with them.
--    Three people with real accounts reporting the same account put it on hold for 7 days until an
--    admin checks. Lifting the hold closes those reports, so it stays lifted.
-- 5. Admins (a short list of accounts) see reports and can suspend an account.

-- ---------- 1. Settings and account checks ----------
create table public.app_settings (
  key text primary key,
  value jsonb not null
);
alter table public.app_settings enable row level security;
create policy "read settings" on public.app_settings for select to anon, authenticated using (true);
insert into public.app_settings (key, value) values ('require_verified', 'false');

create function public.setting_on(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select value = 'true'::jsonb from public.app_settings where key = p_key), false)
$$;

-- Signed in with Google or a verified mobile number (not just the phone's anonymous account)
create function public.verified_account() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u
                  where u.id = auth.uid() and not coalesce(u.is_anonymous, false)
                    and (u.phone_confirmed_at is not null or u.email_confirmed_at is not null))
$$;

create table public.suspensions (
  auth_id uuid primary key,
  until timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 200),
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.suspensions enable row level security;

create table public.admins (
  auth_id uuid primary key,
  note text
);
alter table public.admins enable row level security;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.admins where auth_id = auth.uid())
$$;

create function public.suspended(p_auth uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_auth is not null and exists (select 1 from public.suspensions where auth_id = p_auth and until > now())
$$;

-- Raised before posting, taking or offering on a job. Server jobs (no signed-in user) pass.
create function public.assert_can_act() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  if public.suspended(auth.uid()) then
    raise exception 'suspended' using errcode = '42501';
  end if;
  if public.setting_on('require_verified') and not public.verified_account() then
    raise exception 'verify_first' using errcode = '42501';
  end if;
end $$;

-- What the app needs to know before it lets someone post or accept
create function public.my_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'verified', public.verified_account(),
    'require_verified', public.setting_on('require_verified'),
    'suspended_until', (select until from public.suspensions where auth_id = auth.uid() and until > now()),
    'admin', public.is_admin())
$$;

-- ---------- 2. The profile phone number comes from the verified sign-in number ----------
alter table public.workers add column phone_verified boolean not null default false;
alter table public.employers add column phone_verified boolean not null default false;

create function public.phone_from_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  select right(u.phone, 10) into p from auth.users u
   where u.id = new.auth_id and u.phone_confirmed_at is not null and u.phone ~ '^91[6-9][0-9]{9}$';
  if p is not null then
    new.phone := p;
    new.phone_verified := true;
  else
    new.phone_verified := false;
  end if;
  if tg_op = 'INSERT' and public.suspended(new.auth_id) then
    raise exception 'suspended' using errcode = '42501';
  end if;
  return new;
end $$;
-- Named so it runs after *_keep_stats, which has already put back the real auth_id
create trigger workers_phone_from_account before insert or update of phone, auth_id on public.workers
  for each row execute function public.phone_from_account();
create trigger employers_phone_from_account before insert or update of phone, auth_id on public.employers
  for each row execute function public.phone_from_account();

-- After adding a mobile number to an account: put it on this account's profiles
create function public.sync_my_phone() returns int
language plpgsql security definer set search_path = '' as $$
declare a int; b int;
begin
  if auth.uid() is null then return 0; end if;
  update public.workers set phone = phone where auth_id = auth.uid();
  get diagnostics a = row_count;
  update public.employers set phone = phone where auth_id = auth.uid();
  get diagnostics b = row_count;
  return a + b;
end $$;

-- ---------- 3 and 4. Blocks, then the checks on posting, taking and offering ----------
create table public.blocks (
  worker_id uuid not null references public.workers (id) on delete cascade,
  employer_id uuid not null references public.employers (id) on delete cascade,
  by_role text not null check (by_role in ('worker', 'employer')),
  created_at timestamptz not null default now(),
  primary key (worker_id, employer_id)
);
alter table public.blocks enable row level security;
create policy "read my blocks" on public.blocks for select to authenticated
  using (public.my_worker(worker_id) or public.my_employer(employer_id));

-- A block is between people, not single profiles: it also covers the same person's other
-- profiles (shared phone mode, or a second profile on the same account)
create function public.blocked_pair(p_worker uuid, p_employer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks bl
      join public.workers w on w.id = bl.worker_id
      join public.employers e on e.id = bl.employer_id
      join public.workers w2 on w2.id = p_worker
      join public.employers e2 on e2.id = p_employer
     where (bl.worker_id = w2.id or w.auth_id = w2.auth_id)
       and (bl.employer_id = e2.id or e.auth_id = e2.auth_id))
$$;

-- An open job I may see: not from someone I blocked or who blocked me, and not from a suspended account
create function public.job_visible(p_posted_by uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.blocks bl
                       join public.workers w on w.id = bl.worker_id
                       join public.employers e on e.id = bl.employer_id
                       join public.employers e2 on e2.id = p_posted_by
                      where w.auth_id = auth.uid() and (bl.employer_id = e2.id or e.auth_id = e2.auth_id))
     and not exists (select 1 from public.employers e where e.id = p_posted_by and public.suspended(e.auth_id))
$$;

drop policy "read my or open bookings" on public.bookings;
create policy "read my or open bookings" on public.bookings for select to authenticated
  using (public.my_employer(employer_id)
         or (worker_id is not null and public.my_worker(worker_id))
         or (status = 'searching' and public.i_work_as(type) and public.job_visible(employer_id)));

create function public.check_new_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n_hour int; n_day int;
begin
  if auth.uid() is null then return new; end if;   -- repeat jobs made by the server
  perform public.assert_can_act();
  select count(*) filter (where b.created_at > now() - interval '1 hour'), count(*)
    into n_hour, n_day
    from public.bookings b join public.employers e on e.id = b.employer_id
   where e.auth_id = auth.uid() and b.created_at > now() - interval '1 day';
  -- A team of 5 is 5 rows, so this is about 6 posts an hour
  if n_hour >= 30 or n_day >= 100 then
    raise exception 'slow_down' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger bookings_check_new before insert on public.bookings
  for each row execute function public.check_new_booking();

-- Someone takes the job (accept_booking, accept_offer)
create function public.check_new_worker() returns trigger
language plpgsql security definer set search_path = '' as $$
declare wa uuid; ea uuid;
begin
  if new.worker_id is null or new.worker_id is not distinct from old.worker_id then return new; end if;
  perform public.assert_can_act();
  select auth_id into wa from public.workers where id = new.worker_id;
  select auth_id into ea from public.employers where id = new.employer_id;
  if public.blocked_pair(new.worker_id, new.employer_id) or public.suspended(wa) or public.suspended(ea) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  -- One account on both sides of a job would make fake ratings and job counts. Checked only once
  -- real accounts are required: the demo runs both apps in one browser, on one anonymous account.
  if public.setting_on('require_verified') and wa is not null and wa = ea then
    raise exception 'own_job' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger bookings_check_worker before update of worker_id on public.bookings
  for each row execute function public.check_new_worker();

create function public.check_new_offer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then return new; end if;
  perform public.assert_can_act();
  if exists (select 1 from public.bookings b where b.id = new.booking_id
              and public.blocked_pair(new.worker_id, b.employer_id)) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  select count(*) into n from public.offers o join public.workers w on w.id = o.worker_id
   where w.auth_id = auth.uid() and o.created_at > now() - interval '10 minutes';
  if n >= 20 then
    raise exception 'slow_down' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger offers_check_new before insert on public.offers
  for each row execute function public.check_new_offer();

-- ---------- 4. Reports ----------
create table public.reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  reporter_auth uuid,
  reporter_verified boolean not null default false,
  booking_id uuid references public.bookings (id) on delete set null,
  by_role text not null check (by_role in ('worker', 'employer')),
  worker_id uuid references public.workers (id) on delete set null,
  employer_id uuid references public.employers (id) on delete set null,
  reason text not null check (reason in ('fake_job', 'no_pay', 'abuse', 'unsafe', 'no_show', 'other')),
  note text check (char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_note text check (char_length(closed_note) <= 300)
);
create index reports_open_idx on public.reports (status, created_at desc);
alter table public.reports enable row level security;
create policy "admins read reports" on public.reports for select to authenticated using (public.is_admin());

-- Either side of a job reports the other (and can block them at the same time)
create function public.report_person(p_booking uuid, p_by text, p_reason text, p_note text, p_block boolean)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; rid bigint; target uuid; n int;
begin
  perform public.assert_party(p_booking, p_by);
  perform public.assert_can_act();
  select * into b from public.bookings where id = p_booking;
  if b.worker_id is null then raise exception 'no_worker_yet' using errcode = '22023'; end if;
  select count(*) into n from public.reports where reporter_auth = auth.uid() and created_at > now() - interval '1 day';
  if n >= 10 then raise exception 'slow_down' using errcode = '54000'; end if;

  insert into public.reports (reporter_auth, reporter_verified, booking_id, by_role, worker_id, employer_id, reason, note)
  values (auth.uid(), public.verified_account(), b.id, p_by, b.worker_id, b.employer_id, p_reason,
          nullif(trim(coalesce(p_note, '')), ''))
  returning id into rid;

  if p_block then
    insert into public.blocks (worker_id, employer_id, by_role) values (b.worker_id, b.employer_id, p_by)
    on conflict do nothing;
  end if;

  -- Three different people with real accounts reporting the same account: on hold for 7 days
  -- until an admin looks. Anonymous accounts are free to make, so their reports don't count here.
  if p_by = 'worker' then
    select auth_id into target from public.employers where id = b.employer_id;
  else
    select auth_id into target from public.workers where id = b.worker_id;
  end if;
  if target is not null and not public.suspended(target) then
    select count(distinct r.reporter_auth) into n
      from public.reports r
      left join public.workers w on w.id = r.worker_id
      left join public.employers e on e.id = r.employer_id
     where r.status = 'open' and r.reporter_verified
       and ((r.by_role = 'worker' and e.auth_id = target) or (r.by_role = 'employer' and w.auth_id = target));
    if n >= 3 then
      insert into public.suspensions (auth_id, until, reason)
      values (target, now() + interval '7 days', 'Automatic hold: reported by 3 people')
      on conflict (auth_id) do update set until = greatest(public.suspensions.until, excluded.until),
                                          reason = excluded.reason, created_at = now(), created_by = null;
      update public.workers set online = false where auth_id = target;
    end if;
  end if;
  return rid;
end $$;

-- ---------- 5. Admin tools ----------
create function public.assert_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
end $$;

create function public.admin_reports(p_status text default 'open')
returns table (id bigint, created_at timestamptz, by_role text, reason text, note text, status text,
               booking_id uuid, worker_id uuid, worker_name text, worker_phone text, worker_auth uuid,
               employer_id uuid, employer_name text, employer_phone text, employer_auth uuid,
               target_auth uuid, target_reports bigint, target_suspended_until timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  return query
  with r as (
    select r.*, w.name wn, w.phone wp, w.auth_id wa, e.name en, e.phone ep, e.auth_id ea,
           case when r.by_role = 'worker' then e.auth_id else w.auth_id end ta
      from public.reports r
      left join public.workers w on w.id = r.worker_id
      left join public.employers e on e.id = r.employer_id
     where p_status is null or r.status = p_status
  )
  select r.id, r.created_at, r.by_role, r.reason, r.note, r.status, r.booking_id,
         r.worker_id, r.wn, r.wp, r.wa, r.employer_id, r.en, r.ep, r.ea, r.ta,
         (select count(*) from r r2 where r2.ta = r.ta),
         (select s.until from public.suspensions s where s.auth_id = r.ta and s.until > now())
    from r order by r.created_at desc limit 200;
end $$;

create function public.admin_suspend(p_auth uuid, p_days int, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  if p_auth is null or p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'bad_input' using errcode = '22023';
  end if;
  insert into public.suspensions (auth_id, until, reason, created_by)
  values (p_auth, now() + make_interval(days => p_days), left(coalesce(nullif(trim(p_reason), ''), 'Suspended by admin'), 200), auth.uid())
  on conflict (auth_id) do update set until = excluded.until, reason = excluded.reason,
                                      created_at = now(), created_by = excluded.created_by;
  update public.workers set online = false where auth_id = p_auth;
  return true;
end $$;

create function public.admin_unsuspend(p_auth uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  delete from public.suspensions where auth_id = p_auth;
  -- Close the reports against this account, or the next report would put the hold straight back
  update public.reports r set status = 'closed', closed_at = now(), closed_note = 'Hold lifted by an admin'
   where r.status = 'open'
     and ((r.by_role = 'worker' and exists (select 1 from public.employers e where e.id = r.employer_id and e.auth_id = p_auth))
       or (r.by_role = 'employer' and exists (select 1 from public.workers w where w.id = r.worker_id and w.auth_id = p_auth)));
  return true;
end $$;

create function public.admin_close_report(p_id bigint, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  update public.reports set status = 'closed', closed_at = now(), closed_note = left(nullif(trim(coalesce(p_note, '')), ''), 300)
   where id = p_id and status = 'open';
  return found;
end $$;

revoke execute on function public.admin_reports(text), public.admin_suspend(uuid, int, text),
  public.admin_unsuspend(uuid), public.admin_close_report(bigint, text) from public, anon;
revoke execute on function public.phone_from_account(), public.check_new_booking(), public.check_new_worker(),
  public.check_new_offer() from public, anon, authenticated;

-- ---------- Public profiles: show who has a verified number; hide suspended and deleted workers ----------
-- from everyone except employers who already have a job with them (for the pay slip and payment)
create or replace view public.workers_public with (security_barrier) as
  select id, name, skill, online, rating_sum, rating_count, jobs_done, is_sample, updated_at, experience_years,
         iti_cert, tools, home_state, city, lessons, available_days, clean_streak, is_mestri,
         round(lat::numeric, 2)::double precision as lat, round(lng::numeric, 2)::double precision as lng,
         phone_verified
    from public.workers
   where (not public.suspended(auth_id) and device_id not like 'deleted-%')
      or exists (select 1 from public.bookings b join public.employers e on e.id = b.employer_id
                  where b.worker_id = workers.id and e.auth_id = auth.uid());
create or replace view public.employers_public with (security_barrier) as
  select id, name, jobs, paid_on_time, rating_sum, rating_count, created_at, disputes, gstin, effort_refused,
         phone_verified
    from public.employers;
