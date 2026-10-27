-- 031: country packs, part 2 (pay rules)
-- Every amount the app adds to or takes from a wage now comes from the job's country, not from
-- rupee numbers written into the code. India's rules are exactly what they were, so nothing changes
-- for people already using the app.
-- 1. countries.pay_rules: rounding step, overtime multiple, show-up pay, effort and risk extras,
--    tools extra, travel allowance, night and heat extras, counter-offer step. See docs/ADDING-A-COUNTRY.md. countries.wage_region names the place
--    whose minimum wage is used ("Tamil Nadu").
-- 2. min_wages per country and trade, with the estimated going rate (est_min, est_max) the app shows.
--    A country can't go live without all six trades and every pay rule, and a country with jobs keeps them.
-- 3. The legal floor, overtime rate, travel allowance, effort extra, rain-off pay and show-up pay
--    use the job's country. The India-only versions of these helpers are dropped. The wage map shows
--    one country at a time.

-- ---------- 1. Pay rules ----------
alter table public.countries add column pay_rules jsonb not null default '{}';
alter table public.countries add column wage_region text check (char_length(wage_region) <= 60);

-- Every key a live country needs, all numbers
create function public.pay_rule_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['round', 'overtime', 'short_min', 'showup', 'tools', 'load_medium', 'load_heavy', 'risky',
               'travel_free_km', 'travel_base', 'travel_per_km', 'travel_max', 'night', 'heat', 'offer_step']
$$;

create function public.pay_rule(p_country text, p_key text) returns numeric
language sql stable set search_path = '' as $$
  select (pay_rules ->> p_key)::numeric from public.countries where code = p_country
$$;

-- Rounds up to the country's step (10 rupees, 1 dollar), so a floor is never undercut
create function public.round_up(p_amount numeric, p_country text) returns int
language sql stable set search_path = '' as $$
  select (ceil(p_amount / public.pay_rule(p_country, 'round')) * public.pay_rule(p_country, 'round'))::int
$$;

create function public.round_near(p_amount numeric, p_country text) returns int
language sql stable set search_path = '' as $$
  select (round(p_amount / public.pay_rule(p_country, 'round')) * public.pay_rule(p_country, 'round'))::int
$$;

-- ---------- 2. Minimum wages and going rates per country ----------
alter table public.min_wages add column country text not null default 'IN' references public.countries(code);
alter table public.min_wages add column est_min int;
alter table public.min_wages add column est_max int;
alter table public.min_wages drop constraint min_wages_pkey;
alter table public.min_wages add primary key (country, type);
alter table public.min_wages alter column country drop default;

-- India's going rates, as js/data.js had them (estimates, never below the floor)
update public.min_wages m set est_min = v.lo, est_max = v.hi
  from (values ('coolie', 610, 700), ('helper', 610, 650), ('plumber', 700, 1000),
               ('electrician', 800, 1100), ('mason', 750, 1000), ('painter', 650, 900)) v(type, lo, hi)
 where m.country = 'IN' and m.type = v.type;
alter table public.min_wages alter column est_min set not null;
alter table public.min_wages alter column est_max set not null;
alter table public.min_wages add constraint min_wages_estimate check (est_min >= day_rate and est_max >= est_min);

-- Live, or has jobs: the country's pay rules and minimum wages must stay complete
create function public.country_in_use(p_country text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.countries where code = p_country and live)
      or exists (select 1 from public.bookings where country = p_country)
$$;

-- A country goes live only with all six trades and every pay rule, and keeps them while in use
create or replace function public.check_country() returns trigger
language plpgsql set search_path = '' as $$
declare k text;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'unknown time zone %', new.time_zone using errcode = '22023';
  end if;
  if new.phone_example !~ ('^(' || new.phone_pattern || ')$') then
    raise exception 'phone_example does not match phone_pattern' using errcode = '22023';
  end if;
  if new.live or exists (select 1 from public.bookings where country = new.code) then
    foreach k in array public.pay_rule_keys() loop
      if jsonb_typeof(new.pay_rules -> k) is distinct from 'number' then
        raise exception 'pay rule % missing for %', k, new.code using errcode = '22023';
      end if;
    end loop;
    if (new.pay_rules ->> 'round')::numeric <= 0 or (new.pay_rules ->> 'overtime')::numeric < 1 then
      raise exception 'round must be above 0 and overtime at least 1' using errcode = '22023';
    end if;
    if (select count(*) from public.min_wages where country = new.code) < 6 then
      raise exception 'minimum wages missing for %', new.code using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create function public.check_min_wage_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.country_in_use(old.country) then
    raise exception 'a country in use keeps its minimum wages; change the rate instead' using errcode = '22023';
  end if;
  return old;
end $$;
create trigger min_wages_keep before delete on public.min_wages
  for each row execute function public.check_min_wage_delete();
revoke execute on function public.check_min_wage_delete() from public, anon, authenticated;

-- India: the rules the app has always used
update public.countries set wage_region = 'Tamil Nadu', pay_rules = jsonb_build_object(
  'round', 10,           -- amounts are whole tens of rupees
  'overtime', 2,         -- hours past 8 at twice the hourly rate (Code on Wages, 2019)
  'short_min', 0.5,      -- a short job pays at least half a day
  'showup', 100,         -- employer cancels after the worker set off
  'tools', 50,           -- worker brings own tools
  'load_medium', 50, 'load_heavy', 100, 'risky', 100,
  'travel_free_km', 5, 'travel_base', 50, 'travel_per_km', 10, 'travel_max', 150,
  'night', 0.2,          -- 8 PM to 6 AM
  'heat', 0.1,           -- hot day, not at night
  'offer_step', 50)      -- a worker's counter-offer: one or two steps above the posted wage
 where code = 'IN';

-- ---------- 3. Amounts follow the job's country ----------
-- Lowest legal wage: short jobs by the hour (at least short_min of a day), hours past 8 at the overtime multiple
create function public.legal_min_wage(p_type text, p_hours int, p_country text) returns int
language sql stable set search_path = '' as $$
  select case when p_hours > 8
              then m.day_rate + public.round_up(m.day_rate / 8.0 * public.pay_rule(p_country, 'overtime') * (p_hours - 8), p_country)
              else public.round_up(m.day_rate * greatest(p_hours / 8.0, public.pay_rule(p_country, 'short_min')), p_country) end
    from public.min_wages m where m.country = p_country and m.type = p_type
$$;

-- Overtime per hour = the overtime multiple of the agreed wage per hour (a short job counts as at least 4 hours)
create function public.ot_rate(p_wage int, p_hours int, p_country text) returns int
language sql stable set search_path = '' as $$
  select ceil(p_wage * public.pay_rule(p_country, 'overtime') / greatest(p_hours, 4))::int
$$;

create or replace function public.bookings_fair_pay() returns trigger language plpgsql set search_path = '' as $$
declare floor_pay int;
begin
  if tg_op = 'INSERT' then
    floor_pay := public.legal_min_wage(new.type, new.hours, new.country);
    if floor_pay is not null then
      new.wage_min := greatest(new.wage_min, floor_pay);
      new.wage_max := greatest(new.wage_max, new.wage_min);
      new.agreed_wage := greatest(new.agreed_wage, floor_pay);
    end if;
  end if;
  new.ot_rate := public.ot_rate(new.agreed_wage, new.hours, new.country);
  return new;
end $$;

-- Travel allowance: nothing up to travel_free_km, then base + per km, up to travel_max
create function public.travel_pay_for(a_lat double precision, a_lng double precision,
                                      b_lat double precision, b_lng double precision, p_country text) returns int
language sql stable set search_path = '' as $$
  select case
    when a_lat is null or b_lat is null then 0
    else (select case when km <= r.free_km then 0
                      else least(r.max_pay, r.base + r.per_km * floor(km - r.free_km))::int end
            from (select 6371 * 2 * asin(sqrt(
                    power(sin(radians(b_lat - a_lat) / 2), 2) +
                    cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))) as km) d,
                 (select public.pay_rule(p_country, 'travel_free_km') free_km, public.pay_rule(p_country, 'travel_base') base,
                         public.pay_rule(p_country, 'travel_per_km') per_km, public.pay_rule(p_country, 'travel_max') max_pay) r)
  end
$$;

-- Accepting a job or an offer: as in 021, with the job's own travel rule
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
         travel_pay = public.travel_pay_for(coalesce(s.lat, lat), coalesce(s.lng, lng), w.lat, w.lng, country)
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
         travel_pay = public.travel_pay_for(coalesce(s.lat, lat), coalesce(s.lng, lng), w.lat, w.lng, country)
   where id = p_booking and employer_id = p_employer and status = 'searching'
  returning * into b;
  if b.id is null then return null; end if;
  update public.offers set status = case when id = o.id then 'accepted' else 'rejected' end where booking_id = p_booking;
  return b;
end $$;

-- Work harder than described: the extra in the job's country (as in 008, with 012's ownership check)
create function public.load_extra(p_load text, p_country text) returns int
language sql stable set search_path = '' as $$
  select case p_load when 'medium' then public.pay_rule(p_country, 'load_medium')
                     when 'heavy' then public.pay_rule(p_country, 'load_heavy') else 0 end::int
$$;

create or replace function public.claim_effort(p_booking uuid, p_worker uuid, p_load text, p_risky boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; extra int;
begin
  perform public.assert_mine(p_worker, null);
  select * into b from public.bookings
   where id = p_booking and worker_id = p_worker and status in ('started', 'completed') and effort_status is null;
  if b.id is null or p_load not in ('light', 'medium', 'heavy') then return null; end if;
  extra := greatest(0, public.load_extra(p_load, b.country) - public.load_extra(b.load, b.country))
         + case when p_risky and not b.risky then public.pay_rule(b.country, 'risky')::int else 0 end;
  if extra = 0 then return 0; end if;
  update public.bookings
     set effort_load = p_load, effort_risky = p_risky, effort_extra = extra,
         effort_status = 'pending', effort_at = now()
   where id = p_booking;
  return extra;
end $$;

-- Rain-off pay: the time worked, at least short_min of the wage (as in 006 and 012), rounded the country's way
create or replace function public.rain_stop(p_booking uuid, p_employer uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_mine(null, p_employer);
  update public.bookings
     set status = 'completed', completed_at = now(), rain_off = true, overtime_hours = 0,
         paid_amount = public.round_near(agreed_wage * least(1, greatest(public.pay_rule(country, 'short_min'),
                         extract(epoch from (now() - started_at)) / 3600.0 / hours)), country) + travel_pay
   where id = p_booking and employer_id = p_employer and status = 'started';
  return found;
end $$;

-- Show-up pay: the job country's amount (as in 006 and 015, with 012's ownership checks)
create or replace function public.cancel_booking(p_booking uuid, p_employer uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_mine(null, p_employer);
  update public.bookings
     set status = case when p_reason = 'expired' then 'expired' else 'cancelled' end,
         cancel_reason = left(p_reason, 40),
         showup_pay = case when status = 'assigned' and scheduled_for is null and p_reason <> 'expired'
                           then public.pay_rule(country, 'showup')::int else 0 end
   where id = p_booking and employer_id = p_employer and status in ('searching', 'assigned');
  return found;
end $$;

create or replace function public.cancel_job(p_booking uuid, p_worker uuid, p_employer uuid, p_note text)
returns text language plpgsql security definer set search_path = '' as $$
declare b public.bookings; note text := nullif(left(trim(coalesce(p_note, '')), 120), '');
begin
  if note is null then return 'need_reason'; end if;
  if p_worker is not null then
    perform public.assert_mine(p_worker, null);
    select * into b from public.bookings where id = p_booking and worker_id = p_worker for update;
    if b.id is null then return 'not_found'; end if;
    if b.status = 'assigned' then
      update public.bookings
         set status = 'searching', worker_id = null, accepted_at = null, preferred_worker_id = null,
             travel_pay = 0, cancel_reason = 'worker_cancelled', cancel_note = note, cancelled_by = 'worker',
             created_at = case when scheduled_for is null then now() else created_at end
       where id = p_booking;
      perform set_config('wb.internal', 'on', true);
      update public.workers set clean_streak = 0 where id = p_worker;
      return 'reposted';
    elsif b.status in ('started', 'completed') then
      update public.bookings set status = 'cancelled', cancel_reason = 'closed_by_worker', cancel_note = note,
             cancelled_by = 'worker' where id = p_booking;
      return 'closed';
    end if;
    return 'not_allowed';
  end if;

  perform public.assert_mine(null, p_employer);
  select * into b from public.bookings where id = p_booking and employer_id = p_employer for update;
  if b.id is null then return 'not_found'; end if;
  if b.status in ('searching', 'assigned') then
    update public.bookings
       set status = 'cancelled', cancel_reason = case when b.status = 'assigned' then 'employer_cancelled' else 'cancelled' end,
           cancel_note = note, cancelled_by = 'employer',
           showup_pay = case when b.status = 'assigned' and b.scheduled_for is null
                             then public.pay_rule(b.country, 'showup')::int else 0 end
     where id = p_booking;
    return case when b.status = 'assigned' and b.scheduled_for is null then 'showup' else 'cancelled' end;
  elsif b.status in ('started', 'completed') then
    update public.bookings set status = 'cancelled', cancel_reason = 'employer_unpaid', cancel_note = note,
           cancelled_by = 'employer' where id = p_booking;
    perform set_config('wb.internal', 'on', true);
    update public.employers set jobs = jobs + 1 where id = p_employer; -- a job, but not paid
    return 'unpaid';
  end if;
  return 'not_allowed';
end $$;

-- The India-only versions are replaced by the ones above that take the country
drop function public.legal_min_wage(text, int);
drop function public.ot_rate(int, int);
drop function public.travel_pay_for(double precision, double precision, double precision, double precision);
drop function public.load_extra(text);

-- Wage map: one country's jobs at a time, so rupees and shillings are never averaged together
create function public.wage_map_rows(p_country text)
returns table (type text, lat double precision, lng double precision, agreed_wage int, hours int)
language sql stable security definer set search_path = '' as $$
  select b.type, round(b.lat::numeric, 2)::double precision, round(b.lng::numeric, 2)::double precision, b.agreed_wage, b.hours
    from public.bookings b
   where b.worker_confirmed_at is not null and b.lat is not null and b.country = p_country
   order by b.worker_confirmed_at desc
   limit 2000
$$;
revoke all on function public.wage_map_rows(text) from public;
grant execute on function public.wage_map_rows(text) to anon, authenticated;

-- Older app versions ask without a country: India's jobs only, never every country mixed together
create or replace function public.wage_map_rows()
returns table (type text, lat double precision, lng double precision, agreed_wage int, hours int)
language sql stable security definer set search_path = '' as $$
  select * from public.wage_map_rows('IN')
$$;
