#!/usr/bin/env bash
# Records which scripts/*.sql have been applied to a database, so a deploy
# can tell what is still pending instead of relying on memory.
#
#   scripts/migrate.sh status                  every scripts/migration_*.sql: applied or pending
#   scripts/migrate.sh apply  <file.sql>        run the file once, then record it
#   scripts/migrate.sh mark   <file.sql>        record a file applied earlier by hand (no run)
#
# Connection: the standard libpq variables (PGHOST, PGPORT, PGUSER, PGDATABASE,
# PGPASSWORD) or DATABASE_URL. The script never reads .env on purpose: the
# backend's .env points at production, and a migration must name its target.
#
# PSQL overrides the client, e.g. a database in a container:
#   PSQL="docker exec -i timeso-local-pg psql -U postgres -d timeso_local" scripts/migrate.sh status
#
# The record lives in schema_migrations (created on first use). A file is
# keyed by its name; its sha256 is stored too, so applying a file whose
# content changed since it was recorded stops instead of re-running silently.
set -euo pipefail

cd "$(dirname "$0")"

if [ -n "${PSQL:-}" ]; then
  read -r -a PSQL_CMD <<< "$PSQL"
elif [ -n "${DATABASE_URL:-}" ]; then
  PSQL_CMD=(psql "$DATABASE_URL")
else
  PSQL_CMD=(psql)
fi

run_sql() { # run_sql <sql>: one statement, tuples only
  printf '%s\n' "$1" | "${PSQL_CMD[@]}" -X -q -t -A -v ON_ERROR_STOP=1 -f -
}

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

ensure_table() {
  run_sql "SET client_min_messages = warning;
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename varchar(200) PRIMARY KEY,
    checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    applied_by varchar(100) NOT NULL DEFAULT current_user,
    recorded_only boolean NOT NULL DEFAULT false
  );" > /dev/null
}

check_file() {
  local file="${1:-}"
  if [ -z "$file" ]; then echo "missing <file.sql>" >&2; exit 2; fi
  file="$(basename "$file")"
  if [ ! -f "$file" ] || [[ "$file" != *.sql ]]; then
    echo "not a .sql file in scripts/: $file" >&2; exit 2
  fi
  if [[ ! "$file" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    echo "unexpected characters in file name: $file" >&2; exit 2
  fi
  FILE="$file"
  SUM="$(sha "$file")"
}

recorded_checksum() { run_sql "SELECT checksum FROM schema_migrations WHERE filename = '$1';"; }

record() { # record <file> <sum> <recorded_only>
  run_sql "INSERT INTO schema_migrations (filename, checksum, recorded_only)
           VALUES ('$1', '$2', $3);" > /dev/null
}

refuse_if_recorded() {
  local existing
  existing="$(recorded_checksum "$FILE")"
  if [ -n "$existing" ]; then
    if [ "$existing" = "$SUM" ]; then
      echo "already applied: $FILE"
    else
      echo "already applied, but the file changed since: $FILE" >&2
      echo "  recorded $existing" >&2
      echo "  now      $SUM" >&2
    fi
    exit 1
  fi
}

cmd="${1:-status}"
case "$cmd" in
  status)
    ensure_table
    applied="$(run_sql "SELECT filename || ' ' || checksum FROM schema_migrations;")"
    for file in migration_*.sql; do
      line="$(printf '%s\n' "$applied" | grep -E "^${file//./\\.} " || true)"
      if [ -z "$line" ]; then
        echo "pending  $file"
      elif [ "${line#* }" = "$(sha "$file")" ]; then
        echo "applied  $file"
      else
        echo "changed  $file   (applied, content differs now)"
      fi
    done
    ;;
  apply)
    check_file "${2:-}"
    ensure_table
    refuse_if_recorded
    "${PSQL_CMD[@]}" -X -v ON_ERROR_STOP=1 -f - < "$FILE"
    record "$FILE" "$SUM" false
    echo "applied and recorded: $FILE"
    ;;
  mark)
    check_file "${2:-}"
    ensure_table
    refuse_if_recorded
    record "$FILE" "$SUM" true
    echo "recorded (not run): $FILE"
    ;;
  *)
    echo "usage: scripts/migrate.sh status | apply <file.sql> | mark <file.sql>" >&2
    exit 2
    ;;
esac
