-- 014: close a job that started or finished without a payment.
-- Worker closes it (for example a test job, or they let it go): no score changes.
-- Employer closes it: it counts as a job not paid, so their Fair Pay Score goes down,
-- and the worker sees "closed by the employer without pay" (proof for a complaint).
create or replace function public.close_unpaid(p_booking uuid, p_worker uuid, p_employer uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  if p_worker is not null then
    perform public.assert_mine(p_worker, null);
    update public.bookings set status = 'cancelled', cancel_reason = 'closed_by_worker'
     where id = p_booking and worker_id = p_worker and status in ('started', 'completed')
     returning * into b;
    return b.id is not null;
  end if;
  perform public.assert_mine(null, p_employer);
  update public.bookings set status = 'cancelled', cancel_reason = 'employer_unpaid'
   where id = p_booking and employer_id = p_employer and status in ('started', 'completed')
   returning * into b;
  if b.id is null then return false; end if;
  perform set_config('wb.internal', 'on', true);
  update public.employers set jobs = jobs + 1 where id = p_employer; -- a job, but not paid on time
  return true;
end $$;
revoke all on function public.close_unpaid(uuid, uuid, uuid) from public, anon;
grant execute on function public.close_unpaid(uuid, uuid, uuid) to authenticated;
