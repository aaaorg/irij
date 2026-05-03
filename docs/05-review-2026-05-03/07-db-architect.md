# Database & Storage Architect Review

**Reviewer pohled:** senior DB / storage architekt s MMO zkušeností
**Datum:** 2026-05-03
**Scope:** ADR-004 (hybrid storage), ADR-005 (single match), ADR-009 (hosting/backup), data model 02a–e, `server/src/rpc/profile.ts`, `infra/`, prázdné `migrations/`.

## TL;DR

Hybrid Nakama Storage + Postgres je **správná volba pro 100 CCU** a celé MVP. Storage write pattern v `profile.ts` je čistý (atomic batch, `permissionWrite=0`, owner-read), takže auth-cheat na blob přes klient SDK je zavřený. Reálná rizika nejsou v _kde_ ukládat, ale v **operačním tooling** — `migrations/` je prázdný (žádné Postgres schéma pro listings/audit/anti-inflation), žádný backup runbook ani restore drill, žádný OCC version handling pro Phase 5 autosave (bloby `player`/`player_inventory` se mohou mezi 30 s autosave a explicit RPC write přepsat lost-update). Banka jako single blob narazí na 255 MB cap při dlouhodobém hoardingu (řádově OK pro MVP, ale strop vidět). Doporučuju **dřív než Phase 5**: zavést OCC version + split `player_position` z `player` blobu (autosave hot-path nemá smysl serializovat celý profile), a **dřív než Phase 8 (NPC obchod) / Phase 11 (audit)**: první SQL migraci s `irij` schématem, audit log partitioned by month, idempotent migration tooling.

## Úspěchy

1. **Hybrid je idiomatický.** Per-player blob v Nakama Storage = zero-config write-through z match handleru, OCC built-in, owner permissions. Cross-player queries zůstávají v Postgres, kde patří. Nezvyšuje stack komplexitu (žádný Redis), což odpovídá single-dev realitě.
2. **Storage permissions jsou tight.** `profile.ts` zapisuje s `permissionRead=1, permissionWrite=0` → klient nemůže ani číst cizí blob, ani zapsat svůj přes SDK. Veškerý write proudí runtime modulem = server-authoritative model je strukturálně vynucený, ne jen konvence.
3. **Atomic batch write** všech tří blobů (`player`, `player_skills`, `player_inventory`) v jediném `storageWrite([...])` — Nakama garantuje jednu transakci, takže character creation nemá half-state failure.
4. **Schema dokumenty (02a–e) explicitně oddělují persistent vs match-state** (autosave 30 s, write-through na XP/inventory/equipment) — to je kritická hygiena pro post-crash recovery.
5. **Single Postgres instance, vlastní schéma** (ADR-004) — žádná vendor sprawl, jeden backup target, jeden connection pool, ale logická izolace tabulek mimo Nakama vlastní (`users`, `storage`, atd.).

## Rizika

1. **[P0] Žádný OCC pattern u autosave (Phase 5 blocker).** `profileCreateCharacter` zapisuje bez `version`. Při 30 s autosave (pozice/HP) souběžně s explicit RPC (např. inventory equip) druhý write přepíše první bez detekce. Nakama umí `version: '*'` (write-only-if-not-exists) i `version: '<hash>'` (CAS); musí se používat. Lost-update na inventory = duplikace itemů (anti-cheat / anti-inflation P0).
2. **[P0] Banka jako monolit blob škáluje špatně.** `player_bank` collection (lazy-load) — neomezená kapacita per design (02a). Hráč po 6 měsících může mít 5k+ stack řádků. Storage value je `jsonb` v PG s teoretickým 255 MB capem ([forum.heroiclabs.com](https://forum.heroiclabs.com/t/storage-max-size-in-megabytes/3459)), ale praktický `jsonb` parse/write nad 1 MB začne blokovat match loop (Goja JSON.parse není stream). Doporučuju **bank shardovat per-tab nebo per-page** od začátku.
3. **[P1] Migrace tooling chybí.** ADR-004 zmiňuje `golang-migrate` a `migrations/` je prázdný adresář. První Postgres tabulky (mob_spawn snapshot, market_listing, job_board_task, audit_log, daily_economy_snapshot) přijdou v Phase 8–11; bez konvence (schema name, migration runner v Docker compose, dry-run check) bude každá migrace ad-hoc.
4. **[P1] Audit log volume estimate chybí.** ADR-012 + 02e řeknou "audit log do Postgres", ale kolik řádků/den? 100 CCU × ~500 actions/h × 8 h = 400k řádků/den = 12M/měsíc. Bez **partitioning by month** + retention policy se tabulka stane unpurgable po 6 měsících. Index strategy (player_id, created_at, action_type) musí být zaplánovaná dřív, ne po prvním slow query.
5. **[P1] Backup strategie není runbook, je jen "pg_dump cron".** ADR-009 říká "pg_dump 4× denně, off-site, monthly restore drill" (Risks tabulka). Implementace neexistuje. **Player Storage data jsou v Postgresu** (Nakama je tam ukládá), takže pg_dump je krije; toto je dobrá zpráva, ale **restore drill nikdy neproběhl** — nevíš, jestli `nakama migrate up` po restore znovu nesefoukne data, jestli Storage value version stays consistent.
6. **[P2] Connection pool conflict při post-MVP scaling.** MVP: jeden Nakama node používá svůj built-in PG pool (default `max_open_conns=100`). Když runtime modul si bude otevírat vlastní connection pro `irij` schema (cross-player queries) přes `nk.sqlExec`, použije _stejný_ pool — fine. Při Nakama clusteru (post-MVP, ADR-009) každý node × pool size přejede `max_connections` = 100 default v PG 16 → connection storms. PgBouncer před PG je standard, není v plánu.

## Doporučené akce

1. **Před Phase 5 zavést OCC version handling.** Match handler drží `version` per blob při load, autosave/equip RPC použije `nk.storageWrite([{..., version}])`. Při version mismatch → reload a retry (max 3×). **Split `player_position` + `hp_current` do vlastní collection** (`player_state`) s 30 s autosave write; profile/inventory mají write-through pattern bez position thrash.
2. **Před Phase 8 (NPC obchod) napsat první migraci.** `migrations/0001_init_irij_schema.sql`: `CREATE SCHEMA irij;` + tabulky `irij.market_listing`, `irij.merchant_stock`, `irij.job_board_task`, `irij.player_job_entry`. Migration runner = sidecar container v `docker-compose.yml` před Nakama startem (`golang-migrate up`). Dry-run check v CI (Phase 21).
3. **Audit log partitioning od dne 1.** `irij.audit_log` jako PG 16 native partitioned table by `created_at` měsíčně, indexy `(player_id, created_at DESC)` a `(action_type, created_at DESC)`. Retention = drop partition po 90 dnech (forensika), kritické patterns (large trades, suspect XP) export do separátní `irij.audit_critical` s retention 1 rok.
4. **Bank tabulka, ne blob.** Posunout banku z Nakama Storage do Postgres `irij.player_bank_item (player_id, item_id, instance_id, quantity, slot_index)` s indexem `(player_id, slot_index)`. Lazy-load při open zůstává, ale pagination + cross-shard scan ("nejvyšší zlato hráč") je triviální. Storage Engine si nech jen pro inventory + equipment (bounded velikost).
5. **Backup runbook + restore drill v Phase 21.** Konkrétní: `pg_dump --format=custom --schema=public --schema=irij` 4× denně → Hetzner Storage Box (rclone). Měsíční restore drill = automatizovaný script `scripts/restore-drill.sh` který stáhne dump, spustí dočasný PG container, ověří `SELECT count(*) FROM users` + storage object count vs known baseline. Bez drillu backup nepočítej.
6. **Cross-shard readiness check v code review.** ADR-005 říká "žádná globální iterace nad celým světem" — to platí pro game logic, ale stejné pravidlo musí platit pro DB queries v `irij` schema. Žádné `SELECT * FROM market_listing WHERE 1=1` bez `village_id` filtru, žádné `SELECT * FROM mob_spawn`. Když Phase 8+ začne psát Postgres queries, **každá WHERE klauzule musí mít chunk_id nebo village_id** jako lead column v indexu — jinak post-MVP chunk-cluster split znamená přepis všech queries.

## Reference

- `docs/04-tech-adr.md` ADR-004, ADR-005, ADR-009
- `docs/02a-data-model-postava.md` (Storage layer notes; Match state vs persistent)
- `docs/02e-data-model-ekonomika.md` (audit, anti-inflation logy, listing escrow)
- `server/src/rpc/profile.ts` (storage write pattern, permissions)
- `infra/docker-compose.yml` (PG 16 + Nakama 3.38, žádný migration runner)
- [Nakama Storage Engine — Collections](https://heroiclabs.com/docs/nakama/concepts/storage/collections/) (OCC version, atomic batch)
- [Heroic Labs forum — storage object size limit](https://forum.heroiclabs.com/t/storage-max-size-in-megabytes/3459) (255 MB jsonb cap, S3 doporučeno pro big assets)
- [Nakama Storage Search](https://heroiclabs.com/docs/nakama/concepts/storage/search/) (filtering capabilities, cross-player query limits)
- OSRS post-mortem patterns (audit log partitioning, RWF anti-dupe via OCC) — interní reference
