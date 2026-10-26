-- Rules every migration must keep. Fails the build if a new function or table breaks one.

-- 1. Every SECURITY DEFINER function pins search_path
do $$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  if bad is not null then raise exception 'SECURITY DEFINER without search_path: %', bad; end if;
end $$;

-- 2. A function that acts for a worker or employer checks that they are the caller's
do $$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname not in ('assert_mine', 'assert_party', 'my_worker', 'my_employer', 'blocked_pair')
     and (
       ((pg_get_function_identity_arguments(p.oid) ~ '\mp_(worker|employer) uuid') and p.prosrc !~ 'assert_mine\(')
       or ((pg_get_function_identity_arguments(p.oid) ~ '\mp_by text') and p.prosrc !~ 'assert_party\(')
       or (p.proname like 'admin\_%' and p.prosrc !~ 'assert_admin\(')
     );
  if bad is not null then raise exception 'Function acts for someone without an ownership check: %', bad; end if;
end $$;

-- 3. Row-level security is on for every table
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if bad is not null then raise exception 'Tables without row-level security: %', bad; end if;
end $$;

-- 4. Signed-out visitors (anon) can only read, never write
do $$
declare bad text;
begin
  select string_agg(polrelid::regclass || '.' || polname, ', ') into bad
    from pg_policy where 'anon'::regrole = any(polroles) and polcmd <> 'r';
  if bad is not null then raise exception 'anon can write through: %', bad; end if;
end $$;

-- 5. Nobody reads another person's phone number, UPI ID, device id or exact location from the tables
do $$
declare bad text;
begin
  select string_agg(table_name || '.' || column_name || ' (' || grantee || ')', ', ') into bad
    from information_schema.column_privileges
   where table_schema = 'public' and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated')
     and table_name in ('workers', 'employers') and column_name in ('phone', 'upi_id', 'device_id', 'lat', 'lng', 'birth_year');
  if bad is not null then raise exception 'Private columns are readable: %', bad; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name in ('workers_public', 'employers_public') and column_name in ('phone', 'upi_id', 'device_id')) then
    raise exception 'A public profile view shows a phone, UPI ID or device id';
  end if;
end $$;

-- 6. Server-only and admin functions can't be called by signed-out visitors
do $$
declare bad text;
begin
  select string_agg(f, ', ') into bad from unnest(array[
    'public.admin_reports(text)', 'public.admin_suspend(uuid,integer,text)', 'public.admin_unsuspend(uuid)',
    'public.admin_close_report(bigint,text)', 'public.delete_my_account()', 'public.export_my_data()',
    'public.purge_old_locations()']) f
   where has_function_privilege('anon', f, 'execute');
  if bad is not null then raise exception 'anon can run: %', bad; end if;
  if has_function_privilege('authenticated', 'public.purge_old_locations()', 'execute') then
    raise exception 'signed-in users can run purge_old_locations';
  end if;
end $$;

select 'security rules: ok' as result;
