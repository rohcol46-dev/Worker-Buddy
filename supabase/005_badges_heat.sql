-- Skill badges (ITI certificate) and heat-incident reports, to match the pitch deck

-- Workers can add their ITI / skill certificate number. It shows as a badge
-- marked "to be verified" until an NGO or ITI partner checks it.
alter table public.workers add column iti_cert text check (iti_cert is null or char_length(iti_cert) between 4 and 30);

-- Heat incidents: the deck's "Fewer heat injuries" metric is tracked from these
create table public.heat_reports (
  id bigint generated always as identity primary key,
  worker_id uuid not null references public.workers(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  feels_like int,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);
alter table public.heat_reports enable row level security;
create policy "read heat reports" on public.heat_reports for select to anon, authenticated using (true);
create policy "report heat" on public.heat_reports for insert to anon, authenticated with check (true);
