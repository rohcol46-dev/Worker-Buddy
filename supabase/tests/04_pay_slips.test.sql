-- QR receipts need the employer's pay secret, open jobs hide the exact site, dispute pages are
-- shared by links that expire, and old device-id claims close on a date.
--   e7 employer    g7 worker (plumber)    g6 another plumber (not on the job)
reset role;
-- A test helper: run SQL and expect a given error
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
  ('00000000-0000-0000-0000-0000000000e7', '919800000077', now(), false),
  ('00000000-0000-0000-0000-0000000000a7', '919800000076', now(), false),
  ('00000000-0000-0000-0000-0000000000a6', '919800000075', now(), false);
insert into public.employers (id, device_id, name, phone, auth_id) values
  ('10000000-0000-0000-0000-0000000000e7', 'd-e7', 'Employer Seven', '9123456777', '00000000-0000-0000-0000-0000000000e7');
insert into public.workers (id, device_id, name, phone, skill, birth_year, online, lat, lng, auth_id) values
  ('20000000-0000-0000-0000-0000000000a7', 'd-g7', 'Worker Seven', '9111111177', 'plumber', 1990, true, 13.05, 80.25,
   '00000000-0000-0000-0000-0000000000a7'),
  ('20000000-0000-0000-0000-0000000000a6', 'd-g6', 'Worker Six', '9111111176', 'plumber', 1990, true, 13.05, 80.25,
   '00000000-0000-0000-0000-0000000000a6');

-- The employer posts a job at their home, for 10 AM tomorrow (night jobs need a GST number)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e7', false);
insert into public.bookings (id, employer_id, type, area, lat, lng, hours, load, wage_min, wage_max, agreed_wage, scheduled_for) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000e7', 'plumber',
   '12, Gandhi Road, Velachery', 12.981234, 80.218765, 8, 'light', 700, 900, 800,
   date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day 10 hours');
do $$ declare s record; begin
  select * into s from public.job_sites(array['40000000-0000-0000-0000-000000000001'::uuid]);
  assert s.lat = 12.981234 and s.address = '12, Gandhi Road, Velachery', 'employer gets the exact site';
  assert (select count(*) from public.booking_pay_secrets where booking_id = '40000000-0000-0000-0000-000000000001') = 1,
    'employer reads the pay secret';
end $$;

-- Another plumber sees the open job, but only to about 1 km and the area's last part
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a6', false);
do $$ declare b record; begin
  select * into b from public.bookings where id = '40000000-0000-0000-0000-000000000001';
  assert b.id is not null, 'open job visible to the same skill';
  assert b.lat = 12.98 and b.lng = 80.22 and b.area = 'Velachery', 'open job is rounded';
  assert not exists (select 1 from public.job_sites(array['40000000-0000-0000-0000-000000000001'::uuid])), 'no exact site before the job is yours';
  assert not exists (select 1 from public.booking_pay_secrets), 'workers never see pay secrets';
end $$;
select pg_temp.expect_error('select * from public.booking_sites', 'permission denied for table booking_sites');

-- The worker who takes it gets the exact site
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', false);
do $$ declare s record; begin
  assert (public.accept_booking('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a7')).status = 'assigned', 'accepted';
  select * into s from public.job_sites(array['40000000-0000-0000-0000-000000000001'::uuid]);
  assert s.lat = 12.981234 and s.address = '12, Gandhi Road, Velachery', 'worker on the job gets the exact site';
  assert not exists (select 1 from public.booking_pay_secrets), 'even the worker on the job';
end $$;
reset role;
update public.bookings set status = 'completed', started_at = now() - interval '8 hours', completed_at = now(), paid_amount = 800
 where id = '40000000-0000-0000-0000-000000000001';

-- A QR made from the OTP (which the worker knows) is refused; one made from the pay secret works
select set_config('test.otp_code', (select left(encode(sha256(convert_to(otp || ':800:40000000-0000-0000-0000-000000000001', 'UTF8')), 'hex'), 10)
  from public.booking_otps where booking_id = '40000000-0000-0000-0000-000000000001'), false);
select set_config('test.pay_code', (select left(encode(sha256(convert_to(secret || ':800:40000000-0000-0000-0000-000000000001', 'UTF8')), 'hex'), 10)
  from public.booking_pay_secrets where booking_id = '40000000-0000-0000-0000-000000000001'), false);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', false);
do $$ begin
  assert (public.confirm_by_qr('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a7', 800,
          current_setting('test.otp_code'))).id is null, 'OTP-made receipt refused';
  assert (public.confirm_by_qr('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a7', 800,
          current_setting('test.pay_code'))).status = 'paid', 'employer QR accepted';
end $$;

-- Dispute page: by job id only for the two people on the job
do $$ begin
  assert (public.dispute_evidence('40000000-0000-0000-0000-000000000001') -> 'booking' ->> 'area') = '12, Gandhi Road, Velachery',
    'party sees the full address';
  assert (public.dispute_evidence('40000000-0000-0000-0000-000000000001') -> 'worker' ->> 'phone') is not null, 'party sees phones';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a6', false);
do $$ begin
  assert public.dispute_evidence('40000000-0000-0000-0000-000000000001') is null, 'outsider gets nothing by job id';
end $$;
select pg_temp.expect_error($$select public.share_evidence('40000000-0000-0000-0000-000000000001')$$, 'not_yours');

-- The worker shares a link; anyone with it sees the evidence without phones or the exact place
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', false);
select set_config('test.token', public.share_evidence('40000000-0000-0000-0000-000000000001'), false);
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_error($$select public.dispute_evidence('40000000-0000-0000-0000-000000000001')$$,
  'permission denied for function dispute_evidence');
do $$ declare j jsonb; begin
  j := public.shared_evidence(current_setting('test.token'));
  assert j is not null, 'link works';
  assert j -> 'worker' ->> 'phone' is null and j -> 'employer' ->> 'phone' is null, 'no phones by link';
  assert j -> 'booking' ->> 'area' = 'Velachery', 'no full address by link';
  assert public.shared_evidence('nope') is null, 'a wrong token gets nothing';
end $$;
reset role;

-- Stopping the share ends the link; an expired link ends too
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e7', false);
do $$ begin
  assert public.stop_sharing_evidence('40000000-0000-0000-0000-000000000001') = 1, 'link stopped';
  assert public.shared_evidence(current_setting('test.token')) is null, 'stopped link gets nothing';
end $$;
select set_config('test.token2', public.share_evidence('40000000-0000-0000-0000-000000000001'), false);
reset role;
update public.evidence_links set expires_at = now() - interval '1 minute' where token = current_setting('test.token2');
do $$ begin
  assert public.shared_evidence(current_setting('test.token2')) is null, 'expired link gets nothing';
end $$;

-- Old device-id claims: open until the date, closed after it
select set_config('request.jwt.claim.sub', '', false);
insert into public.workers (id, device_id, name, phone, skill, birth_year)
  values ('20000000-0000-0000-0000-0000000000a5', 'legacy-device', 'Old Profile', '9111111175', 'plumber', 1990);
do $$ begin
  assert (select auth_id from public.workers where id = '20000000-0000-0000-0000-0000000000a5') is null, 'old profile unclaimed';
end $$;
update public.app_settings set value = '"2000-01-01T00:00:00Z"' where key = 'legacy_claims_until';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a6', false);
do $$ begin
  assert public.claim_profiles('legacy-device') = 0, 'claim closed after the date';
  assert (select id from public.get_my_worker('legacy-device')) = '20000000-0000-0000-0000-0000000000a6', 'old profile not found by device id';
end $$;
reset role;
update public.app_settings set value = '"2999-01-01T00:00:00Z"' where key = 'legacy_claims_until';
set role authenticated;
do $$ begin
  assert public.claim_profiles('legacy-device') = 1, 'claim open before the date';
end $$;
reset role;

-- Clearing a job's place (as deleting an account does) deletes its exact site
select set_config('wb.internal', 'on', false);
update public.bookings set lat = null, lng = null where id = '40000000-0000-0000-0000-000000000001';
select set_config('wb.internal', 'off', false);
do $$ begin
  assert not exists (select 1 from public.booking_sites where booking_id = '40000000-0000-0000-0000-000000000001'), 'site deleted';
end $$;

select 'pay slips: ok' as result;
