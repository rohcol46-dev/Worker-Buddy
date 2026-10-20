-- 013: no distance limit. Any worker can take a job anywhere and start it from anywhere.
-- The OTP (only the employer has it) is the proof that the worker reached the site.
-- Where the worker started is still saved (start_lat / start_lng) for the evidence page.
create or replace function public.start_at_site(p_booking uuid, p_worker uuid, p_otp text,
                                                p_lat double precision, p_lng double precision) returns text
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; o public.booking_otps;
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
  update public.bookings set status = 'started', started_at = now(), start_lat = p_lat, start_lng = p_lng
   where id = p_booking;
  return 'ok';
end $$;
