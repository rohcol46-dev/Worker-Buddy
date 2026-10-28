-- 032: "Check this employer" (workers only, no personal details, daily limit) and trial numbers (admins only).
--   d1 employer with a record    d3 worker who checks    d2 employer who tries to check    d4 admin
reset role;
create function pg_temp.expect_error(p_sql text, p_error text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error "%" from: %', p_error, p_sql using errcode = 'P0001', hint = 'test';
exception when others then
  if sqlerrm <> p_error then raise exception 'expected error "%" but got "%" from: %', p_error, sqlerrm, p_sql; end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated, anon;

update public.app_settings set value = 'false' where key = 'require_verified';
insert into auth.users (id, phone, phone_confirmed_at, email, email_confirmed_at, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000d1', '919800000088', now(), null, null, false),
  ('00000000-0000-0000-0000-0000000000d2', '919800000089', now(), null, null, false),
  ('00000000-0000-0000-0000-0000000000d3', '919800000087', now(), null, null, false),
  ('00000000-0000-0000-0000-0000000000d4', null, null, 'trial-admin@example.com', now(), false);
insert into public.admins (auth_id) values ('00000000-0000-0000-0000-0000000000d4');
insert into public.employers (id, device_id, name, phone, auth_id, country) values
  ('10000000-0000-0000-0000-0000000000d1', 'd-d1', 'Employer Eight', '9123456888', '00000000-0000-0000-0000-0000000000d1', 'IN'),
  ('10000000-0000-0000-0000-0000000000d2', 'd-d2', 'Employer Nine', '9123456999', '00000000-0000-0000-0000-0000000000d2', 'IN');
insert into public.workers (id, device_id, name, phone, skill, birth_year, auth_id) values
  ('20000000-0000-0000-0000-0000000000d3', 'd-d3', 'Worker Eight', '9111111188', 'painter', 1990,
   '00000000-0000-0000-0000-0000000000d3');

-- Employers' phone comes from their verified number (018): d1 is +919800000088, d2 +919800000089.
-- A record for d1: two confirmed-paid jobs with the same worker (the second is a repeat hire),
-- workers tagged water twice and shade once, and one job closed unpaid after the work started
alter table public.employers disable trigger user;   -- the counters are normally changed only by the job functions
update public.employers set jobs = 3, paid_on_time = 2, rating_sum = 9, rating_count = 2, disputes = 1
 where id = '10000000-0000-0000-0000-0000000000d1';
-- An impostor profile that typed d1's number without confirming it, with a bad record
insert into public.employers (id, device_id, name, phone, disputes, phone_verified) values
  ('10000000-0000-0000-0000-0000000000d5', 'd-d5', 'Impostor', '+919800000088', 5, false),
  ('10000000-0000-0000-0000-0000000000d6', 'd-d6', 'Unconfirmed', '+919800000066', 2, false);
alter table public.employers enable trigger user;
alter table public.bookings disable trigger user;
insert into public.bookings (employer_id, worker_id, type, area, hours, load, wage_min, wage_max, agreed_wage, otp, status,
                             worker_confirmed_at, employer_tags, cancel_reason) values
  ('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d3', 'painter', 'Adyar', 8, 'light',
   700, 900, 800, '1234', 'paid', now() - interval '1 hour', '{gaveWater,gaveShade}', null),
  ('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d3', 'painter', 'Adyar', 8, 'light',
   700, 900, 800, '1234', 'paid', now(), '{gaveWater}', null),
  ('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d3', 'painter', 'Adyar', 8, 'light',
   700, 900, 800, '1234', 'cancelled', null, '{}', 'employer_unpaid');
alter table public.bookings enable trigger user;

-- Signed out: no access
set role anon;
select pg_temp.expect_error($$select public.check_employer('9800000088')$$, 'permission denied for function check_employer');
select pg_temp.expect_error($$select * from public.admin_trial_numbers()$$, 'permission denied for function admin_trial_numbers');

-- An employer can't use it (workers only)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
select pg_temp.expect_error($$select public.check_employer('9800000088')$$, 'workers_only');
select pg_temp.expect_error($$select * from public.admin_trial_numbers()$$, 'not_admin');

-- The worker checks d1 in any common way of writing the number, and sees the record without personal details
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', false);
do $$ declare r jsonb; begin
  r := public.check_employer('+91 98000 00088');
  assert (r->>'found')::boolean, 'found by +91 form';
  assert (r->>'jobs')::int = 3 and (r->>'paid_on_time')::int = 2, 'jobs and paid on time';
  assert (r->>'rating_sum')::int = 9 and (r->>'rating_count')::int = 2, 'stars';
  assert (r->>'verified')::boolean, 'confirmed number';
  assert (r->>'not_paid')::int = 1 and (r->>'unpaid_cancels')::int = 1, 'not paid and unpaid cancels';
  assert (r->'tags'->>'gaveWater')::int = 2 and (r->'tags'->>'gaveShade')::int = 1, 'welfare tags counted';
  assert not (r ? 'name') and not (r ? 'phone') and not (r ? 'id') and r::text !~ 'Employer Eight' and r::text !~ '9800000088',
    'no name, phone or id';
  assert (public.check_employer('09800000088')->>'found')::boolean, 'found with a leading 0';
  assert not (public.check_employer('9000000001')->>'found')::boolean, 'unknown number';
  r := public.check_employer('9800000066');
  assert (r->>'found')::boolean and not (r->>'verified')::boolean and (r->>'not_paid')::int = 2,
    'only unconfirmed profiles: shown, marked not confirmed';
end $$;
select pg_temp.expect_error($$select public.check_employer('12345')$$, 'bad_phone');

-- A deleted employer is not found
reset role;
alter table public.employers disable trigger user;
update public.employers set device_id = 'deleted-' || id where id = '10000000-0000-0000-0000-0000000000d2';
alter table public.employers enable trigger user;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', false);
do $$ begin
  assert not (public.check_employer('9800000089')->>'found')::boolean, 'deleted employer hidden';
end $$;

-- 30 checks a day, then "slow_down" (bad numbers don't count: 5 good ones so far)
do $$ begin
  for i in 1..25 loop perform public.check_employer('9000000002'); end loop;
end $$;
select pg_temp.expect_error($$select public.check_employer('9800000088')$$, 'slow_down');
select pg_temp.expect_error($$insert into public.employer_checks (auth_id) values (auth.uid())$$,
  'permission denied for table employer_checks');

-- The admin sees this week's numbers
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', false);
do $$ declare r record; n int; begin
  select count(*) into n from public.admin_trial_numbers(4);
  assert n = 4, 'one row per week';
  select * into r from public.admin_trial_numbers(4) limit 1;
  assert r.week_start = (date_trunc('week', now() at time zone 'Asia/Kolkata'))::date, 'newest week first';
  assert r.paid_jobs >= 2 and r.repeat_jobs >= 1 and r.rehired_jobs >= 1, 'paid, repeat and rehired jobs';
  assert r.workers_4w >= 1 and r.active_workers >= 1 and r.active_employers >= 1 and r.paid_amount >= 1600, 'active people and amount';
  assert r.new_workers >= 1 and r.new_employers >= 2, 'sign-ups';
end $$;
select pg_temp.expect_error($$select * from public.admin_trial_numbers(4, 'Mars/Base')$$, 'unknown time zone Mars/Base');

reset role;
select 'check employer and trial numbers: ok' as result;
