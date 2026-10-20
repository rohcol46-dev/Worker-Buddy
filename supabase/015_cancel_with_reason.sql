-- 015: one way to cancel, for both sides and every stage, always with a reason (like Rapido).
-- The other side sees who cancelled and why.
--   Worker, before starting  -> the job goes back to other workers (their clean streak resets)
--   Worker, after starting   -> the job closes with no payment (no score change)
--   Employer, while searching -> cancelled
--   Employer, worker on the way -> cancelled, ₹100 show-up pay owed (not for jobs booked for later)
--   Employer, after starting -> cancelled unpaid: counts as a job not paid on their Fair Pay Score
alter table public.bookings add column if not exists cancel_note text check (char_length(cancel_note) <= 120);
alter table public.bookings add column if not exists cancelled_by text check (cancelled_by in ('worker', 'employer'));

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
           showup_pay = case when b.status = 'assigned' and b.scheduled_for is null then 100 else 0 end
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
revoke all on function public.cancel_job(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.cancel_job(uuid, uuid, uuid, text) to authenticated;

-- 014's close_unpaid is replaced by cancel_job
drop function if exists public.close_unpaid(uuid, uuid, uuid);
