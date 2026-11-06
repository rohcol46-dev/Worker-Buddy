-- 034: job alerts on a closed app. Push addresses are private, only the employer of a new job
-- can trigger its alert (once), and only nearby online workers of that skill are alerted.
--   c1 employer    c2 painter, near, online    c3 painter, 100 km away    c4 painter, offline
--   c5 mason, near    c6 another employer
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
insert into auth.users (id, phone, phone_confirmed_at, is_anonymous) values
  ('00000000-0000-0000-0000-0000000034c1', '919800034171', now(), false),
  ('00000000-0000-0000-0000-0000000034c2', '919800034172', now(), false),
  ('00000000-0000-0000-0000-0000000034c3', '919800034173', now(), false),
  ('00000000-0000-0000-0000-0000000034c4', '919800034174', now(), false),
  ('00000000-0000-0000-0000-0000000034c5', '919800034175', now(), false),
  ('00000000-0000-0000-0000-0000000034c6', '919800034176', now(), false);
insert into public.employers (id, device_id, name, phone, auth_id) values
  ('10000000-0000-0000-0000-0000000034c1', 'd-34c1', 'Employer A1', '9123434101', '00000000-0000-0000-0000-0000000034c1'),
  ('10000000-0000-0000-0000-0000000034c6', 'd-34c6', 'Employer A6', '9123434106', '00000000-0000-0000-0000-0000000034c6');
insert into public.workers (id, device_id, name, phone, skill, birth_year, online, lat, lng, auth_id) values
  ('20000000-0000-0000-0000-0000000034c2', 'd-34c2', 'Near Painter', '9111134172', 'painter', 1990, true, 13.00, 80.20,
   '00000000-0000-0000-0000-0000000034c2'),
  ('20000000-0000-0000-0000-0000000034c3', 'd-34c3', 'Far Painter', '9111134173', 'painter', 1990, true, 13.90, 80.20,
   '00000000-0000-0000-0000-0000000034c3'),
  ('20000000-0000-0000-0000-0000000034c4', 'd-34c4', 'Offline Painter', '9111134174', 'painter', 1990, false, 13.00, 80.20,
   '00000000-0000-0000-0000-0000000034c4'),
  ('20000000-0000-0000-0000-0000000034c5', 'd-34c5', 'Near Mason', '9111134175', 'mason', 1990, true, 13.00, 80.20,
   '00000000-0000-0000-0000-0000000034c5');

create function pg_temp.key(p text) returns text language sql as $$ select rpad(p, 87, 'k') $$;
grant execute on function pg_temp.key(text) to authenticated, anon;

-- Signed out: can't save or read push addresses, or ask who to alert
set role anon;
select pg_temp.expect_error($$select public.save_push_subscription('20000000-0000-0000-0000-0000000034c2', 'https://fcm.googleapis.com/fcm/send/x', pg_temp.key('a'), 'auth-secret-0000000', 'en')$$,
  'permission denied for function save_push_subscription');
select pg_temp.expect_error($$select * from public.push_subscriptions$$, 'permission denied for table push_subscriptions');

-- Each worker saves an address for their own profile, never someone else's
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000034c2', false);
select pg_temp.expect_error($$select public.save_push_subscription('20000000-0000-0000-0000-0000000034c3', 'https://fcm.googleapis.com/fcm/send/x', pg_temp.key('a'), 'auth-secret-0000000', 'en')$$,
  'not_yours');
select public.save_push_subscription('20000000-0000-0000-0000-0000000034c2', 'https://fcm.googleapis.com/fcm/send/a2', pg_temp.key('a2'), 'auth-secret-a2-0000', 'ta');
select pg_temp.expect_error($$select * from public.push_subscriptions$$, 'permission denied for table push_subscriptions');
select pg_temp.expect_error($$select public.job_alert_targets('30000000-0000-0000-0000-0000000034c1', '00000000-0000-0000-0000-0000000034c1')$$,
  'permission denied for function job_alert_targets');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000034c3', false);
select public.save_push_subscription('20000000-0000-0000-0000-0000000034c3', 'https://fcm.googleapis.com/fcm/send/a3', pg_temp.key('a3'), 'auth-secret-a3-0000', 'en');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000034c4', false);
select public.save_push_subscription('20000000-0000-0000-0000-0000000034c4', 'https://fcm.googleapis.com/fcm/send/a4', pg_temp.key('a4'), 'auth-secret-a4-0000', 'en');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000034c5', false);
select public.save_push_subscription('20000000-0000-0000-0000-0000000034c5', 'https://fcm.googleapis.com/fcm/send/a5', pg_temp.key('a5'), 'auth-secret-a5-0000', 'en');
-- Only real push services
select pg_temp.expect_error($$select public.save_push_subscription('20000000-0000-0000-0000-0000000034c5', 'https://evil.example/x', pg_temp.key('a'), 'auth-secret-0000000', 'en')$$,
  'new row for relation "push_subscriptions" violates check constraint "push_subscriptions_endpoint_check"');
-- Another account can't delete a2's address
select public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/a2');
reset role;
do $$ begin
  assert (select count(*) from public.push_subscriptions) = 4, 'four addresses saved';
  assert (select lang from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/a2') = 'ta', 'language kept';
end $$;

-- Jobs: a1's painter job now near the workers, a1's later painter job, an old one, a6's job, a team job
insert into public.bookings (id, employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, lat, lng, created_at, scheduled_for, group_id, group_size) values
  ('30000000-0000-0000-0000-0000000034c1', '10000000-0000-0000-0000-0000000034c1', 'painter', 'Adyar', 8, 'light', 700, 900, 800, 13.01, 80.21, now(), null, null, 1),
  ('30000000-0000-0000-0000-0000000034c2', '10000000-0000-0000-0000-0000000034c1', 'painter', 'Adyar', 8, 'light', 700, 900, 800, 13.01, 80.21, now(), now() + interval '1 day', null, 1),
  ('30000000-0000-0000-0000-0000000034c3', '10000000-0000-0000-0000-0000000034c1', 'painter', 'Adyar', 8, 'light', 700, 900, 800, 13.01, 80.21, now() - interval '11 minutes', null, null, 1),
  ('30000000-0000-0000-0000-0000000034c4', '10000000-0000-0000-0000-0000000034c6', 'painter', 'Adyar', 8, 'light', 700, 900, 800, 13.01, 80.21, now(), null, null, 1),
  ('30000000-0000-0000-0000-0000000034c5', '10000000-0000-0000-0000-0000000034c1', 'painter', 'Adyar', 8, 'light', 700, 900, 800, 13.01, 80.21, now(), null, '40000000-0000-0000-0000-0000000034c5', 2),
  ('30000000-0000-0000-0000-0000000034c6', '10000000-0000-0000-0000-0000000034c1', 'painter', 'Adyar', 8, 'light', 700, 900, 800, 13.01, 80.21, now(), null, '40000000-0000-0000-0000-0000000034c5', 2);

set role service_role;
do $$ declare r jsonb; begin
  -- Only the near, online painter is alerted, with the job's details and their language
  r := public.job_alert_targets('30000000-0000-0000-0000-0000000034c1', '00000000-0000-0000-0000-0000000034c1');
  assert jsonb_array_length(r->'targets') = 1, 'one worker alerted: ' || (r->'targets')::text;
  assert r->'targets'->0->>'endpoint' = 'https://fcm.googleapis.com/fcm/send/a2' and r->'targets'->0->>'lang' = 'ta', 'the near online painter';
  assert r->'job'->>'type' = 'painter' and (r->'job'->>'wage_min')::int = 700 and r->'job'->>'currency' = 'INR', 'job details';
  assert not (r->'job' ? 'otp') and r::text !~ 'Employer A1', 'no OTP or employer name';
  -- Once per job
  assert public.job_alert_targets('30000000-0000-0000-0000-0000000034c1', '00000000-0000-0000-0000-0000000034c1') is null, 'alerted once';
  -- A later job is alerted too
  assert jsonb_array_length(public.job_alert_targets('30000000-0000-0000-0000-0000000034c2', '00000000-0000-0000-0000-0000000034c1')->'targets') = 1,
    'later job alerted';
  -- Too old, or someone else's job: nothing
  assert public.job_alert_targets('30000000-0000-0000-0000-0000000034c3', '00000000-0000-0000-0000-0000000034c1') is null, 'old job';
  assert public.job_alert_targets('30000000-0000-0000-0000-0000000034c4', '00000000-0000-0000-0000-0000000034c1') is null, 'not my job';
  -- A team job: once for the whole team
  assert public.job_alert_targets('30000000-0000-0000-0000-0000000034c5', '00000000-0000-0000-0000-0000000034c1') is not null, 'team alerted';
  assert public.job_alert_targets('30000000-0000-0000-0000-0000000034c6', '00000000-0000-0000-0000-0000000034c1') is null, 'team alerted once';
end $$;
reset role;

-- A worker busy on a job now isn't alerted about a job for now; a suspended one never
update public.bookings set status = 'started', worker_id = '20000000-0000-0000-0000-0000000034c2'
 where id = '30000000-0000-0000-0000-0000000034c3';
insert into public.bookings (id, employer_id, type, area, hours, load, wage_min, wage_max, agreed_wage, lat, lng) values
  ('30000000-0000-0000-0000-0000000034c7', '10000000-0000-0000-0000-0000000034c1', 'painter', 'Adyar', 8, 'light', 700, 900, 800, 13.01, 80.21);
set role service_role;
do $$ begin
  assert jsonb_array_length(public.job_alert_targets('30000000-0000-0000-0000-0000000034c7', '00000000-0000-0000-0000-0000000034c1')->'targets') = 0,
    'busy worker skipped';
end $$;
reset role;

-- Alerts keep a quiet worker online for 12 hours, not 30 minutes
alter table public.workers disable trigger workers_touch_seen;
update public.workers set online = true, last_seen_at = now() - interval '2 hours'
 where id in ('20000000-0000-0000-0000-0000000034c3', '20000000-0000-0000-0000-0000000034c5');
update public.workers set online = true, last_seen_at = now() - interval '13 hours' where id = '20000000-0000-0000-0000-0000000034c4';
reset role;
delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/a5';
select public.offline_quiet_workers();
alter table public.workers enable trigger workers_touch_seen;
do $$ begin
  assert (select online from public.workers where id = '20000000-0000-0000-0000-0000000034c3'), 'alerts on: still online after 2 hours';
  assert not (select online from public.workers where id = '20000000-0000-0000-0000-0000000034c5'), 'no alerts: offline after 2 hours';
  assert not (select online from public.workers where id = '20000000-0000-0000-0000-0000000034c4'), 'alerts on: offline after 13 hours';
end $$;

-- A worker removes their own address; a deleted account loses its addresses
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000034c3', false);
select public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/a3');
reset role;
select set_config('wb.internal', 'on', false);   -- as delete_my_account does
update public.workers set device_id = 'deleted-' || id, auth_id = null where id = '20000000-0000-0000-0000-0000000034c4';
select set_config('wb.internal', 'off', false);
do $$ begin
  assert not exists (select 1 from public.push_subscriptions where endpoint in ('https://fcm.googleapis.com/fcm/send/a3', 'https://fcm.googleapis.com/fcm/send/a4')),
    'removed and deleted addresses are gone';
  assert exists (select 1 from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/a2'), 'others kept';
end $$;

select 'job alerts: ok';
