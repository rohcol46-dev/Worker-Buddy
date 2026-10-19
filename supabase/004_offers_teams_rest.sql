-- More ideas from other apps:
--   counter-offers (inDrive), team booking (Porter "add helpers"),
--   rest points hosted by shops and employers (Zomato rest points)

-- ---------- Team booking: one booking per worker, sharing a group ----------
alter table public.bookings
  add column group_id uuid,
  add column group_size int not null default 1 check (group_size between 1 and 5);
create index bookings_group_idx on public.bookings (group_id);

-- ---------- Counter-offers: a worker asks for more, within the fair range ----------
create table public.offers (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  amount int not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (booking_id, worker_id)
);
alter table public.offers enable row level security;
create policy "read offers" on public.offers for select to anon, authenticated using (true);
alter publication supabase_realtime add table public.offers;

-- Worker makes (or changes) an offer. Only above the employer's price and
-- never above the top of the fair-wage range, so bargaining stays fair both ways.
create function public.make_offer(p_booking uuid, p_worker uuid, p_amount int) returns public.offers
language plpgsql security definer set search_path = '' as $$
declare o public.offers;
begin
  if not exists (
    select 1 from public.bookings b join public.workers w on w.id = p_worker
     where b.id = p_booking and b.status = 'searching' and b.group_size = 1
       and w.skill = b.type and not w.is_sample
       and (b.preferred_worker_id is null or b.preferred_worker_id = p_worker)
       and p_amount > b.agreed_wage and p_amount <= b.wage_max
  ) then return null; end if;
  insert into public.offers (booking_id, worker_id, amount) values (p_booking, p_worker, p_amount)
  on conflict (booking_id, worker_id) do update set amount = excluded.amount, status = 'open', created_at = now()
  returning * into o;
  return o;
end $$;

-- Employer accepts an offer: that worker gets the job at the offered wage
create function public.accept_offer(p_booking uuid, p_employer uuid, p_offer bigint) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare o public.offers; b public.bookings;
begin
  select * into o from public.offers where id = p_offer and booking_id = p_booking and status = 'open';
  if o.id is null then return null; end if;
  -- the worker must not be busy with another job right now
  if exists (select 1 from public.bookings x where x.worker_id = o.worker_id
              and x.status in ('assigned', 'started', 'completed') and x.scheduled_for is null) then
    update public.offers set status = 'rejected' where id = o.id;
    return null;
  end if;
  update public.bookings
     set status = 'assigned', worker_id = o.worker_id, agreed_wage = o.amount, accepted_at = now()
   where id = p_booking and employer_id = p_employer and status = 'searching'
  returning * into b;
  if b.id is null then return null; end if;
  update public.offers set status = case when id = o.id then 'accepted' else 'rejected' end where booking_id = p_booking;
  return b;
end $$;

-- ---------- Rest points: shops and employers who give workers water, shade, a toilet or charging ----------
create table public.rest_points (
  id bigint generated always as identity primary key,
  employer_id uuid not null unique references public.employers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  water boolean not null default false,
  shade boolean not null default false,
  toilet boolean not null default false,
  charging boolean not null default false,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);
alter table public.rest_points enable row level security;
create policy "read rest points" on public.rest_points for select to anon, authenticated using (true);
create policy "add rest point" on public.rest_points for insert to anon, authenticated with check (water or shade or toilet or charging);
create policy "change rest point" on public.rest_points for update to anon, authenticated using (true) with check (water or shade or toilet or charging);
create policy "remove rest point" on public.rest_points for delete to anon, authenticated using (true);

revoke all on function public.make_offer(uuid, uuid, int), public.accept_offer(uuid, uuid, bigint) from public;
grant execute on function public.make_offer(uuid, uuid, int), public.accept_offer(uuid, uuid, bigint) to anon, authenticated;
