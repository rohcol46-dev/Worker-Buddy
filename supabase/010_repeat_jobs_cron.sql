-- 010: repeat jobs are created by the server every 10 minutes (pg_cron),
-- so they appear on time even if the employer never opens the app.
-- Same rule as the app: the next weekday/time (India time) at least 1 hour ahead, one booking per worker.
create extension if not exists pg_cron;

create or replace function public.next_repeat_at(p_weekday int, p_at_time text) returns timestamptz
language sql stable set search_path = '' as $$
  select case when t < now() + interval '60 minutes' then t + interval '7 days' else t end
  from (
    select ((date_trunc('day', now() at time zone 'Asia/Kolkata')
             + ((p_weekday - extract(dow from now() at time zone 'Asia/Kolkata')::int + 7) % 7) * interval '1 day'
             + p_at_time::time) at time zone 'Asia/Kolkata') as t
  ) x
$$;

create or replace function public.create_due_repeats() returns int
language plpgsql security definer set search_path = '' as $$
declare r public.repeat_jobs; t jsonb; due timestamptz; size int; grp uuid; made int := 0; has_gst boolean;
begin
  for r in select * from public.repeat_jobs where active loop
    due := public.next_repeat_at(r.weekday, r.at_time);
    continue when exists (select 1 from public.bookings where repeat_id = r.id and scheduled_for = due);
    -- Night jobs still need a GST-verified employer
    select gstin is not null into has_gst from public.employers where id = r.employer_id;
    continue when extract(hour from due at time zone 'Asia/Kolkata') not between 6 and 19 and not coalesce(has_gst, false);
    t := r.template;
    size := greatest(1, least(10, coalesce((t->>'group_size')::int, 1)));
    grp := case when size > 1 then gen_random_uuid() end;
    insert into public.bookings (employer_id, type, area, lat, lng, hours, load, risky, wage_min, wage_max, agreed_wage,
                                 bring_tools, perks, scheduled_for, repeat_id, group_id, group_size, otp)
    select r.employer_id, t->>'type', t->>'area', (t->>'lat')::float8, (t->>'lng')::float8, (t->>'hours')::int,
           t->>'load', coalesce((t->>'risky')::boolean, false), (t->>'wage_min')::int, (t->>'wage_max')::int,
           (t->>'agreed_wage')::int, coalesce((t->>'bring_tools')::boolean, false),
           coalesce(array(select jsonb_array_elements_text(t->'perks')), '{}'),
           due, r.id, grp, size, (1000 + floor(random() * 9000))::int::text
    from generate_series(1, size);
    made := made + size;
  end loop;
  return made;
end $$;
revoke execute on function public.create_due_repeats() from anon, authenticated, public;

select cron.schedule('worker-buddy-repeat-jobs', '*/10 * * * *', 'select public.create_due_repeats()');
