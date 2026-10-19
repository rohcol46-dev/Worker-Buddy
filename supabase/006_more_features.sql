-- 27 more features: fair pay extras, safety, migrants, growth, employer tools
-- (show-up pay, QR proof of pay, travel allowance, rain-off pay, tools, materials,
--  meal/water tags, 18+ check, night jobs, site check-in, streaks, favourites first,
--  repeat jobs, contractor crew book, accident-cover interest)

-- ---------- New columns ----------
alter table public.bookings
  add column showup_pay int not null default 0,          -- owed when the employer cancels after the worker set off
  add column showup_paid_at timestamptz,
  add column rain_off boolean not null default false,    -- work stopped by rain: paid at least half a day
  add column travel_pay int not null default 0,          -- site more than 5 km from the worker
  add column bring_tools boolean not null default false, -- worker brings own tools (+₹50, inside the wage)
  add column perks text[] not null default '{}',         -- meal, water, shade, toilet provided
  add column priority_ids uuid[],                        -- favourite workers see it first (60 seconds)
  add column start_lat double precision,                 -- where the worker was when the OTP was entered
  add column start_lng double precision,
  add column repeat_id bigint;

alter table public.workers
  add column birth_year int check (birth_year is null or birth_year between 1940 and 2100),
  add column tools text[] not null default '{}',
  add column home_state text check (home_state is null or char_length(home_state) <= 40),
  add column city text check (city is null or char_length(city) <= 40),
  add column lessons text[] not null default '{}',
  add column available_days date[] not null default '{}',
  add column clean_streak int not null default 0,
  add column cover_optin boolean not null default false,
  add column is_mestri boolean not null default false;

alter table public.employers
  add column gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

-- ---------- 18+ only (no child labour) ----------
drop policy "register worker" on public.workers;
create policy "register worker" on public.workers for insert to anon, authenticated
  with check (is_sample = false and rating_sum = 0 and rating_count = 0 and jobs_done = 0 and clean_streak = 0
              and birth_year is not null and birth_year <= extract(year from now())::int - 18);
drop policy "update worker profile" on public.workers;
create policy "update worker profile" on public.workers for update to anon, authenticated
  using (is_sample = false)
  with check (is_sample = false and (birth_year is null or birth_year <= extract(year from now())::int - 18));

create or replace function public.keep_worker_stats() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('wb.internal', true) is distinct from 'on' then
    new.rating_sum := old.rating_sum;
    new.rating_count := old.rating_count;
    new.jobs_done := old.jobs_done;
    new.clean_streak := old.clean_streak;
    new.device_id := old.device_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Employers can now edit their profile (GST number), but not their scores
create function public.keep_employer_stats() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('wb.internal', true) is distinct from 'on' then
    new.jobs := old.jobs;
    new.paid_on_time := old.paid_on_time;
    new.rating_sum := old.rating_sum;
    new.rating_count := old.rating_count;
    new.disputes := old.disputes;
    new.device_id := old.device_id;
  end if;
  return new;
end $$;
create trigger employers_keep_stats before update on public.employers for each row execute function public.keep_employer_stats();
create policy "update employer profile" on public.employers for update to anon, authenticated using (true) with check (true);

-- The money functions below change employer scores, so they switch wb.internal on
-- (security definer functions bypass RLS, but triggers still run).

-- ---------- Posting: money fields start at zero; night jobs need a GST-verified employer ----------
drop policy "create booking" on public.bookings;
create policy "create booking" on public.bookings for insert to anon, authenticated
  with check (status = 'searching' and worker_id is null and accepted_at is null
              and wage_min <= agreed_wage and agreed_wage <= wage_max
              and tip = 0 and worker_tags = '{}' and employer_tags = '{}'
              and showup_pay = 0 and showup_paid_at is null and travel_pay = 0 and rain_off = false
              and (extract(hour from (coalesce(scheduled_for, now()) at time zone 'Asia/Kolkata')) between 6 and 19
                   or exists (select 1 from public.employers e where e.id = employer_id and e.gstin is not null)));

-- ---------- Travel allowance: ₹50 past 5 km, +₹10 per extra km, at most ₹150 ----------
create function public.travel_pay_for(a_lat double precision, a_lng double precision,
                                      b_lat double precision, b_lng double precision) returns int
language sql immutable set search_path = '' as $$
  select case
    when a_lat is null or b_lat is null then 0
    else (select case when km <= 5 then 0 else least(150, 50 + 10 * floor(km - 5)::int) end
            from (select 6371 * 2 * asin(sqrt(
                    power(sin(radians(b_lat - a_lat) / 2), 2) +
                    cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))) as km) d)
  end
$$;

-- Accept: favourites first for 60 seconds, travel allowance worked out from the worker's position
create or replace function public.accept_booking(p_booking uuid, p_worker uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; w public.workers;
begin
  select * into w from public.workers where id = p_worker and not is_sample;
  if w.id is null then return null; end if;
  update public.bookings
     set status = 'assigned', worker_id = p_worker, accepted_at = now(),
         travel_pay = public.travel_pay_for(lat, lng, w.lat, w.lng)
   where id = p_booking and status = 'searching' and type = w.skill
     and (preferred_worker_id is null or preferred_worker_id = p_worker)
     and (priority_ids is null or p_worker = any(priority_ids) or now() > created_at + interval '60 seconds')
     and (w.online or scheduled_for is not null)
  returning * into b;
  return b;
end $$;

create or replace function public.accept_offer(p_booking uuid, p_employer uuid, p_offer bigint) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare o public.offers; b public.bookings; w public.workers;
begin
  select * into o from public.offers where id = p_offer and booking_id = p_booking and status = 'open';
  if o.id is null then return null; end if;
  if exists (select 1 from public.bookings x where x.worker_id = o.worker_id
              and x.status in ('assigned', 'started', 'completed') and x.scheduled_for is null) then
    update public.offers set status = 'rejected' where id = o.id;
    return null;
  end if;
  select * into w from public.workers where id = o.worker_id;
  update public.bookings
     set status = 'assigned', worker_id = o.worker_id, agreed_wage = o.amount, accepted_at = now(),
         travel_pay = public.travel_pay_for(lat, lng, w.lat, w.lng)
   where id = p_booking and employer_id = p_employer and status = 'searching'
  returning * into b;
  if b.id is null then return null; end if;
  update public.offers set status = case when id = o.id then 'accepted' else 'rejected' end where booking_id = p_booking;
  return b;
end $$;

-- ---------- Show-up pay: cancelling after a worker accepted costs the employer ₹100 ----------
create or replace function public.cancel_booking(p_booking uuid, p_employer uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings
     set status = case when p_reason = 'expired' then 'expired' else 'cancelled' end,
         cancel_reason = left(p_reason, 40),
         showup_pay = case when status = 'assigned' and scheduled_for is null and p_reason <> 'expired' then 100 else 0 end
   where id = p_booking and employer_id = p_employer and status in ('searching', 'assigned');
  return found;
end $$;

create function public.pay_showup(p_booking uuid, p_employer uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set showup_paid_at = now()
   where id = p_booking and employer_id = p_employer and showup_pay > 0 and showup_paid_at is null;
  return found;
end $$;

-- ---------- Site check-in: the OTP only starts work within 1 km of the site ----------
create function public.start_at_site(p_booking uuid, p_worker uuid, p_otp text,
                                     p_lat double precision, p_lng double precision) returns text
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; km double precision;
begin
  select * into b from public.bookings where id = p_booking and worker_id = p_worker and status = 'assigned';
  if b.id is null then return 'not_found'; end if;
  if b.otp <> p_otp then return 'wrong_otp'; end if;
  if p_lat is not null and b.lat is not null then
    km := 6371 * 2 * asin(sqrt(power(sin(radians(b.lat - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - p_lng) / 2), 2)));
    if km > 1 then return 'too_far'; end if;
  end if;
  update public.bookings set status = 'started', started_at = now(), start_lat = p_lat, start_lng = p_lng
   where id = p_booking;
  return 'ok';
end $$;

-- ---------- Completing: overtime + travel allowance ----------
create or replace function public.complete_booking(p_booking uuid, p_worker uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare extra int;
begin
  select greatest(0, ceil(extract(epoch from (now() - b.started_at)) / 3600.0 - b.hours - 0.25))::int
    into extra
    from public.bookings b
   where b.id = p_booking and b.worker_id = p_worker and b.status = 'started';
  if extra is null then return false; end if;
  update public.bookings
     set status = 'completed', completed_at = now(), overtime_hours = extra,
         paid_amount = agreed_wage + 80 * extra + travel_pay
   where id = p_booking;
  return true;
end $$;

-- ---------- Rain-off pay: work stopped by rain is paid for the time worked, at least half the wage ----------
create function public.rain_stop(p_booking uuid, p_employer uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings
     set status = 'completed', completed_at = now(), rain_off = true, overtime_hours = 0,
         paid_amount = round(agreed_wage * least(1, greatest(0.5,
                         extract(epoch from (now() - started_at)) / 3600.0 / hours)) / 10) * 10 + travel_pay
   where id = p_booking and employer_id = p_employer and status = 'started';
  return found;
end $$;

-- ---------- Materials the worker bought: the employer approves, they are repaid with the wage ----------
create table public.materials (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  item text not null check (char_length(item) between 1 and 60),
  amount int not null check (amount between 1 and 20000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
alter table public.materials enable row level security;
create policy "read materials" on public.materials for select to anon, authenticated using (true);
create policy "add material" on public.materials for insert to anon, authenticated
  with check (status = 'pending' and exists (select 1 from public.bookings b where b.id = booking_id and b.status in ('started', 'completed')));
alter publication supabase_realtime add table public.materials;

create function public.decide_material(p_id bigint, p_employer uuid, p_ok boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.materials m set status = case when p_ok then 'approved' else 'rejected' end
   where m.id = p_id and m.status = 'pending'
     and exists (select 1 from public.bookings b where b.id = m.booking_id and b.employer_id = p_employer and b.status in ('started', 'completed'));
  return found;
end $$;

-- Pay: wage + overtime + travel (already in paid_amount) + tip + approved materials
drop function public.pay_booking(uuid, uuid, int);
create function public.pay_booking(p_booking uuid, p_employer uuid, p_tip int default 0) returns boolean
language plpgsql security definer set search_path = '' as $$
declare mats int;
begin
  if p_tip < 0 or p_tip > 500 then return false; end if;
  select coalesce(sum(amount), 0) into mats from public.materials where booking_id = p_booking and status = 'approved';
  perform set_config('wb.internal', 'on', true);
  update public.bookings
     set status = 'paid', paid_at = now(), tip = p_tip,
         paid_amount = coalesce(paid_amount, agreed_wage + travel_pay) + p_tip + mats
   where id = p_booking and employer_id = p_employer and status = 'completed';
  if not found then return false; end if;
  update public.employers set jobs = jobs + 1 where id = p_employer;
  return true;
end $$;

create or replace function public.confirm_payment(p_booking uuid, p_worker uuid, p_received boolean) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; was_disputed boolean;
begin
  select disputed into was_disputed from public.bookings
   where id = p_booking and worker_id = p_worker and status = 'paid' and worker_confirmed_at is null;
  if was_disputed is null then return null; end if;
  perform set_config('wb.internal', 'on', true);
  if p_received then
    update public.bookings
       set worker_confirmed_at = now(), disputed = false,
           receipt_no = 'WB-' || upper(substr(replace(id::text, '-', ''), 1, 8))
     where id = p_booking returning * into b;
    update public.employers
       set paid_on_time = paid_on_time + 1,
           disputes = greatest(0, disputes - case when was_disputed then 1 else 0 end)
     where id = b.employer_id;
  elsif not was_disputed then
    update public.bookings set disputed = true where id = p_booking returning * into b;
    update public.employers set disputes = disputes + 1 where id = b.employer_id;
  else
    select * into b from public.bookings where id = p_booking;
  end if;
  return b;
end $$;

-- ---------- QR proof of pay: works with no internet at the site ----------
-- The employer's phone shows a QR with the amount and a code made from the job's secret OTP.
-- The worker's phone scans it and, when back online, this marks the job paid AND confirmed.
create function public.confirm_by_qr(p_booking uuid, p_worker uuid, p_amount int, p_code text) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings
   where id = p_booking and worker_id = p_worker and status in ('completed', 'paid') and worker_confirmed_at is null;
  if b.id is null then return null; end if;
  if p_code is distinct from left(encode(sha256(convert_to(b.otp || ':' || p_amount || ':' || b.id::text, 'UTF8')), 'hex'), 10) then
    return null;
  end if;
  if p_amount < coalesce(b.paid_amount, b.agreed_wage + b.travel_pay) then return null; end if;
  perform set_config('wb.internal', 'on', true);
  if b.status = 'completed' then
    update public.employers set jobs = jobs + 1 where id = b.employer_id;
  end if;
  update public.bookings
     set status = 'paid', paid_at = coalesce(paid_at, now()), paid_amount = p_amount,
         tip = greatest(tip, p_amount - coalesce(paid_amount, agreed_wage + travel_pay)),
         worker_confirmed_at = now(), disputed = false,
         receipt_no = 'WB-' || upper(substr(replace(id::text, '-', ''), 1, 8))
   where id = p_booking returning * into b;
  update public.employers set paid_on_time = paid_on_time + 1 where id = b.employer_id;
  return b;
end $$;

-- ---------- Streaks: jobs in a row rated 4+ by employers; "can't come" resets it ----------
create or replace function public.review_booking(p_booking uuid, p_by text, p_stars int, p_tags text[]) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  ok_worker text[] := array['onTime','skilled','hardWorking','polite','cleanWork'];
  ok_employer text[] := array['paidOnTime','gaveWater','gaveShade','respectful','safeSite'];
begin
  if p_stars < 1 or p_stars > 5 then return false; end if;
  p_tags := coalesce(p_tags, '{}');
  perform set_config('wb.internal', 'on', true);
  if p_by = 'worker' then
    if not p_tags <@ ok_employer then return false; end if;
    update public.bookings set rating_by_worker = p_stars, employer_tags = p_tags
     where id = p_booking and status in ('completed','paid') and rating_by_worker is null returning * into b;
    if b.id is null then return false; end if;
    update public.employers set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1 where id = b.employer_id;
  elsif p_by = 'employer' then
    if not p_tags <@ ok_worker then return false; end if;
    update public.bookings set rating_by_employer = p_stars, worker_tags = p_tags
     where id = p_booking and status in ('completed','paid') and rating_by_employer is null returning * into b;
    if b.id is null then return false; end if;
    update public.workers
       set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1, jobs_done = jobs_done + 1,
           clean_streak = case when p_stars >= 4 then clean_streak + 1 else 0 end
     where id = b.worker_id;
  else
    return false;
  end if;
  return true;
end $$;

create or replace function public.worker_cancel(p_booking uuid, p_worker uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings
     set status = 'searching', worker_id = null, accepted_at = null, preferred_worker_id = null,
         travel_pay = 0, cancel_reason = 'worker_cancelled',
         created_at = case when scheduled_for is null then now() else created_at end
   where id = p_booking and worker_id = p_worker and status = 'assigned';
  if not found then return false; end if;
  perform set_config('wb.internal', 'on', true);
  update public.workers set clean_streak = 0 where id = p_worker;
  return true;
end $$;

-- ---------- Favourite workers ----------
create table public.favorites (
  employer_id uuid not null references public.employers(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employer_id, worker_id)
);
alter table public.favorites enable row level security;
create policy "read favorites" on public.favorites for select to anon, authenticated using (true);
create policy "add favorite" on public.favorites for insert to anon, authenticated with check (true);
create policy "remove favorite" on public.favorites for delete to anon, authenticated using (true);

-- ---------- Repeat jobs (every week, same day and time) ----------
create table public.repeat_jobs (
  id bigint generated always as identity primary key,
  employer_id uuid not null references public.employers(id) on delete cascade,
  template jsonb not null,
  weekday int not null check (weekday between 0 and 6),
  at_time text not null check (at_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.repeat_jobs enable row level security;
create policy "read repeat jobs" on public.repeat_jobs for select to anon, authenticated using (true);
create policy "add repeat job" on public.repeat_jobs for insert to anon, authenticated with check (true);
create policy "change repeat job" on public.repeat_jobs for update to anon, authenticated using (true) with check (true);

-- ---------- Contractor (mestri) crew book: members, daily attendance, weekly payroll ----------
create table public.crew_members (
  id bigint generated always as identity primary key,
  leader_id uuid not null references public.workers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  phone text check (phone is null or phone ~ '^[6-9][0-9]{9}$'),
  daily_wage int not null check (daily_wage between 100 and 5000),
  created_at timestamptz not null default now()
);
create table public.crew_attendance (
  member_id bigint not null references public.crew_members(id) on delete cascade,
  day date not null,
  present boolean not null default true,
  paid boolean not null default false,
  primary key (member_id, day)
);
alter table public.crew_members enable row level security;
alter table public.crew_attendance enable row level security;
create policy "read crew" on public.crew_members for select to anon, authenticated using (true);
create policy "add crew" on public.crew_members for insert to anon, authenticated with check (true);
create policy "remove crew" on public.crew_members for delete to anon, authenticated using (true);
create policy "read attendance" on public.crew_attendance for select to anon, authenticated using (true);
create policy "mark attendance" on public.crew_attendance for insert to anon, authenticated with check (true);
create policy "change attendance" on public.crew_attendance for update to anon, authenticated using (true) with check (true);
create policy "remove attendance" on public.crew_attendance for delete to anon, authenticated using (true);

revoke all on function public.pay_showup(uuid, uuid), public.start_at_site(uuid, uuid, text, double precision, double precision),
  public.rain_stop(uuid, uuid), public.decide_material(bigint, uuid, boolean), public.pay_booking(uuid, uuid, int),
  public.confirm_by_qr(uuid, uuid, int, text) from public;
grant execute on function public.pay_showup(uuid, uuid), public.start_at_site(uuid, uuid, text, double precision, double precision),
  public.rain_stop(uuid, uuid), public.decide_material(bigint, uuid, boolean), public.pay_booking(uuid, uuid, int),
  public.confirm_by_qr(uuid, uuid, int, text) to anon, authenticated;
