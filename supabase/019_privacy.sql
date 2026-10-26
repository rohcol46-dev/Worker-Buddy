-- 019: privacy (India's Digital Personal Data Protection Act, 2023)
-- 1. Consent: which version of the privacy notice each account agreed to, and when.
-- 2. delete_my_account(): removes the profile, crew list, saved places, locations and the sign-in.
--    Jobs stay for the other person's pay slip, with the deleted person's name and number removed.
--    Not while a job is in progress or the account is on hold.
-- 3. export_my_data(): everything stored about this account, as one file.
-- 4. Old locations are wiped: job check-in points after 180 days, the last location of a worker
--    who has not been online for 90 days, heat-report locations after a year.

-- ---------- 1. Consent ----------
create table public.consents (
  auth_id uuid not null,
  version text not null check (char_length(version) between 1 and 20),
  lang text not null check (lang in ('en', 'ta', 'hi')),
  created_at timestamptz not null default now(),
  primary key (auth_id, version)
);
alter table public.consents enable row level security;
create policy "read my consents" on public.consents for select to authenticated using (auth_id = auth.uid());

create function public.give_consent(p_version text, p_lang text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  insert into public.consents (auth_id, version, lang) values (auth.uid(), p_version, p_lang)
  on conflict (auth_id, version) do nothing;
  return true;
end $$;

-- ---------- 2. Delete my account ----------
create function public.delete_my_account() returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); ws uuid[]; es uuid[];
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  -- An account on hold stays until the hold is settled, so deleting can't be used to escape it
  if public.suspended(me) then raise exception 'suspended' using errcode = '42501'; end if;
  select coalesce(array_agg(id), '{}') into ws from public.workers where auth_id = me;
  select coalesce(array_agg(id), '{}') into es from public.employers where auth_id = me;

  -- A job in progress has to be finished or cancelled first, so nobody is left unpaid
  if exists (select 1 from public.bookings
              where status in ('assigned', 'started', 'completed')
                and (worker_id = any(ws) or employer_id = any(es))) then
    raise exception 'finish_jobs_first' using errcode = '55000';
  end if;

  perform set_config('wb.internal', 'on', true);
  update public.bookings set status = 'cancelled', cancel_reason = 'account_deleted'
   where status = 'searching' and employer_id = any(es);
  update public.bookings set lat = null, lng = null, start_lat = null, start_lng = null
   where worker_id = any(ws) or employer_id = any(es);
  delete from public.repeat_jobs where employer_id = any(es);
  delete from public.rest_points where employer_id = any(es);
  delete from public.favorites where employer_id = any(es) or worker_id = any(ws);
  delete from public.crew_members where leader_id = any(ws);
  delete from public.heat_reports where worker_id = any(ws);
  delete from public.offers where worker_id = any(ws);
  update public.reports set reporter_auth = null where reporter_auth = me;
  delete from public.consents where auth_id = me;

  -- Profiles with no jobs go completely; the rest keep only what the other side's pay slip needs
  delete from public.workers w where w.id = any(ws)
     and not exists (select 1 from public.bookings b where b.worker_id = w.id or b.preferred_worker_id = w.id);
  delete from public.employers e where e.id = any(es)
     and not exists (select 1 from public.bookings b where b.employer_id = e.id);
  update public.workers
     set name = 'Deleted user', phone = '6000000000', upi_id = null, lat = null, lng = null, online = false,
         iti_cert = null, birth_year = null, home_state = null, city = null, available_days = '{}',
         tools = '{}', lessons = '{}', cover_optin = false, is_mestri = false,
         device_id = 'deleted-' || id, auth_id = null
   where id = any(ws);
  update public.employers
     set name = 'Deleted user', phone = '6000000000', gstin = null, device_id = 'deleted-' || id, auth_id = null
   where id = any(es);

  -- The sign-in itself (Google or mobile number). If this fails, everything above is undone and
  -- the person is told, rather than being told the account is gone when it isn't.
  begin
    delete from auth.users where id = me;
  exception when others then
    raise exception 'delete_failed' using errcode = '55000', detail = sqlerrm;
  end;
  return true;
end $$;

-- ---------- 3. Download my data ----------
create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); ws uuid[]; es uuid[];
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select coalesce(array_agg(id), '{}') into ws from public.workers where auth_id = me;
  select coalesce(array_agg(id), '{}') into es from public.employers where auth_id = me;
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'phone', u.phone, 'email', u.email, 'created_at', u.created_at)
                  from auth.users u where u.id = me),
    'worker_profiles', (select coalesce(jsonb_agg(to_jsonb(w) - 'device_id'), '[]') from public.workers w where w.id = any(ws)),
    'employer_profiles', (select coalesce(jsonb_agg(to_jsonb(e) - 'device_id'), '[]') from public.employers e where e.id = any(es)),
    'jobs', (select coalesce(jsonb_agg(to_jsonb(b) - 'otp' order by b.created_at), '[]') from public.bookings b
              where b.worker_id = any(ws) or b.employer_id = any(es)),
    'messages', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]') from public.messages m
                  join public.bookings b on b.id = m.booking_id where b.worker_id = any(ws) or b.employer_id = any(es)),
    'materials', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.materials m
                   join public.bookings b on b.id = m.booking_id where b.worker_id = any(ws) or b.employer_id = any(es)),
    'offers', (select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.offers o where o.worker_id = any(ws)),
    'crew', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.crew_members c where c.leader_id = any(ws)),
    'crew_attendance', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.crew_attendance a
                         join public.crew_members c on c.id = a.member_id where c.leader_id = any(ws)),
    'favorites', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from public.favorites f
                   where f.worker_id = any(ws) or f.employer_id = any(es)),
    'repeat_jobs', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.repeat_jobs r where r.employer_id = any(es)),
    'rest_points', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.rest_points r where r.employer_id = any(es)),
    'heat_reports', (select coalesce(jsonb_agg(to_jsonb(h)), '[]') from public.heat_reports h where h.worker_id = any(ws)),
    'blocks', (select coalesce(jsonb_agg(to_jsonb(bl)), '[]') from public.blocks bl
                where bl.worker_id = any(ws) or bl.employer_id = any(es)),
    'reports_i_made', (select coalesce(jsonb_agg(to_jsonb(r) - 'reporter_auth'), '[]') from public.reports r where r.reporter_auth = me),
    'consents', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.consents c where c.auth_id = me)
  );
end $$;

revoke execute on function public.delete_my_account(), public.export_my_data(), public.give_consent(text, text) from public, anon;

-- ---------- 4. Old locations are wiped every night ----------
create function public.purge_old_locations() returns int
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int;
begin
  perform set_config('wb.internal', 'on', true);
  update public.bookings set start_lat = null, start_lng = null
   where start_lat is not null and coalesce(paid_at, completed_at, created_at) < now() - interval '180 days';
  get diagnostics a = row_count;
  update public.workers set lat = null, lng = null
   where lat is not null and not online and updated_at < now() - interval '90 days';
  get diagnostics b = row_count;
  update public.heat_reports set lat = null, lng = null
   where lat is not null and created_at < now() - interval '1 year';
  get diagnostics c = row_count;
  return a + b + c;
end $$;
revoke execute on function public.purge_old_locations() from public, anon, authenticated;

select cron.schedule('worker-buddy-purge-locations', '30 21 * * *', 'select public.purge_old_locations()');
