-- Country packs: phone numbers in international form, a job's country and currency, time zones.
-- Adds a test country (Kenya) next to India.
--   f1 employer in Kenya (verified number)   f2 worker in Kenya (anonymous)

create function pg_temp.expect_error(p_sql text, p_error text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error "%" from: %', p_error, p_sql using errcode = 'P0001', hint = 'test';
exception when others then
  if sqlerrm <> p_error then raise exception 'expected error "%" but got "%" from: %', p_error, sqlerrm, p_sql; end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated, anon;
create temp table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated;

insert into public.countries (code, name, live, currency, calling_code, phone_pattern, phone_example, time_zone, emergency, languages)
values ('KE', 'Kenya', false, 'KES', '254', '[17][0-9]{8}', '712345678', 'Africa/Nairobi', '999', '{en,sw}');

-- A country with a wrong time zone or an example that doesn't fit its own phone format is refused
select pg_temp.expect_error($$insert into public.countries (code, name, currency, calling_code, phone_pattern, phone_example, time_zone, emergency, languages)
  values ('XX', 'Nowhere', 'XXX', '999', '[0-9]{8}', '12345678', 'Mars/Olympus', '112', '{en}')$$, 'unknown time zone Mars/Olympus');
select pg_temp.expect_error($$insert into public.countries (code, name, currency, calling_code, phone_pattern, phone_example, time_zone, emergency, languages)
  values ('XX', 'Nowhere', 'XXX', '999', '[0-9]{8}', '1234', 'UTC', '112', '{en}')$$, 'phone_example does not match phone_pattern');

-- Phone numbers typed every common way end up the same
do $$ begin
  assert public.phone_e164('9876543210', 'IN') = '+919876543210', 'IN local';
  assert public.phone_e164('098765 43210', 'IN') = '+919876543210', 'IN with 0 and space';
  assert public.phone_e164('919876543210', 'IN') = '+919876543210', 'IN with calling code';
  assert public.phone_e164('+91 98765-43210', 'IN') = '+919876543210', 'IN international';
  assert public.phone_e164('5876543210', 'IN') is null, 'IN must start 6 to 9';
  assert public.phone_e164('12345', 'IN') is null, 'too short';
  assert public.phone_e164('0712345678', 'KE') = '+254712345678', 'KE local with 0';
  assert public.phone_e164('+254 712 345 678', 'KE') = '+254712345678', 'KE international';
  assert public.phone_e164('+254 812 345 678', 'KE') is null, 'KE wrong prefix';
  assert public.phone_e164('+919876543210', 'KE') = '+919876543210', 'foreign number written internationally is kept';
  assert public.phone_e164('9876543210', 'KE') is null, 'Indian number typed locally is not Kenyan';
  assert public.phone_e164('9876543210', 'ZZ') is null, 'unknown country';
end $$;

insert into auth.users (id, phone, phone_confirmed_at, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000f1', '254712000001', now(), false),
  ('00000000-0000-0000-0000-0000000000f2', null, null, true);

-- Kenya is not open yet: nobody can sign up there
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
select pg_temp.expect_error($$insert into public.workers (device_id, name, phone, skill, birth_year, auth_id, country)
  values ('d-f2x', 'Early', '0712000002', 'mason', 1992, '00000000-0000-0000-0000-0000000000f2', 'KE')$$, 'country_not_open');
reset role;
-- Kenya's pay rules and minimum wages (test numbers, not real rates); 031 needs them before going live
update public.countries set pay_rules = '{"round": 10, "overtime": 1.5, "short_min": 0.5, "showup": 200, "tools": 100,
  "load_medium": 100, "load_heavy": 200, "risky": 200, "travel_free_km": 5, "travel_base": 100, "travel_per_km": 20,
  "travel_max": 300, "night": 0.2, "heat": 0.1, "offer_step": 100}' where code = 'KE';
insert into public.min_wages (country, type, day_rate, est_min, est_max, source, effective_from)
  select 'KE', k, 400, 450, 700, 'test', date '2026-01-01'
    from unnest(array['coolie','helper','plumber','electrician','mason','painter']) k;
update public.countries set live = true where code = 'KE';
insert into public.employers (id, device_id, name, phone, auth_id, country) values
  ('10000000-0000-0000-0000-0000000000f1', 'd-k1', 'Nairobi Builders', '0700000000', '00000000-0000-0000-0000-0000000000f1', 'KE');
insert into public.workers (id, device_id, name, phone, skill, birth_year, online, auth_id, country) values
  ('20000000-0000-0000-0000-0000000000f2', 'd-k2', 'Wanjiku', '0712 000 002', 'mason', 1992, true, '00000000-0000-0000-0000-0000000000f2', 'KE');

do $$ begin
  assert (select phone from public.employers where id = '10000000-0000-0000-0000-0000000000f1') = '+254712000001', 'verified Kenyan number';
  assert (select phone from public.workers where id = '20000000-0000-0000-0000-0000000000f2') = '+254712000002', 'typed Kenyan number';
  -- Indian profiles made before country packs were converted
  assert not exists (select 1 from public.workers where phone !~ '^\+'), 'all worker numbers international';
end $$;

-- A wrong number is refused, by the app's own account too
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
select pg_temp.expect_error($$update public.workers set phone = '9876543210' where id = '20000000-0000-0000-0000-0000000000f2'$$, 'bad_phone');
update public.workers set phone = '0712000003' where id = '20000000-0000-0000-0000-0000000000f2';
reset role;
do $$ begin
  assert (select phone from public.workers where id = '20000000-0000-0000-0000-0000000000f2') = '+254712000003', 'changed number';
end $$;

-- A profile keeps its country (moving it would move the night-work clock)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
update public.employers set country = 'KE' where id = '10000000-0000-0000-0000-0000000000e1';
reset role;
do $$ begin
  assert (select country from public.employers where id = '10000000-0000-0000-0000-0000000000e1') = 'IN', 'country is fixed';
end $$;

-- A job takes its employer's country and currency, whatever the app sends
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
with made as (
  insert into public.bookings (employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, scheduled_for, country, currency)
  values ('10000000-0000-0000-0000-0000000000f1', 'mason', 'Kibera', 8, 'light', 400, 600, 500,
          (date_trunc('day', now() at time zone 'Africa/Nairobi') + interval '1 day 10 hours') at time zone 'Africa/Nairobi', 'IN', 'INR')
  returning id
)
insert into ids select 'ke_job', id from made;
-- 5:00 in Nairobi is night there (07:30 in India): refused for a Kenyan employer without a business number
select pg_temp.expect_error($$insert into public.bookings (employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, scheduled_for)
  values ('10000000-0000-0000-0000-0000000000f1', 'mason', 'Kibera', 8, 'light', 700, 900, 800,
          (date_trunc('day', now() at time zone 'Africa/Nairobi') + interval '1 day 5 hours') at time zone 'Africa/Nairobi')$$,
  'new row violates row-level security policy for table "bookings"');
update public.bookings set country = 'IN', currency = 'INR' where id = (select id from ids where name = 'ke_job');
reset role;
do $$ begin
  assert (select country || ' ' || currency from public.bookings where id = (select id from ids where name = 'ke_job')) = 'KE KES',
    'job keeps employer country and currency';
  assert (select agreed_wage from public.bookings where id = (select id from ids where name = 'ke_job')) = 500,
    'the Tamil Nadu rupee floor is not applied to a Kenyan job';
  assert (select b.country || ' ' || b.currency from public.bookings b join public.employers e on e.id = b.employer_id
           where e.country = 'IN' limit 1) = 'IN INR', 'Indian jobs are IN and INR';
end $$;

-- Repeat jobs: the hour is the employer's local hour
do $$ begin
  assert extract(hour from public.next_repeat_at(1, '09:00', 'Africa/Nairobi') at time zone 'Africa/Nairobi') = 9, 'Nairobi 9 AM';
  assert extract(hour from public.next_repeat_at(1, '09:00') at time zone 'Asia/Kolkata') = 9, 'old call means India';
end $$;

-- A crew member's number is read in the crew leader's country
insert into public.crew_members (leader_id, name, phone, daily_wage)
values ('20000000-0000-0000-0000-0000000000f2', 'Otieno', '0712000009', 800);
do $$ begin
  assert (select phone from public.crew_members where name = 'Otieno') = '+254712000009', 'crew number';
end $$;

-- A deleted Kenyan account gets a stand-in number (019 writes an Indian-style one)
select set_config('wb.internal', 'on', false);
update public.workers set name = 'Deleted user', phone = '6000000000', device_id = 'deleted-' || id, auth_id = null
 where id = '20000000-0000-0000-0000-0000000000f2';
select set_config('wb.internal', '', false);
do $$ begin
  assert (select phone from public.workers where id = '20000000-0000-0000-0000-0000000000f2') = '+2540000000', 'stand-in number';
end $$;

-- Anyone can read the country list; nobody but the founder can change it
set role anon;
do $$ begin
  assert (select currency from public.countries where code = 'IN') = 'INR', 'anon reads countries';
end $$;
update public.countries set currency = 'USD' where code = 'IN';
reset role;
do $$ begin
  assert (select currency from public.countries where code = 'IN') = 'INR', 'anon cannot change countries';
end $$;

select 'country packs: ok' as result;
