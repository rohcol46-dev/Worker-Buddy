-- Worker Buddy: workers (captains), employers (customers), bookings (rides)
create table public.workers (
  id uuid primary key default gen_random_uuid(),
  device_id text unique not null,
  name text not null check (char_length(name) between 1 and 60),
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  skill text not null check (skill in ('coolie','helper','plumber','electrician','mason','painter')),
  lat double precision,
  lng double precision,
  online boolean not null default false,
  rating_sum int not null default 0,
  rating_count int not null default 0,
  jobs_done int not null default 0,
  is_sample boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.employers (
  id uuid primary key default gen_random_uuid(),
  device_id text unique not null,
  name text not null check (char_length(name) between 1 and 60),
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  jobs int not null default 0,
  paid_on_time int not null default 0,
  rating_sum int not null default 0,
  rating_count int not null default 0,
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  employer_id uuid not null references public.employers(id),
  type text not null check (type in ('coolie','helper','plumber','electrician','mason','painter')),
  area text not null check (char_length(area) between 1 and 80),
  lat double precision,
  lng double precision,
  hours int not null check (hours between 1 and 14),
  load text not null check (load in ('light','medium','heavy')),
  risky boolean not null default false,
  wage_min int not null,
  wage_max int not null,
  agreed_wage int not null,
  otp text not null check (otp ~ '^[0-9]{4}$'),
  status text not null default 'searching'
    check (status in ('searching','assigned','started','completed','paid','cancelled','expired')),
  worker_id uuid references public.workers(id),
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  paid_at timestamptz,
  rating_by_worker int check (rating_by_worker between 1 and 5),
  rating_by_employer int check (rating_by_employer between 1 and 5)
);

create index bookings_status_idx on public.bookings (status);
create index bookings_employer_idx on public.bookings (employer_id);
create index bookings_worker_idx on public.bookings (worker_id);
create index workers_online_idx on public.workers (online, skill);

-- Row level security: the demo has no login, so anyone may read and register,
-- but bookings change state ONLY through the functions below.
alter table public.workers enable row level security;
alter table public.employers enable row level security;
alter table public.bookings enable row level security;

create policy "read workers" on public.workers for select to anon, authenticated using (true);
create policy "register worker" on public.workers for insert to anon, authenticated with check (is_sample = false and rating_sum = 0 and rating_count = 0 and jobs_done = 0);
create policy "update worker profile" on public.workers for update to anon, authenticated using (is_sample = false) with check (is_sample = false);

create policy "read employers" on public.employers for select to anon, authenticated using (true);
create policy "register employer" on public.employers for insert to anon, authenticated with check (jobs = 0 and paid_on_time = 0 and rating_sum = 0 and rating_count = 0);

create policy "read bookings" on public.bookings for select to anon, authenticated using (true);
create policy "create booking" on public.bookings for insert to anon, authenticated
  with check (status = 'searching' and worker_id is null and accepted_at is null and wage_min <= agreed_wage and agreed_wage <= wage_max);

-- Stop rating/score fields being edited directly on profile updates
create function public.keep_worker_stats() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('wb.internal', true) is distinct from 'on' then
    new.rating_sum := old.rating_sum;
    new.rating_count := old.rating_count;
    new.jobs_done := old.jobs_done;
    new.device_id := old.device_id;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger workers_keep_stats before update on public.workers for each row execute function public.keep_worker_stats();

-- First worker to accept wins (atomic: only one update can see status = 'searching')
create function public.accept_booking(p_booking uuid, p_worker uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  update public.bookings
     set status = 'assigned', worker_id = p_worker, accepted_at = now()
   where id = p_booking and status = 'searching'
     and exists (select 1 from public.workers w where w.id = p_worker and w.online and w.skill = public.bookings.type)
  returning * into b;
  return b; -- null when someone else got it first
end $$;

create function public.start_booking(p_booking uuid, p_worker uuid, p_otp text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set status = 'started', started_at = now()
   where id = p_booking and worker_id = p_worker and status = 'assigned' and otp = p_otp;
  return found;
end $$;

create function public.complete_booking(p_booking uuid, p_worker uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set status = 'completed', completed_at = now()
   where id = p_booking and worker_id = p_worker and status = 'started';
  return found;
end $$;

create function public.pay_booking(p_booking uuid, p_employer uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set status = 'paid', paid_at = now()
   where id = p_booking and employer_id = p_employer and status = 'completed';
  if not found then return false; end if;
  update public.employers set jobs = jobs + 1, paid_on_time = paid_on_time + 1 where id = p_employer;
  return true;
end $$;

create function public.cancel_booking(p_booking uuid, p_employer uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set status = case when p_reason = 'expired' then 'expired' else 'cancelled' end
   where id = p_booking and employer_id = p_employer and status = 'searching';
  return found;
end $$;

-- by = 'worker' (worker rates employer) or 'employer' (employer rates worker); once each
create function public.rate_booking(p_booking uuid, p_by text, p_stars int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  if p_stars < 1 or p_stars > 5 then return false; end if;
  perform set_config('wb.internal', 'on', true);
  if p_by = 'worker' then
    update public.bookings set rating_by_worker = p_stars
     where id = p_booking and status in ('completed','paid') and rating_by_worker is null returning * into b;
    if b.id is null then return false; end if;
    update public.employers set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1 where id = b.employer_id;
  elsif p_by = 'employer' then
    update public.bookings set rating_by_employer = p_stars
     where id = p_booking and status in ('completed','paid') and rating_by_employer is null returning * into b;
    if b.id is null then return false; end if;
    update public.workers set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1, jobs_done = jobs_done + 1 where id = b.worker_id;
  else
    return false;
  end if;
  return true;
end $$;

revoke all on function public.accept_booking(uuid, uuid), public.start_booking(uuid, uuid, text), public.complete_booking(uuid, uuid),
  public.pay_booking(uuid, uuid), public.cancel_booking(uuid, uuid, text), public.rate_booking(uuid, text, int) from public;
grant execute on function public.accept_booking(uuid, uuid), public.start_booking(uuid, uuid, text), public.complete_booking(uuid, uuid),
  public.pay_booking(uuid, uuid), public.cancel_booking(uuid, uuid, text), public.rate_booking(uuid, text, int) to anon, authenticated;

-- Live updates to both apps
alter publication supabase_realtime add table public.bookings, public.workers;

-- Sample workers so the employer map is not empty (they cannot accept jobs)
insert into public.workers (device_id, name, phone, skill, lat, lng, online, rating_sum, rating_count, jobs_done, is_sample) values
 ('sample-1','Ravi','9000000101','coolie',13.0091,80.2150,true,47,10,10,true),
 ('sample-2','Selvi','9000000102','painter',13.0350,80.2120,true,24,5,5,true),
 ('sample-3','Arun','9000000103','electrician',13.0418,80.2341,true,36,8,8,true),
 ('sample-4','Murugan','9000000104','mason',12.9791,80.2209,true,21,5,5,true),
 ('sample-5','Fathima','9000000105','helper',13.0213,80.2231,true,49,10,10,true),
 ('sample-6','Karthik','9000000106','plumber',13.0012,80.2565,true,18,4,4,true);
