-- 017: nobody can write straight into the shared places cache any more.
-- Every phone has an account (anonymous at first), so the 012 rule "signed in can write" let
-- anyone plant fake water points or shelters on the rest map. Now the only way in is
-- save_places, which:
--   - accepts only the four kinds the app looks up (rest, ration, stay, creche)
--   - keeps only name, position (and kind for rest points): no other fields get through
--   - rejects any place more than about 5 km from the area being saved (the app searches 4 km)
--   - never replaces an answer saved in the last 7 days, so a fresh real answer can't be overwritten
-- It can't prove the list came from OpenStreetMap, but it limits what a fake one can do.

drop policy "save places" on public.places_cache;
drop policy "refresh places" on public.places_cache;
revoke insert, update, delete on public.places_cache from anon, authenticated;

create function public.save_places(p_cell text, p_list jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  m text[] := regexp_match(p_cell, '^(rest|ration|stay|creche):(-?[0-9]{1,3}\.[0-9]{2}),(-?[0-9]{1,3}\.[0-9]{2})$');
  clat double precision;
  clng double precision;
  item jsonb;
  plat double precision;
  plng double precision;
  pname text;
  clean jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or m is null or jsonb_typeof(p_list) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_list) not between 1 and 100 then
    return false;
  end if;
  -- A fresh answer stays: nobody can replace an area someone looked up this week
  if exists (select 1 from public.places_cache where cell = p_cell and updated_at > now() - interval '7 days') then
    return false;
  end if;
  clat := m[2]::double precision;
  clng := m[3]::double precision;
  for item in select value from jsonb_array_elements(p_list) loop
    if jsonb_typeof(item) is distinct from 'object'
       or jsonb_typeof(item->'lat') is distinct from 'number'
       or jsonb_typeof(item->'lng') is distinct from 'number'
       or jsonb_typeof(item->'name') is distinct from 'string' then
      return false;
    end if;
    plat := (item->>'lat')::double precision;
    plng := (item->>'lng')::double precision;
    pname := left(btrim(item->>'name'), 80);
    if abs(plat - clat) > 0.05 or abs(plng - clng) > 0.05 or pname = '' then
      return false;
    end if;
    if m[1] = 'rest' then
      if (item->>'kind') is null or (item->>'kind') not in ('water', 'shade', 'toilet', 'tea') then
        return false;
      end if;
      clean := clean || jsonb_build_array(jsonb_build_object('kind', item->>'kind', 'name', pname, 'lat', plat, 'lng', plng));
    else
      clean := clean || jsonb_build_array(jsonb_build_object('name', pname, 'lat', plat, 'lng', plng));
    end if;
  end loop;
  insert into public.places_cache (cell, list) values (p_cell, clean)
    on conflict (cell) do update set list = excluded.list;
  return true;
end $$;

revoke execute on function public.save_places(text, jsonb) from public, anon;
grant execute on function public.save_places(text, jsonb) to authenticated;
