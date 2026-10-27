-- 030: country packs, part 1 (money, phone numbers, time zones)
-- Worker Buddy is no longer India-only. Each country gets one row in public.countries, and every
-- worker, employer and job records its country. India is the first (and for now the only live) pack,
-- so nothing changes for people already using the app.
-- 1. countries: currency, calling code, phone format, time zone, emergency number, languages.
-- 2. A country on workers, employers and jobs. A profile can only be made in a live country and
--    keeps it. A job takes its employer's country and that country's currency, so a pay slip never
--    changes if settings change later.
-- 3. Phone numbers are stored in international form (+919876543210). A number typed the local way
--    (9876543210) is converted using the person's country, so older app versions keep working.
-- 4. The night-work rule and repeat jobs use the job's own time zone, not Asia/Kolkata.

-- ---------- 1. Countries ----------
create table public.countries (
  code text primary key check (code ~ '^[A-Z]{2}$'),          -- ISO 3166-1 alpha-2
  name text not null check (char_length(name) between 2 and 60),
  live boolean not null default false,                         -- open for sign-up
  currency text not null check (currency ~ '^[A-Z]{3}$'),      -- ISO 4217
  calling_code text not null check (calling_code ~ '^[1-9][0-9]{0,3}$'),
  phone_pattern text not null,       -- the national number after the calling code, without a leading 0
  phone_example text not null,
  time_zone text not null,           -- IANA name, e.g. Asia/Kolkata
  emergency text not null check (emergency ~ '^[0-9]{2,4}$'),
  languages text[] not null check (cardinality(languages) between 1 and 12),
  updated_at timestamptz not null default now()
);
alter table public.countries enable row level security;
create policy "anyone reads countries" on public.countries for select to anon, authenticated using (true);
-- Changed only by the founder in the SQL editor (no write policy)

create function public.check_country() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'unknown time zone %', new.time_zone using errcode = '22023';
  end if;
  if new.phone_example !~ ('^(' || new.phone_pattern || ')$') then
    raise exception 'phone_example does not match phone_pattern' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger countries_check before insert or update on public.countries
  for each row execute function public.check_country();
revoke execute on function public.check_country() from public, anon, authenticated;

insert into public.countries (code, name, live, currency, calling_code, phone_pattern, phone_example, time_zone, emergency, languages)
values ('IN', 'India', true, 'INR', '91', '[6-9][0-9]{9}', '9876543210', 'Asia/Kolkata', '112', '{en,ta,hi}');

create function public.country_tz(p_country text) returns text
language sql stable set search_path = '' as $$
  select coalesce((select time_zone from public.countries where code = p_country), 'UTC')
$$;

-- ---------- 2. A country on every profile and job ----------
alter table public.workers add column country text not null default 'IN' references public.countries(code);
alter table public.employers add column country text not null default 'IN' references public.countries(code);
alter table public.bookings add column country text not null default 'IN' references public.countries(code);
alter table public.bookings add column currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$');

-- A profile is made in a country that is open for sign-up, and keeps that country: changing it
-- would move the clock the night-work rule reads. Moving country is done by the founder.
create function public.profile_country() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.country is distinct from old.country and current_setting('wb.internal', true) is distinct from 'on' then
      new.country := old.country;
    end if;
  elsif not exists (select 1 from public.countries where code = new.country and live) then
    raise exception 'country_not_open' using errcode = '22023';
  end if;
  return new;
end $$;
-- Named so it runs before *_phone_from_account, which reads the number in this country
create trigger workers_country before insert or update of country on public.workers
  for each row execute function public.profile_country();
create trigger employers_country before insert or update of country on public.employers
  for each row execute function public.profile_country();
revoke execute on function public.profile_country() from public, anon, authenticated;

-- A new job always takes its employer's country and that country's currency
create function public.booking_country() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select e.country, c.currency into new.country, new.currency
    from public.employers e join public.countries c on c.code = e.country
   where e.id = new.employer_id;
  new.country := coalesce(new.country, 'IN');
  new.currency := coalesce(new.currency, 'INR');
  return new;
end $$;
create trigger bookings_country before insert on public.bookings
  for each row execute function public.booking_country();
-- ... and keeps them
create function public.booking_country_fixed() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.country := old.country;
  new.currency := old.currency;
  return new;
end $$;
create trigger bookings_country_fixed before update of country, currency on public.bookings
  for each row execute function public.booking_country_fixed();
revoke execute on function public.booking_country(), public.booking_country_fixed() from public, anon, authenticated;

-- The minimum wages in min_wages (016) are Tamil Nadu's, in rupees: they apply to Indian jobs only
-- until wages are kept per country. Runs after bookings_country, which has set the job's country.
create or replace function public.bookings_fair_pay() returns trigger language plpgsql set search_path = '' as $$
declare floor_pay int;
begin
  if tg_op = 'INSERT' and new.country = 'IN' then
    floor_pay := public.legal_min_wage(new.type, new.hours);
    if floor_pay is not null then
      new.wage_min := greatest(new.wage_min, floor_pay);
      new.wage_max := greatest(new.wage_max, new.wage_min);
      new.agreed_wage := greatest(new.agreed_wage, floor_pay);
    end if;
  end if;
  new.ot_rate := public.ot_rate(new.agreed_wage, new.hours);
  return new;
end $$;

-- ---------- 3. Phone numbers in international form ----------
-- Returns +<calling code><national number>, or null when the number is not valid for the country.
-- Accepts 9876543210, 09876543210, 919876543210, +91 98765 43210 and +919876543210 for India.
create function public.phone_e164(p_phone text, p_country text) returns text
language plpgsql stable set search_path = '' as $$
declare c public.countries; d text;
begin
  if p_phone is null then return null; end if;
  select * into c from public.countries where code = p_country;
  if not found then return null; end if;
  d := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if btrim(p_phone) like '+%' or btrim(p_phone) like '00%' then
    d := regexp_replace(d, '^00', '');
    -- Written in international form: any country's number is kept if it is a plausible length
    if d ~ ('^' || c.calling_code || '(' || c.phone_pattern || ')$') or (d !~ ('^' || c.calling_code) and d ~ '^[1-9][0-9]{6,14}$') then
      return '+' || d;
    end if;
    return null;
  end if;
  d := regexp_replace(d, '^0', '');
  if d ~ ('^(' || c.phone_pattern || ')$') then return '+' || c.calling_code || d; end if;
  if d ~ ('^' || c.calling_code || '(' || c.phone_pattern || ')$') then return '+' || d; end if;
  return null;
end $$;

-- Existing numbers: 9876543210 -> +919876543210 (every existing profile is in India)
alter table public.workers drop constraint workers_phone_check;
alter table public.employers drop constraint employers_phone_check;
alter table public.crew_members drop constraint crew_members_phone_check;
alter table public.workers disable trigger user;
alter table public.employers disable trigger user;
alter table public.crew_members disable trigger user;
update public.workers set phone = '+91' || phone where phone ~ '^[6-9][0-9]{9}$';
update public.employers set phone = '+91' || phone where phone ~ '^[6-9][0-9]{9}$';
update public.crew_members set phone = '+91' || phone where phone ~ '^[6-9][0-9]{9}$';
alter table public.workers enable trigger user;
alter table public.employers enable trigger user;
alter table public.crew_members enable trigger user;
alter table public.workers add constraint workers_phone_check check (phone ~ '^\+[1-9][0-9]{6,14}$');
alter table public.employers add constraint employers_phone_check check (phone ~ '^\+[1-9][0-9]{6,14}$');
alter table public.crew_members add constraint crew_members_phone_check check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$');

-- Same job as in 018 (the verified sign-in number wins), now for any country, and a typed
-- number is put into international form or refused with 'bad_phone'.
create or replace function public.phone_from_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  select '+' || u.phone into p from auth.users u
   where u.id = new.auth_id and u.phone_confirmed_at is not null and u.phone ~ '^[1-9][0-9]{6,14}$';
  if p is not null then
    new.phone := p;
    new.phone_verified := true;
  else
    new.phone_verified := false;
    if new.phone !~ '^\+[1-9][0-9]{6,14}$' or tg_op = 'INSERT' or new.phone is distinct from old.phone
       or new.country is distinct from old.country then
      p := public.phone_e164(new.phone, new.country);
      -- An account being deleted keeps a stand-in number (019); it is never shown or called
      if p is null and new.device_id like 'deleted-%' and new.auth_id is null then
        p := '+' || (select calling_code from public.countries where code = new.country) || '0000000';
      end if;
      if p is null then raise exception 'bad_phone' using errcode = '22023'; end if;
      new.phone := p;
    end if;
  end if;
  if tg_op = 'INSERT' and public.suspended(new.auth_id) then
    raise exception 'suspended' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger workers_phone_from_account on public.workers;
drop trigger employers_phone_from_account on public.employers;
create trigger workers_phone_from_account before insert or update of phone, auth_id, country on public.workers
  for each row execute function public.phone_from_account();
create trigger employers_phone_from_account before insert or update of phone, auth_id, country on public.employers
  for each row execute function public.phone_from_account();

-- A crew member's number is read in the crew leader's country
create function public.crew_phone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.phone is null or new.phone = '' then new.phone := null; return new; end if;
  new.phone := public.phone_e164(new.phone, (select country from public.workers where id = new.leader_id));
  if new.phone is null then raise exception 'bad_phone' using errcode = '22023'; end if;
  return new;
end $$;
create trigger crew_members_phone before insert or update of phone on public.crew_members
  for each row execute function public.crew_phone();
revoke execute on function public.crew_phone() from public, anon, authenticated;

-- ---------- 4. Time zones ----------
-- Night work (outside 6:00 to 19:59) still needs a GST-registered employer; the hour is now read
-- in the job's own country. Same rule as 016 otherwise.
drop policy "create booking" on public.bookings;
create policy "create booking" on public.bookings for insert to authenticated
  with check (public.my_employer(employer_id)
              and status = 'searching' and worker_id is null and accepted_at is null
              and wage_min <= agreed_wage and agreed_wage <= wage_max
              and tip = 0 and worker_tags = '{}' and employer_tags = '{}'
              and showup_pay = 0 and showup_paid_at is null and travel_pay = 0 and rain_off = false
              and effort_status is null and effort_extra = 0
              and (extract(hour from (coalesce(scheduled_for, now()) at time zone public.country_tz(country))) between 6 and 19
                   or public.employer_has_gst(employer_id)));

create function public.next_repeat_at(p_weekday int, p_at_time text, p_tz text) returns timestamptz
language sql stable set search_path = '' as $$
  select case when t < now() + interval '60 minutes' then t + interval '7 days' else t end
  from (
    select ((date_trunc('day', now() at time zone p_tz)
             + ((p_weekday - extract(dow from now() at time zone p_tz)::int + 7) % 7) * interval '1 day'
             + p_at_time::time) at time zone p_tz) as t
  ) x
$$;
-- The two-argument version stays for older callers and means India
create or replace function public.next_repeat_at(p_weekday int, p_at_time text) returns timestamptz
language sql stable set search_path = '' as $$
  select public.next_repeat_at(p_weekday, p_at_time, 'Asia/Kolkata')
$$;

create or replace function public.create_due_repeats() returns int
language plpgsql security definer set search_path = '' as $$
declare r public.repeat_jobs; t jsonb; due timestamptz; size int; grp uuid; made int := 0; has_gst boolean; tz text;
begin
  for r in select * from public.repeat_jobs where active loop
    select gstin is not null, public.country_tz(country) into has_gst, tz from public.employers where id = r.employer_id;
    tz := coalesce(tz, 'UTC');
    due := public.next_repeat_at(r.weekday, r.at_time, tz);
    continue when exists (select 1 from public.bookings where repeat_id = r.id and scheduled_for = due);
    -- Night jobs still need a GST-verified employer
    continue when extract(hour from due at time zone tz) not between 6 and 19 and not coalesce(has_gst, false);
    t := r.template;
    size := greatest(1, least(10, coalesce((t->>'group_size')::int, 1)));
    grp := case when size > 1 then gen_random_uuid() end;
    insert into public.bookings (employer_id, type, area, lat, lng, hours, load, risky, wage_min, wage_max, agreed_wage,
                                 bring_tools, perks, scheduled_for, repeat_id, group_id, group_size, otp)
    select r.employer_id, t->>'type', t->>'area', (t->>'lat')::float8, (t->>'lng')::float8, (t->>'hours')::int,
           t->>'load', coalesce((t->>'risky')::boolean, false), (t->>'wage_min')::int, (t->>'wage_max')::int,
           (t->>'agreed_wage')::int, coalesce((t->>'bring_tools')::boolean, false),
           coalesce(array(select jsonb_array_elements_text(t->'perks')), '{}'),
           due, r.id, grp, size, (1000 + floor(random() * 9000))::int::text
    from generate_series(1, size);
    made := made + size;
  end loop;
  return made;
end $$;
revoke execute on function public.create_due_repeats() from anon, authenticated, public;
