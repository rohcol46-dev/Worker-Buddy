#!/usr/bin/env bash
# Builds a fresh test database from every migration, then runs the tests.
# Needs a Postgres 15+ server and psql. DATABASE_URL points at any database on that server
# (the server's own "postgres" database is fine); the tests use their own database, wb_test.
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres supabase/tests/run.sh
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Set DATABASE_URL, for example postgres://postgres:postgres@localhost:5432/postgres}"

psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c 'drop database if exists wb_test' -c 'create database wb_test'
TEST_URL=$(psql "$DATABASE_URL" -X -At -c "select 1" >/dev/null && echo "$DATABASE_URL" | sed -E 's#/[^/?]+(\?|$)#/wb_test\1#')
PSQL=(psql "$TEST_URL" -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -f tests/supabase_stub.sql 2>&1 | grep -v 'wal_level\|HINT' || true

for f in 0*.sql; do
  echo "migration $f"
  # pg_cron is not on plain Postgres; tests/supabase_stub.sql has a stand-in cron.schedule
  sed 's/^create extension if not exists pg_cron;//' "$f" | "${PSQL[@]}" >/dev/null
done

for f in tests/*.test.sql; do
  echo "test $f"
  "${PSQL[@]}" -f "$f"
done
echo "all database tests passed"
