-- 016: private phone numbers and locations, and a legal wage floor
-- 1. Nobody can read another person's phone number, UPI ID, device id or exact location.
--    Other people's profiles come from workers_public / employers_public: no phone, and the
--    location is rounded to about 1 km. Your own full profile comes from get_my_worker /
--    get_my_employer. The phone, UPI ID and live location of the other person on a job come
--    from job_contacts, and only while you share that job.
-- 2. Bookings, messages, offers, materials, crew, favourites, repeat jobs and heat reports:
--    only the people on them can read them. The wage map, reviews and dispute room read
--    through functions that return only what those pages show.
-- 3. Pay: the Tamil Nadu minimum wage is the floor of every job (the database raises any job
--    posted below it), and overtime is paid at twice the hourly rate (Code on Wages, 2019, s.14).

-- ---------- 1. Profiles: public views without phone numbers or exact locations ----------
create view public.workers_public with (security_barrier) as
  select id, name, skill, online, rating_sum, rating_count, jobs_done, is_sample, updated_at,
         experience_years, iti_cert, tools, home_state, city, lessons, available_days, clean_streak, is_mestri,
         round(lat::numeric, 2)::double precision as lat,   -- about 1 km
         round(lng::numeric, 2)::double precision as lng
    from public.workers;

create view public.employers_public with (security_barrier) as
  select id, name, jobs, paid_on_time, rating_sum, rating_count, created_at, disputes, gstin, effort_refused
    from public.employers;

grant select on public.workers_public, public.employers_public to anon, authenticated;

-- The tables themselves: only the id stays readable (updates find the row by id)
revoke select on public.workers, public.employers from anon, authenticated;
grant select (id) on public.workers, public.employers to anon, authenticated;

-- Live updates used to send whole worker rows (phone and GPS) to every app; the employer app now refreshes instead
alter publication supabase_realtime drop table public.workers;

-- Your own profile. Shared phone mode: this phone's profile id first, then your newest.
-- A profile made before accounts existed is found by its device id until claim_profiles claims it
-- (never a sample profile: their device ids are public in 001).
create function public.get_my_worker(p_device text default null) returns setof public.workers
language sql stable security definer set search_path = '' as $$
  select * from public.workers
   where auth.uid() is not null
     and (auth_id = auth.uid() or (p_device is not null and device_id = p_device and auth_id is null and not is_sample))
   order by (device_id = p_device) desc nulls last, updated_at desc
   limit 1
$$;

create function public.get_my_employer(p_device text default null) returns setof public.employers
language sql stable security definer set search_path = '' as $$
  select * from public.employers
   where auth.uid() is not null
     and (auth_id = auth.uid() or (p_device is not null and device_id = p_device and auth_id is null))
   order by (device_id = p_device) desc nulls last, created_at desc
   limit 1
$$;

-- The other person on my jobs: phone and UPI ID once matched; the worker's live location
-- only while they are on the way or at work (a job booked for later: from 2 hours before it starts).
-- The job site is already on the booking.
create function public.job_contacts(p_bookings uuid[])
returns table (booking_id uuid, person_id uuid, phone text, upi_id text, lat double precision, lng double precision)
language sql stable security definer set search_path = '' as $$
  select b.id, w.id, w.phone, w.upi_id,
         case when b.status = 'started' or (b.status = 'assigned' and (b.scheduled_for is null or b.scheduled_for <= now() + interval '2 hours')) then w.lat end,
         case when b.status = 'started' or (b.status = 'assigned' and (b.scheduled_for is null or b.scheduled_for <= now() + interval '2 hours')) then w.lng end
    from public.bookings b join public.workers w on w.id = b.worker_id
   where b.id = any (p_bookings) and public.my_employer(b.employer_id)
  union all
  select b.id, e.id, e.phone, null, null, null
    from public.bookings b join public.employers e on e.id = b.employer_id
   where b.id = any (p_bookings) and b.worker_id is not null and public.my_worker(b.worker_id)
$$;

-- Table rules can't read the hidden columns any more, so they ask these functions instead
create function public.employer_has_gst(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employers where id = p and gstin is not null)
$$;
create function public.i_work_as(p_skill text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.workers where auth_id = auth.uid() and skill = p_skill)
$$;

-- Same rule as in 012, with the GST check through employer_has_gst
drop policy "create booking" on public.bookings;
create policy "create booking" on public.bookings for insert to authenticated
  with check (public.my_employer(employer_id)
              and status = 'searching' and worker_id is null and accepted_at is null
              and wage_min <= agreed_wage and agreed_wage <= wage_max
              and tip = 0 and worker_tags = '{}' and employer_tags = '{}'
              and showup_pay = 0 and showup_paid_at is null and travel_pay = 0 and rain_off = false
              and effort_status is null and effort_extra = 0
              and (extract(hour from (coalesce(scheduled_for, now()) at time zone 'Asia/Kolkata')) between 6 and 19
                   or public.employer_has_gst(employer_id)));

-- ---------- 2. Jobs and everything on them: only the people involved ----------
-- Workers still see open jobs for their skill, so their phones can ring
drop policy "read bookings" on public.bookings;
create policy "read my or open bookings" on public.bookings for select to authenticated
  using (public.my_employer(employer_id)
         or (worker_id is not null and public.my_worker(worker_id))
         or (status = 'searching' and public.i_work_as(type)));

drop policy "read messages" on public.messages;
create policy "read messages on my jobs" on public.messages for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id
                  and (public.my_employer(b.employer_id) or (b.worker_id is not null and public.my_worker(b.worker_id)))));

drop policy "read materials" on public.materials;
create policy "read materials on my jobs" on public.materials for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id
                  and (public.my_employer(b.employer_id) or (b.worker_id is not null and public.my_worker(b.worker_id)))));

drop policy "read offers" on public.offers;
create policy "read my offers" on public.offers for select to authenticated
  using (public.my_worker(worker_id)
         or exists (select 1 from public.bookings b where b.id = booking_id and public.my_employer(b.employer_id)));

drop policy "read heat reports" on public.heat_reports;
create policy "read my heat reports" on public.heat_reports for select to authenticated using (public.my_worker(worker_id));

drop policy "read favorites" on public.favorites;
create policy "read my favorites" on public.favorites for select to authenticated using (public.my_employer(employer_id));

drop policy "read repeat jobs" on public.repeat_jobs;
create policy "read my repeat jobs" on public.repeat_jobs for select to authenticated using (public.my_employer(employer_id));

drop policy "read crew" on public.crew_members;
create policy "read my crew" on public.crew_members for select to authenticated using (public.my_worker(leader_id));

drop policy "read attendance" on public.crew_attendance;
create policy "read my crew attendance" on public.crew_attendance for select to authenticated
  using (exists (select 1 from public.crew_members m where m.id = member_id and public.my_worker(m.leader_id)));

-- Review tags on a profile (counted from the last 100 reviewed jobs)
create function public.review_tags(p_kind text, p_id uuid) returns table (tag text, n int)
language sql stable security definer set search_path = '' as $$
  select tag, count(*)::int
    from (select case when p_kind = 'worker' then b.worker_tags else b.employer_tags end as tags
            from public.bookings b
           where case when p_kind = 'worker' then b.worker_id = p_id else b.employer_id = p_id end
             and (case when p_kind = 'worker' then b.worker_tags else b.employer_tags end) <> '{}'
           order by b.created_at desc
           limit 100) r, unnest(r.tags) tag
   group by tag
   order by 2 desc
$$;

-- Wage map: confirmed pay by kind of work, placed to about 1 km
create function public.wage_map_rows()
returns table (type text, lat double precision, lng double precision, agreed_wage int, hours int)
language sql stable security definer set search_path = '' as $$
  select b.type, round(b.lat::numeric, 2)::double precision, round(b.lng::numeric, 2)::double precision, b.agreed_wage, b.hours
    from public.bookings b
   where b.worker_confirmed_at is not null and b.lat is not null
   order by b.worker_confirmed_at desc
   limit 2000
$$;

-- Dispute room: anyone with the link sees the evidence; phone numbers and the exact
-- site and check-in points only for the two people on the job. How far from the site the
-- worker checked in (start_m, metres) is worked out here from the exact points, so
-- rounding can't make it look wrong.
create function public.dispute_evidence(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; party boolean; j jsonb;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null then return null; end if;
  party := public.my_employer(b.employer_id) or (b.worker_id is not null and public.my_worker(b.worker_id));
  j := (to_jsonb(b) - 'otp') || jsonb_build_object('start_m',
         case when b.start_lat is not null and b.lat is not null then
           round(12742000 * asin(sqrt(power(sin(radians(b.start_lat - b.lat) / 2), 2)
             + cos(radians(b.lat)) * cos(radians(b.start_lat)) * power(sin(radians(b.start_lng - b.lng) / 2), 2))))::int end);
  if not party then
    j := j || jsonb_build_object('lat', round(b.lat::numeric, 2), 'lng', round(b.lng::numeric, 2),
                                 'start_lat', null, 'start_lng', null);
  end if;
  return jsonb_build_object(
    'booking', j,
    'employer', (select jsonb_build_object('name', e.name, 'phone', case when party then e.phone end, 'gstin', e.gstin,
                          'jobs', e.jobs, 'paid_on_time', e.paid_on_time, 'rating_sum', e.rating_sum,
                          'rating_count', e.rating_count, 'disputes', e.disputes)
                   from public.employers e where e.id = b.employer_id),
    'worker', (select jsonb_build_object('name', w.name, 'phone', case when party then w.phone end, 'skill', w.skill)
                 from public.workers w where w.id = b.worker_id),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.messages m where m.booking_id = b.id), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.materials x where x.booking_id = b.id), '[]'::jsonb));
end $$;

revoke all on function public.get_my_worker(text), public.get_my_employer(text), public.job_contacts(uuid[]),
  public.review_tags(text, uuid), public.wage_map_rows(), public.dispute_evidence(uuid) from public;
grant execute on function public.get_my_worker(text), public.get_my_employer(text), public.job_contacts(uuid[]) to authenticated;
grant execute on function public.review_tags(text, uuid), public.wage_map_rows(), public.dispute_evidence(uuid) to anon, authenticated;

-- ---------- 3. Pay: the legal minimum wage is the floor, overtime is double ----------
-- Tamil Nadu minimum wage, "construction or maintenance of roads and buildings", 1 Apr 2026 to
-- 31 Mar 2027: ₹609.30 a day (basic ₹117 + VDA ₹492.30, as listed by WageIndicator), rounded up
-- to ₹610. No per-trade figure could be confirmed, so every kind of work uses this floor.
-- Check it against the Labour Department's G.O. and update the rows here (and MIN_WAGE_DAY in js/data.js).
create table public.min_wages (
  type text primary key check (type in ('coolie','helper','plumber','electrician','mason','painter')),
  day_rate int not null check (day_rate > 0),
  source text not null,
  effective_from date not null
);
alter table public.min_wages enable row level security;
create policy "read minimum wages" on public.min_wages for select to anon, authenticated using (true);
insert into public.min_wages (type, day_rate, source, effective_from)
  select k, 610, 'TN minimum wage, construction or maintenance of roads and buildings: ₹609.30/day from 1 Apr 2026, rounded up', date '2026-04-01'
    from unnest(array['coolie','helper','plumber','electrician','mason','painter']) k;

-- The lowest legal wage for a job: short jobs by the hour (at least half a day),
-- hours past 8 at twice the hourly rate. Same rounding as js/wage.js.
create function public.legal_min_wage(p_type text, p_hours int) returns int
language sql stable set search_path = '' as $$
  select (case when p_hours > 8
               then m.day_rate + ceil(m.day_rate / 4.0 * (p_hours - 8) / 10) * 10
               else ceil(m.day_rate * greatest(p_hours / 8.0, 0.5) / 10) * 10 end)::int
    from public.min_wages m where m.type = p_type
$$;

-- Overtime per hour = twice the agreed wage per hour (a short job counts as at least 4 hours)
create function public.ot_rate(p_wage int, p_hours int) returns int
language sql immutable set search_path = '' as $$
  select ceil(p_wage * 2.0 / greatest(p_hours, 4))::int
$$;

alter table public.bookings add column ot_rate int not null default 0;
-- Jobs already finished keep the ₹80 they were paid at, so old pay slips still add up
update public.bookings set ot_rate = case when completed_at is not null then 80 else public.ot_rate(agreed_wage, hours) end;

-- Every new job (from the app or a repeat job) is raised to the legal floor; the overtime rate follows the agreed wage
create function public.bookings_fair_pay() returns trigger language plpgsql set search_path = '' as $$
declare floor_pay int;
begin
  if tg_op = 'INSERT' then
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
create trigger bookings_fair_pay before insert or update of agreed_wage, hours on public.bookings
  for each row execute function public.bookings_fair_pay();

-- Completing work: overtime at the job's own rate instead of a flat ₹80
create or replace function public.complete_booking(p_booking uuid, p_worker uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare extra int;
begin
  perform public.assert_mine(p_worker, null);
  select greatest(0, ceil(extract(epoch from (now() - b.started_at)) / 3600.0 - b.hours - 0.25))::int
    into extra
    from public.bookings b
   where b.id = p_booking and b.worker_id = p_worker and b.status = 'started';
  if extra is null then return false; end if;
  update public.bookings
     set status = 'completed', completed_at = now(), overtime_hours = extra,
         paid_amount = agreed_wage + ot_rate * extra + travel_pay
   where id = p_booking;
  return true;
end $$;
