-- 034: job alerts on a closed app (Web Push).
--
-- Until now a worker only heard about a job while the app was open on the screen. Now:
--   1. A worker taps "Turn on job alerts" once. The phone gives a push address, saved here
--      through save_push_subscription (only for the caller's own worker profile).
--   2. After an employer posts a job, the employer's app asks the job-alert server function
--      (supabase/functions/job-alert) to alert workers. That function, which runs with the
--      server key, calls job_alert_targets: it checks the job is the caller's, new and still
--      looking for a worker, marks it as alerted (once per job, once per team), and returns the
--      push addresses of online workers with that skill, in that country, within 30 km.
--   3. A worker with alerts on stays "online" for up to 12 hours with the app closed (before:
--      30 minutes), because an alert now reaches them. Going offline stops the alerts.
-- Nobody but the server function can read the push addresses.

-- ---------- 1. Push addresses ----------
create table public.push_subscriptions (
  -- only the browsers' own push services, so the server function never sends anywhere else
  endpoint text primary key check (char_length(endpoint) <= 1000 and endpoint ~
    '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)/'),
  auth_id uuid not null,
  worker_id uuid not null references public.workers(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) between 60 and 120),
  auth text not null check (char_length(auth) between 16 and 40),
  lang text not null default 'en' check (lang ~ '^[a-z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_worker_idx on public.push_subscriptions (worker_id);
alter table public.push_subscriptions enable row level security;   -- no policies: only the functions below
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, delete on public.push_subscriptions to service_role;  -- the server function drops dead addresses

-- Save this phone's push address for my worker profile (a phone has one address; it moves
-- to whichever profile saved it last). At most 5 phones per worker: the oldest goes.
create function public.save_push_subscription(p_worker uuid, p_endpoint text, p_p256dh text, p_auth text, p_lang text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_mine(p_worker, null);
  insert into public.push_subscriptions (endpoint, auth_id, worker_id, p256dh, auth, lang)
  values (p_endpoint, auth.uid(), p_worker, p_p256dh, p_auth, coalesce(nullif(p_lang, ''), 'en'))
  on conflict (endpoint) do update
    set auth_id = excluded.auth_id, worker_id = excluded.worker_id, p256dh = excluded.p256dh,
        auth = excluded.auth, lang = excluded.lang, updated_at = now();
  delete from public.push_subscriptions
   where worker_id = p_worker
     and endpoint not in (select endpoint from public.push_subscriptions
                           where worker_id = p_worker order by updated_at desc limit 5);
end $$;
revoke all on function public.save_push_subscription(uuid, text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(uuid, text, text, text, text) to authenticated;

-- Stop alerts on this phone (sign out, or the worker turns them off)
create function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and auth_id = auth.uid();
$$;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- A deleted or suspended account gets no alerts; a deleted one loses its addresses
create function public.push_forget_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.device_id like 'deleted-%' then
    delete from public.push_subscriptions where worker_id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.push_forget_deleted() from public, anon, authenticated;
create trigger workers_push_forget after update of device_id on public.workers
  for each row when (new.device_id like 'deleted-%') execute function public.push_forget_deleted();

-- ---------- 2. Who to alert about a new job ----------
create table public.job_alerts (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  group_id uuid unique,                -- a team job is alerted once, not once per worker place
  sent_at timestamptz not null default now()
);
alter table public.job_alerts enable row level security;
revoke all on public.job_alerts from public, anon, authenticated;

-- Called only by the job-alert server function, with the signed-in employer's account id.
-- Returns {"job": {...}, "targets": [{endpoint, p256dh, auth, lang}, ...]}, or null when there is
-- nothing to send (not this employer's job, no longer searching, too old, or already alerted).
create function public.job_alert_targets(p_booking uuid, p_auth uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  targets jsonb;
begin
  select bk.* into b from public.bookings bk join public.employers e on e.id = bk.employer_id
   where bk.id = p_booking and e.auth_id = p_auth;
  if not found or b.status <> 'searching' then return null; end if;
  if b.scheduled_for is null and b.created_at < now() - interval '10 minutes' then return null; end if;
  if b.scheduled_for is not null and b.scheduled_for < now() then return null; end if;

  insert into public.job_alerts (booking_id, group_id) values (b.id, b.group_id) on conflict do nothing;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang)), '[]')
    into targets
    from (select s.* from public.push_subscriptions s join public.workers w on w.id = s.worker_id
           where w.online and w.skill = b.type and w.country = b.country and not w.is_sample
             and w.device_id not like 'deleted-%' and not public.suspended(w.auth_id)
             and w.auth_id is distinct from p_auth
             and (b.preferred_worker_id is null or w.id = b.preferred_worker_id)
             and not public.blocked_pair(w.id, b.employer_id)
             -- busy on a job now: skip for jobs that start now
             and (b.scheduled_for is not null or not exists (
                   select 1 from public.bookings x where x.worker_id = w.id and x.status in ('assigned', 'started')))
             -- within 30 km when both places are known
             and (b.lat is null or b.lng is null or w.lat is null or w.lng is null
                  or 12742 * asin(sqrt(power(sin(radians(w.lat - b.lat) / 2), 2)
                       + cos(radians(b.lat)) * cos(radians(w.lat)) * power(sin(radians(w.lng - b.lng) / 2), 2))) <= 30)
           order by s.updated_at desc
           limit 300) s;

  return jsonb_build_object(
    'job', jsonb_build_object('id', b.id, 'type', b.type, 'area', b.area, 'hours', b.hours,
                              'wage_min', b.wage_min, 'wage_max', b.wage_max, 'currency', b.currency,
                              'scheduled_for', b.scheduled_for),
    'targets', targets);
end $$;
revoke all on function public.job_alert_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.job_alert_targets(uuid, uuid) to service_role;

-- ---------- 3. Workers with alerts on stay online with the app closed ----------
create or replace function public.offline_quiet_workers() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  -- A worker on a job is left alone: the phone is often locked while they work.
  -- A worker with job alerts on is reached by an alert, so they stay online for 12 hours.
  update public.workers w set online = false
   where online
     and last_seen_at < now() - case when exists (select 1 from public.push_subscriptions s where s.worker_id = w.id)
                                     then interval '12 hours' else interval '30 minutes' end
     and not exists (select 1 from public.bookings b
                      where b.worker_id = w.id and b.status in ('assigned', 'started'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.offline_quiet_workers() from public, anon, authenticated;
