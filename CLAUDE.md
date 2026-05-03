# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projekt

**Irij** — browser MMORPG ve světě slovanského folklóru. Tick-based, 2D pixel art. Phaser klient + Nakama server, sólo dev s AI asistencí. Cíl: ~100 CCU, EU latence, self-hostable.

**Stav:** raná fáze (Phase 0/1 dle [docs/00-action-plan.md](docs/00-action-plan.md)). Většina match handleru, RPC a klientských scén je TODO scaffolding.

## Repo layout

Monorepo (pnpm workspaces) — tři balíčky a sdílené moduly:

- [client/](client/) — Phaser 3 + Vite + TypeScript klient, importuje `irij-shared`
- [server/](server/) — Nakama TypeScript runtime modul, esbuild bundle do IIFE
- [shared/](shared/) — sdílené types, opcodes, constants. Re-exporty: `irij-shared`, `irij-shared/types`, `irij-shared/messages`, `irij-shared/constants`. Používá `"main": "./src/index.ts"` (žádný build, konzumenti čtou TS přímo)
- [infra/](infra/) — `docker-compose.yml` (Postgres 16 + Nakama 3.24) a `nakama/local.yml`
- [migrations/](migrations/) — SQL migrace (golang-migrate, zatím prázdné)
- [docs/](docs/) — designové dokumenty 00–04 a `refs/`. **Vždy je čti, než budeš dělat netriviální změny** — definují data model, message katalog a tech ADRs

## Klíčové příkazy

```bash
pnpm install                # nainstaluje workspace
pnpm infra:up               # Postgres + Nakama přes Docker (vyžaduje předchozí build:server)
pnpm infra:down
pnpm infra:logs

pnpm build:shared           # tsc --noEmit (pouze typecheck — shared se nebuilduje)
pnpm build:server           # esbuild bundle → server/dist/index.js (Nakama mountuje read-only)
pnpm build:client           # tsc --noEmit && vite build
pnpm build                  # všechno v pořadí: shared → server → client

pnpm dev:client             # Vite dev na http://localhost:5173
pnpm --filter irij-server watch   # esbuild --watch pro server modul

pnpm typecheck              # rekurzivně přes všechny balíčky
pnpm lint                   # rekurzivně (zatím nikde implementováno)
pnpm test                   # rekurzivně (zatím nikde implementováno)
```

**Důležitá past (z [docs/00-action-plan.md](docs/00-action-plan.md)):** Nakama runtime hledá `index.js` v `/nakama/data/modules`, mountnuto z `server/dist/`. Pokud není buildnutý server **před** `pnpm infra:up`, runtime modul se nezaregistruje. Sekvence: `build:server` → `infra:up`.

Nakama porty: `7349` gRPC, `7350` HTTP/WS API, `7351` console (admin/password z `infra/nakama/local.yml`).

## Architektura — co je nutné znát

### Server-authoritative everything (ADR-006)

Klient pouze _navrhuje_ akce a interpoluje/predikuje pro UX. Server validuje každý vstup proti pravidlům z `docs/02a-e` a broadcastuje výsledek. Nikdy nepiš logiku, kde klient autoritativně mění stav.

### Tickrate model (ADR-007, [shared/src/constants/index.ts](shared/src/constants/index.ts))

Master tick = **10 Hz** (`TICK_HZ`). Vše ostatní jsou násobky pomocí counterů v `match_loop`:

- `COMBAT_TICK_INTERVAL = 3` (~330 ms)
- `AI_TICK_INTERVAL = 5` (500 ms)
- `RESOURCE_RESPAWN_CHECK_INTERVAL = 150` (15 s)
- `PLAYER_AUTOSAVE_INTERVAL = 300` (30 s)
- `JOB_BOARD_GENERATION_INTERVAL = 18000` (30 min)

Nikdy nezakládej druhý match handler jen kvůli jiné frekvenci — counter v existujícím loopu.

### Single match, chunk-cluster ready (ADR-005)

MVP používá jediný match `world.main` ([server/src/match/world.ts](server/src/match/world.ts)). Kód musí být strukturovaný **jako kdyby** byly chunky samostatné matche — žádné globální iterace nad celým světem, vždy spatial lookup přes chunk index. Post-MVP rozdělení 4×4 chunků = 1 match nesmí vyžadovat přepis game logiky.

### Hybrid storage (ADR-004)

| Data                                                    | Storage                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| Player, Skills, Inventory, Equipment, Bank              | Nakama Storage Engine (per-player JSON blobs)                    |
| World data (mob spawns, listings, job board), audit log | Postgres tabulky **přímo** (cross-player queries, `migrations/`) |
| Static catalogs (`items.json`, `recipes.json`, ...)     | Read-only soubory v repu, in-memory cache                        |
| Map chunky                                              | Static files servírované z CDN                                   |

Připojujeme se na _stejný_ Postgres jako Nakama, ale ve vlastním schématu. Žádný Redis (overkill pro 100 CCU).

### Sdílené typy a opcodes

[shared/src/messages/opcodes.ts](shared/src/messages/opcodes.ts) je single source of truth pro Match Data opcodes (číselné rozsahy 1–119, group-by-feature). Klient i server musí importovat odsud — nikdy neduplikovat hodnoty. Payloady patří do `shared/src/messages/`, types do `shared/src/types/`. Plný katalog viz [docs/03-message-katalog.md](docs/03-message-katalog.md).

### Server bundle pattern

[server/build.js](server/build.js) bundluje `src/main.ts` esbuildem do **IIFE** (`format: 'iife'`, `globalName: 'irij_server'`, `platform: 'neutral'`, external `nakama-runtime`). Nakama TS runtime hledá globální `InitModule` symbol — viz hack na konci [server/src/main.ts](server/src/main.ts) (`!InitModule && InitModule.bind(null)`). Nepřepisuj ten pattern bez ověření, že runtime stále načítá modul.

### TypeScript config

Workspace dědí z [tsconfig.base.json](tsconfig.base.json): `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `moduleResolution: Bundler`, ESM. Imports uvnitř balíčků používají `.js` extensions (ESM convention) i pro `.ts` soubory.

## Workflow při nových featurech

Action plan v [docs/00-action-plan.md](docs/00-action-plan.md) definuje fázování. Než přidáš novou feature:

1. Najdi odpovídající fázi v action planu — pořadí má důvod (auth před char creation před movement před combat).
2. Pro game logic ověř pravidla v `docs/02a-e` (postava / itemy / svět / NPC-mobi-questy / ekonomika) — constraints sekce každého dokumentu.
3. Pro nové síťové zprávy přidej opcode do `shared/src/messages/opcodes.ts` ve správném číselném rozsahu, payload type do `shared/src/messages/`, a teprve pak implementuj klient + server stranu.
4. RPC patří do `server/src/rpc/{auth,profile,...}.ts` a registrují se z `server/src/main.ts` přes `registerXxxRpcs(initializer)`.

## Co v repu zatím **není** (a neměl bys to vymýšlet)

- Žádný lint runner ani test framework — `pnpm lint`/`pnpm test` jsou prázdné scripty.
- Žádné CI, žádný deployment script.
- Žádná Postgres migrace ani SQL — `migrations/` je prázdný adresář.
- Většina match logiky, RPC a klient scén je TODO scaffolding — nehledej "kde je combat resolver", neexistuje.
