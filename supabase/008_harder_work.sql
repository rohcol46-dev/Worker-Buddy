-- 008: "Work is harder than described"
-- The employer picks light / medium / heavy and risky when posting. If the work turns out
-- harder, the worker says so; the difference in pay is worked out with the same rules as
-- the fair-wage engine (medium +₹50, heavy +₹100, risky +₹100). The employer accepts
-- (it is added to the wage) or refuses (it shows on their profile for every worker to see).
-- Payment waits until the employer answers.

alter table public.bookings
  add column effort_load text check (effort_load in ('light', 'medium', 'heavy')),
  add column effort_risky boolean,
  add column effort_extra int not null default 0,
  add column effort_status text check (effort_status in ('pending', 'accepted', 'refused')),
  add column effort_at timestamptz;

alter table public.employers add column effort_refused int not null default 0;

-- Re-check the posting rule: claims start empty
drop policy "create booking" on public.bookings;
create policy "create booking" on public.bookings for insert to anon, authenticated
  with check (status = 'searching' and worker_id is null and accepted_at is null
              and wage_min <= agreed_wage and agreed_wage <= wage_max
              and tip = 0 and worker_tags = '{}' and employer_tags = '{}'
              and showup_pay = 0 and showup_paid_at is null and travel_pay = 0 and rain_off = false
              and effort_status is null and effort_extra = 0
              and (extract(hour from (coalesce(scheduled_for, now()) at time zone 'Asia/Kolkata')) between 6 and 19
                   or exists (select 1 from public.employers e where e.id = employer_id and e.gstin is not null)));

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
  end if;
  return new;
end $$;

create function public.load_extra(p_load text) returns int
language sql immutable set search_path = '' as $$
  select case p_load when 'medium' then 50 when 'heavy' then 100 else 0 end
$$;

-- Worker: one claim per job, while working or before being paid. Returns the extra in ₹ (0 = nothing to claim).
create function public.claim_effort(p_booking uuid, p_worker uuid, p_load text, p_risky boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; extra int;
begin
  select * into b from public.bookings
   where id = p_booking and worker_id = p_worker and status in ('started', 'completed') and effort_status is null;
  if b.id is null or p_load not in ('light', 'medium', 'heavy') then return null; end if;
  extra := greatest(0, public.load_extra(p_load) - public.load_extra(b.load))
         + case when p_risky and not b.risky then 100 else 0 end;
  if extra = 0 then return 0; end if;
  update public.bookings
     set effort_load = p_load, effort_risky = p_risky, effort_extra = extra,
         effort_status = 'pending', effort_at = now()
   where id = p_booking;
  return extra;
end $$;

-- Employer: accept (added to the wage and to the amount due) or refuse (counted on their profile)
create function public.decide_effort(p_booking uuid, p_employer uuid, p_ok boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform set_config('wb.internal', 'on', true);
  update public.bookings
     set effort_status = case when p_ok then 'accepted' else 'refused' end,
         agreed_wage = agreed_wage + case when p_ok then effort_extra else 0 end,
         paid_amount = case when p_ok and paid_amount is not null then paid_amount + effort_extra else paid_amount end
   where id = p_booking and employer_id = p_employer and effort_status = 'pending'
     and status in ('started', 'completed')
  returning * into b;
  if b.id is null then return false; end if;
  if not p_ok then
    update public.employers set effort_refused = effort_refused + 1 where id = p_employer;
  end if;
  return true;
end $$;

-- No payment (button or QR) while a claim is waiting for an answer
create function public.effort_before_pay() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'paid' and old.status <> 'paid' and new.effort_status = 'pending' then
    raise exception 'effort_pending';
  end if;
  return new;
end $$;
create trigger bookings_effort_before_pay before update on public.bookings
  for each row execute function public.effort_before_pay();
