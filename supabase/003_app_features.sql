-- Features borrowed from Rapido, Urban Company and job apps:
--   schedule for later, choose / rebook a worker, tip, review tags,
--   worker can't come -> find another worker, cancel with reason

alter table public.workers add column experience_years int not null default 0 check (experience_years between 0 and 60);

alter table public.bookings
  add column scheduled_for timestamptz,                               -- null = now
  add column preferred_worker_id uuid references public.workers(id),  -- request one worker by name
  add column tip int not null default 0 check (tip between 0 and 500),
  add column worker_tags text[] not null default '{}',                -- employer's review of the worker
  add column employer_tags text[] not null default '{}',              -- worker's review of the employer / site
  add column cancel_reason text;

drop policy "create booking" on public.bookings;
create policy "create booking" on public.bookings for insert to anon, authenticated
  with check (status = 'searching' and worker_id is null and accepted_at is null
              and wage_min <= agreed_wage and agreed_wage <= wage_max
              and tip = 0 and worker_tags = '{}' and employer_tags = '{}');

-- Accept: "now" jobs need the worker online; jobs for later can be taken any time.
-- A job sent to one worker by name can only be taken by that worker.
create or replace function public.accept_booking(p_booking uuid, p_worker uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  update public.bookings
     set status = 'assigned', worker_id = p_worker, accepted_at = now()
   where id = p_booking and status = 'searching'
     and (preferred_worker_id is null or preferred_worker_id = p_worker)
     and exists (select 1 from public.workers w
                  where w.id = p_worker and w.skill = public.bookings.type and not w.is_sample
                    and (w.online or public.bookings.scheduled_for is not null))
  returning * into b;
  return b;
end $$;

-- Worker can't come (like a Rapido captain cancelling): the job goes back to
-- searching so another worker gets it. The 2-minute search restarts.
create function public.worker_cancel(p_booking uuid, p_worker uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings
     set status = 'searching', worker_id = null, accepted_at = null, preferred_worker_id = null,
         cancel_reason = 'worker_cancelled',
         created_at = case when scheduled_for is null then now() else created_at end
   where id = p_booking and worker_id = p_worker and status = 'assigned';
  return found;
end $$;

-- Employer can cancel before the work starts, with a reason
create or replace function public.cancel_booking(p_booking uuid, p_employer uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings
     set status = case when p_reason = 'expired' then 'expired' else 'cancelled' end,
         cancel_reason = left(p_reason, 40)
   where id = p_booking and employer_id = p_employer and status in ('searching', 'assigned');
  return found;
end $$;

-- Pay with an optional tip. The tip goes on top of wage + overtime and on the pay slip.
drop function public.pay_booking(uuid, uuid);
create function public.pay_booking(p_booking uuid, p_employer uuid, p_tip int default 0) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_tip < 0 or p_tip > 500 then return false; end if;
  update public.bookings
     set status = 'paid', paid_at = now(), tip = p_tip,
         paid_amount = coalesce(paid_amount, agreed_wage) + p_tip
   where id = p_booking and employer_id = p_employer and status = 'completed';
  if not found then return false; end if;
  update public.employers set jobs = jobs + 1 where id = p_employer;
  return true;
end $$;

-- Stars plus quick review tags. Workers review the work site too
-- (water given, shade, safe site), which shows on the employer's job requests.
create function public.review_booking(p_booking uuid, p_by text, p_stars int, p_tags text[]) returns boolean
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
    update public.workers set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1, jobs_done = jobs_done + 1 where id = b.worker_id;
  else
    return false;
  end if;
  return true;
end $$;

revoke all on function public.worker_cancel(uuid, uuid), public.pay_booking(uuid, uuid, int),
  public.review_booking(uuid, text, int, text[]) from public;
grant execute on function public.worker_cancel(uuid, uuid), public.pay_booking(uuid, uuid, int),
  public.review_booking(uuid, text, int, text[]) to anon, authenticated;

-- Give the sample workers some experience so their profiles look real
update public.workers set experience_years = 3 + (rating_count % 7) where is_sample;
