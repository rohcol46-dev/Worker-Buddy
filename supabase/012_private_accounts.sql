-- 012: private accounts
-- Every phone signs in (Supabase anonymous sign-in, no password or SMS needed) and owns
-- the worker / employer profiles it creates. The database then checks ownership on every
-- action, and the job OTP moves to its own table that only that job's employer can read.

-- ---------- 1. Who owns each profile ----------
alter table public.workers add column auth_id uuid default auth.uid();
alter table public.employers add column auth_id uuid default auth.uid();
create index workers_auth_id on public.workers (auth_id);
create index employers_auth_id on public.employers (auth_id);

create function public.my_worker(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.workers where id = p and auth_id = auth.uid())
$$;
create function public.my_employer(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.employers where id = p and auth_id = auth.uid())
$$;

-- Raised by every action done on someone else's behalf
create function public.assert_mine(p_worker uuid, p_employer uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (p_worker is not null and not public.my_worker(p_worker))
     or (p_employer is not null and not public.my_employer(p_employer)) then
    raise exception 'not_yours' using errcode = '42501';
  end if;
end $$;
create function public.assert_party(p_booking uuid, p_by text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.bookings b where b.id = p_booking
                  and ((p_by = 'worker' and public.my_worker(b.worker_id))
                    or (p_by = 'employer' and public.my_employer(b.employer_id)))) then
    raise exception 'not_yours' using errcode = '42501';
  end if;
end $$;

-- Profiles made before this change: the phone that has the old device id claims them once
create function public.claim_profiles(p_device text) returns int
language plpgsql security definer set search_path = '' as $$
declare a int; b int;
begin
  if auth.uid() is null or p_device is null then return 0; end if;
  perform set_config('wb.internal', 'on', true);
  update public.workers set auth_id = auth.uid() where device_id = p_device and auth_id is null and not is_sample;
  get diagnostics a = row_count;
  update public.employers set auth_id = auth.uid() where device_id = p_device and auth_id is null;
  get diagnostics b = row_count;
  return a + b;
end $$;

-- The owner can only change through claim_profiles
create or replace function public.keep_worker_stats() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('wb.internal', true) is distinct from 'on' then
    new.rating_sum := old.rating_sum;
    new.rating_count := old.rating_count;
    new.jobs_done := old.jobs_done;
    new.clean_streak := old.clean_streak;
    new.device_id := old.device_id;
    new.auth_id := old.auth_id;
  end if;
  new.updated_at := now();
  return new;
end $$;
create or replace function public.keep_employer_stats() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('wb.internal', true) is distinct from 'on' then
    new.jobs := old.jobs;
    new.paid_on_time := old.paid_on_time;
    new.rating_sum := old.rating_sum;
    new.rating_count := old.rating_count;
    new.disputes := old.disputes;
    new.effort_refused := old.effort_refused;
    new.device_id := old.device_id;
    new.auth_id := old.auth_id;
  end if;
  return new;
end $$;

-- ---------- 2. Every action checks ownership ----------
-- Old functions the app no longer uses
drop function if exists public.start_booking(uuid, uuid, text);
drop function if exists public.rate_booking(uuid, text, integer);

-- Add "perform public.assert_mine(...)" at the top of every function that acts for a worker or employer
do $$
declare f record; def text; w text; e text;
begin
  for f in
    select p.oid, pg_get_function_identity_arguments(p.oid) args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname not in ('my_worker', 'my_employer', 'assert_mine', 'assert_party', 'claim_profiles', 'create_due_repeats')
  loop
    w := case when f.args ~ '\mp_worker uuid' then 'p_worker' else 'null' end;
    e := case when f.args ~ '\mp_employer uuid' then 'p_employer' else 'null' end;
    def := pg_get_functiondef(f.oid);
    if w <> 'null' or e <> 'null' then
      def := regexp_replace(def, E'\nbegin\n', E'\nbegin\n  perform public.assert_mine(' || w || ', ' || e || E');\n');
    elsif f.args ~ '\mp_by text' then
      def := regexp_replace(def, E'\nbegin\n', E'\nbegin\n  perform public.assert_party(p_booking, p_by);\n');
    else
      continue;
    end if;
    if position('assert_' in def) = 0 then raise exception 'could not add check to %', f.oid::regprocedure; end if;
    execute def;
  end loop;
end $$;

-- ---------- 3. The OTP is private to the job's employer ----------
create table public.booking_otps (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  otp text not null check (otp ~ '^[0-9]{4}$'),
  tries int not null default 0
);
alter table public.booking_otps enable row level security;
create policy "employer reads own job otp" on public.booking_otps for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and public.my_employer(b.employer_id)));

insert into public.booking_otps (booking_id, otp)
  select id, otp from public.bookings where otp ~ '^[0-9]{4}$';
alter table public.bookings alter column otp drop not null;
update public.bookings set otp = null;

-- New bookings: the OTP is made by the server and never stored on the (publicly readable) booking row
create function public.otp_hide() returns trigger language plpgsql set search_path = '' as $$
begin
  new.otp := null;
  return new;
end $$;
create function public.otp_make() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_otps (booking_id, otp) values (new.id, (1000 + floor(random() * 9000))::int::text);
  return new;
end $$;
create trigger bookings_otp_hide before insert or update of otp on public.bookings
  for each row execute function public.otp_hide();
create trigger bookings_otp_make after insert on public.bookings
  for each row execute function public.otp_make();

-- Check-in: OTP from the private table; 5 wrong tries lock the code
create or replace function public.start_at_site(p_booking uuid, p_worker uuid, p_otp text,
                                                p_lat double precision, p_lng double precision) returns text
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; o public.booking_otps; km double precision;
begin
  perform public.assert_mine(p_worker, null);
  select * into b from public.bookings where id = p_booking and worker_id = p_worker and status = 'assigned';
  if b.id is null then return 'not_found'; end if;
  select * into o from public.booking_otps where booking_id = p_booking for update;
  if o.tries >= 5 then return 'locked'; end if;
  if o.otp is distinct from p_otp then
    update public.booking_otps set tries = tries + 1 where booking_id = p_booking;
    return 'wrong_otp';
  end if;
  if p_lat is not null and b.lat is not null then
    km := 6371 * 2 * asin(sqrt(power(sin(radians(b.lat - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - p_lng) / 2), 2)));
    if km > 1 then return 'too_far'; end if;
  end if;
  update public.bookings set status = 'started', started_at = now(), start_lat = p_lat, start_lng = p_lng
   where id = p_booking;
  return 'ok';
end $$;

-- QR proof of pay: the code is checked against the private OTP
create or replace function public.confirm_by_qr(p_booking uuid, p_worker uuid, p_amount integer, p_code text)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; mats int; base int; secret text;
begin
  perform public.assert_mine(p_worker, null);
  select * into b from public.bookings
   where id = p_booking and worker_id = p_worker and status in ('completed', 'paid') and worker_confirmed_at is null;
  if b.id is null then return null; end if;
  select otp into secret from public.booking_otps where booking_id = p_booking;
  if p_code is distinct from left(encode(sha256(convert_to(secret || ':' || p_amount || ':' || b.id::text, 'UTF8')), 'hex'), 10) then
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

-- ---------- 4. Table rules: you can only change your own things ----------
drop policy "register worker" on public.workers;
create policy "register worker" on public.workers for insert to authenticated
  with check (auth_id = auth.uid() and is_sample = false and rating_sum = 0 and rating_count = 0 and jobs_done = 0
              and clean_streak = 0 and birth_year is not null and birth_year <= extract(year from now())::int - 18);
drop policy "update worker profile" on public.workers;
create policy "update worker profile" on public.workers for update to authenticated
  using (is_sample = false and auth_id = auth.uid())
  with check (is_sample = false and auth_id = auth.uid()
              and (birth_year is null or birth_year <= extract(year from now())::int - 18));

drop policy "register employer" on public.employers;
create policy "register employer" on public.employers for insert to authenticated
  with check (auth_id = auth.uid() and jobs = 0 and paid_on_time = 0 and rating_sum = 0 and rating_count = 0);
drop policy "update employer profile" on public.employers;
create policy "update employer profile" on public.employers for update to authenticated
  using (auth_id = auth.uid()) with check (auth_id = auth.uid());

drop policy "create booking" on public.bookings;
create policy "create booking" on public.bookings for insert to authenticated
  with check (public.my_employer(employer_id)
              and status = 'searching' and worker_id is null and accepted_at is null
              and wage_min <= agreed_wage and agreed_wage <= wage_max
              and tip = 0 and worker_tags = '{}' and employer_tags = '{}'
              and showup_pay = 0 and showup_paid_at is null and travel_pay = 0 and rain_off = false
              and effort_status is null and effort_extra = 0
              and (extract(hour from (coalesce(scheduled_for, now()) at time zone 'Asia/Kolkata')) between 6 and 19
                   or exists (select 1 from public.employers e where e.id = employer_id and e.gstin is not null)));

drop policy "send message on live booking" on public.messages;
create policy "send message on live booking" on public.messages for insert to authenticated
  with check (exists (select 1 from public.bookings b where b.id = booking_id
                       and b.status in ('assigned', 'started', 'completed', 'paid')
                       and ((sender = 'worker' and public.my_worker(b.worker_id))
                         or (sender = 'employer' and public.my_employer(b.employer_id)))));

drop policy "add material" on public.materials;
create policy "add material" on public.materials for insert to authenticated
  with check (status = 'pending' and exists (select 1 from public.bookings b where b.id = booking_id
                and b.status in ('started', 'completed') and public.my_worker(b.worker_id)));

drop policy "add favorite" on public.favorites;
create policy "add favorite" on public.favorites for insert to authenticated with check (public.my_employer(employer_id));
drop policy "remove favorite" on public.favorites;
create policy "remove favorite" on public.favorites for delete to authenticated using (public.my_employer(employer_id));

drop policy "add repeat job" on public.repeat_jobs;
create policy "add repeat job" on public.repeat_jobs for insert to authenticated with check (public.my_employer(employer_id));
drop policy "change repeat job" on public.repeat_jobs;
create policy "change repeat job" on public.repeat_jobs for update to authenticated
  using (public.my_employer(employer_id)) with check (public.my_employer(employer_id));

drop policy "add rest point" on public.rest_points;
create policy "add rest point" on public.rest_points for insert to authenticated
  with check (public.my_employer(employer_id) and (water or shade or toilet or charging));
drop policy "change rest point" on public.rest_points;
create policy "change rest point" on public.rest_points for update to authenticated
  using (public.my_employer(employer_id)) with check (public.my_employer(employer_id) and (water or shade or toilet or charging));
drop policy "remove rest point" on public.rest_points;
create policy "remove rest point" on public.rest_points for delete to authenticated using (public.my_employer(employer_id));

drop policy "report heat" on public.heat_reports;
create policy "report heat" on public.heat_reports for insert to authenticated with check (public.my_worker(worker_id));

drop policy "add crew" on public.crew_members;
create policy "add crew" on public.crew_members for insert to authenticated with check (public.my_worker(leader_id));
drop policy "remove crew" on public.crew_members;
create policy "remove crew" on public.crew_members for delete to authenticated using (public.my_worker(leader_id));

drop policy "mark attendance" on public.crew_attendance;
create policy "mark attendance" on public.crew_attendance for insert to authenticated
  with check (exists (select 1 from public.crew_members m where m.id = member_id and public.my_worker(m.leader_id)));
drop policy "change attendance" on public.crew_attendance;
create policy "change attendance" on public.crew_attendance for update to authenticated
  using (exists (select 1 from public.crew_members m where m.id = member_id and public.my_worker(m.leader_id)))
  with check (exists (select 1 from public.crew_members m where m.id = member_id and public.my_worker(m.leader_id)));
drop policy "remove attendance" on public.crew_attendance;
create policy "remove attendance" on public.crew_attendance for delete to authenticated
  using (exists (select 1 from public.crew_members m where m.id = member_id and public.my_worker(m.leader_id)));

drop policy "save places" on public.places_cache;
create policy "save places" on public.places_cache for insert to authenticated with check (true);
drop policy "refresh places" on public.places_cache;
create policy "refresh places" on public.places_cache for update to authenticated using (true) with check (true);

-- A worker locked out by 5 wrong tries: the employer issues a fresh OTP
create function public.reset_otp(p_booking uuid, p_employer uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare fresh text := (1000 + floor(random() * 9000))::int::text;
begin
  perform public.assert_mine(null, p_employer);
  if not exists (select 1 from public.bookings where id = p_booking and employer_id = p_employer and status = 'assigned') then
    return null;
  end if;
  update public.booking_otps set otp = fresh, tries = 0 where booking_id = p_booking;
  return fresh;
end $$;
