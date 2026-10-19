-- 011: shared cache of nearby places (rest points, ration shops, stays, creches).
-- One row per kind per ~1 km map cell. The first phone to look up an area saves the
-- answer from the free Overpass server; everyone else in that area reads it from here (fast).
create table public.places_cache (
  cell text primary key check (cell ~ '^[a-z]+:-?[0-9]+\.[0-9]{2},-?[0-9]+\.[0-9]{2}$'),
  list jsonb not null check (jsonb_typeof(list) = 'array' and jsonb_array_length(list) <= 100),
  updated_at timestamptz not null default now()
);
alter table public.places_cache add constraint places_cache_size check (pg_column_size(list) < 60000);
alter table public.places_cache enable row level security;
create policy "read places" on public.places_cache for select to anon, authenticated using (true);
create policy "save places" on public.places_cache for insert to anon, authenticated with check (true);
create policy "refresh places" on public.places_cache for update to anon, authenticated using (true) with check (true);

-- The server sets the time, not the phone
create function public.places_cache_time() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger places_cache_time before insert or update on public.places_cache
  for each row execute function public.places_cache_time();
