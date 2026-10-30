-- 033: close a write hole found in the security audit (October 2026).
--
-- workers_public and employers_public (016) are plain views owned by postgres, so they skip
-- row-level security. Supabase grants every table and view to anon and authenticated by
-- default, and 016 only added SELECT, so the default INSERT, UPDATE and DELETE stayed on.
-- Anyone, even signed out, could rename, edit or delete any worker or employer through
-- /rest/v1/workers_public and /rest/v1/employers_public. The views are for reading only.
--
-- Also, as a second wall: signed-out visitors (anon) lose write rights on every table that has
-- no anon write policy (row-level security already blocks them there), and the helper
-- functions that only the database itself calls can no longer be run by signed-out visitors.

-- ---------- 1. The public profile views are read-only ----------
revoke insert, update, delete, truncate, references, trigger
  on public.workers_public, public.employers_public from public, anon, authenticated;
grant select on public.workers_public, public.employers_public to anon, authenticated;

-- ---------- 2. Signed-out visitors can't write to tables ----------
do $$
declare t record;
begin
  for t in
    select c.oid::regclass as tbl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
       -- leave alone a table that deliberately lets signed-out visitors add rows
       and not exists (select 1 from pg_policy p
                        where p.polrelid = c.oid and p.polcmd <> 'r'
                          and ('anon'::regrole = any (p.polroles) or 0::oid = any (p.polroles)))
  loop
    execute format('revoke insert, update, delete, truncate on %s from anon', t.tbl);
  end loop;
end $$;

-- ---------- 3. Internal helpers aren't callable by signed-out visitors ----------
-- Signed-in users keep them: row-level security policies call them as that user.
-- suspended() stays open: workers_public calls it, and a view's functions run as the reader.
do $$
declare f text;
begin
  foreach f in array array[
    'public.assert_admin()', 'public.assert_can_act()', 'public.assert_mine(uuid,uuid)',
    'public.assert_party(uuid,text)', 'public.blocked_pair(uuid,uuid)', 'public.employer_has_gst(uuid)',
    'public.i_work_as(text)', 'public.is_admin()', 'public.job_party(uuid)', 'public.job_visible(uuid)',
    'public.legacy_claims_open()', 'public.my_employer(uuid)', 'public.my_worker(uuid)',
    'public.setting_on(text)', 'public.verified_account()']
  loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

-- Trigger functions run when the table changes; nobody needs to call them by hand
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.fn);
  end loop;
end $$;
