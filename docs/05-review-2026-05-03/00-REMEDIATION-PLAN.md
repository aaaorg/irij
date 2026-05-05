# Irij — Remediation Plan (review 2026-05-03)

**Pro koho:** implementační agent, který bude jednotlivé položky postupně realizovat **po konzultaci s Jakubem** (gating per item).
**Princip:** každá položka je atomická, self-contained (ID, priorita, kontext, konkrétní kroky, verifikace, effort), s odkazem na zdrojový report ve stejné složce.
**Pořadí:** doporučené pořadí v sekci [#workflow](#workflow). Priority **P0 = blocker** (řeš dřív, než pokračuje další fáze action planu), **P1 = vysoká** (řeš v rámci probíhající fáze), **P2 = nice-to-have** (lze odložit).
**Konvence:** každá položka má sekci **Files** s konkrétními cestami. Implementační agent **nesmí měnit nic mimo Files** (a pokud potřebuje, výslovně to v PR popíše).
**Workflow per item:** větev `dev/remediation-<id>` → PR → squash merge → návrat na main (per CLAUDE.md git workflow).

---

## Sekce A — Operational safety net (před Phase 5)

### A1 — CI: typecheck + build + test gate na PR (P0) ✅ PR #16

- **Source:** Engineering Director, DevOps, QA, Tech Lead.
- **Why:** Repo už persistuje hráče, žádný automatický check existuje. Drift mezi `pnpm typecheck` a `pnpm build` se objeví až manuálně. Bez gate na PR squash merge protekne.
- **Files:**
  - `.github/workflows/ci.yml` (nový)
- **What:**
  1. GitHub Actions workflow `ci.yml` triggered na PR + push do `main`.
  2. Job `quality`: setup Node 22 + pnpm 9.15.9 (per `package.json` engines + `packageManager`), `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build` (= shared → server → client).
  3. Job `test` (závisí na `quality`): `pnpm test` — bude no-op dokud A2 nepřipojí Vitest, pak začne mít smysl.
  4. Cache `~/.local/share/pnpm/store` per `pnpm-lock.yaml` hash.
- **Verify:** otevři dummy PR, oba joby zelené pod 3 min.
- **Effort:** ~1 h.

### A2 — Vitest skeleton + první test suite na pure utily (P0) ✅ PR #17

- **Source:** QA, Tech Lead, Backend.
- **Why:** `pnpm test` je no-op. Pure utily (`pathfinding`, `walkable`, `parseMoveRequest`, opcode shape) jsou ideální cíl bez Nakama runtime mocku. Bez testů Phase 6+ refactor pathfindingu = playtest ruleta.
- **Files:**
  - `server/package.json` (přidej `vitest` devDep, `test: vitest run`)
  - `server/vitest.config.ts` (nový)
  - `server/src/match/pathfinding.test.ts` (nový)
  - `server/src/match/walkable.test.ts` (nový)
  - `server/src/match/movement.test.ts` (nový — `parseMoveRequest` shape, rate-limit sliding window)
  - root `package.json` `test: pnpm -r test` už existuje, ověř recursive run
- **What:**
  1. Nainstaluj `vitest` ^2 (nebo aktuální stable) jako server devDep.
  2. Test cases per Tech Lead doporučení:
     - `findPath`: happy path (manhattan + diagonal), `MAX_PATH_LENGTH_TILES` cap, no-corner-cutting (block adjacent diagonal), unreachable target.
     - `nearestWalkable`: 8-conn semantika, depth radius respektovaný, no-walkable → null.
     - `maskFromTiledMap`: gid mapping (3 = water = non-walkable), out-of-bounds robustness, malformed JSON → throw.
     - `parseMoveRequest`: invalid shapes (`null`, missing keys, float coords, NaN), valid shape pass-through.
     - Sliding-window rate limit edge cases (10 req v 999 ms = pass, 11 req = reject, prune po 1000 ms).
  3. CI A1 začne pouštět tyto testy automaticky.
- **Verify:** `pnpm --filter irij-server test` runs ≥ 20 testů, vše zelené.
- **Effort:** ~3 h.

### A3 — Backup runbook + restore drill (P0) ✅ PR #19

- **Source:** Engineering Director, DB Architect, DevOps, Nakama specialist.
- **Why:** Repo persistuje hráče (Nakama Storage je v Postgres). Phase 21 je pozdě — alpha test s kámoši (Phase 22) bez ověřeného backupu = single point of failure pro důvěru.
- **Files:**
  - `infra/scripts/backup.sh` (nový)
  - `infra/scripts/restore-drill.sh` (nový)
  - `docs/06-ops-runbooks.md` (nový — krátký provozní runbook)
- **What:**
  1. `backup.sh`: `pg_dump --format=custom --schema=public --schema=irij --file=/backups/irij-YYYYMMDDHHMM.dump` (cron-friendly).
  2. `restore-drill.sh`: stáhne dump, spustí dočasný PG container (`docker run --rm -d postgres:16`), `pg_restore` do něho, `psql -c "SELECT count(*) FROM users"`, výstup compare s baseline file. Exit 0/1.
  3. `06-ops-runbooks.md`: dokumentuj cron interval (4× denně), off-site target (Hetzner Storage Box per memory `project_external_infra` nebo NAS), monthly drill, RPO/RTO target (RPO 6 h, RTO 1 h pro alfu).
- **Verify:** spusť `restore-drill.sh` lokálně, zkontroluj exit 0 + log čistý.
- **Effort:** ~4 h (vč. setup off-site target + první test run).

### A4 — Secrets hygiene + prod template (P0) ✅ PR #18

- **Source:** Security, Nakama, DevOps.
- **Why:** `infra/nakama/local.yml` má plaintext `console.password: password`, `session.encryption_key`, `socket.server_key` v repu. `local.yml` neobsahuje nic, co by bránilo deploy do prod. Hardcoded vzor = footgun.
- **Files:**
  - `infra/nakama/local.dev.yml` (rename z `local.yml`)
  - `infra/nakama/prod.yml.example` (nový — placeholders, env substitution)
  - `infra/.env.example` (nový — list of required env vars)
  - `.gitignore` (přidej `infra/.env`, `infra/nakama/prod.yml`)
  - `infra/docker-compose.yml` (update `--config /nakama/data/local.dev.yml` cestu)
  - `client/src/nakama.ts` (default `serverKey` musí přijít z `import.meta.env.VITE_NAKAMA_SERVER_KEY`, fallback `'irij-local-server-key'` jen v dev)
  - `client/.env.example` (nový)
- **What:**
  1. Rename + add example. `prod.yml.example` použij Heroic Labs `${ENV_VAR}` substitution.
  2. Bootstrap script (volitelný): `infra/scripts/generate-keys.sh` — `openssl rand -hex 32` × 3 (session, refresh, server key) → `.env`.
  3. Vite klient: čti `VITE_NAKAMA_SERVER_KEY` z env, v dev fallback default OK.
  4. Doc v `06-ops-runbooks.md`: rotation policy (90 dnů + při personnel change).
- **Verify:** `pnpm build:server && pnpm infra:up` stále jede (lokál čte `local.dev.yml`); `git status` ukazuje `.env` jako ignorovaný.
- **Effort:** ~2 h.

### A5 — Audit log foundation (P0 → P1) ✅ PR #20

- **Source:** Security, DB Architect.
- **Why:** ADR-012 bod 5 ("audit log do Postgres") neimplementovaný. Login, char creation, MOVE_REJECTED s podezřelým patternem nikde nejsou persistentně. Phase 19 (auth providers) potřebuje ten log.
- **Files:**
  - `migrations/0001_init_irij_schema.sql` (nový — viz B3)
  - `migrations/0002_audit_log.sql` (nový)
  - `server/src/lib/audit.ts` (nový — `logAudit(nk, event, fields)` helper)
  - `server/src/rpc/profile.ts` (volat `logAudit` v `profileCreateCharacter`)
  - `server/src/match/movement.ts` (sample `MOVE_REJECTED` 1/100 do audit logu, plus 100 % pro `out_of_bounds` a `too_far`)
- **What:**
  1. PG schema `irij` + tabulka `irij.audit_log(id BIGSERIAL, ts TIMESTAMPTZ DEFAULT now(), user_id UUID, ip TEXT, event TEXT NOT NULL, payload JSONB)` partitioned by month.
  2. Helper `logAudit(nk, event, fields)` → `nk.sqlExec("INSERT INTO irij.audit_log...", [...])`.
  3. Volej z auth/profile RPC, exploitable signals z movement.
- **Verify:** vyrob 3 char accounty, zkontroluj `SELECT count(*) FROM irij.audit_log WHERE event='character_created'` = 3.
- **Effort:** ~3 h (vč. migration A4 dependency).

### A6 — Real-browser smoke skript formalizovaný (P1) ✅ PR #21

- **Source:** QA.
- **Why:** Manuální Playwright smoke per CLAUDE.md `feedback_real_browser_verification.md` přestane škálovat v Phase 6+. Formalizuj do skriptu.
- **Files:**
  - `client/tests/smoke/golden-path.spec.ts` (nový — Playwright)
  - `client/playwright.config.ts` (nový)
  - `client/package.json` (přidej `@playwright/test` devDep, `smoke: playwright test`)
- **What:**
  1. Golden path scénář: BootScene → guest auth → char create → world spawn → click-to-move 3 tile → ENTITY_MOVED render check → no console errors.
  2. CI gate (volitelně, nice-to-have) — spustí se headless v `ci.yml` jen pokud `infra:up` runs (separátní workflow `e2e.yml` s docker compose service).
- **Verify:** `pnpm --filter irij-client smoke` pass.
- **Effort:** ~3 h.

---

## Sekce B — Storage & persistence hardening (před Phase 5)

### B1 — OCC version handling pattern (P0) ✅ PR #23

- **Source:** DB Architect, Nakama specialist.
- **Why:** `nk.storageWrite` podporuje `version` field (CAS). Phase 5 autosave (30 s) souběžně s explicit RPC = lost-update na inventory = duplikace itemů = anti-inflation P0.
- **Files:**
  - `server/src/lib/storage.ts` (nový — `readWithVersion`, `writeWithVersion`, retry helper)
  - `shared/src/types/player.ts` (přidej `schema_version: 1` do Player typu)
  - `server/src/rpc/profile.ts` (init `schema_version: 1` při create)
  - `docs/04-tech-adr.md` (doplnit do ADR-004 OCC subsection)
- **What:**
  1. `readWithVersion<T>(nk, collection, key, userId): {value: T, version: string}` — wrapper kolem `nk.storageRead`.
  2. `writeWithVersion<T>(nk, collection, key, userId, value, version): {newVersion: string}` — `nk.storageWrite` s `version` field.
  3. Retry helper `withOCCRetry(fn, max=3)` — chytá `runtime.ErrStorageRejectedVersion`, re-reads + re-applies.
  4. ADR-004 doplň section "OCC pattern" s rule: každý write blob = read with version → mutate → write with version → on conflict re-read.
- **Verify:** unit test s fake storage mockem (Vitest), expect retry na conflict.
- **Effort:** ~3 h.

### B2 — Split `player_state` z `player` blobu (P1) ✅ PR #23

- **Source:** DB Architect.
- **Why:** Hot-path autosave (pozice, HP, current zone) nemá smysl serializovat celý profile blob. Frequent write → contention s méně častými RPC writes.
- **Files:**
  - `shared/src/types/player.ts` (definuj `PlayerState` typ)
  - `server/src/match/world.ts` (matchJoin čte `player_state` collection, init pokud neexistuje)
  - `server/src/rpc/profile.ts` (`profileCreateCharacter` zapíše i `player_state`)
- **What:**
  1. Nová Storage collection `player_state` s `{current_position, hp_current, hp_max, last_logout_at}`.
  2. Phase 5 autosave čte/píše jen `player_state`, žádný `player` blob.
  3. `player` blob (display_name, gender, appearance) je write-once + write-on-explicit-RPC.
- **Verify:** create char, check obě collections existují s `version`.
- **Effort:** ~2 h. (lze sloučit s implementací Phase 5)

### B3 — První PG migrace + golang-migrate runner (P0/P1) ✅ PR #20 (s A5)

- **Source:** DB Architect, DevOps.
- **Why:** `migrations/` je prázdný adresář. Phase 6+ (mob spawns, listings, audit log) potřebuje PG tabulky. Bez konvence ad-hoc spaghetti.
- **Files:**
  - `migrations/0001_init_irij_schema.sql` (nový)
  - `infra/docker-compose.yml` (přidej `migrate` sidecar service: `migrate/migrate:v4.18` image, runs before Nakama)
  - `docs/06-ops-runbooks.md` (sekce „Migrations workflow")
- **What:**
  1. `0001_init_irij_schema.sql`:
     ```sql
     CREATE SCHEMA IF NOT EXISTS irij;
     -- placeholder pro budoucí tabulky (audit_log v 0002, market v 00xx)
     ```
  2. `docker-compose.yml`: nová service `migrate` (image `migrate/migrate:v4.18`, command `up`, depends on `postgres` healthy, mounts `./migrations:/migrations`, env `POSTGRES_URL`).
  3. Nakama `depends_on: { migrate: { condition: service_completed_successfully } }`.
  4. Doc: jak přidat novou migraci, naming convention `NNNN_description.sql`, dry-run check.
- **Verify:** `pnpm infra:up`, `psql -c "\dn"` ukazuje `irij` schema.
- **Effort:** ~2 h.

### B4 — Bank jako PG tabulka, ne blob (P1, plánováno před Phase 14)

- **Source:** DB Architect.
- **Why:** Banka jako monolit blob narazí na 255 MB jsonb cap a Goja JSON.parse přes 1 MB blokuje match loop. Phase 14 (Bank) je dobrý moment to udělat správně od začátku.
- **Files:**
  - `migrations/000X_player_bank.sql` (nový, číslo dle pořadí)
  - `server/src/rpc/bank.ts` (nový — Phase 14 implementace)
- **What:**
  1. Schema `irij.player_bank_item (player_id UUID, slot_index INT, item_id TEXT, instance_id UUID, quantity INT, PRIMARY KEY (player_id, slot_index))` + index `(player_id)`.
  2. Cross-shard ready: `player_id` je lead column, lze partitionovat po MVP.
- **Verify:** Phase 14 implementace integration test (deposit/withdraw round-trip).
- **Effort:** ~4 h (Phase 14 scope).

---

## Sekce C — Build pipeline & runtime robustness (před Phase 5)

### C1 — Post-build IIFE strip guard (P0)

- **Source:** Tech Lead, Nakama specialist.
- **Why:** `server/build.js` regex unwrap je fragile. Esbuild minor upgrade tichounce rozbije, Nakama spadne s "failed to find InitModule".
- **Files:**
  - `server/build.js`
  - `server/package.json` (pin `esbuild` na exact version, ne `^0.28.0`)
- **What:**
  1. Po `unwrapIife()` načti `dist/index.js`, zkontroluj `^function InitModule\b` regex match na top-level (multiline).
  2. Pokud nematchne → `console.error` + `process.exit(1)`.
  3. Pin esbuild: `"esbuild": "0.28.0"` (přesně, bez `^`).
- **Verify:** uměle rozbij `unwrapIife()` (return raw), build → exit 1 s jasnou hláškou.
- **Effort:** ~30 min.

### C2 — `find_or_create_match` race fix (P0)

- **Source:** Tech Lead, Nakama specialist.
- **Why:** Race může vyrobit 2-3 orphan matche tickající 10 Hz. Komentář v `world.ts` to přiznává. Před prvním produkčním deploy řešit.
- **Files:**
  - `server/src/rpc/world.ts` (nebo kde sedí `find_or_create_match`)
  - `server/src/lib/storage.ts` (z B1)
- **What:**
  1. Použít CAS lock přes `nk.storageWrite([{collection: '_world_singleton', key: 'active_match_id', value: {...}, version: ''}])` — `version: ''` znamená create-if-not-exists, druhý pokus selže.
  2. Vyhrávající caller vytvoří match a uloží `match_id` do storage; ostatní callers re-read storage a join.
  3. Cleanup pattern: na `matchTerminate` vymaž storage záznam (nebo TTL přes timestamp + `nk.storageList`).
- **Verify:** unit test (Vitest) s fake storage mockem simulujícím race; integration manuální (10 paralelních klientů).
- **Effort:** ~3 h.

### C3 — Replace `mapJson as any` typed import (P0)

- **Source:** Tech Lead, Backend.
- **Why:** Cast ruší TS jistotu právě tam, kde je nejvíc potřeba (walkable mask init z bundlnutého `.tmj`). Tiled export drift = silent runtime KO.
- **Files:**
  - `shared/src/types/world.ts` (definuj `TiledMap`, `TiledLayer`, `TiledTilesetRef`)
  - `server/src/match/world.ts` (řádek `mapJson as any` na typed import)
  - `server/src/match/walkable.ts` (`maskFromTiledMap` parametr typed)
  - `server/build.js` (volitelně: validate `.tmj` schema při bundlování)
- **What:**
  1. Definuj minimální `TiledMap` typ (orientation, width, height, tilewidth/height, layers, tilesets).
  2. Update všech callerů.
- **Verify:** `pnpm build:server` bez errorů, ale `git diff` ukazuje že `as any` zmizel.
- **Effort:** ~1 h.

### C4 — Shared walkable typology (P1)

- **Source:** Tech Lead.
- **Why:** Server: `NON_WALKABLE_TILE_GIDS`. Klient: zatím bez vlastní walkable logiky (každý click letí na server). Phase 18 polish + objects layer → klient bude muset filtrovat lokálně, hrozí drift.
- **Files:**
  - `shared/src/world/walkable.ts` (nový — `isWalkableGid(gid: number): boolean` pure)
  - `server/src/match/walkable.ts` (use shared)
  - `client/src/scenes/WorldScene.ts` (v Phase 18+ použít shared pro UX click filtering)
- **What:** Přesun `NON_WALKABLE_TILE_GIDS` z `shared/src/constants` (kde už je) do `shared/src/world/walkable.ts` + vytvoř `isWalkableGid`. Server importuje místo lokální logiky.
- **Verify:** unit test (server walkable test už pokrývá; přidej shared test).
- **Effort:** ~1 h.

### C5 — `runScheduledTicks` table-driven counter helper (P1)

- **Source:** Tech Lead.
- **Why:** Phase 5 autosave + Phase 6 combat/AI ticky přijdou; bez jednotného pattern hrozí ad-hoc spaghetti v `matchLoop`.
- **Files:**
  - `server/src/match/scheduler.ts` (nový)
  - `server/src/match/world.ts` (`matchLoop` použije)
- **What:**
  1. `runScheduledTicks(state, tick, dispatcher)` s table `{combat: COMBAT_TICK_INTERVAL, ai: AI_TICK_INTERVAL, autosave: PLAYER_AUTOSAVE_INTERVAL, jobBoard: JOB_BOARD_GENERATION_INTERVAL}`.
  2. Dispatcher = mapa `{combat: combatTick, autosave: autosaveTick, ...}` čisté funkce nebo handler refs.
- **Verify:** Phase 5 autosave přidaný jako první entry, jeden test ověří periodicitu.
- **Effort:** ~2 h.

---

## Sekce D — Validation & error handling (Phase 4.5/5)

### D1 — Tenký zod-like validator v `shared/` (P1)

- **Source:** Backend, Tech Lead.
- **Why:** RPC validace je ad-hoc, duplikovaná, `typeof` checks. Phase 6+ (combat, inventory, trade) explodují na 10× duplikovanou logiku.
- **Files:**
  - `shared/src/validation/schema.ts` (nový — ~50 LOC pure TS)
  - `server/src/rpc/profile.ts` (refactor `parseRequest`)
  - `server/src/match/movement.ts` (refactor `parseMoveRequest`)
- **What:** API per Backend report (`obj()`, `int()`, `str()`, `parse(unknown): Result<T, string[]>`). Goja-safe (žádný regex /v flag, žádný `import.meta`).
- **Verify:** unit test schémata + replacement RPC handler test.
- **Effort:** ~3 h.

### D2 — RPC throw + typed error code (P1)

- **Source:** Backend, Nakama specialist.
- **Why:** `errorResponse('username_taken')` vrací 200 OK + `{ok:false}` body. Klient si parsuje string. Nakama-native throw + `Error` s `code` mapuje na HTTP/RPC error → klient čistě rozliší success/failure status, log severity správný.
- **Files:**
  - `server/src/lib/errors.ts` (nový — `RpcError` třída)
  - `server/src/rpc/*.ts` (refactor `errorResponse` → `throw new RpcError(code, message)`)
  - `client/src/rpc.ts` (catch nakama-native error, map na `Result<T, RpcError>`)
- **What:**
  1. `RpcError extends Error` s `code: string`.
  2. Nakama runtime mapping (heroiclabs/nakama-project-template ukazuje jak).
  3. Klient handler jednotně dispatchuje.
- **Verify:** explicit RPC error case test (např. duplicate username) → klient dostane HTTP 400 + parsed code.
- **Effort:** ~3 h.

### D3 — Storage blob runtime narrowing (P1)

- **Source:** Backend.
- **Why:** `as Player` casty po `storageRead` bez runtime ověření = silent crash 10 minut později.
- **Files:**
  - `shared/src/types/player.ts` (přidej `asPlayer(value: unknown): Player | null` narrowing helper)
  - `server/src/match/world.ts` (matchJoin použije)
  - `server/src/rpc/profile.ts` (profileGetSelf použije)
- **What:** Po `storageRead` narrowing helper kontroluje klíčová pole + `schema_version`. Logger.warn + odmítnutí join při mismatch.
- **Verify:** unit test asPlayer s valid + invalid + missing fields.
- **Effort:** ~1.5 h.

### D4 — Structured logging bridge (P2)

- **Source:** Backend.
- **Why:** `printf`-style log se neparsuje pro Loki/Grafana pipeline (Phase 21).
- **Files:**
  - `server/src/lib/log.ts` (nový — `log(logger, level, msg, fields)` bridge)
  - migrace existujících `logger.info('...' + ${...})` calls.
- **What:** Bridge funkce: `log(logger, 'info', 'move rejected', {userId, reason, target})` → `logger.info('move rejected ' + JSON.stringify({userId,...}))`. V Phase 21 přepneš na native structured API jakmile Nakama runtime přidá.
- **Verify:** grep zbylé `${` v logger calls, hand-migrate.
- **Effort:** ~1 h.

### D5 — Transactionally-safe presence helper (P1)

- **Source:** Backend, Tech Lead.
- **Why:** `addPresenceToChunk` + `removePresenceFromChunk` jsou dva separátní spread-reassigny → potenciální Goja invariant break. Konzistentní rule: jeden top-level reassign.
- **Files:**
  - `server/src/match/state.ts` (refactor)
  - `server/src/match/movement.ts` (callers)
- **What:** `updatePresenceLocation(state, userId, newPos)` reassignuje **obě** `presencesByUserId` a `presencesByChunk` jednou na konci. Original add/remove stays as private helpers.
- **Verify:** existing tests + new test pro hranici chunků.
- **Effort:** ~1.5 h.

---

## Sekce E — Frontend / UX must-haves (Phase 4.5 / posunuté z Phase 17, 20)

### E1 — PWA ikony + manifest finalizace (P0)

- **Source:** Frontend/UX, Mobile/PWA.
- **Why:** `vite-plugin-pwa` má `manifest.icons: []` (TODO). Lighthouse PWA fail, žádný install prompt. „PWA od MVP" v ADR-013 porušeno.
- **Files:**
  - `client/public/icons/icon-192.png` (nový — 192×192)
  - `client/public/icons/icon-512.png` (nový — 512×512)
  - `client/public/icons/icon-maskable-512.png` (nový — maskable padding)
  - `client/vite.config.ts` (přidej icons array)
- **What:**
  1. Ikony: placeholder z slovanského symbolu (např. perun symbol jednoduché siluetě), CC0 generovaný nebo PixelLab.
  2. Manifest: `name: 'Irij'`, `short_name: 'Irij'`, `display: 'standalone'`, `theme_color: '#1a1410'` (atmosféra paleta), `background_color: '#0a0807'`, `lang: 'cs'`, `start_url: '/'`, `scope: '/'`, `icons: [192, 512, maskable-512]`.
- **Verify:** Lighthouse PWA audit ≥90, "Install" prompt v Chrome desktop.
- **Effort:** ~2 h (vč. ikon).

### E2 — `CharacterCreationScene` mobilní vstup (P0)

- **Source:** Frontend/UX, Mobile/PWA.
- **Why:** Scéna poslouchá pouze Phaser `keydown`. Na mobilu hráč fyzickou klávesnici nemá, Phaser ji neopen-ne → **char creation na mobilu nepoužitelná**.
- **Files:**
  - `client/src/scenes/CharacterCreationScene.ts`
  - `client/src/ui/dom-overlay.ts` (nový — helper pro DOM overlay nad Phaser canvas)
- **What:**
  1. DOM `<input>` overlay (HTML element pozicovaný nad canvas absolutním stylem) pro `username` + `display_name`.
  2. Toggle buttons (gender, hair, skin, outfit) — DOM `<button>` s touch-friendly hit targets ≥44 px.
  3. Phaser keydown listener zachovej pro desktop.
- **Verify:** Playwright mobile emulation (iPhone 13 viewport): vyrob postavu bez fyzické klávesnice.
- **Effort:** ~3 h.

### E3 — i18n bootstrap + cs.json (P0 — posunuto z Phase 17)

- **Source:** i18n, Frontend/UX, Engineering Director.
- **Why:** i18next + detector v `package.json` ale nikde import. Phase 17 plánuje setup po Phases 5-16 = po Phases bude 300+ hardcoded CS stringů místo dnešních ~30. ADR-016 ("od dne 1") porušený.
- **Files:**
  - `client/src/i18n.ts` (nový — i18next init)
  - `client/src/locales/cs.json` (nový — extrahované stringy z LoginScene + CharacterCreationScene)
  - `client/src/locales/en.json` (nový — placeholder + 5 prioritních stringů přeložených, zbytek `__MISSING__`)
  - `client/src/main.ts` (init před Phaser game start)
  - `client/src/scenes/LoginScene.ts`, `CharacterCreationScene.ts` (replace hardcoded → `t()`)
  - `client/package.json` (přidej `i18next-icu` pro ICU plurals)
- **What:**
  1. `i18n.ts`: `i18next.use(LanguageDetector).use(ICU).init({ fallbackLng: 'cs', resources: { cs, en } })`.
  2. Extrahuj všechny user-facing stringy z LoginScene + CharacterCreationScene (~30 stringů).
  3. `t()` wrapper použít všude. Pluralizace přes ICU MessageFormat.
  4. CI lint (later): script kontroluje, že cs.json a en.json mají stejné klíče.
- **Verify:** `?lng=en` query param nebo `localStorage` switch ukáže EN. Manual test.
- **Effort:** ~4 h.

### E4 — Loading PreloadScene + reconnect overlay (P1)

- **Source:** Frontend/UX, Phaser specialist, Networking.
- **Why:** Assety se načítají až ve `WorldScene.preload()` → hard pop. `socket.ondisconnect` skočí rovnou na LoginScene → hráč ztratí session bez vysvětlení.
- **Files:**
  - `client/src/scenes/PreloadScene.ts` (nový — progress bar pro tilemap + sprites)
  - `client/src/main.ts` (Boot → Preload → Login → ...)
  - `client/src/nakama.ts` (reconnect logika s exponential backoff, max 5 pokusů)
  - `client/src/ui/reconnect-overlay.ts` (nový — DOM overlay "Reconnecting...")
- **What:**
  1. PreloadScene s progress barem, načte tilemap + tileset + character sprite.
  2. Reconnect: detekce `ondisconnect`, overlay s countdownem, retry. Pokud max retries → fallback Login.
- **Verify:** Playwright: kill backend → ověř overlay → restart backend → ověř reconnect success.
- **Effort:** ~3 h.

### E5 — Viewport meta + safe-area-inset (P1)

- **Source:** Frontend/UX, Mobile/PWA.
- **Why:** `user-scalable=no` ve viewport meta = WCAG 2.5.5 a11y regrese. iOS notch řeže HUD bez safe-area-inset.
- **Files:**
  - `client/index.html`
  - `client/src/scenes/WorldScene.ts` (HUD pozicování s `env(safe-area-inset-*)`)
- **What:** `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` (žádný `user-scalable=no`). HUD CSS/Phaser pozice respektuje safe-area.
- **Verify:** iPhone X+ emulace v Chrome devtools — HUD pod notchem.
- **Effort:** ~1 h.

### E6 — Phaser DPR resolution (P1)

- **Source:** Mobile/PWA, Phaser specialist.
- **Why:** Phaser nenastavuje `resolution: window.devicePixelRatio` → rozmazaný retina render na mobilu/HiDPI.
- **Files:** `client/src/main.ts` (Phaser config)
- **What:** `resolution: Math.min(window.devicePixelRatio || 1, 2)` (cap na 2× pro perf).
- **Verify:** Retina screen render ostrost.
- **Effort:** 15 min.

---

## Sekce F — Networking polish (před Phase 6)

### F1 — RTT / clock sync foundation (P1)

- **Source:** Networking.
- **Why:** `SERVER_TICK` opcode rezervovaný ale nepoužitý. Klient lerpuje vždy ~RTT/2 za serverem. Bez RTT measurement nemůžeš ladit lerp duration ani diagnostikovat lag.
- **Files:**
  - `shared/src/messages/opcodes.ts` (využij `SERVER_TICK` rezervovaný opcode)
  - `server/src/match/world.ts` (broadcast `SERVER_TICK` 1 Hz s server timestamp)
  - `client/src/scenes/WorldScene.ts` (track RTT z ping/pong, expose v debug HUD)
- **What:** Server posílá `{server_time_ms}` 1× za sekundu. Klient drží rolling avg RTT, používá pro lerp duration adjustment + debug HUD.
- **Verify:** debug HUD ukáže RTT v ms, snižuj přes localhost vs throttled 4G profil.
- **Effort:** ~2 h.

### F2 — AOI radius redukce (P1)

- **Source:** Networking.
- **Why:** `CHUNK_SIZE_TILES=64` na 50×50 mapě = 3×3 okolí pokrývá celý svět. Na 256×256 MVP mapě = ~56 % recipientů. Před prvním load testem snížit.
- **Files:** `shared/src/constants/index.ts` (`CHUNK_SIZE_TILES`, `BROADCAST_CHUNK_RADIUS`)
- **What:** Změř a snížit na realistic AOI: `CHUNK_SIZE_TILES=16`, `BROADCAST_CHUNK_RADIUS=2` (= 5×5 chunků = 80×80 tiles okolí). Update unit testů.
- **Verify:** Manuální 2-tab test (oba v rámci AOI = vidí, mimo = nevidí).
- **Effort:** ~1.5 h.

### F3 — Generic rate-limiter modul (P1)

- **Source:** Networking, Security.
- **Why:** Movement má per-userId rate limit, ale chat/RPC budou potřebovat stejný pattern. Generický modul = šetří refactor.
- **Files:**
  - `server/src/lib/rate-limit.ts` (nový — sliding window per-key)
  - `server/src/match/movement.ts` (use)
  - příprava pro chat/RPC v Phase 16
- **What:** `RateLimiter(maxReq, windowMs)` třída/factory. Per-key sliding window (movement už má, extract).
- **Verify:** unit test (A2 už pokrývá movement; přidej generic test).
- **Effort:** ~1.5 h.

---

## Sekce G — Game design rozhodnutí (před Phase 6)

### G1 — Combat tick rate decision (P0 — needs Jakub call)

- **Source:** Game Designer, Mobile/PWA, Networking.
- **Why:** Plán 0.3-0.4 s. OSRS 0.6 s, Tibia 1 s, Highspell ~0.6 s. Mobile RTT 50-150 ms na 4G sežere 30-50 % tvého ticku, anti-cheat tick-skip detekce je peklo. Game Designer důrazně doporučuje 0.6 s.
- **Files:**
  - `shared/src/constants/index.ts` (`COMBAT_TICK_INTERVAL`)
  - `docs/04-tech-adr.md` (ADR doplnění s justifikací)
- **What:** **Rozhodnutí Jakuba:** 0.6 s (OSRS-tempo) nebo trvat na 0.3-0.4 s. Implementační agent **nemění**, dokud Jakub neodpoví.
- **Verify:** —
- **Effort:** N/A (rozhodnutí, ne kód).

### G2 — Sprite směr MVP cut: 4 iso místo 8 (P1)

- **Source:** Art Director.
- **Why:** ADR-020 sprite plán = 8 směrů × ≥4 framy idle/walk × N postavy ≈ ~6900 framů per character template. Nereálné pro sólo dev v Phase 18 polish.
- **Files:**
  - `docs/04-tech-adr.md` (update ADR-018 / ADR-020 sprite scope)
  - placeholder sprite refresh v Phase 6+ (ne teď)
- **What:** **Rozhodnutí Jakuba:** 4 iso směry (NE/NW/SE/SW) jako MVP, 8 směrů = post-MVP polish. Update ADR.
- **Verify:** —
- **Effort:** N/A (rozhodnutí + krátký ADR update).

### G3 — Druhý mob v Phase 6 scope (P1)

- **Source:** Game Designer.
- **Why:** "1 mob v MVP" nestačí — vlk samotný = 30 min content, druhý mob s ranged dropem testuje damage types + AI patterns.
- **Files:**
  - `docs/00-action-plan.md` (Phase 6 scope update)
  - `server/data/mobs.json` (Phase 6 implementační scope)
- **What:** Phase 6 scope = vlk + lesní strašidlo (ranged AI). Validuje combat damage types a anti-cheat na tick-skip.
- **Verify:** —
- **Effort:** N/A (scope decision; Phase 6 implementation effort ~1 extra den).

---

## Sekce H — Content & art pipeline (Phase 5 prep / Phase 18 prep)

### H1 — License audit `Isometric_tileset.zip` (P0)

- **Source:** Art Director.
- **Why:** ZIP v repu má restriktivní `License.txt`. Commit do public Git je distribution = potenciální IP issue.
- **Files:**
  - `Isometric_tileset.zip` (root)
  - `.gitignore` (přidej, nebo `git rm`)
- **What:**
  1. **Rozhodnutí Jakuba:** dohnat autora pro write permission, NEBO **odstranit z repu** + přepnout na Kenney Isometric Buildings/Landscape (CC0).
  2. Pokud remove: `git rm Isometric_tileset.zip`, doc v `12-art-director.md` citaci CC0 alternative.
- **Verify:** `git log Isometric_tileset.zip` ukazuje removal commit.
- **Effort:** ~30 min (decision + rm) nebo více (license negotiation).

### H2 — `docs/05-style-guide.md` foundation (P1)

- **Source:** Art Director, Game Designer.
- **Why:** Phase 18 plán "polish + style guide parallelně" = pozdě. Bez palety + reference angle + light direction lock před AI gen sessionem dostaneš 5 různých estetik.
- **Files:** `docs/05-style-guide.md` (nový)
- **What:** Core sections:
  - Paleta (hex codes, mood reference)
  - Iso angle lock (ADR-018 reference)
  - Light direction (např. NE light source, SW shadows)
  - Slovanský folklór moodboard (3-5 reference images, attribution)
  - Animation framerate baseline (Phase 6+ chars 8 framy walk per direction)
  - AI gen prompts template (Scenario / PixelLab konzistentní seed/style)
- **Verify:** doc exists + referencovaný z action planu.
- **Effort:** ~3 h.

### H3 — Pipeline lock: PixelLab + Scenario + Bfxr (P1)

- **Source:** Art Director.
- **Why:** Action plan zmínkuje "Scenario / PixelLab", ale nelokuje konkrétní role per asset typ. Konzistence trpí.
- **Files:** `docs/05-style-guide.md` (sekce „Tooling")
- **What:** PixelLab pro chars (8 directions support), Scenario pro props/tilesets, Bfxr+Freesound pro audio (ne ElevenLabs — overkill + cena), Aseprite pro manuální cleanup.
- **Verify:** doc.
- **Effort:** ~30 min.

---

## Sekce I — GTM foundation (TENTO TÝDEN)

### I1 — Brand lock: finální název (P0 — needs Jakub call)

- **Source:** Community/Marketing, Product.
- **Why:** "Irij" je pracovní název per CLAUDE.md/scope-and-pillars. Brand drift při launch = ztracená rok-marketingová investice.
- **What:** **Rozhodnutí Jakuba:** "Irij" zůstává nebo finální název nyní. Pokud nový → update CLAUDE.md, scope, README, package names, registrace domén.
- **Verify:** —
- **Effort:** N/A (decision).

### I2 — Coming-soon landing page na irij.cz (P0)

- **Source:** Community/Marketing.
- **Why:** Engineering jede, ale GTM stack = nula. Indie MMO žijí z komunity vybudované **před** launchem.
- **Files:** mimo repo (Cloudflare Pages / Netlify / static html v separátním repu)
- **What:**
  1. Single page: hero (slovanský folklór ilustrace), 1-paragraph pitch, "Closed alpha 2027 — sign up for updates" mailing list (Buttondown / ConvertKit free tier), Discord invite link.
  2. SEO meta tags, OG image.
- **Verify:** Lighthouse 95+, mailing list captures email.
- **Effort:** ~4 h.

### I3 — Discord komunita s 2 trusted mody (P0 — posunuto z Phase 22)

- **Source:** Community/Marketing.
- **Why:** Phase 22 Discord je 6+ měsíců pozdě. Highspell, Project Gorgon ukazují day-1 community advantage.
- **What:**
  1. Vytvoř Discord server (irij.cz/discord redirect).
  2. Channels: #general, #devlog, #suggestions, #screenshots, #bug-reports (skrytý do alfy), #cz-sk.
  3. 2 trusted mody (kámoši + AI bot pro spam).
  4. Welcome message + roadmap pinned.
- **Verify:** první 5 členů (kámoši + sám).
- **Effort:** ~2 h.

### I4 — Devlog cadence start od Phase 6 (P1)

- **Source:** Community/Marketing.
- **Why:** Bi-weekly YouTube devlog + týdenní Reddit screenshot je doporučená cadence pro indie MMO. ROI roste s kontinuitou.
- **What:** Po dokončení Phase 5 spusť 1× za 2 týdny YouTube krátké video (3-5 min progress) + týdenní r/MMORPG screenshot. Cross-post Discord.
- **Verify:** kalendář v Discord pinned.
- **Effort:** N/A (operational, spuštění po Phase 5).

---

## Sekce J — Process & governance

### J1 — Action plan reorder (P0)

- **Source:** Engineering Director, Product, i18n.
- **Why:** Konsenzus napříč rolemi: posunout věci vpřed, kde je riziko refaktoru později vyšší.
- **Files:**
  - `docs/00-action-plan.md`
  - `CLAUDE.md` (Stav line)
- **What:**
  1. Vlož "Phase 4.5 — Operational hardening" mezi Phase 4 a 5: A1+A2+A3+A4+A5+C1+C2+C3.
  2. Posuň i18n bootstrap (E3) z Phase 17 do Phase 5a.
  3. Brand+landing+Discord (I1+I2+I3) označ "do this week" s odkazem.
  4. Phase 18 explicitně rozděl na 18a (1 mapa + 5 NPC + 1 quest + 1 mob baseline) a 18b (zbytek = beta content).
- **Verify:** doc commit, action plan updates.
- **Effort:** ~1 h.

### J2 — Kill-switch / pivot kritérium po Phase 11 (P1)

- **Source:** Engineering Director, Product.
- **Why:** Risk checkpoint v action planu zmiňuje, ale není to akce. Naformuluj kritérium ochrany před sunk cost klamem.
- **Files:** `docs/00-action-plan.md` (sekce „Risk checkpoints" → konkretizuj „Kill switch")
- **What:** Po Phase 11 první lore quest:
  - Pokud po 30 min vlastním playtest cítíš nudu → pause + scope brainstorm.
  - Pokud Phase 5-11 trvalo > 4× původní odhad → re-evaluate timeline.
  - Pokud burnout > 2 týdny → fallback na "minimum playable" cut (Phases 0-11+14+16+21).
- **Verify:** doc.
- **Effort:** ~30 min.

### J3 — Timeline reality check + buffer (P1)

- **Source:** Engineering Director, Product.
- **Why:** 22 fází × 5-7 dnů × 3-4 h/den sólo = realisticky 2× plán = jaro/léto 2027 ke closed alpha. Plán neobsahuje buffer.
- **Files:** `docs/00-action-plan.md` (sekce „Tempo" + per-phase odhady)
- **What:** Aplikuj 2× safety buffer na všechny phase odhady. Update Stav v CLAUDE.md realistic odhadem alpha date. Definuj "minimum playable" fallback list jako pojistku.
- **Verify:** doc commit s update.
- **Effort:** ~30 min.

---

## Workflow

Doporučené pořadí (gating per Jakub):

1. **Tento týden:** I1 (brand decision), I2 (landing), I3 (Discord), J1 (action plan reorder), J3 (timeline reality), G1 (combat tick decision), G2 (sprite cut decision), H1 (license decision).
2. **Phase 4.5 (~5-7 dnů):** A1 → A2 → A4 → A3 → A5, C1 → C3 → C2, B3, B1, E1, E2.
3. **Phase 5 (s Phase 5 implementací):** B2 (split player_state) — splývá s autosave; D1, D2, D3, D5; E3 (i18n), E4 (Preload+Reconnect), E5, E6; H2, H3.
4. **Před Phase 6:** F1, F2, F3, C4, C5, D4; J2.
5. **Phase 6+:** dále per Phase scope action planu (s opravami a poznatky promítnutými do těchto fází).

---

## Pokyny pro implementačního agenta

- **Per item:** otevři PR s názvem `[remediation/<id>] <krátký popis>`, branch `dev/remediation-<id>`. Squash merge per CLAUDE.md.
- **Před začátkem každého P0 item:** confirm s Jakubem v komentáři (může být OK skipnuto pro triviální itemy s clear scope; ne pro decisions G1/G2/H1/I1).
- **Po dokončení:** update tento dokument (zaškrtnout `[x]` v frontmatter každého itemu — nepřidaný v této verzi, lze přidat při prvním execution passu) **NEBO** v `docs/00-action-plan.md` přidat poznámku do změnového logu.
- **Konflikty s existujícím kódem:** zastavit, popsat v PR komentáři, počkat na rozhodnutí.
- **Bookkeeping:** každý PR musí dokumentovat, kterou Sekci/ID řeší, link na zdrojový report (např. „Source: [04-nakama-specialist.md#riziko-1](04-nakama-specialist.md)").

---

**Source reports:** kompletní výchozí materiál v sourozeneckých souborech `01-engineering-director.md` až `17-community-marketing.md` ve stejné složce. Index v [README.md](README.md), executive summary v [00-EXECUTIVE-SUMMARY.md](00-EXECUTIVE-SUMMARY.md).
