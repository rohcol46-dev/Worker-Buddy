-- Jobs expire on the server, "online" times out, sample workers are hidden, error reports are capped,
-- and the weekly numbers count confirmed-paid jobs.
--   e9 employer    w9 worker (mason)    w8 another account
reset role;
-- A test helper: run SQL and expect a given error
create function pg_temp.expect_error(p_sql text, p_error text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error "%" from: %', p_error, p_sql using errcode = 'P0001', hint = 'test';
exception when others then
  if sqlerrm <> p_error then raise exception 'expected error "%" but got "%" from: %', p_error, sqlerrm, p_sql; end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

update public.app_settings set value = 'false' where key = 'require_verified';

insert into auth.users (id, phone, phone_confirmed_at, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000e9', '919800000099', now(), false),
  ('00000000-0000-0000-0000-0000000000f9', '919800000098', now(), false),
  ('00000000-0000-0000-0000-0000000000f8', '919800000097', now(), false);
insert into public.employers (id, device_id, name, phone, auth_id) values
  ('10000000-0000-0000-0000-0000000000e9', 'd-e9', 'Employer Nine', '9123456799', '00000000-0000-0000-0000-0000000000e9');
insert into public.workers (id, device_id, name, phone, skill, birth_year, online, lat, lng, auth_id) values
  ('20000000-0000-0000-0000-0000000000f9', 'd-f9', 'Worker Nine', '9111111199', 'painter', 1990, true, 13.0, 80.2,
   '00000000-0000-0000-0000-0000000000f9'),
  ('20000000-0000-0000-0000-0000000000f8', 'd-f8', 'Worker Eight', '9111111198', 'painter', 1990, true, 13.0, 80.2,
   '00000000-0000-0000-0000-0000000000f8');

-- A "now" job posted 11 minutes ago and one posted just now
insert into public.bookings (id, employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, created_at) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000e9', 'painter', 'Adyar', 8, 'light', 700, 900, 800,
   now() - interval '11 minutes'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000e9', 'painter', 'Adyar', 8, 'light', 700, 900, 800, now());

-- An old "now" job can't be taken, even before the expiry job runs; a fresh one can
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f9', false);
do $$ begin
  assert (public.accept_booking('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000f9')).id is null,
    'old job not taken';
  assert (public.accept_booking('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000f9')).status = 'assigned',
    'fresh job taken';
end $$;
-- Signed-in users can't run the server jobs
select pg_temp.expect_error('select public.expire_old_jobs()', 'permission denied for function expire_old_jobs');
select pg_temp.expect_error('select public.offline_quiet_workers()', 'permission denied for function offline_quiet_workers');
reset role;

-- The expiry job closes only the old "now" job
do $$ begin
  assert public.expire_old_jobs() = 1, 'one job expired';
  assert (select status from public.bookings where id = '30000000-0000-0000-0000-000000000001') = 'expired', 'old job expired';
  assert (select status from public.bookings where id = '30000000-0000-0000-0000-000000000002') = 'assigned', 'taken job untouched';
end $$;

-- "Online" times out after 30 minutes with no sign; worker_seen keeps a worker online
update public.workers set last_seen_at = now() - interval '40 minutes'
 where id in ('20000000-0000-0000-0000-0000000000f9', '20000000-0000-0000-0000-0000000000f8');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f9', false);
select pg_temp.expect_error($$select public.worker_seen('20000000-0000-0000-0000-0000000000f8')$$, 'not_yours');
do $$ begin
  assert public.worker_seen('20000000-0000-0000-0000-0000000000f9'), 'heartbeat saved';
end $$;
reset role;
do $$ begin
  assert public.offline_quiet_workers() >= 1, 'quiet worker set offline';
  assert (select online from public.workers where id = '20000000-0000-0000-0000-0000000000f9'), 'worker with a heartbeat stays online';
  assert not (select online from public.workers where id = '20000000-0000-0000-0000-0000000000f8'), 'quiet worker offline';
end $$;

-- Going online again counts as a sign of life
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f8', false);
update public.workers set online = true where id = '20000000-0000-0000-0000-0000000000f8';
reset role;
do $$ begin
  assert (select last_seen_at > now() - interval '1 minute' from public.workers where id = '20000000-0000-0000-0000-0000000000f8'),
    'going online updates last_seen_at';
end $$;

-- Sample workers are offline and not in the public view
do $$ begin
  assert not exists (select 1 from public.workers where is_sample and online), 'samples offline';
  assert not exists (select 1 from public.workers_public where is_sample), 'samples hidden';
  assert exists (select 1 from public.workers_public where id = '20000000-0000-0000-0000-0000000000f9'), 'real worker shown';
end $$;

-- Error reports: anyone can send, nobody can read, 20 per person per hour
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f9', false);
do $$ begin
  for i in 1..25 loop perform public.log_client_error('/worker/', 'boom ' || i, 'stack', 'agent'); end loop;
end $$;
select pg_temp.expect_error('select * from public.client_errors', 'permission denied for table client_errors');
select pg_temp.expect_error('select * from public.admin_weekly_metrics', 'permission denied for view admin_weekly_metrics');
reset role;
do $$ begin
  assert (select count(*) from public.client_errors where auth_id = '00000000-0000-0000-0000-0000000000f9') = 20, 'capped at 20';
end $$;

-- Weekly numbers: a paid job the worker confirmed, then a repeat hire of the same worker
update public.bookings set status = 'paid', paid_at = now(), worker_confirmed_at = now(), created_at = now() - interval '1 minute'
 where id = '30000000-0000-0000-0000-000000000002';
insert into public.bookings (employer_id, worker_id, type, area, hours, load, wage_min, wage_max, agreed_wage,
                             status, accepted_at, paid_at, worker_confirmed_at) values
  ('10000000-0000-0000-0000-0000000000e9', '20000000-0000-0000-0000-0000000000f9', 'painter', 'Adyar', 8, 'light',
   700, 900, 800, 'paid', now(), now(), now());
do $$ declare m record; begin
  select * into m from public.admin_weekly_metrics
   where week = date_trunc('week', now() at time zone 'UTC')::date;
  assert m.jobs_confirmed_paid >= 2, 'confirmed-paid jobs counted';
  assert m.repeat_hires >= 1, 'repeat hire counted';
  assert m.jobs_expired >= 1, 'expired job counted';
end $$;

select 'scale and reliability: ok' as result;
