-- Materials shown on the pay slip, and the QR tip worked out without counting materials

alter table public.bookings add column materials_amount int not null default 0;

drop function public.pay_booking(uuid, uuid, int);
create function public.pay_booking(p_booking uuid, p_employer uuid, p_tip int default 0) returns boolean
language plpgsql security definer set search_path = '' as $$
declare mats int;
begin
  if p_tip < 0 or p_tip > 500 then return false; end if;
  select coalesce(sum(amount), 0) into mats from public.materials where booking_id = p_booking and status = 'approved';
  perform set_config('wb.internal', 'on', true);
  update public.bookings
     set status = 'paid', paid_at = now(), tip = p_tip, materials_amount = mats,
         paid_amount = coalesce(paid_amount, agreed_wage + travel_pay) + p_tip + mats
   where id = p_booking and employer_id = p_employer and status = 'completed';
  if not found then return false; end if;
  update public.employers set jobs = jobs + 1 where id = p_employer;
  return true;
end $$;

create or replace function public.confirm_by_qr(p_booking uuid, p_worker uuid, p_amount int, p_code text) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; mats int; base int;
begin
  select * into b from public.bookings
   where id = p_booking and worker_id = p_worker and status in ('completed', 'paid') and worker_confirmed_at is null;
  if b.id is null then return null; end if;
  if p_code is distinct from left(encode(sha256(convert_to(b.otp || ':' || p_amount || ':' || b.id::text, 'UTF8')), 'hex'), 10) then
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

revoke all on function public.pay_booking(uuid, uuid, int) from public;
grant execute on function public.pay_booking(uuid, uuid, int) to anon, authenticated;
