# 06 — Ops Runbooks

Provozní příručky pro Irij infrastrukturu. Primárně pro alfa (self-hosted, sólo dev).

---

## Backup & Restore

### Strategie

| Parametr | Hodnota |
|----------|---------|
| RPO (Recovery Point Objective) | 6 h |
| RTO (Recovery Time Objective) | 1 h |
| Frekvence | 4× denně (cron `0 */6 * * *`) |
| Retence lokální | 7 dnů |
| Off-site target | NAS (rsync/SSH) |
| Měsíční drill | 1. neděle v měsíci |

### Co se zálohuje

- **Postgres** (celá `nakama` DB): uživatelské účty, Nakama Storage Engine (player/skills/inventory blobs), budoucí `irij` schema (audit log, market, mob spawns).
- Static assets a kód jsou v Gitu — nezálohují se zvlášť.

### Setup cron

```bash
# Lokální dump 4× denně
0 */6 * * *  /path/to/irij/infra/scripts/backup.sh /backups/irij

# Off-site sync na NAS (po každém dumpu)
15 */6 * * *  rsync -az --delete /backups/irij/ nas:/volume1/backups/irij/
```

### Manuální backup

```bash
cd irij/
./infra/scripts/backup.sh /backups/irij
```

### Restore drill

Spusť měsíčně (nebo po upgrade Postgres/Nakama):

```bash
./infra/scripts/restore-drill.sh /backups/irij/irij-202605041200.dump
```

Skript spustí dočasný PG container, restoruje dump, ověří počty řádků v `users` a `storage` tabulkách, a vrátí exit 0 (pass) nebo 1 (fail).

### Restore do produkce

1. Zastav Nakamu: `docker compose -f infra/docker-compose.yml stop nakama`
2. Restore: `docker exec -i <pg-container> pg_restore -U nakama -d nakama --clean --if-exists < dump.dump`
3. Start Nakamu: `docker compose -f infra/docker-compose.yml start nakama`
4. Ověř healthcheck: `curl localhost:7350/healthcheck`

---

## Migrations workflow

Migrace běží automaticky při `pnpm infra:up` (sidecar `migrate` service v docker-compose).

### Přidání nové migrace

1. Vytvoř dva soubory v `migrations/`:
   - `NNNN_popis.up.sql` — forward migration
   - `NNNN_popis.down.sql` — rollback
2. Číslování: inkrementuj poslední NNNN (4 digits, zero-padded).
3. Ověř lokálně: `pnpm infra:down && pnpm infra:up` + `psql` check.
4. Commitni oba soubory do stejného PR jako kód, který migraci vyžaduje.

### Dry-run check

```bash
docker run --rm -v $(pwd)/migrations:/migrations \
  --network host migrate/migrate:latest \
  -path=/migrations \
  -database='postgres://nakama:localdev@localhost:5432/nakama?sslmode=disable' \
  up 1
```

### Rollback

```bash
docker run --rm -v $(pwd)/migrations:/migrations \
  --network host migrate/migrate:latest \
  -path=/migrations \
  -database='postgres://nakama:localdev@localhost:5432/nakama?sslmode=disable' \
  down 1
```

---

## Secrets rotation

| Secret | Rotace |
|--------|--------|
| `NAKAMA_SESSION_ENCRYPTION_KEY` | Každých 90 dnů + při personnel change |
| `NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY` | Každých 90 dnů |
| `NAKAMA_SERVER_KEY` | Každých 90 dnů (klient musí znát) |
| `NAKAMA_CONSOLE_PASSWORD` | Každých 90 dnů |
| `POSTGRES_PASSWORD` | Při personnel change |

Generování nových klíčů: `./infra/scripts/generate-keys.sh` (smaž stávající `.env` předtím).

**Pozor:** rotace `SESSION_ENCRYPTION_KEY` invaliduje všechny aktivní sessions — plánuj na low-traffic okno.
