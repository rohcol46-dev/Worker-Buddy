-- Country pay rules: the legal floor, overtime, travel allowance, effort extra, rain-off and show-up pay
-- follow the job's country. India's numbers are unchanged. Uses Kenya from 05 (test numbers, not real rates).
--   f1 employer in Kenya    f3 plumber in Kenya, about 8.5 km from the site
reset role;
create function pg_temp.expect_error(p_sql text, p_error text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error "%" from: %', p_error, p_sql using errcode = 'P0001', hint = 'test';
exception when others then
  if sqlerrm <> p_error then raise exception 'expected error "%" but got "%" from: %', p_error, sqlerrm, p_sql; end if;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated, anon;
create temp table pay_ids (name text primary key, id uuid);
grant select, insert on pay_ids to authenticated;

-- India: exactly the old numbers
do $$ begin
  assert public.legal_min_wage('plumber', 8, 'IN') = 610, 'IN day';
  assert public.legal_min_wage('plumber', 10, 'IN') = 920, 'IN 10 hours, overtime at twice the rate';
  assert public.legal_min_wage('plumber', 3, 'IN') = 310, 'IN short job is half a day';
  assert public.ot_rate(800, 8, 'IN') = 200, 'IN overtime rate: twice the hourly wage';
  assert public.travel_pay_for(13.0, 80.2, 13.08, 80.2, 'IN') = 80, 'IN travel: 50 + 10 a km past 5';
  assert public.travel_pay_for(13.0, 80.2, 13.3, 80.2, 'IN') = 150, 'IN travel capped at 150';
  assert public.load_extra('heavy', 'IN') = 100 and public.load_extra('medium', 'IN') = 50, 'IN effort extras';
  assert public.pay_rule('IN', 'showup') = 100, 'IN show-up pay';
end $$;

-- Kenya: its own floor (400 a day, overtime 1.5x), rounded up to 10
do $$ begin
  assert public.legal_min_wage('plumber', 8, 'KE') = 400, 'KE day';
  assert public.legal_min_wage('plumber', 10, 'KE') = 550, 'KE 10 hours';
  assert public.travel_pay_for(-1.2921, 36.8219, -1.2156, 36.8219, 'KE') = 160, 'KE travel: 100 + 20 a km past 5';
  assert public.travel_pay_for(-1.2921, 36.8219, -1.2921, 36.8219, 'KE') = 0, 'KE no travel up close';
end $$;

-- A country goes live only with every pay rule and all six trades
select pg_temp.expect_error($$insert into public.countries (code, name, live, currency, calling_code, phone_pattern, phone_example, time_zone, emergency, languages)
  values ('GH', 'Ghana', true, 'GHS', '233', '[235][0-9]{8}', '241234567', 'Africa/Accra', '112', '{en}')$$, 'pay rule round missing for GH');
select pg_temp.expect_error($$insert into public.countries (code, name, live, currency, calling_code, phone_pattern, phone_example, time_zone, emergency, languages, pay_rules)
  values ('GH', 'Ghana', true, 'GHS', '233', '[235][0-9]{8}', '241234567', 'Africa/Accra', '112', '{en}',
          (select pay_rules from public.countries where code = 'KE'))$$, 'minimum wages missing for GH');
select pg_temp.expect_error($$update public.countries set pay_rules = pay_rules - 'showup' where code = 'KE'$$, 'pay rule showup missing for KE');
select pg_temp.expect_error($$delete from public.min_wages where country = 'KE' and type = 'mason'$$,
  'a country in use keeps its minimum wages; change the rate instead');

insert into auth.users (id, phone, phone_confirmed_at, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000f3', '254712000033', now(), false);
insert into public.workers (id, device_id, name, phone, skill, birth_year, online, lat, lng, auth_id, country) values
  ('20000000-0000-0000-0000-0000000000f3', 'd-k3', 'Kamau', '0712000033', 'plumber', 1990, true, -1.2156, 36.8219,
   '00000000-0000-0000-0000-0000000000f3', 'KE');

-- A Kenyan job below the floor is raised to it; overtime is 1.5x the hourly wage
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
with made as (
  insert into public.bookings (employer_id, type, area, lat, lng, hours, load, wage_min, wage_max, agreed_wage, scheduled_for)
  values ('10000000-0000-0000-0000-0000000000f1', 'plumber', 'Kibera', -1.2921, 36.8219, 10, 'light', 300, 350, 300,
          (date_trunc('day', now() at time zone 'Africa/Nairobi') + interval '1 day 10 hours') at time zone 'Africa/Nairobi')
  returning id
)
insert into pay_ids select 'job', id from made;
with made as (
  insert into public.bookings (employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage)
  values ('10000000-0000-0000-0000-0000000000f1', 'mason', 'Kibera', 8, 'light', 450, 600, 500)
  returning id
)
insert into pay_ids select 'other', id from made;
reset role;
do $$ declare b public.bookings; begin
  select * into b from public.bookings where id = (select id from pay_ids where name = 'job');
  assert b.agreed_wage = 550 and b.wage_min = 550 and b.wage_max = 550, 'raised to the Kenyan floor';
  assert b.ot_rate = 83, 'overtime 550 x 1.5 / 10 hours';
end $$;

-- The worker accepts: travel allowance by Kenya's rule
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f3', false);
do $$ begin
  assert (public.accept_booking((select id from pay_ids where name = 'job'), '20000000-0000-0000-0000-0000000000f3')).travel_pay = 160,
    'Kenyan travel allowance';
end $$;
reset role;
update public.bookings set status = 'started', started_at = now() - interval '2 hours' where id = (select id from pay_ids where name = 'job');

-- Harder and riskier than described: Kenya's extras
set role authenticated;
do $$ begin
  assert public.claim_effort((select id from pay_ids where name = 'job'), '20000000-0000-0000-0000-0000000000f3', 'heavy', true) = 400,
    'heavy 200 + risky 200';
end $$;

-- Rain stops work after 2 of 10 hours: half the wage (275, rounded to 280) plus travel
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
do $$ begin
  assert public.rain_stop((select id from pay_ids where name = 'job'), '10000000-0000-0000-0000-0000000000f1'), 'rain stop';
end $$;
reset role;
do $$ begin
  assert (select paid_amount from public.bookings where id = (select id from pay_ids where name = 'job')) = 440, 'rain-off pay';
end $$;

-- The employer cancels after the worker set off: Kenya's show-up pay
insert into public.workers (id, device_id, name, phone, skill, birth_year, online, lat, lng, auth_id, country) values
  ('20000000-0000-0000-0000-0000000000f4', 'd-k4', 'Achieng', '0712000044', 'mason', 1991, true, -1.2921, 36.8219, null, 'KE');
update public.bookings set status = 'assigned', worker_id = '20000000-0000-0000-0000-0000000000f4', accepted_at = now()
 where id = (select id from pay_ids where name = 'other');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
do $$ begin
  assert public.cancel_job((select id from pay_ids where name = 'other'), null, '10000000-0000-0000-0000-0000000000f1', 'Changed plans') = 'showup', 'cancelled';
end $$;
reset role;
do $$ begin
  assert (select showup_pay from public.bookings where id = (select id from pay_ids where name = 'other')) = 200, 'Kenyan show-up pay';
end $$;

-- Kenya now has jobs: it can close to new sign-ups but keeps its rules and minimum wages
update public.countries set live = false where code = 'KE';
select pg_temp.expect_error($$update public.countries set pay_rules = '{}' where code = 'KE'$$, 'pay rule round missing for KE');
select pg_temp.expect_error($$delete from public.min_wages where country = 'KE'$$,
  'a country in use keeps its minimum wages; change the rate instead');
update public.countries set live = true where code = 'KE';

-- The wage map shows one country's jobs; older apps asking without a country get India's
reset role;
update public.bookings set worker_confirmed_at = now() where id = (select id from pay_ids where name = 'job');
set role anon;
do $$ begin
  assert (select count(*) from public.wage_map_rows('KE')) = 1, 'Kenyan map';
  assert not exists (select 1 from public.wage_map_rows() where agreed_wage = 550), 'old call shows no Kenyan jobs';
end $$;
reset role;

-- Anyone can read a country's minimum wages and going rates
set role anon;
do $$ begin
  assert (select est_max from public.min_wages where country = 'KE' and type = 'plumber') = 700, 'anon reads going rates';
  assert (select (pay_rules ->> 'showup')::int from public.countries where code = 'IN') = 100, 'anon reads pay rules';
end $$;
reset role;

select 'country pay rules: ok' as result;
