-- 021: pay slips and ratings that can be trusted
-- 1. QR proof of pay uses a secret only the employer's phone gets (booking_pay_secrets).
--    Before, the code was made from the check-in OTP, which the worker already knows, so a
--    worker could make a "paid" receipt alone.
-- 2. An open job no longer shows the exact site (often a home) to every worker of that skill.
--    The booking row keeps the place to about 1 km and the area's last part ("Velachery", not
--    "12, Gandhi Road, Velachery"). The exact point and full address are in booking_sites, and
--    job_sites() gives them to the employer, and to the worker once they have the job.
-- 3. The dispute page is shared with a link that expires (30 days) and can be stopped, not with
--    the job's id (which is also in WhatsApp job links). Without a link, only the two people on
--    the job see the evidence.
-- 4. Profiles made before accounts existed can be claimed by their old device id only until
--    the date in app_settings 'legacy_claims_until' (device ids used to be public).
-- (One account on both sides of a job is already refused by 018 once real accounts are required,
--  and a verified number belongs to one account only.)

-- ---------- 1. A pay secret only the employer sees ----------
create table public.booking_pay_secrets (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  secret text not null default replace(gen_random_uuid()::text, '-', '')
);
alter table public.booking_pay_secrets enable row level security;
create policy "employer reads own job pay secret" on public.booking_pay_secrets for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and public.my_employer(b.employer_id)));
revoke all on public.booking_pay_secrets from anon;
revoke insert, update, delete on public.booking_pay_secrets from authenticated;

insert into public.booking_pay_secrets (booking_id) select id from public.bookings;

create function public.pay_secret_make() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_pay_secrets (booking_id) values (new.id);
  return new;
end $$;
create trigger bookings_pay_secret_make after insert on public.bookings
  for each row execute function public.pay_secret_make();
revoke execute on function public.pay_secret_make() from public, anon, authenticated;

-- Same as 012, with the code checked against the pay secret instead of the OTP
create or replace function public.confirm_by_qr(p_booking uuid, p_worker uuid, p_amount integer, p_code text)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; mats int; base int; secret text;
begin
  perform public.assert_mine(p_worker, null);
  select * into b from public.bookings
   where id = p_booking and worker_id = p_worker and status in ('completed', 'paid') and worker_confirmed_at is null;
  if b.id is null then return null; end if;
  select s.secret into secret from public.booking_pay_secrets s where s.booking_id = p_booking;
  if secret is null or p_code is distinct from
     left(encode(sha256(convert_to(secret || ':' || p_amount || ':' || b.id::text, 'UTF8')), 'hex'), 10) then
    return null;
  end if;
  select coalesce(sum(amount), 0) into mats from public.materials where booking_id = p_booking and status = 'approved';
  if b.status = 'paid' then
    base := b.paid_amount;            -- already paid in the app: the QR only confirms it
  else
    base := coalesce(b.paid_amount, b.agreed_wage + b.travel_pay) + mats;
  end if;
  if p_amount < base then return null; end if;
  perform set_config('wb.internal', 'on', true);
  if b.status = 'completed' then
    update public.employers set jobs = jobs + 1 where id = b.employer_id;
  end if;
  update public.bookings
     set status = 'paid', paid_at = coalesce(paid_at, now()), paid_amount = p_amount,
         materials_amount = case when status = 'completed' then mats else materials_amount end,
         tip = tip + (p_amount - base),
         worker_confirmed_at = now(), disputed = false,
         receipt_no = 'WB-' || upper(substr(replace(id::text, '-', ''), 1, 8))
   where id = p_booking returning * into b;
  update public.employers set paid_on_time = paid_on_time + 1 where id = b.employer_id;
  return b;
end $$;

-- ---------- 2. The exact job site, only for the people on the job ----------
create table public.booking_sites (
  booking_id uuid primary key references public.bookings (id) on delete cascade deferrable initially deferred,
  lat double precision,
  lng double precision,
  address text
);
alter table public.booking_sites enable row level security;
-- No policies: read through job_sites()
revoke all on public.booking_sites from anon, authenticated;

-- "12, Gandhi Road, Velachery" → "Velachery"
create function public.coarse_area(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p is null or position(',' in p) = 0 then p
              else nullif(btrim(regexp_replace(p, '^.*,', '')), '') end
$$;

create function public.site_hide() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_sites (booking_id, lat, lng, address) values (new.id, new.lat, new.lng, new.area)
  on conflict (booking_id) do update set lat = excluded.lat, lng = excluded.lng, address = excluded.address;
  new.lat := round(new.lat::numeric, 2)::double precision;   -- about 1 km
  new.lng := round(new.lng::numeric, 2)::double precision;
  new.area := coalesce(public.coarse_area(new.area), new.area);
  return new;
end $$;
revoke execute on function public.site_hide() from public, anon, authenticated;

-- Jobs already in the database: move their exact sites first
insert into public.booking_sites (booking_id, lat, lng, address) select id, lat, lng, area from public.bookings;
update public.bookings
   set lat = round(lat::numeric, 2)::double precision, lng = round(lng::numeric, 2)::double precision,
       area = coalesce(public.coarse_area(area), area);

create trigger bookings_site_hide before insert on public.bookings
  for each row execute function public.site_hide();

-- Deleting an account (019 clears the job's lat/lng) also deletes the exact sites and addresses
create function public.site_forget() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lat is null and old.lat is not null then
    delete from public.booking_sites where booking_id = new.id;
  end if;
  return new;
end $$;
revoke execute on function public.site_forget() from public, anon, authenticated;
create trigger bookings_site_forget after update of lat on public.bookings
  for each row execute function public.site_forget();

-- Like 019's location purge: exact sites of jobs that ended 180 days ago are deleted
select cron.schedule('worker-buddy-purge-sites', '40 21 * * *', $$
  delete from public.booking_sites s using public.bookings b
   where b.id = s.booking_id and b.status in ('paid', 'cancelled', 'expired')
     and coalesce(b.paid_at, b.completed_at, b.created_at) < now() - interval '180 days'$$);

-- The employer always; the worker once the job is theirs
create function public.job_sites(p_bookings uuid[])
returns table (booking_id uuid, lat double precision, lng double precision, address text)
language sql stable security definer set search_path = '' as $$
  select s.booking_id, s.lat, s.lng, s.address
    from public.booking_sites s join public.bookings b on b.id = s.booking_id
   where s.booking_id = any (p_bookings)
     and (public.my_employer(b.employer_id) or (b.worker_id is not null and public.my_worker(b.worker_id)))
$$;
revoke all on function public.job_sites(uuid[]) from public, anon;
grant execute on function public.job_sites(uuid[]) to authenticated;

-- Travel allowance from the exact site (same as 020 and 006 otherwise)
create or replace function public.accept_booking(p_booking uuid, p_worker uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; w public.workers; s public.booking_sites;
begin
  perform public.assert_mine(p_worker, null);
  select * into w from public.workers where id = p_worker and not is_sample;
  if w.id is null then return null; end if;
  select * into s from public.booking_sites where booking_id = p_booking;
  update public.bookings
     set status = 'assigned', worker_id = p_worker, accepted_at = now(),
         travel_pay = public.travel_pay_for(coalesce(s.lat, lat), coalesce(s.lng, lng), w.lat, w.lng)
   where id = p_booking and status = 'searching' and type = w.skill
     and (preferred_worker_id is null or preferred_worker_id = p_worker)
     and (priority_ids is null or p_worker = any(priority_ids) or now() > created_at + interval '60 seconds')
     and (w.online or scheduled_for is not null)
     and (scheduled_for is not null or created_at > now() - interval '10 minutes')
  returning * into b;
  return b;
end $$;

create or replace function public.accept_offer(p_booking uuid, p_employer uuid, p_offer bigint) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare o public.offers; b public.bookings; w public.workers; s public.booking_sites;
begin
  perform public.assert_mine(null, p_employer);
  select * into o from public.offers where id = p_offer and booking_id = p_booking and status = 'open';
  if o.id is null then return null; end if;
  if exists (select 1 from public.bookings x where x.worker_id = o.worker_id
              and x.status in ('assigned', 'started', 'completed') and x.scheduled_for is null) then
    update public.offers set status = 'rejected' where id = o.id;
    return null;
  end if;
  select * into w from public.workers where id = o.worker_id;
  select * into s from public.booking_sites where booking_id = p_booking;
  update public.bookings
     set status = 'assigned', worker_id = o.worker_id, agreed_wage = o.amount, accepted_at = now(),
         travel_pay = public.travel_pay_for(coalesce(s.lat, lat), coalesce(s.lng, lng), w.lat, w.lng)
   where id = p_booking and employer_id = p_employer and status = 'searching'
  returning * into b;
  if b.id is null then return null; end if;
  update public.offers set status = case when id = o.id then 'accepted' else 'rejected' end where booking_id = p_booking;
  return b;
end $$;

-- ---------- 3. Dispute page: shared by a link that expires ----------
create table public.evidence_links (
  token text primary key default replace(gen_random_uuid()::text, '-', ''),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz
);
create index evidence_links_booking_idx on public.evidence_links (booking_id);
alter table public.evidence_links enable row level security;
revoke all on public.evidence_links from anon, authenticated;

create function public.job_party(p_booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b where b.id = p_booking
                  and (public.my_employer(b.employer_id) or (b.worker_id is not null and public.my_worker(b.worker_id))))
$$;

-- The evidence itself. p_party: phone numbers and exact places (only for the two people on the job).
create function public.evidence_json(p_booking uuid, p_party boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; s public.booking_sites; j jsonb;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null then return null; end if;
  select * into s from public.booking_sites where booking_id = p_booking;
  j := (to_jsonb(b) - 'otp') || jsonb_build_object('start_m',
         case when b.start_lat is not null and coalesce(s.lat, b.lat) is not null then
           round(12742000 * asin(sqrt(power(sin(radians(b.start_lat - coalesce(s.lat, b.lat)) / 2), 2)
             + cos(radians(coalesce(s.lat, b.lat))) * cos(radians(b.start_lat))
               * power(sin(radians(b.start_lng - coalesce(s.lng, b.lng)) / 2), 2))))::int end);
  if p_party then
    j := j || jsonb_build_object('lat', coalesce(s.lat, b.lat), 'lng', coalesce(s.lng, b.lng), 'area', coalesce(s.address, b.area));
  else
    j := j || jsonb_build_object('start_lat', null, 'start_lng', null);
  end if;
  return jsonb_build_object(
    'party', p_party,
    'booking', j,
    'employer', (select jsonb_build_object('name', e.name, 'phone', case when p_party then e.phone end, 'gstin', e.gstin,
                          'jobs', e.jobs, 'paid_on_time', e.paid_on_time, 'rating_sum', e.rating_sum,
                          'rating_count', e.rating_count, 'disputes', e.disputes)
                   from public.employers e where e.id = b.employer_id),
    'worker', (select jsonb_build_object('name', w.name, 'phone', case when p_party then w.phone end, 'skill', w.skill)
                 from public.workers w where w.id = b.worker_id),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.messages m where m.booking_id = b.id), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.materials x where x.booking_id = b.id), '[]'::jsonb));
end $$;
revoke execute on function public.evidence_json(uuid, boolean) from public, anon, authenticated;

-- By job id: only the two people on the job
create or replace function public.dispute_evidence(p_booking uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.job_party(p_booking) then public.evidence_json(p_booking, true) end
$$;
revoke execute on function public.dispute_evidence(uuid) from anon;

-- By a shared link: anyone with it, without phone numbers or exact places
create function public.shared_evidence(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.evidence_json(l.booking_id, false)
    from public.evidence_links l
   where l.token = p_token and l.revoked_at is null and l.expires_at > now()
$$;
revoke all on function public.shared_evidence(text) from public;
grant execute on function public.shared_evidence(text) to anon, authenticated;

-- Either person on the job makes a link (10 a day at most) or stops all links
create function public.share_evidence(p_booking uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text;
begin
  if not public.job_party(p_booking) then raise exception 'not_yours' using errcode = '42501'; end if;
  if (select count(*) from public.evidence_links where created_by = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'slow_down' using errcode = '54000';
  end if;
  insert into public.evidence_links (booking_id, created_by) values (p_booking, auth.uid()) returning token into tok;
  return tok;
end $$;
create function public.stop_sharing_evidence(p_booking uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.job_party(p_booking) then raise exception 'not_yours' using errcode = '42501'; end if;
  update public.evidence_links set revoked_at = now() where booking_id = p_booking and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.share_evidence(uuid), public.stop_sharing_evidence(uuid) from public, anon;
grant execute on function public.share_evidence(uuid), public.stop_sharing_evidence(uuid) to authenticated;

-- ---------- 4. Old device-id claims end on a date ----------
insert into public.app_settings (key, value) values ('legacy_claims_until', '"2026-12-31T00:00:00Z"');

create function public.legacy_claims_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(now() < (select (value #>> '{}')::timestamptz from public.app_settings where key = 'legacy_claims_until'), false)
$$;

create or replace function public.claim_profiles(p_device text) returns int
language plpgsql security definer set search_path = '' as $$
declare a int; b int;
begin
  if auth.uid() is null or p_device is null or not public.legacy_claims_open() then return 0; end if;
  perform set_config('wb.internal', 'on', true);
  update public.workers set auth_id = auth.uid() where device_id = p_device and auth_id is null and not is_sample;
  get diagnostics a = row_count;
  update public.employers set auth_id = auth.uid() where device_id = p_device and auth_id is null;
  get diagnostics b = row_count;
  return a + b;
end $$;

create or replace function public.get_my_worker(p_device text default null) returns setof public.workers
language sql stable security definer set search_path = '' as $$
  select * from public.workers
   where auth.uid() is not null
     and (auth_id = auth.uid() or (p_device is not null and device_id = p_device and auth_id is null and not is_sample
                                   and public.legacy_claims_open()))
   order by (device_id = p_device) desc nulls last, updated_at desc
   limit 1
$$;

create or replace function public.get_my_employer(p_device text default null) returns setof public.employers
language sql stable security definer set search_path = '' as $$
  select * from public.employers
   where auth.uid() is not null
     and (auth_id = auth.uid() or (p_device is not null and device_id = p_device and auth_id is null
                                   and public.legacy_claims_open()))
   order by (device_id = p_device) desc nulls last, created_at desc
   limit 1
$$;
