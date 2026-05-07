# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projekt

**Irij** — browser MMORPG ve světě slovanského folklóru. Tick-based, 2D pixel art, **isometrický pohled** (2:1 dimetric, viz [docs/04 ADR-018](docs/04-tech-adr.md#adr-018-isometric-rendering--explicitní-engineering-kontrakt)). Phaser klient + Nakama server, sólo dev s AI asistencí. Cíl: ~100 CCU, EU latence, self-hostable.

**Stav:** Phase 0 ✓ (lokální stack běží), Phase 1 ✓ (guest auth + Boot → Login → World scene flow), Phase 2 ✓ (character creation — `rpc.profile.create_character` + `rpc.profile.get_self`, validace, init Player/Skills/Inventory blobů, klient CharacterCreationScene), Phase 3 ✓ (isometric mapa 50×50 + render projection/ysort util per ADR-018, postava se renderuje na crossroads (25,25) s camera follow, Phaser Scale.RESIZE), Phase 4 ✓ (server-authoritative movement — match join + presences + walkable mask, MOVE_REQUEST → A* + nearest-walkable BFS fallback → ENTITY_MOVED broadcast 10 Hz, klient click-to-move + 100 ms tween interpolace + render ostatních hráčů z WORLD_SNAPSHOT/ENTITY_SPAWNED/DESPAWNED, MOVE_REJECTED toast), **Phase 4.5 ✓** (operational hardening — CI workflow GitHub Actions, Vitest 47 testů na pathfinding/walkable/movement, secrets hygiene `local.dev.yml` + prod template, backup/restore skripty + runbook, audit log foundation `irij.audit_log` + golang-migrate runner, Playwright golden path smoke test), **Phase 5 ✓** (persistence — `autosave.ts` batched flush každých 30 s v matchLoop + final flush s `last_logout_at` v matchLeave/matchTerminate, `matchJoin` spawnuje na `player_state.current_position`, 10 unit testů + Playwright `persistence.spec.ts`). **Phase 6 ✓** (první mob + combat — `server/data/mobs.json` vlk + obří krysa, `server/src/match/ai.ts` AI state machine idle→chase→attack→leash_return→dead, `server/src/match/combat.ts` ATTACK_REQUEST handler + combat tick 600 ms + loot roll + mob death/respawn, klient click-to-attack + HP bary + floating damage text + mob/drop sprite rendering, 10 nových unit testů). **Phase 7 ✓** (inventář + equipment — `server/data/items.json` 20 itemů, `server/src/lib/items.ts` catalog, `server/src/match/inventory.ts` handlery pro INTERACT_OBJECT/EQUIP/UNEQUIP/ITEM_USE/ITEM_DROP + holster auto-pull + OCC retry, klient `InventoryPanel` + `EquipmentPanel` DOM overlay + player weapon tint, 17 nových unit testů + Playwright `inventory.spec.ts`). **Phase 8 ✓** (XP + skilly — `shared/src/skills/xp.ts` RSC-style exponential curve (lvl 99 ≈ 9M XP), `shared/src/skills/award.ts` `distributeXpAward` s diminishing returns (softcap lvl 60 → 0.2× factor) + per-(atribut, source_skill) tracking, server `server/src/match/xp.ts` `awardXp` napojen v `handleMobDeath` s write-through PLAYER_SKILLS storage, opcodes XP_AWARDED + LEVEL_UP, klient `SkillPanel` DOM overlay [K] + XP_AWARDED/LEVEL_UP toasty s lokalizovanými názvy, 20 nových unit testů + Playwright `skills.spec.ts`). **Phase 9 ✓** (první NPC + dialog — `server/data/npcs.json` Starý Kovář (27,25) + Selka, `server/data/dialogs/{kovar_blatiny,selka}.json` dialog trees s `{ cs, en }` lokalizovanou strukturou + give_item efektem na "Co máš na prodej?" option, `server/src/match/dialog.ts` `handleInteractNpc` + `handleDialogChoose` + `handleDialogCloseRequest` s per-player `dialogSessions` anti-cheat + Chebyshev ≤ 2 range re-check + 5/s rate limit, dialog effects `give_item` / `take_item` / `deduct_currency` / `add_currency` přes OCC retry na PLAYER_INVENTORY (ostatní `unlock_knowledge`/`change_reputation`/`start_quest`/`complete_quest_step` jsou Phase 11+ stub s audit log), `server/src/lib/dialogs.ts` static catalog loader, opcodes INTERACT_NPC=30 / DIALOG_OPEN=110 / DIALOG_CHOOSE=111 / DIALOG_CLOSE=112 wired do matchLoop dispatch, NPC entity v WORLD_SNAPSHOT + chunk index, klient `DialogPanel` DOM overlay (speaker emoji portrait + text + clickable option buttons) + ESC zavírá + click-to-talk priority před movement, `EntityManager.spawnNpc` placeholder character sprite s per-NPC tint (kovář amber, selka pale lime), 21 nových server unit testů (parse handlers + option visibility + catalog integrity) + Playwright `dialog.spec.ts`. Celkem 121 server + 71 shared = 192 testů. **Phase 10 ✓** (gathering + crafting — `server/data/resource_nodes.json` 5 nodes (3× kámen → 10× pazourek, 1× měděná žíla → 3× ruda, 1× dub → 2× dřevo) + `server/data/craft_stations.json` smith_forge u kováře (26,25) + `server/data/recipes.json` 3 standardní recepty (brusek smithing 1, bronzová dýka smithing 1, bronzový meč smithing 5) všechny smith_forge + tool.hammer, doplněny itemy `material.stone.flint` + `tool.pickaxe.bronze` + `tool.axe.bronze`, `shared/src/skills/rarity.ts` `rollCraftedRarity` (T1 95/5/0, T2 85/13/2, T3 70/25/5, T4 50/35/15) + `rollCraftFail`, `shared/src/types/gathering.ts` (`ResourceNodeDefinition` + `CraftStationDefinition`), opcodes GATHER_RESOURCE=32 / GATHER_PROGRESS=33 / GATHER_COMPLETED=34 / CRAFT_REQUEST=80 / CRAFT_PROGRESS=81 / CRAFT_COMPLETED=82, `server/src/lib/recipes.ts` static catalog loader, `server/src/match/gathering.ts` (`handleGatherResource` rate limit 5/s + Chebyshev ≤ 2 + tool inventory check + skill level gate; `advanceGatherSessions` per-tick range re-check + 500 ms progress broadcasts + completion → OCC inventory add + ENTITY_DESPAWNED + GATHER_COMPLETED + XP přes existující `awardXp`; `checkResourceNodeRespawns` 15 s tick → ENTITY_SPAWNED), `server/src/match/crafting.ts` (`handleCraftRequest` rate limit 5/s + recipe lookup + prerequisites validation: skill level + tool + station proximity ≤ 2 + inputs + free output capacity, MAX_CRAFT_BATCH=50; `advanceCraftSessions` per-cycle station re-check + progress broadcasts + cycle completion: re-validate + OCC consume inputs + roll fail/rarity + add output + XP, decrement remainingCycles → start next cycle nebo batch_done), MOVE_REQUEST success ruší jakoukoli probíhající gather/craft session, klient `CraftingPanel` DOM overlay (toggle [C] nebo HUD button, recipe rows s 1×/5×/30× tlačítky + status řádek) + `GatherProgressBar` floating overlay + `EntityManager.spawnResourceNode` / `spawnCraftStation` placeholder shapes + click-to-gather/click-to-craft-station approach pattern v `WorldScene`, 23 nových unit testů (rarity 11× / gather 9× / craft 12×) + Playwright `gathering.spec.ts`). **Phase 11 ✓** (první quest — `shared/src/types/quest.ts` (`QuestDefinition` + 3 objective types `talk_to_npc`/`kill_mob`/`interact_with_object` + `PlayerQuestBlob` mirror s active/completed/knowledge/reputation maps + `emptyQuestBlob` factory + narrowing helper `asPlayerQuestBlob`), `shared/src/messages/quest.ts` (QUEST_PROGRESS event 'started'/'advanced' + QUEST_COMPLETED s reward summary), `DialogOptionVisibility.reputation_min` přejmenováno na `{ village_id, value }` + `quest_state.current_step_id?` / `not_current_step_id?` pro fine-grained visibility checks, nová `STORAGE_COLLECTIONS.PLAYER_QUESTS` collection + `quest_object` entity type s `quest_object_id` field, `InteractObjectRequest.action` enum rozšířen o `'interact'`. Server data: `server/data/quests/synovec_kovar.json` (lore quest "Synovec Starého Kováře" — 3 kroky: find_clue_in_swamp na object.bloody_amulet → defeat_hastrman 1× → return_to_kovar dialog node; rewards xp 1500 melee + 300 thievery + 200 vitality, weapon.melee.sword.bronze, 250 denárů, knowledge lore.polednice_origin, reputation village.blatiny +200, lockout_after_complete=true), `server/data/quest_objects.json` (krvavý amulet (38,38)), `mob.hastrman` lvl 8 HP 45 + spawn (40,40) + `loot.hastrman`, kovář dialog rozšířen o 4 nové větve demonstrující všechny show_if brány (quest_offer/in_progress/complete/lore_after). Server: `server/src/lib/quests.ts` static catalog, `server/src/match/quest.ts` engine — `loadPlayerQuestBlob` lazy create, `tryStartQuest` s prerequisites, `progressObjective` discriminated dispatcher s automatic step advance, `completeQuest` s reward distribution: XP přes `awardXp` source='quest', items+denáry přes OCC retry na PLAYER_INVENTORY, knowledge dedup, reputation clamp 1000 max, blob persist přes OCC retry, broadcast QUEST_PROGRESS/QUEST_COMPLETED unicast, `unlockKnowledge` idempotent + `changeReputation` clamp + `checkOptionVisibility` pure gate evaluator. `server/src/match/state.ts` rozšířen o `QuestObjectInstanceState` + chunk index helpers + `playerQuestBlobs` mirror + `playerQuestVersions` cache. `dialog.ts` `isOptionVisible(option, state, userId)` plně evaluuje show_if; `applyDialogEffect` implementuje `unlock_knowledge`/`change_reputation`/`start_quest` (broadcast QUEST_PROGRESS event='started')/`complete_quest_step` (delegate na progressObjective). `inventory.ts` INTERACT_OBJECT branch `action='interact'` → `handleQuestObjectInteract` (Chebyshev ≤ 2 + propagace na progressObjective; MVP: globálně viditelný objekt, opakovaný interact je no-op idempotentně, per-player consume_on_interact je odsunut na Phase 12+). `combat.ts` po awardXp v `handleMobDeath` volá progressObjective(type:kill_mob). `world.ts` matchInit načítá quest_objects, matchJoin volá loadPlayerQuestBlob + sendActiveQuestsSnapshot, WORLD_SNAPSHOT zahrnuje quest objekty (3×3 chunk + ne-consumed filter), matchLeave čistí quest mirror. `profile.ts` inicializuje empty PlayerQuestBlob při char create. Klient: `client/src/ui/QuestPanel.ts` DOM overlay (toggle [Q] — aktivní questy s title + step description + kill_mob counter, deník dokončených s ✓, vždy re-render i pokud hidden), `EntityManager.spawnQuestObject` placeholder magenta hvězda + label, `WorldScene` napojení (QUEST_PROGRESS dispatch + 'started' toast, QUEST_COMPLETED dispatch + reward toasty (denáry + knowledge unlocks), click-to-interact flow s `tickQuestObjectApproach` analogický gather/NPC approach, click priority quest_object > mob > drop > move). 14 nových quest engine unit testů + 11 doplněných dialog `checkOptionVisibility` testů + Playwright `quest.spec.ts` (full flow: kovář dialog → start_quest → quest log update → MOVE_REQUEST k amuletu → INTERACT_OBJECT → step advanced na Hastrman). Celkem 79 shared + 165 server testů + 8 Playwright smoke. **Phase 12 ✓** (job board MVP — `server/data/job_board_templates.json` 5 templates pro `village.blatiny` (3× deliver_item: kosti×5 / pazourek×8 / dub×4, 2× kill_mob: krysy×3 / vlci×2) všechny issued+delivered to Selka, `shared/src/types/jobBoard.ts` (`JobBoardObjectiveDefinition` discriminated kill_mob/deliver_item, `JobBoardTaskTemplate` + runtime `JobBoardTask`, `PlayerJobBoardEntry` + `CompletedJobEntry`), `shared/src/messages/jobBoard.ts` 4 nové opcodes 66-69 + 4 stávající 62-65 (JOB_TASK_TAKEN/PROGRESS/COMPLETED/BOARD_UPDATED + JOB_BOARD_OPEN_REQUEST/OPEN/JOB_TASK_SUBMIT/ABANDON), `DialogEffect` doplněn o `open_job_board { village_id }`, `XpAwarded.source` rozšířen o `'job'`, `PlayerQuestBlob` rozšířen o `jobs` + `jobs_completed` mapy s backward-compat narrowing v `asPlayerQuestBlob`. Server: `server/src/lib/jobBoardTemplates.ts` static catalog (per-village index), `server/src/match/jobBoard.ts` engine — `seedInitialJobBoard` v matchInit + `runJobBoardGenerationTick` každých `JOB_BOARD_GENERATION_INTERVAL=18000` (30 min) s aging multiplier (5 min → 1.2× / 15 min → 1.5× / 30 min → 2.0× — MVP zkrácené z docs hodnot 24h/48h/5d) + expirace 60 min bez takerů + refill do `POOL_TARGET_SIZE=5`, `handleJobBoardOpenRequest` (range ≤ 2 k issuer NPC), `sendJobBoardOpen` volaná z dialog effectu, `handleJobTaskTaken` (max_concurrent_takers gate + range + per-player blob persist), `progressJobObjectivesKillMob` napojen v `combat.handleMobDeath` po quest progress (capuje progress na count, broadcast unicast JOB_TASK_PROGRESS), `handleJobTaskSubmit` (range k deliver_to NPC, kill_mob progress re-check / deliver_item OCC inventory deduct, reward distribuce přes `awardXp` source='job' + currency add + reputation clamp 1000, fulfilled_count++ s expirací při fulfilled_max), `handleJobTaskAbandon`. `state.ts` rozšířen o `jobBoardTasks` + `jobBoardTasksByVillage` + `jobBoardCounter`. `world.ts` matchJoin re-attachne taker_user_ids ze blobu (po reconnect), matchLeave uvolní sloty (current_takers reflektuje connected hráče, persistovaný entry zůstává). Selka dialog rozšířen o option "Co je na hospodském boardu?" → effect open_job_board (next: null). Klient: `client/src/ui/JobBoardPanel.ts` DOM overlay (centered modal, X close, URGENTNÍ ×2 / +N% badge dle priority bonus, akce „Vzít úkol" / „Vyzvednout odměnu" / „Zrušit" podle stavu, sort: taken_by_self → priority desc → task_id), rozšířený `client/src/ui/QuestPanel.ts` o sekci "Hospodské úkoly" (kill_mob counter + ready ✓ marker při submittable), `WorldScene` lazy `ensureJobBoardPanel` + 4 nové opcode handlery (JOB_BOARD_OPEN/UPDATED + JOB_TASK_PROGRESS/COMPLETED) + JOB_TASK_COMPLETED toast s denáry. 25 nových server unit testů + Playwright `jobboard.spec.ts` smoke (Selka dialog → "hospodském boardu" option → JOB_BOARD_OPEN → panel render s template tituly + Vzít úkol tlačítky). Celkem 79 shared + 196 server testů + 11 Playwright smoke. Parking lot post-MVP: `economic_state` model vesnice, escort/repair objective types, multi-village pool, perzistence shared pool napříč server restarty (MVP regeneruje fresh pool při matchInit). Další: **Phase 13** (NPC merchant) — viz [docs/00-action-plan.md](docs/00-action-plan.md). Většina RPC mimo profile / world.find_or_create_match je stále TODO scaffolding.

**Render konvence:** logický grid je ortogonální `(x, y)` v tiles — server, pathfinding, collision pracují čistě ve world-space. Isometric je čistě klient render projection (2:1 dimetric, screen footprint 64×32 px, projekce v `client/src/render/projection.ts`, Y-sort depth helper v `client/src/render/ysort.ts` — viz ADR-018). Žádný server kód nesmí pracovat s pixel/screen souřadnicemi.

## Repo layout

Monorepo (pnpm workspaces) — tři balíčky a sdílené moduly:

- [client/](client/) — Phaser 3 + Vite + TypeScript klient, importuje `irij-shared`
- [server/](server/) — Nakama TypeScript runtime modul, esbuild bundle do IIFE
- [shared/](shared/) — sdílené types, opcodes, constants. Re-exporty: `irij-shared`, `irij-shared/types`, `irij-shared/messages`, `irij-shared/constants`. Používá `"main": "./src/index.ts"` (žádný build, konzumenti čtou TS přímo)
- [infra/](infra/) — `docker-compose.yml` (Postgres 16 + Nakama 3.38 + golang-migrate sidecar) a `nakama/local.dev.yml`
- [migrations/](migrations/) — SQL migrace (golang-migrate, `0001_init_irij_schema` + `0002_audit_log`)
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

Nakama porty: `7349` gRPC, `7350` HTTP/WS API, `7351` console (admin/password z `infra/nakama/local.dev.yml`).

## Architektura — co je nutné znát

### Server-authoritative everything (ADR-006)

Klient pouze _navrhuje_ akce a interpoluje/predikuje pro UX. Server validuje každý vstup proti pravidlům z `docs/02a-e` a broadcastuje výsledek. Nikdy nepiš logiku, kde klient autoritativně mění stav.

### Tickrate model (ADR-007, [shared/src/constants/index.ts](shared/src/constants/index.ts))

Master tick = **10 Hz** (`TICK_HZ`). Vše ostatní jsou násobky pomocí counterů v `match_loop`:

- `COMBAT_TICK_INTERVAL = 6` (600 ms)
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

### Error contract (RPC → uživatel)

Server hází typovaný [`RpcError(code)`](server/src/lib/errors.ts) kde `code` je snake_case identifikátor (např. `username_taken`, `invalid_display_name`, `already_exists`). **Message Error objektu je čistě ten kód, žádný human-readable detail** — překlady jsou výhradně klientské.

Klient v [client/src/rpc.ts](client/src/rpc.ts):
- `callRpc` zachytí raw `Response` objekt, který nakama-js v2 throwne při non-2xx, a vytáhne z body `message` field.
- `callRpcSafe` vrací `{ ok: true, data } | { ok: false, error: { code, message } }`. Volající scéna mapuje `error.code` přes lokální `ERROR_MESSAGES: Record<string, string>` na českou hlášku, fallback je generická chyba.
- `extractErrorCode` musí umět **tři tvary** přicházející přes drát — nezjednodušuj na jeden:
  1. `"username_taken"` — čistý kód (ideální stav)
  2. `"username_taken: detail"` — legacy s detailem
  3. `"Error: username_taken at index.js:360:12(3)"` — **Nakama Goja runtime obalí thrown JS Error přes toString() a do gRPC message přidá stack trace.** Bez třetího regexu kód vyjde jako `'unknown'` a uživatel uvidí generickou hlášku, i když server hodil správný `RpcError`.

**Recept na nový error code:**
1. Server: `throw new RpcError('moje_chyba')` v handleru.
2. Shared: doplň literál do error union typu v `shared/src/messages/<feature>.ts` (např. [profile.ts](shared/src/messages/profile.ts) má union pro create_character).
3. Klient: přidej řádek do `ERROR_MESSAGES` v scéně, která RPC volá. **Vždy v češtině** (hráč nikdy nesmí vidět ani anglický fallback, ani goja stack trace) — projektová konvence, viz commit `7e63e10`.

**Co NEdělat:**
- Neházet `throw new Error('detail')` — ztratí se kód, klient nemá co mapovat.
- Neposílat lokalizovaný text ze serveru — server neví, jaký jazyk hráč má.
- Nezachytávat error v handleru a vracet `{ ok: false, error: ... }` — Nakama runtime má svůj error mapping přes thrown errors, custom envelope ho rozbíjí.

### TypeScript config

Workspace dědí z [tsconfig.base.json](tsconfig.base.json): `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `moduleResolution: Bundler`, ESM. Imports uvnitř balíčků používají `.js` extensions (ESM convention) i pro `.ts` soubory.

## Workflow při nových featurech

Action plan v [docs/00-action-plan.md](docs/00-action-plan.md) definuje fázování. Než přidáš novou feature:

1. Najdi odpovídající fázi v action planu — pořadí má důvod (auth před char creation před movement před combat).
2. Pro game logic ověř pravidla v `docs/02a-e` (postava / itemy / svět / NPC-mobi-questy / ekonomika) — constraints sekce každého dokumentu.
3. Pro nové síťové zprávy přidej opcode do `shared/src/messages/opcodes.ts` ve správném číselném rozsahu, payload type do `shared/src/messages/`, a teprve pak implementuj klient + server stranu.
4. RPC handlery patří do `server/src/rpc/{auth,profile,...}.ts` jako **pojmenované exportované funkce** (`export function authPing(...)`, ne arrow). V `server/src/main.ts` se přivážou **přímo v body `InitModule`**: `initializer.registerRpc('rpc.auth.ping', authPing)`. Match handlery v `server/src/match/*.ts` jsou taktéž top-level named functions; registrace přes object s shorthand property references (`initializer.registerMatch('world', { matchInit, matchJoin, ... })`). **Nikdy** nepoužívej helper-funkce typu `registerAuthRpcs(initializer)` ani method shorthand v object literal — Nakama Goja runtime parsuje `InitModule` AST a extrahuje handler identifikátory pouze z výrazů přímo v jeho body, neprochází do helperů a function-literal property values odmítá.
5. Pro každý chybový stav, který se může propagovat k hráči, hodit `throw new RpcError('snake_case_code')` na serveru a přidat český překlad do `ERROR_MESSAGES` v odpovídající klientské scéně — viz „Error contract" výše. Generický fallback „Nastala neočekávaná chyba" znamená, že kód není namapovaný a uživatel ztratil informaci.

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

- Žádný lint runner — `pnpm lint` je prázdný skript.
- Žádný deployment script (CI workflow pro typecheck + build + test na PR existuje od Phase 4.5).
- Většina match logiky, RPC a klient scén je TODO scaffolding — nehledej "kde je combat resolver", neexistuje.
