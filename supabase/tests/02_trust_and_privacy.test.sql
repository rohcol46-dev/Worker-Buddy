-- Ownership, verified accounts, report/block, suspensions, limits, consent, export and delete.
-- Each check runs as a signed-in user, the way the app calls the database.
--   e1 employer (verified number)    a1 worker (verified number)    a2 worker (anonymous)
--   a3 worker with no jobs           e2 employer for the rate limit  ad admin
--   r1..r3 workers who report e3

-- A test helper: run SQL and expect a given error
create function pg_temp.expect_error(p_sql text, p_error text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error "%" from: %', p_error, p_sql using errcode = 'P0001', hint = 'test';
exception when others then
  if sqlerrm <> p_error then raise exception 'expected error "%" but got "%" from: %', p_error, sqlerrm, p_sql; end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

insert into auth.users (id, phone, phone_confirmed_at, email, email_confirmed_at, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000e1', '919800000001', now(), null, null, false),
  ('00000000-0000-0000-0000-0000000000e2', '919800000002', now(), null, null, false),
  ('00000000-0000-0000-0000-0000000000e3', '919800000003', now(), null, null, false),
  ('00000000-0000-0000-0000-0000000000a1', '919800000011', now(), null, null, false),
  ('00000000-0000-0000-0000-0000000000a2', null, null, null, null, true),
  ('00000000-0000-0000-0000-0000000000a3', null, null, 'a3@example.com', now(), false),
  ('00000000-0000-0000-0000-0000000000b1', '919800000021', now(), null, null, false),
  ('00000000-0000-0000-0000-0000000000b2', '919800000022', now(), null, null, false),
  ('00000000-0000-0000-0000-0000000000b3', '919800000023', now(), null, null, false),
  ('00000000-0000-0000-0000-0000000000ad', null, null, 'admin@example.com', now(), false);

insert into public.employers (id, device_id, name, phone, auth_id) values
  ('10000000-0000-0000-0000-0000000000e1', 'd-e1', 'Employer One', '9123456789', '00000000-0000-0000-0000-0000000000e1'),
  ('10000000-0000-0000-0000-0000000000e2', 'd-e2', 'Employer Two', '9123456780', '00000000-0000-0000-0000-0000000000e2'),
  ('10000000-0000-0000-0000-0000000000e3', 'd-e3', 'Employer Three', '9123456781', '00000000-0000-0000-0000-0000000000e3'),
  ('10000000-0000-0000-0000-0000000000a1', 'd-a1e', 'Worker One as employer', '9123456782', '00000000-0000-0000-0000-0000000000a1');
insert into public.workers (id, device_id, name, phone, skill, birth_year, online, auth_id) values
  ('20000000-0000-0000-0000-0000000000a1', 'd-a1', 'Worker One', '9111111111', 'mason', 1990, true, '00000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000a2', 'd-a2', 'Worker Two', '9111111112', 'mason', 1990, true, '00000000-0000-0000-0000-0000000000a2'),
  ('20000000-0000-0000-0000-0000000000a3', 'd-a3', 'Worker Three', '9111111113', 'mason', 1990, true, '00000000-0000-0000-0000-0000000000a3'),
  ('20000000-0000-0000-0000-0000000000b1', 'd-b1', 'Reporter One', '9111111121', 'mason', 1990, true, '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000b2', 'd-b2', 'Reporter Two', '9111111122', 'mason', 1990, true, '00000000-0000-0000-0000-0000000000b2'),
  ('20000000-0000-0000-0000-0000000000b3', 'd-b3', 'Reporter Three', '9111111123', 'mason', 1990, true, '00000000-0000-0000-0000-0000000000b3');
insert into public.admins (auth_id, note) values ('00000000-0000-0000-0000-0000000000ad', 'test admin');

-- The profile phone is the verified sign-in number; an anonymous account keeps the typed number
do $$ begin
  assert (select phone from public.employers where id = '10000000-0000-0000-0000-0000000000e1') = '9800000001', 'employer phone from account';
  assert (select phone_verified from public.workers where id = '20000000-0000-0000-0000-0000000000a1'), 'worker phone verified';
  assert (select phone from public.workers where id = '20000000-0000-0000-0000-0000000000a2') = '9111111112', 'anonymous keeps typed phone';
  assert not (select phone_verified from public.workers where id = '20000000-0000-0000-0000-0000000000a2'), 'anonymous not verified';
end $$;

-- Jobs to work with, for 10 AM tomorrow (night jobs need a GST number)
create temp table ids (name text primary key, id uuid);
grant select on ids to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
with made as (
  insert into public.bookings (employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, scheduled_for)
  select '10000000-0000-0000-0000-0000000000e1', 'mason', 'Guindy', 8, 'light', 700, 900, 800,
         date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day 10 hours'
  from generate_series(1, 3)
  returning id
)
select 1;
reset role;
insert into ids select 'job' || row_number() over (order by id), id from public.bookings
 where employer_id = '10000000-0000-0000-0000-0000000000e1';

-- Someone else can't take a job on a worker's behalf
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
select pg_temp.expect_error(format('select public.accept_booking(%L, %L)', (select id from ids where name = 'job1'),
  '20000000-0000-0000-0000-0000000000a1'), 'not_yours');
-- Signed-out style reads: no phone numbers in the public profile view
select pg_temp.expect_error('select phone from public.workers', 'permission denied for table workers');

-- With "require a verified account" on, an anonymous account can't take a job
reset role;
update public.app_settings set value = 'true' where key = 'require_verified';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
do $$ begin
  assert (public.my_status() ->> 'require_verified')::boolean, 'status shows the switch';
  assert not (public.my_status() ->> 'verified')::boolean, 'anonymous is not verified';
end $$;
select pg_temp.expect_error(format('select public.accept_booking(%L, %L)', (select id from ids where name = 'job1'),
  '20000000-0000-0000-0000-0000000000a2'), 'verify_first');
-- A verified worker can
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin
  assert (public.accept_booking((select id from ids where name = 'job1'), '20000000-0000-0000-0000-0000000000a1')).status = 'assigned',
    'verified worker accepts';
end $$;

-- One account can't be both sides of a job
with made as (
  insert into public.bookings (employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, scheduled_for)
  values ('10000000-0000-0000-0000-0000000000a1', 'mason', 'Adyar', 8, 'light', 700, 900, 800,
          date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day 10 hours')
  returning id
)
select set_config('test.own_job', (select id::text from made), false);
select pg_temp.expect_error(format('select public.accept_booking(%L, %L)', current_setting('test.own_job'),
  '20000000-0000-0000-0000-0000000000a1'), 'own_job');

-- Only the people on a job can report it; the worker reports and blocks the employer
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
select pg_temp.expect_error(format('select public.report_person(%L, %L, %L, %L, %L)', (select id from ids where name = 'job1'),
  'worker', 'no_pay', 'x', true), 'not_yours');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin
  assert public.report_person((select id from ids where name = 'job1'), 'worker', 'unsafe', 'No helmet given', true) > 0, 'report saved';
  assert (select count(*) from public.blocks) = 1, 'block saved and visible to me';
  assert (select count(*) from public.reports) = 0, 'reports are not readable by users';
  -- The blocked employer's other open jobs disappear and can't be taken
  assert not exists (select 1 from public.bookings where id = (select id from ids where name = 'job2')), 'blocked job hidden';
end $$;
select pg_temp.expect_error(format('select public.accept_booking(%L, %L)', (select id from ids where name = 'job2'),
  '20000000-0000-0000-0000-0000000000a1'), 'blocked');
-- The block covers the same person's other profile too
reset role;
insert into public.workers (id, device_id, name, phone, skill, birth_year, online, auth_id) values
  ('20000000-0000-0000-0000-0000000000a9', 'd-a9', 'Worker One again', '9111111119', 'mason', 1990, true,
   '00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.expect_error(format('select public.accept_booking(%L, %L)', (select id from ids where name = 'job2'),
  '20000000-0000-0000-0000-0000000000a9'), 'blocked');
select pg_temp.expect_error('select * from public.admin_reports()', 'not_admin');

-- The admin sees the report and suspends the employer, who then can't post
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', false);
do $$ begin
  assert (select count(*) from public.admin_reports() where reason = 'unsafe') = 1, 'admin sees the report';
  assert public.admin_suspend('00000000-0000-0000-0000-0000000000e1', 3, 'Test suspension'), 'suspended';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select pg_temp.expect_error($q$insert into public.bookings (employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, scheduled_for)
  values ('10000000-0000-0000-0000-0000000000e1', 'mason', 'Guindy', 8, 'light', 700, 900, 800,
          date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day 10 hours')$q$, 'suspended');
do $$ begin
  assert (public.my_status() ->> 'suspended_until') is not null, 'status shows the suspension';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', false);
do $$ begin assert public.admin_unsuspend('00000000-0000-0000-0000-0000000000e1'), 'unsuspended'; end $$;

-- Posting limit: 30 job rows an hour per account
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false);
insert into public.bookings (employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, scheduled_for)
select '10000000-0000-0000-0000-0000000000e2', 'painter', 'Velachery', 8, 'light', 700, 900, 800,
       date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '2 days 10 hours'
  from generate_series(1, 30);
select pg_temp.expect_error($q$insert into public.bookings (employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, scheduled_for)
  values ('10000000-0000-0000-0000-0000000000e2', 'painter', 'Velachery', 8, 'light', 700, 900, 800,
          date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '2 days 10 hours')$q$, 'slow_down');

-- Three different workers reporting one employer put that account on hold
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e3', false);
insert into public.bookings (employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, scheduled_for)
select '10000000-0000-0000-0000-0000000000e3', 'mason', 'Tambaram', 8, 'light', 700, 900, 800,
       date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day 10 hours'
  from generate_series(1, 3);
reset role;
insert into ids select 'e3job' || row_number() over (order by id), id from public.bookings
 where employer_id = '10000000-0000-0000-0000-0000000000e3';
set role authenticated;
do $$
declare i int;
begin
  for i in 1..3 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b' || i, false);
    perform public.accept_booking((select id from ids where name = 'e3job' || i), ('20000000-0000-0000-0000-0000000000b' || i)::uuid);
    perform public.report_person((select id from ids where name = 'e3job' || i), 'worker', 'fake_job', null, false);
  end loop;
end $$;
reset role;
do $$ begin
  assert public.suspended('00000000-0000-0000-0000-0000000000e3'), 'three reports put the account on hold';
end $$;

-- An account on hold can't delete itself to escape the hold
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e3', false);
select pg_temp.expect_error('select public.delete_my_account()', 'suspended');
-- The hidden employer's jobs are still on the reporters' own job lists
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ begin
  assert exists (select 1 from public.bookings where id = (select id from ids where name = 'e3job1')), 'my own job stays visible';
end $$;

-- Lifting the hold closes the reports, so one more report doesn't bring it back
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', false);
do $$ begin assert public.admin_unsuspend('00000000-0000-0000-0000-0000000000e3'), 'hold lifted'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select public.report_person((select id from ids where name = 'e3job1'), 'worker', 'other', 'again', false);
reset role;
do $$ begin
  assert not public.suspended('00000000-0000-0000-0000-0000000000e3'), 'hold stays lifted';
end $$;

-- Reports from anonymous accounts never trigger the automatic hold
update public.app_settings set value = 'false' where key = 'require_verified';
insert into auth.users (id, is_anonymous) select ('00000000-0000-0000-0000-0000000000c' || i)::uuid, true from generate_series(1, 3) i;
insert into auth.users (id, phone, phone_confirmed_at, is_anonymous) values ('00000000-0000-0000-0000-0000000000e4', '919800000004', now(), false);
insert into public.workers (id, device_id, name, phone, skill, birth_year, online, auth_id)
select ('20000000-0000-0000-0000-0000000000c' || i)::uuid, 'd-c' || i, 'Anon ' || i, '911111113' || i, 'helper', 1990, true,
       ('00000000-0000-0000-0000-0000000000c' || i)::uuid from generate_series(1, 3) i;
insert into public.employers (id, device_id, name, phone, auth_id) values
  ('10000000-0000-0000-0000-0000000000e4', 'd-e4', 'Employer Four', '9123456784', '00000000-0000-0000-0000-0000000000e4');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e4', false);
insert into public.bookings (employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, scheduled_for)
select '10000000-0000-0000-0000-0000000000e4', 'helper', 'Porur', 8, 'light', 700, 900, 800,
       date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 10 hours'
  from generate_series(1, 3);
reset role;
insert into ids select 'e4job' || row_number() over (order by id), id from public.bookings
 where employer_id = '10000000-0000-0000-0000-0000000000e4';
set role authenticated;
do $$
declare i int;
begin
  for i in 1..3 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c' || i, false);
    perform public.accept_booking((select id from ids where name = 'e4job' || i), ('20000000-0000-0000-0000-0000000000c' || i)::uuid);
    perform public.report_person((select id from ids where name = 'e4job' || i), 'worker', 'fake_job', null, false);
  end loop;
end $$;
reset role;
do $$ begin
  assert not public.suspended('00000000-0000-0000-0000-0000000000e4'), 'anonymous reports alone cause no hold';
end $$;
update public.app_settings set value = 'true' where key = 'require_verified';

-- Consent and data export
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare d jsonb;
begin
  assert public.give_consent('2026-10', 'ta'), 'consent saved';
  assert (select count(*) from public.consents) = 1, 'I see my consent';
  d := public.export_my_data();
  assert jsonb_array_length(d -> 'worker_profiles') = 2, 'export has both my worker profiles';
  assert jsonb_array_length(d -> 'jobs') >= 1, 'export has my jobs';
  assert not (d -> 'worker_profiles' -> 0 ? 'device_id'), 'export leaves out the device id';
end $$;

-- Delete: not while a job is in progress
select pg_temp.expect_error('select public.delete_my_account()', 'finish_jobs_first');
reset role;
update public.bookings set status = 'paid', paid_at = now() where id = (select id from ids where name = 'job1');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.delete_my_account();
reset role;
do $$ begin
  assert (select name from public.workers where id = '20000000-0000-0000-0000-0000000000a1') = 'Deleted user',
    'a worker with past jobs is anonymised';
  assert (select auth_id from public.workers where id = '20000000-0000-0000-0000-0000000000a1') is null, 'no owner left';
  assert not exists (select 1 from public.workers_public where id = '20000000-0000-0000-0000-0000000000a1'), 'hidden from employers';
  assert (select lat from public.bookings where id = (select id from ids where name = 'job1')) is null, 'job location wiped';
  assert not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a1'), 'sign-in removed';
  assert not exists (select 1 from public.consents where auth_id = '00000000-0000-0000-0000-0000000000a1'), 'consent removed';
end $$;

-- A worker with no jobs disappears completely
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
select public.delete_my_account();
reset role;
do $$ begin
  assert not exists (select 1 from public.workers where id = '20000000-0000-0000-0000-0000000000a3'), 'profile deleted';
end $$;

select 'trust and privacy: ok' as result;
