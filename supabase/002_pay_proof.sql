-- Proof of pay, overtime and translated quick messages

alter table public.employers add column disputes int not null default 0;

alter table public.bookings
  add column overtime_hours int not null default 0,
  add column paid_amount int,
  add column worker_confirmed_at timestamptz,
  add column disputed boolean not null default false,
  add column receipt_no text;

-- Quick messages: only a phrase key is stored; each phone shows it in its own language
create table public.messages (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender text not null check (sender in ('worker', 'employer')),
  phrase text not null check (phrase ~ '^[a-zA-Z]{2,30}$'),
  created_at timestamptz not null default now()
);
create index messages_booking_idx on public.messages (booking_id, created_at);
alter table public.messages enable row level security;
create policy "read messages" on public.messages for select to anon, authenticated using (true);
create policy "send message on live booking" on public.messages for insert to anon, authenticated
  with check (exists (select 1 from public.bookings b where b.id = booking_id and b.status in ('assigned', 'started', 'completed', 'paid')));
alter publication supabase_realtime add table public.messages;

-- Completing work works out overtime: every started hour past the agreed hours
-- (after a 15-minute grace) adds Rs 80, the same rule as the wage estimate.
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
         paid_amount = agreed_wage + 80 * extra
   where id = p_booking;
  return true;
end $$;

-- Employer says "paid". This is only half the proof: the worker must confirm.
create or replace function public.pay_booking(p_booking uuid, p_employer uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings
     set status = 'paid', paid_at = now(), paid_amount = coalesce(paid_amount, agreed_wage)
   where id = p_booking and employer_id = p_employer and status = 'completed';
  if not found then return false; end if;
  update public.employers set jobs = jobs + 1 where id = p_employer;
  return true;
end $$;

-- Worker confirms "I received it" (creates the pay slip) or "Not received" (dispute).
-- Only confirmed payments count as paid on time in the Fair Pay Score.
create function public.confirm_payment(p_booking uuid, p_worker uuid, p_received boolean) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; was_disputed boolean;
begin
  select disputed into was_disputed from public.bookings
   where id = p_booking and worker_id = p_worker and status = 'paid' and worker_confirmed_at is null;
  if was_disputed is null then return null; end if;

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

revoke all on function public.confirm_payment(uuid, uuid, boolean) from public;
grant execute on function public.confirm_payment(uuid, uuid, boolean) to anon, authenticated;
