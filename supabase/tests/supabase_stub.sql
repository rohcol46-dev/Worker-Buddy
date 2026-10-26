-- Just enough of Supabase for the migrations to run on plain Postgres (used only by the tests)
-- Roles belong to the whole server, so they may already be there from an earlier run
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to current_user;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  phone text unique,
  phone_confirmed_at timestamptz,
  email text,
  email_confirmed_at timestamptz,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

create publication supabase_realtime;

create schema cron;
create function cron.schedule(p_name text, p_when text, p_sql text) returns bigint language sql as $$ select 1::bigint $$;
create function cron.unschedule(p_name text) returns boolean language sql as $$ select true $$;
