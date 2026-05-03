# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projekt

**Irij** — browser MMORPG ve světě slovanského folklóru. Tick-based, 2D pixel art, **isometrický pohled** (2:1 dimetric, viz [docs/04 ADR-018](docs/04-tech-adr.md#adr-018-isometric-rendering--explicitní-engineering-kontrakt)). Phaser klient + Nakama server, sólo dev s AI asistencí. Cíl: ~100 CCU, EU latence, self-hostable.

**Stav:** Phase 0 ✓ (lokální stack běží), Phase 1 ✓ (guest auth + Boot → Login → World scene flow), Phase 2 ✓ (character creation — `rpc.profile.create_character` + `rpc.profile.get_self`, validace, init Player/Skills/Inventory blobů, klient CharacterCreationScene), Phase 3 ✓ (isometric mapa 50×50 + render projection/ysort util per ADR-018, postava se renderuje na crossroads (25,25) s camera follow, Phaser Scale.RESIZE), Phase 4 ✓ (server-authoritative movement — match join + presences + walkable mask, MOVE_REQUEST → A* + nearest-walkable BFS fallback → ENTITY_MOVED broadcast 10 Hz, klient click-to-move + 100 ms tween interpolace + render ostatních hráčů z WORLD_SNAPSHOT/ENTITY_SPAWNED/DESPAWNED, MOVE_REJECTED toast). Další: **Phase 5** (persistence — autosave každých 30 s + spawn-na-poslední-pozici po re-login) — viz [docs/00-action-plan.md](docs/00-action-plan.md). Většina RPC mimo profile / world.find_or_create_match je stále TODO scaffolding.

**Render konvence:** logický grid je ortogonální `(x, y)` v tiles — server, pathfinding, collision pracují čistě ve world-space. Isometric je čistě klient render projection (2:1 dimetric, screen footprint 64×32 px, projekce v `client/src/render/projection.ts`, Y-sort depth helper v `client/src/render/ysort.ts` — viz ADR-018). Žádný server kód nesmí pracovat s pixel/screen souřadnicemi.

## Repo layout

Monorepo (pnpm workspaces) — tři balíčky a sdílené moduly:

- [client/](client/) — Phaser 3 + Vite + TypeScript klient, importuje `irij-shared`
- [server/](server/) — Nakama TypeScript runtime modul, esbuild bundle do IIFE
- [shared/](shared/) — sdílené types, opcodes, constants. Re-exporty: `irij-shared`, `irij-shared/types`, `irij-shared/messages`, `irij-shared/constants`. Používá `"main": "./src/index.ts"` (žádný build, konzumenti čtou TS přímo)
- [infra/](infra/) — `docker-compose.yml` (Postgres 16 + Nakama 3.38) a `nakama/local.yml`
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

[server/build.js](server/build.js) bundluje `src/main.ts` esbuildem do IIFE (`format: 'iife'`, `globalName: '__irij_server'`, `platform: 'neutral'`, external `nakama-runtime`) a **post-build krokem strip-uje IIFE wrapper**, takže ve výsledném `dist/index.js` je všechno na top-level scope. Nakama Goja runtime potřebuje `function InitModule(...)` jako top-level FunctionDeclaration — schovaná uvnitř IIFE closure ji nenajde a server crashne s `failed to find InitModule function`. Nepřepisuj ten unwrap krok bez ověření, že runtime modul stále načítá.

### TypeScript config

Workspace dědí z [tsconfig.base.json](tsconfig.base.json): `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `moduleResolution: Bundler`, ESM. Imports uvnitř balíčků používají `.js` extensions (ESM convention) i pro `.ts` soubory.

## Workflow při nových featurech

Action plan v [docs/00-action-plan.md](docs/00-action-plan.md) definuje fázování. Než přidáš novou feature:

1. Najdi odpovídající fázi v action planu — pořadí má důvod (auth před char creation před movement před combat).
2. Pro game logic ověř pravidla v `docs/02a-e` (postava / itemy / svět / NPC-mobi-questy / ekonomika) — constraints sekce každého dokumentu.
3. Pro nové síťové zprávy přidej opcode do `shared/src/messages/opcodes.ts` ve správném číselném rozsahu, payload type do `shared/src/messages/`, a teprve pak implementuj klient + server stranu.
4. RPC handlery patří do `server/src/rpc/{auth,profile,...}.ts` jako **pojmenované exportované funkce** (`export function authPing(...)`, ne arrow). V `server/src/main.ts` se přivážou **přímo v body `InitModule`**: `initializer.registerRpc('rpc.auth.ping', authPing)`. Match handlery v `server/src/match/*.ts` jsou taktéž top-level named functions; registrace přes object s shorthand property references (`initializer.registerMatch('world', { matchInit, matchJoin, ... })`). **Nikdy** nepoužívej helper-funkce typu `registerAuthRpcs(initializer)` ani method shorthand v object literal — Nakama Goja runtime parsuje `InitModule` AST a extrahuje handler identifikátory pouze z výrazů přímo v jeho body, neprochází do helperů a function-literal property values odmítá.

## Git workflow

**Žádné direct commity do `main`.** Každá změna jde přes feature branch + PR + squash merge.

1. **Branch naming (MVP fáze):** `dev/phase-X` nebo `dev/phase-X-stručný-popis` (např. `dev/phase-2-character-creation`). Jedna branch = jeden PR = jedna fáze nebo její sub-task. Po MVP přejdeme na klasické `feat/...` a `fix/...` (bug-fix), ale dokud action plan jede po fázích, držíme `dev/phase-X` konvenci, protože je čitelná v listu PRs i `git log`.
2. **Commit message:** `feat(phase-X): krátký popis` (nebo `docs(...)`, `fix(...)` pokud relevantní). Tělo commitu popisuje WHY a klíčové změny — viz `git log` pro vzor. Vždy přidej `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (nebo aktuálně použitý model).
3. **Merge style: VŽDY `--squash`** — `gh pr merge <num> --squash --delete-branch`. Drží to lineární historii bez merge commitů. Ano, znamená to, že feature branch v `git log` po merge nezůstane jako separátní linea (žádný „Merge pull request #X" commit), ale je to záměr — jeden squashed commit = jedna fáze. **Neudělej `--merge` ani `--rebase`** kvůli konzistenci. (PRs #1–#5 byly merge commity z dřívější doby; od PR #6 jedeme squash.)
4. **Merge + návrat na main je součást tvé práce, ne uživatelovy.** Jakmile uživatel řekne „mergni" / „pošli to" / „je to OK" (nebo ekvivalent), provedeš celý handoff sám: `gh pr merge <num> --squash --delete-branch` → `git checkout main` → `git pull`. Neukončuj turn s instrukcí "teď to zmergeš ty" — to je drift, který už uživatel jednou musel opravit. Výjimka: pokud PR čeká na review od jiného člověka nebo CI, čekej; jinak zavři smyčku.
5. **Bookkeeping (Stav line, action plan checkboxy, changelog) patří do stejného PR**, ne do follow-up — viz sekce níže.
6. **Real-browser smoke test** před handoffem na člověka pro klient/UI/shared změny (Vite + Playwright, bez console errors, projít golden path). Typecheck + curl/Node skript nestačí.

## Bookkeeping po dokončení práce

Project state je trackovaný v repu (action plan checkboxy + CLAUDE.md Stav line + git log), **ne v memory**. Memory systém (`~/.claude/projects/.../memory/`) je pro cross-session fakta o uživateli a preferencích, ne pro stav projektu.

**Když mergeš PR, který dokončí celou fázi** z [docs/00-action-plan.md](docs/00-action-plan.md) (= všechny task-checkboxy té fáze jsou splněné):

1. Flipni všechny `[ ]` → `[x]` u dané fáze v action planu
2. Updatuj řádek `**Stav:**` na začátku tohoto souboru (co je hotové, co je další)
3. Přidej entry do sekce „Změnový log" na konci action planu (datum + co se dokončilo + odkaz na PR čísla)
4. Pokud PR přidává/mění ADR, doplň také changelog na konci [docs/04-tech-adr.md](docs/04-tech-adr.md)

**Když mergeš PR, který dokončí jednotlivý task uprostřed fáze:** stačí flipnout daný checkbox v action planu. Stav line a changelog netřeba.

**Tyto updaty patří do stejného PR jako práce sama**, ne do separátního follow-up PR. Drift se tím nenahromadí a fresh session s "pokračuj" vidí aktuální stav v prvním přečteném souboru (CLAUDE.md je auto-loaded, action plan je hned referencovaný).

## Co v repu zatím **není** (a neměl bys to vymýšlet)

- Žádný lint runner ani test framework — `pnpm lint`/`pnpm test` jsou prázdné scripty.
- Žádné CI, žádný deployment script.
- Žádná Postgres migrace ani SQL — `migrations/` je prázdný adresář.
- Většina match logiky, RPC a klient scén je TODO scaffolding — nehledej "kde je combat resolver", neexistuje.
