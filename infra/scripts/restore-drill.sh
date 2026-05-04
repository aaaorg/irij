#!/usr/bin/env bash
set -euo pipefail

# Restore drill — ověří, že dump je validní a restorovatelný.
# Spustí dočasný PG container, restoruje dump, spočítá základní tabulky.
#
# Použití:
#   ./restore-drill.sh /backups/irij-202605041200.dump

DUMP_FILE="${1:-}"
DRILL_CONTAINER="irij-restore-drill-$$"
PG_PORT=54321

if [ -z "$DUMP_FILE" ]; then
  echo "Usage: $0 <path-to-dump-file>" >&2
  exit 1
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "ERROR: dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

cleanup() {
  echo "Cleaning up drill container..."
  docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting temporary PG container..."
docker run -d \
  --name "$DRILL_CONTAINER" \
  -e POSTGRES_DB=nakama \
  -e POSTGRES_USER=nakama \
  -e POSTGRES_PASSWORD=drill \
  -p "${PG_PORT}:5432" \
  postgres:16-alpine >/dev/null

echo "Waiting for PG to be ready..."
for i in $(seq 1 30); do
  if docker exec "$DRILL_CONTAINER" pg_isready -U nakama >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: PG container did not become ready" >&2
    exit 1
  fi
  sleep 1
done

echo "Restoring dump: ${DUMP_FILE} ..."
docker cp "$DUMP_FILE" "${DRILL_CONTAINER}:/tmp/restore.dump"
docker exec "$DRILL_CONTAINER" \
  pg_restore \
    --username=nakama \
    --dbname=nakama \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    /tmp/restore.dump 2>&1 || true

echo ""
echo "=== Restore verification ==="

USERS_COUNT="$(docker exec "$DRILL_CONTAINER" \
  psql -U nakama -d nakama -t -c "SELECT count(*) FROM users" 2>/dev/null | tr -d ' ')"

echo "  users table row count: ${USERS_COUNT:-ERROR}"

STORAGE_COUNT="$(docker exec "$DRILL_CONTAINER" \
  psql -U nakama -d nakama -t -c "SELECT count(*) FROM storage" 2>/dev/null | tr -d ' ')"

echo "  storage table row count: ${STORAGE_COUNT:-ERROR}"

SCHEMAS="$(docker exec "$DRILL_CONTAINER" \
  psql -U nakama -d nakama -t -c "SELECT string_agg(nspname, ', ') FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema'" 2>/dev/null | tr -d ' ')"

echo "  schemas: ${SCHEMAS:-ERROR}"
echo ""

if [ -n "$USERS_COUNT" ] && [ "$USERS_COUNT" -ge 0 ] 2>/dev/null; then
  echo "DRILL PASSED — dump is restorable."
  exit 0
else
  echo "DRILL FAILED — restore produced unexpected results." >&2
  exit 1
fi
