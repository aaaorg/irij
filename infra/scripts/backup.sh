#!/usr/bin/env bash
set -euo pipefail

# pg_dump pro Irij — volat z cronu (doporučeno 4× denně).
# Dump includuje public schema (Nakama) + irij schema (game tables).
#
# Předpoklady:
#   - Docker compose stack běží (postgres container)
#   - Cílový adresář existuje
#
# Použití:
#   ./backup.sh                           # dump do /backups/
#   ./backup.sh /mnt/nas/irij-backups     # dump do custom adresáře
#   BACKUP_RETENTION_DAYS=14 ./backup.sh  # vlastní retence

BACKUP_DIR="${1:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
TIMESTAMP="$(date +%Y%m%d%H%M)"
DUMP_FILE="${BACKUP_DIR}/irij-${TIMESTAMP}.dump"

COMPOSE_FILE="$(dirname "$0")/../docker-compose.yml"
PG_CONTAINER="$(docker compose -f "$COMPOSE_FILE" ps -q postgres)"

if [ -z "$PG_CONTAINER" ]; then
  echo "ERROR: postgres container not running" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "Dumping to ${DUMP_FILE} ..."
docker exec "$PG_CONTAINER" \
  pg_dump \
    --username=nakama \
    --format=custom \
    --file="/tmp/irij-backup.dump" \
    nakama

docker cp "${PG_CONTAINER}:/tmp/irij-backup.dump" "$DUMP_FILE"
docker exec "$PG_CONTAINER" rm -f /tmp/irij-backup.dump

DUMP_SIZE="$(du -h "$DUMP_FILE" | cut -f1)"
echo "Dump complete: ${DUMP_FILE} (${DUMP_SIZE})"

# Prune old backups
PRUNED="$(find "$BACKUP_DIR" -name 'irij-*.dump' -mtime +"$RETENTION_DAYS" -delete -print | wc -l)"
if [ "$PRUNED" -gt 0 ]; then
  echo "Pruned ${PRUNED} backups older than ${RETENTION_DAYS} days."
fi
