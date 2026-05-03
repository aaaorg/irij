# DevOps / SRE Review

## TL;DR

Lokální Docker stack je čistý a reprodukovatelný — Postgres healthcheck, `restart: unless-stopped`, named volume, read-only mount runtime modulu. To je dobrý základ. Jenže od „lokálně to běží" k „100 CCU v produkci" chybí prakticky všechno: žádné CI (`.github/workflows` je prázdný), žádné migrace (`migrations/` prázdný), žádný `docker-compose.prod.yml`, žádný backup script, žádné secrets management, žádný restore drill, žádný Prometheus scrape config, žádný runbook. Phase 21 je realistických ~3-5 dnů jen pokud se mezitím **postupně** připraví CI a migrations workflow — jinak to bude týden+ panického scriptování den před launchem. Build sequencing past (`build:server` před `infra:up`) je řešitelná `pnpm infra:up` wrappere nebo `pre`-hookem; nedělat z toho Make/Just (jen další tool). Server requirements 4 GB / 2 vCPU jsou na hraně reálného — Nakama + Postgres + Goja runtime + 100 CCU se vejde, ale rezerva mizí. Doporučuju 8 GB / 4 vCPU baseline.

## Úspěchy / co je už solidní

- **Postgres healthcheck + Nakama `depends_on: service_healthy`** — žádný race condition, restart policies správně.
- **Read-only mount runtime modulu** (`server/dist:/nakama/data/modules:ro`) — match handler nemůže omylem zapsat do build outputu.
- **ADR-009 je velmi konkrétní** — Cloudflare cache rules, WebSocket idle timeout 100 s, heartbeat ~15 s, page rules 3 free. Méně handwave než 90 % indie projektů.
- **Hybrid storage rozhodnutí (ADR-004)** je ops-friendly — backup řešíš jediný Postgres (Nakama Storage i custom tables tam jsou), žádný dvojitý DR plán.
- **Tickrate model (ADR-007)** je deterministický a snadno profilovatelný — autosave 30 s + master 10 Hz = predikovatelná zátěž a clean recovery point.

## Rizika / dluh

- **P0 — Žádné secrets management.** `local.yml` má `password: password` a 32-char placeholder encryption keys přímo v repu. Před Phase 21 musíš mít: `infra/nakama/prod.yml` přes env substituci (Nakama umí `${VAR}`), `.env.prod` mimo repo + `.env.example` v repu, secrets injekce přes `docker compose --env-file`. Bez toho riskuješ commitnutí prod creds.
- **P0 — Restore drill nebyl nikdy proveden.** Action plan ho má jako single checkbox v Phase 21. Backup, který nebyl nikdy obnoven, **není backup**. Naplánuj první drill _před_ launchem a **monthly** poté (týdenní rituál v action planu zmiňuje „backup verification" ale vágně).
- **P1 — Žádné CI.** `.github/workflows/` existuje ale prázdný. Typecheck/build/lint by měly běžet na každém PR _teď_, ne v Phase 21. Build break v `main` při solo dev = pomalé, ale stejně škodlivé pro morálku a regrese.
- **P1 — Migrations workflow chybí.** Phase 6+ začne potřebovat (audit log table, listings, mob spawns). Rozhodni teď: `golang-migrate` CLI v separátním kontejneru spuštěném před Nakamou (Nakama si svoje migrace dělá sama) + commit konvence `migrations/0001_audit_log.up.sql` / `.down.sql`. Bez `down.sql` ztratíš schopnost rollback.
- **P1 — Build sequencing past není automatizovaná.** `pnpm infra:up` by měl mít `"infra:up": "pnpm build:server && docker compose ..."` nebo pre-script. Aktuální stav = footgun pro každého nového contributora (i tebe za 3 měsíce).
- **P2 — Monitoring stack jen v ADR.** Prometheus endpoint na Nakama (port 9100) musíš v `prod.yml` zapnout (`metrics.prometheus_port`), Grafana Cloud agent nainstalovat, dashboardy pro CCU/tick latency P95/P99 nastavit. Pro 100 CCU stačí Grafana Cloud free tier (10k series), ale 1× setup ~půl dne práce.

## Doporučené akce

1. **Teď (Phase 5–6 paralelně):** Přidej `.github/workflows/ci.yml` s `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`. ~30 minut, okamžitý value.
2. **Teď:** `pnpm infra:up` přepiš na `pnpm build:server && docker compose -f infra/docker-compose.yml up -d`, plus přidej `pnpm dev` orchestrátor (build:server watch + Vite + tail logs).
3. **Phase 5 (persistence):** definuj migrations workflow — přidej `migrations/0001_init.up.sql` + `down.sql`, `infra/docker-compose.yml` rozšiř o jednorázový `migrate` service (golang-migrate image), runbook do README.
4. **Phase 21 prep (start ideálně Phase 18):** vytvoř `infra/docker-compose.prod.yml` s env substitucí, `infra/nakama/prod.yml.template`, `.env.prod.example`, `infra/scripts/backup.sh` (pg_dump → restic/rclone na Hetzner Storage Box, retention 30 daily + 12 monthly).
5. **Phase 21:** hned první den po deploy proveď restore drill — full pg_dump na 2nd VPS, `nakama migrate up`, ověř Storage data integrity (joinout test účtem). Naplánuj cron `0 4 1 * *` měsíčně.
6. **Phase 21:** server requirements bump — 8 GB RAM / 4 vCPU baseline (Hetzner CCX13 ~€15/mo nebo větší existing). 4/2 je tight pro Nakama Goja + Postgres shared_buffers + nginx + space na backup pg_dump bez OOM. Swap 2 GB jako safety net (action plan ho zmiňuje, dobré).

## Reference

- [Nakama Production Deploy](https://heroiclabs.com/docs/nakama/getting-started/configuration/) — `metrics.prometheus_port`, `runtime.env` substituce, `--config` overlay
- [Cloudflare WebSocket idle timeout](https://developers.cloudflare.com/network/websockets/) — 100 s, heartbeat ~15 s
- [golang-migrate workflow](https://github.com/golang-migrate/migrate/blob/master/cmd/migrate/README.md) — CLI v Docker, `up`/`down`/`force`
- [pg_dump + restic best practices](https://restic.readthedocs.io/en/latest/040_backup.html) — encrypted, dedup, off-site
- [Grafana Cloud free tier](https://grafana.com/products/cloud/) — 10k series, 50 GB logs, dostatečné pro 100 CCU
- [docs/04 ADR-009, ADR-015](../04-tech-adr.md) — hosting + observability rozhodnutí
- [docs/00 Phase 21](../00-action-plan.md) — production deploy checklist
