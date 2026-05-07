# 00 — Action Plan

**Stav:** Draft 1 — 2026-05-03
**Účel:** Krokovaný checklist od dnes po closed alpha. Odškrtávej `[x]` jak postupuješ.

> **Filozofie:** každá fáze končí _něčím demonstrovatelným_. Pokud po dokončení fáze nemáš co ukázat (sobě, kámošovi, do screenshotu), něco je špatně.

> **Tempo:** odhady jsou pro **sólo dev s AI asistencí, ~3-4 h/den**. Tvoje rychlost se bude lišit. Nepanikař když fáze trvá dvojnásobek.

---

## Pre-flight checklist (před tím, než začneš kódit)

Tyhle věci řeš _než_ se zaboříš do kódu — některé mají lead time (Apple Dev Program, doména DNS propagace).

- [ ] **Server** — ověřit, že existující server má min. 4 GB RAM, 2+ vCPU, 50 GB SSD, Docker + Compose nainstalované
- [ ] **Doménové jméno** — koupit / zvolit doménu (pokud ještě nemáš)
- [ ] **Cloudflare zone** — přidat doménu, potvrdit nameservery
- [ ] **GitHub repo** — privátní repo pro Irij (i kdyby později open source)
- [ ] **Discord Developer App** — vytvořit aplikaci, OAuth2 redirect URI připravit (bude potřeba pro auth)
- [ ] **Google Cloud OAuth Client ID** — vytvořit project, OAuth consent screen, Web application client
- [ ] **SMTP provider** — registrovat (Sendgrid free 100/den nebo Mailgun free 100/den)
- [ ] **Off-site backup target** — Hetzner Storage Box / Backblaze B2 / S3 bucket
- [ ] **AI asset gen accounty** — Scenario nebo PixelLab subscription, ElevenLabs (jen jak budeš potřebovat)
- [ ] **Tiled editor** — `apt install tiled` nebo flathub, pro pozdější mapy

---

## Phase 0 — Local setup ⏱ ~1 den

Cíl: lokální stack jede, Nakama console reagují, klient se otevře v browseru.

- [x] Nainstalovat **Node 20+** (`nvm install 20 && nvm use 20`)
- [x] Nainstalovat **pnpm 9+** (`corepack enable && corepack prepare pnpm@latest --activate`)
- [x] Nainstalovat **Docker** + Docker Compose
- [x] V root složce: `pnpm install`
- [x] V root: `pnpm build:server` (vytvoří `server/dist/index.js`)
- [x] V root: `pnpm infra:up` (spustí Postgres + Nakama)
- [x] Ověřit: `docker compose -f infra/docker-compose.yml ps` — oba services `running`
- [x] Otevřít `http://localhost:7351` — Nakama console (admin/password z `local.yml`)
- [x] V druhém terminálu: `pnpm dev:client`
- [x] Otevřít `http://localhost:5173` — Phaser klient ukáže "Irij — boot…" a poté "WorldScene — TODO"
- [x] **Demo:** screenshot Nakama console + Phaser klient = milestone "stack běží"

**Známé pasti:**
- Nakama runtime hledá `index.js` v `/nakama/data/modules` — pokud tam není, runtime modul se nezaregistruje. Server musí být **buildnutý před** `infra:up`.
- Pokud `pnpm install` selže na peer deps, zkontroluj Node verzi (musí být 20+).

---

## Phase 1 — Hello connection ⏱ ~2 dny

Cíl: klient se připojí k Nakamě, autentizuje guest accountem, drží WebSocket session.

- [x] V `client/src/` vytvořit `nakama.ts` — wrapper kolem `@heroiclabs/nakama-js` clienta
- [x] Implementovat `connectAsGuest(deviceId)` — `nk.authenticateDevice(deviceId, true)` + `socket.connect(session)`
- [x] V `client/src/` vytvořit `device.ts` — generování + persistence device_id v `localStorage`
- [x] V `WorldScene.create()` zavolat connect, zalogovat výsledek do console *(refaktorováno do LoginScene — auth flow oddělen od world rendering)*
- [x] V `BootScene` přidat error handling — pokud connect fail, ukázat červený text *(error UI v LoginScene; boot flow obsahuje error handling, scéna je dedikovaná)*
- [x] Otestovat: F12 console v browseru ukáže `Connected as user <uuid>`
- [x] **Demo:** screenshot Nakama console "Status → Online users" ukazující 1 user *(uživatel ověřil 2 guest accounty + admin)*

---

## Phase 2 — Character creation ⏱ ~3 dny

Cíl: nový hráč si vytvoří postavu (jméno, gender, appearance), persistovaná v Nakama Storage.

- [x] V `server/src/rpc/profile.ts` implementovat `rpc.profile.create_character`
  - [x] Validace `username` regex + unikátnost (Nakama `nk.usersGetUsername` check)
  - [x] Validace `display_name` length + UTF-8
  - [x] Validace `gender` enum, `appearance` ranges
  - [x] Vytvořit `Player` blob v Nakama Storage (collection: `player`, key: `userId`)
  - [x] Inicializovat 4 atributy + 17 skillů na lvl 1 (collection: `player_skills`)
  - [x] Inicializovat prázdný inventář, equipment (collection: `player_inventory`)
- [x] Implementovat `rpc.profile.get_self` — vrátí kompletní player state
- [x] V klientovi: pokud `get_self` říká postava neexistuje → ukázat character creation UI
- [x] Char creation UI (zatím text + klávesy, hezké UI v Phase 17): jméno, M/F, hair_id, skin_tone_id, outfit_id
- [x] Po vytvoření znovu zavolej `get_self`, ulož v klientovi
- [x] **Demo:** vytvoř 2 postavy, ověř v Nakama console → Storage → `player` collection

---

## Phase 3 — Statická mapa ⏱ ~3-4 dny

Cíl: render základní mapy v Phaseru, hráč vidí svou postavu (bez pohybu). **Isometric** (2:1 dimetric, viz [docs/04 ADR-018](04-tech-adr.md#adr-018-isometric-rendering--explicitní-engineering-kontrakt)).

- [x] Implementovat `client/src/render/projection.ts` — `worldToScreen(x, y)` a `screenToWorld(sx, sy)` per ADR-018
- [x] Implementovat `client/src/render/ysort.ts` — helper pro depth-by-y sprite sort
- [x] Vytvořit **Tiled** test mapu 50×50 dlaždic, **isometric orientation, 64×32 px tile footprint**
- [x] Najít / vyrobit první tileset (placeholder — Kenney isometric set, nebo přiložený `Isometric_tileset.zip` ve workdir, nebo AI generated). **Top-down assety nepoužitelné.** *(PIL-generated 3-tile placeholder: grass, dirt path, water)*
- [x] V `client/public/maps/` uložit `test_50x50.tmj` (Tiled JSON export, isometric) + tileset PNG
- [x] V `WorldScene.preload()` načíst mapu + tileset
- [x] V `WorldScene.create()` vytvořit Phaser Tilemap (`orientation: ISOMETRIC`), render terrain layer
- [x] Načíst placeholder character sprite (4 směry pro iso kompas), render na startovní pozici
- [x] Camera follow (`this.cameras.main.startFollow(player)`) — operuje na screen coords po projekci
- [x] Phaser Scale.RESIZE responsivně reaguje na resize okna
- [x] **Demo:** isometric mapa + statická postava uprostřed, zoom OK na desktop i na mobil

---

## Phase 4 — Server-authoritative movement ⏱ ~5-7 dnů

Cíl: dva hráči se vidí pohybovat, server rozhoduje, klient interpoluje.

- [x] V `server/src/match/world.ts`:
  - [x] Implementovat `matchInit` (registruj match jako `world.main`)
  - [x] V `matchJoin` načíst player state ze Storage, uložit do `state.presences`
  - [x] Implementovat handler pro `Op.MOVE_REQUEST`
  - [x] Validovat target je walkable, vzdálenost ≤ MAX_PATH_LENGTH
  - [x] Pathfinding A* na walkable masce mapy (přidat knihovnu nebo napsat ručně)
  - [x] V `matchLoop` posunovat hráče po tile-by-tile podle path
  - [x] Broadcast `Op.ENTITY_MOVED` 10× za sekundu všem v match
- [x] V klientovi:
  - [x] Po loginu: `socket.joinMatch('world.main')`
  - [x] Click-to-move: detect tile click, send `MOVE_REQUEST`
  - [x] Subscribe na `ENTITY_MOVED`, interpoluj sprite movement
  - [x] Render ostatní hráče (nový sprite per presence)
- [x] Otevři dvě browser okna (anebo browser + telefon na LAN), ověř že se vidí
- [x] **Demo:** video s dvěma postavami pohybujícími se ve světě

**Anti-cheat checkpoint:** pokus se v dev tools poslat `MOVE_REQUEST` s `target: {x: 99999, y: 99999}` — server musí odmítnout. Pokud to projde, fixni dřív než pokračuješ.

---

## Phase 4.5 — Operational hardening ⏱ ~3-4 dny

Cíl: safety net před persistence fází — CI, testy, zálohy, audit trail, secrets hygiene. Vzniklo z [multi-role review](05-review-2026-05-03/00-REMEDIATION-PLAN.md) sekce A + B3.

- [x] **A1 — CI workflow** (PR #16): GitHub Actions `ci.yml` — typecheck + build + test gate na PR + push do main
- [x] **A2 — Vitest skeleton** (PR #17): 47 testů na pathfinding (A*, corner cutting, maxPath cap), walkable (maskFromTiledMap, nearestWalkable BFS), movement (parseMoveRequest shape, checkRateLimit sliding window). Export `parseMoveRequest` + extrahovaný `checkRateLimit` pure helper.
- [x] **A4 — Secrets hygiene** (PR #18): rename `local.yml` → `local.dev.yml`, `prod.yml.example` s `${ENV_VAR}` substitution, `.env.example` + `client/.env.example`, `generate-keys.sh` (openssl rand)
- [x] **A3 — Backup runbook** (PR #19): `infra/scripts/backup.sh` (pg_dump + retence), `restore-drill.sh` (dočasný PG container + verify), `docs/06-ops-runbooks.md` (RPO 6h, RTO 1h, cron setup, NAS off-site, secrets rotation)
- [x] **A5 + B3 — Audit log + migrace** (PR #20): golang-migrate sidecar v docker-compose, `0001_init_irij_schema` (CREATE SCHEMA irij), `0002_audit_log` (partitioned table), `server/src/lib/audit.ts` logAudit helper, integrace do profileCreateCharacter + movement (out_of_bounds, too_far)
- [x] **A6 — Playwright smoke test** (PR #21): `client/tests/smoke/golden-path.spec.ts` — Boot → guest auth → char create → WorldScene → click-to-move → zero console errors

**Demo:** `pnpm test` → 47 testů zelených, `pnpm --filter irij-client smoke` → golden path pass, CI na PR automaticky.

---

## Phase 5 — Persistence ⏱ ~2 dny

Cíl: pozice + inventář přežijí logout/login.

- [x] V `matchLoop` autosave každých 30 s — flush `state.presences[playerId]` do Storage
- [x] V `matchLeave` final flush + zaznamenat `last_logout_at`
- [x] V `matchJoin` načíst `current_position`, spawnut tam
- [x] **Demo:** pohybuj se, zavři okno, znovu se připoj, postav se objeví na poslední pozici

---

## Phase 6 — První mob + combat ⏱ ~5-7 dnů

Cíl: vlk v lese, lze ho zabít, dropuje loot, dává XP.

- [x] V `server/data/mobs.json` definovat `mob.wolf` (level 5, HP 30, melee) + `mob.giant_rat` (level 2, HP 15, melee)
- [x] V `server/data/loot_tables.json` definovat `loot.wolf` + `loot.giant_rat`
- [x] V `server/src/match/world.ts` mob spawn logic
  - [x] V `matchInit` načíst spawn pointy z `mob_spawns.json` (4 spawny — 2 vlci + 2 krysy)
  - [x] Spawnout instance v `state.mobInstances` + chunk index `state.mobsByChunk`
  - [x] AI tick (každých 500 ms): detekce hráče v aggro_radius, chase, leash návrat (`server/src/match/ai.ts`)
- [x] Handler `Op.ATTACK_REQUEST` (`server/src/match/combat.ts`)
  - [x] Validace dosah (Chebyshev ≤ 1), rate limit (4/s), target alive
  - [x] Combat tick (600 ms per G1 rozhodnutí): resolve damage, broadcast `COMBAT_RESOLVED`
- [x] Mob death: roll loot table, spawn drop entities, broadcast `ENTITY_DIED`
- [x] Klient: render mob sprite (placeholder wolf/rat), click-to-attack, HP bar, floating damage text
- [x] **Demo:** zabít vlka, vidět loot na zemi (ještě bez pickupu)

---

## Phase 7 — Inventář + equipment ⏱ ~5-7 dnů

Cíl: pickup loot, inventář UI, equip zbraň, holster system.

- [x] V `server/data/items.json` definovat MVP item katalog (~20 itemů — sword bronze/iron, leather armor, whetstone t1, food bread, materials)
- [x] Server: handler pro `INTERACT_OBJECT` na drop entitu → přesunout item do inventáře
- [x] Server: validace inventory full
- [x] Server: handlery `EQUIP_REQUEST`, `UNEQUIP_REQUEST`, `ITEM_USE_REQUEST`, `ITEM_DROP_REQUEST`
- [x] Server: holster system — auto-pull při combat akci, atd.
- [x] Klient: inventář UI panel (24 slotů), drag-drop nebo click-to-equip
- [x] Klient: equipment panel (10 slotů + holster)
- [x] Klient: render equipped weapon sprite na postavě (layered)
- [x] **Demo:** zabít vlka, sebrat dýku, equipnout, vidět změnu vizuálu postavy

---

## Phase 8 — XP + skilly ⏱ ~3-4 dny

Cíl: combat dává XP, levely rostou, atributy fractional XP fungují.

- [x] Implementovat XP curve (lookup table 1-99, 99 ≈ 10M)
- [x] Server: na kill mob → `xp_award` z mob def → split mezi skill + atributy (skills.md fractional curve)
- [x] Diminishing returns logika (`PlayerAtributSource` tracking)
- [x] Broadcast `LEVEL_UP` při level up (vizuální celebration; vlastní opcode místo STATUS_EFFECT_APPLIED — explicitní per-skill payload)
- [x] Klient: skill panel UI s atributy + skilly + XP bary
- [x] Klient: level up notifikace ("LEVEL UP! Útok 6→7")
- [x] **Demo:** zabít 5 vlků, vidět melee skill stoupat, atributy fractional přidávat

---

## Phase 9 — První NPC + dialog ⏱ ~5-7 dnů

Cíl: Starý Kovář v Blatinách stojí na mapě, dá se s ním pokecat.

- [x] V `server/data/npcs.json` definovat `npc.kovar_blatiny` s flagy
- [x] V `server/data/dialogs/kovar_blatiny.json` definovat dialog tree
- [x] Server: `INTERACT_NPC` handler s validacemi
- [x] Server: dialog engine — node lookup, option filtering podle knowledge/quest/reputation
- [x] Server: efekty (give_item, deduct_currency, unlock_knowledge, change_reputation, start_quest)
- [x] Klient: dialog UI — speaker portrait, text, options
- [x] Klient: lokalizace (zatím jen CS, framework připravený)
- [x] **Demo:** přijdi ke kováři, vyber option "Co máš na prodej?", dostaň item za denáry

---

## Phase 10 — Gathering + crafting ⏱ ~5-7 dnů

Cíl: těžit rudu, kovat brus, použít v boji.

- [x] V mapě označit `tile_meta` pro mining nodes (kamenolom) *(implementováno přes `server/data/resource_nodes.json` jako server-side entity, ne tile_meta v Tiled — pro MVP jednodušší + chunk-cluster ready per ADR-005)*
- [x] V `server/data/recipes.json` definovat 3-5 receptů (brus, dýka, šíp, chléb) *(3 recepty: brusek, bronzová dýka, bronzový meč)*
- [x] Server: `GATHER_RESOURCE` handler s validacemi (tool, level, dosah)
- [x] Server: gather progress + completed broadcast
- [x] Server: `CRAFT_REQUEST` handler — validace inputs, station proximity, fail roll
- [x] Server: rarity rolling (T1 → 95/5/0/0)
- [x] Klient: gather animation + progress bar
- [x] Klient: crafting UI panel — list dostupných receptů, queue
- [x] **Demo:** vytěž 3× kámen, dojdi do kovárny, ukov 30× brusů, použij v boji

---

## Phase 11 — První quest ⏱ ~5-7 dnů

Cíl: jeden lore quest end-to-end (start dialog → kroky → reward).

- [x] Napsat **kvalitní lore quest** "Synovec Starého Kováře" — 3 kroky, lore text, větvení dialog
- [x] V `server/data/quests/` JSON definici
- [x] Server: quest state machine — start, progress, complete
- [x] Server: objective handlers (`talk_to_npc`, `kill_mob`, `interact_with_object`)
- [x] Server: reward distribuce (XP, item, denáry, knowledge unlock, reputace)
- [x] Klient: quest log UI — aktivní questy, progress, map markery *(MVP: log + step description; map markery odsunuty na Phase 18 polish)*
- [x] Klient: quest deník (completed, čtitelný lore) *(MVP: list dokončených; čtitelný lore text odsunut do Phase 18 — completed entries v deníku otevírají read-only quest description)*
- [x] **Demo:** projít celý quest, dostat odměnu, knowledge unlock se objeví v deníku

---

## Phase 12 — Job board MVP ⏱ ~5-7 dnů

Cíl: hospodský board s procedurálně generovanými tasky.

- [x] V `server/data/job_board_templates.json` definovat 5-10 templates *(5 templates: 3 deliver_item + 2 kill_mob, single village `village.blatiny`, all issued/delivered to Selka)*
- [x] Server: procedurální generátor (každých 30 min new tasky podle vesnické economic_state) *(weight-based random výběr, `economic_state` model odsunut na post-MVP — viz docs/02e poznámka)*
- [x] Server: shared pool s `max_concurrent_takers`
- [x] Server: aging mechanika (priority bonus pro zapomenuté tasky)
- [x] Server: `JOB_TASK_TAKEN`, `JOB_TASK_PROGRESS`, `JOB_TASK_COMPLETED` handlery *(plus `JOB_BOARD_OPEN_REQUEST/OPEN`, `JOB_TASK_SUBMIT`, `JOB_TASK_ABANDON`, `JOB_BOARD_UPDATED`)*
- [x] Klient: job board UI v hospodě (NPC interakce → list tasků) *(otevírá se přes nový dialog effect `open_job_board` u Selky)*
- [x] Klient: aktivní tasky panel *(rozšíření QuestPanel o sekci "Hospodské úkoly" + per-task progress mirror)*
- [x] **Demo:** vezmi task "Krysy ve sklepě", zabij krysy, vrať se k Selce, vyzvedni odměnu *(deliver_items + kill_mobs flow ověřen unit testy + Playwright smoke; auto-progress na kill_mob přes combat.handleMobDeath hook)*

---

## Phase 13 — NPC merchant ⏱ ~3-4 dny

Cíl: kovář prodává zboží + kupuje rudu (specialista vs general).

- [ ] V `server/data/merchant_tables.json` definovat tabulky pro kovář + general store
- [ ] Server: `SHOP_OPEN`, `SHOP_BUY`, `SHOP_SELL` handlery
- [ ] Server: stock respawn tick (15 min interval)
- [ ] Server: buy_limit_per_day reset
- [ ] Klient: shop UI — vlevo NPC stock, vpravo hráč inventář, tlačítka
- [ ] **Demo:** prodej rudu kováři vs. general store, vidět rozdílné ceny

---

## Phase 14 — Bank ⏱ ~2-3 dny

Cíl: shared bank přístupný v každé vesnici.

- [ ] Server: `BANK_OPEN`, `BANK_DEPOSIT`, `BANK_WITHDRAW` handlery
- [ ] Server: collection `player_bank` v Storage (lazy load on open)
- [ ] Klient: bank UI — vlevo banka, vpravo inventář
- [ ] **Demo:** ulož 100 itemů, odhlas se, přihlas se v jiné vesnici, otevři banku, najdi je

---

## Phase 15 — Player-to-player trade ⏱ ~3-4 dny

Cíl: dva hráči si můžou bezpečně vyměnit itemy.

- [ ] Server: `TRADE_OFFER`, `TRADE_UPDATE`, `TRADE_ACCEPT`, `TRADE_CANCEL` handlery
- [ ] Server: `TradeSession` v match state, atomický swap, anti-scam (re-accept po change)
- [ ] Klient: trade UI — dvousloupcový, accept tlačítko, anti-scam UI feedback
- [ ] **Demo:** dva hráči si bezpečně vymění zbraň za denáry

---

## Phase 16 — Chat ⏱ ~2-3 dny

Cíl: lokální + globální + whisper chat.

- [ ] Server: `CHAT_MESSAGE` handler s validacemi (length, profanity, rate)
- [ ] Server: scope-based broadcast (lokální = 15 dlaždic, globální = match)
- [ ] Klient: chat UI panel s tabs (Vše / Hra / Veřejné / Soukromé / Klan / Obchod) jako v reference screenshotu
- [ ] **Demo:** dva hráči si píšou, whisper komu chceš

---

## Phase 17 — i18n setup ⏱ ~2-3 dny

Cíl: všechno user-facing přes `t()`, EN překlady.

- [ ] Klient: integrovat `i18next` + `i18next-browser-languagedetector`
- [ ] Vytvořit `client/src/locales/cs.json`, `en.json`
- [ ] Extrahovat všechny user-facing stringy z kódu do locales
- [ ] Quest dialogy migrovat do `{ cs, en }` struktury
- [ ] Server: thin i18n wrapper pro server-side notifikace
- [ ] CI lint: kontrola, že každý klíč má překlad v obou jazycích
- [ ] **Demo:** přepni jazyk v settings, všechno funguje EN

---

## Phase 18 — Polish + content ⏱ ~10-14 dnů

Cíl: realný world, ne jen sandbox.

- [ ] Postavit kompletní 256×256 Blatiny + okolí mapu v Tiled
- [ ] Vytvořit první sprite art pass (postava, 5 NPC, 3 mobi, 10 itemů) přes Scenario / PixelLab + manuální cleanup
- [ ] Naplnit data: 10 NPC, 5 mobů, 3 lore questy, 8 job board templates, 30 itemů, 15 receptů
- [ ] Audio pass: ambient (Blatiny / Bažina / Hvozd), pár SFX (úder, sběr, level up)
- [ ] UI polish: tooltipy, konfirmace, error stavy
- [ ] Začni psát **05 Style guide** parallelně s tímto polish (dokument iterativní, vznikne tady)

---

## Phase 19 — Auth providers ⏱ ~3-4 dny

Cíl: Discord + Google + email login + guest, vše funkční.

- [ ] Server: implementovat `rpc.auth.login_oidc` pro Discord
- [ ] Server: implementovat `rpc.auth.login_oidc` pro Google
- [ ] Server: implementovat `rpc.auth.login_email` + reset password flow + SMTP integration
- [ ] Klient: login screen s tlačítky (Discord, Google, Email, Play as guest)
- [ ] Klient: guest → upgrade flow (link na OIDC)
- [ ] **Demo:** přihlas se přes Discord, vidíš avatar + username import

---

## Phase 20 — PWA + mobil polish ⏱ ~3-5 dnů

Cíl: instalovatelná PWA na desktop i mobil, mobile UI použitelný.

- [ ] PWA manifest finalizovat (ikony 192/512/maskable)
- [ ] Service worker test (cache lobby/login, ne game traffic)
- [ ] Mobile UI: compact layout pro <768px viewport
- [ ] Touch input audit — všechno jde palcem
- [ ] Performance audit: bundle <5 MB, FCP <2s na 4G
- [ ] **Demo:** instaluj PWA na svůj telefon, zahraj 10 min, oprav UX bottlenecky

---

## Phase 21 — Production deploy ⏱ ~3-5 dnů

Cíl: hra běží na tvém serveru s doménou, https, Cloudflare.

- [ ] Provisioning serveru: Docker, swap, firewall (UFW: 22/80/443 jen)
- [ ] Production `infra/docker-compose.prod.yml` s:
  - [ ] Postgres data volume + backup script (pg_dump cron)
  - [ ] Nakama prod config (silné encryption keys, console password)
  - [ ] nginx jako reverse proxy + Let's Encrypt (certbot)
- [ ] Cloudflare DNS: A records pro `play.<doména>`, `assets.<doména>`, `<doména>`
- [ ] Cloudflare Cache Rules (viz docs/04 ADR-009)
- [ ] GitHub Actions: build → SSH deploy → restart
- [ ] Off-site backup: nastavit pg_dump → backup target (Hetzner Storage Box / B2)
- [ ] Monitoring: Grafana Cloud agent, Prometheus scrape Nakama metrics
- [ ] **Restore drill:** simuluj ztrátu, restore z backup, ověř že to funguje
- [ ] **Demo:** přístup z mobilu mimo domácí síť, latence < 30 ms

---

## Phase 22 — Closed alpha ⏱ ~5-7 dnů

Cíl: 3-5 kámošů to hraje, sbíráš feedback.

- [ ] Vytvoř **Discord server** pro Irij komunitu — kanály #general, #bug-reports, #suggestions
- [ ] Bug bash sám (1-2 dny intenzivního hraní, fix top 5 problémů)
- [ ] Pozvi 3-5 kámošů, dej jim onboarding instrukce
- [ ] Daily check-in: log spam, error rate, feedback inbox
- [ ] Quick fix smyčka — 1 release / den s fixy
- [ ] **Milestone:** týden bez critical bug, hráči přicházejí denně, server-side anti-inflation log vypadá zdravě

---

## Týdenní rituály (jakmile MVP běží)

Každý pátek:

- [ ] Backup verification — náhodný backup obnov do test prostředí, ověř integritu
- [ ] Anti-inflation log review — total denáry trend, aktuální gold sinks
- [ ] Error rate review — Sentry / logs, top 5 errors fix
- [ ] Player retention metric — D1 / D7
- [ ] Roadmap review — co je další 2 týdny

---

## Risk checkpoints (kdy se zastavit a zhodnotit)

- **Konec Phase 4:** pokud server-authoritative movement nefunguje smooth → zvaž jestli message protokol potřebuje refactor _před_ tím, než přidáš víc messages
- **Konec Phase 7:** pokud inventář + equipment je bordel v kódu → refactor _teď_, později to bude horší
- **Konec Phase 11:** první quest hotový → playtest 30 min, ověř že "lore-driven" feeling funguje. Pokud cítíš nudu → probrainstormuj scope dřív než píšeš víc questů
- **Konec Phase 18:** styl, atmosféra, world feel — _teď_ je čas zhodnotit, jestli MVP je _zábavný_, ne jen funkční. Pokud ne, pause a redesign
- **Konec Phase 22:** alpha feedback. Top 3 problémy hráčů → roadmap revizi

---

## Co _nedělat_ během MVP (parking lot)

Tyhle chuti tě budou pokoušet. Odolávej.

- Player housing — počkat
- Mounts / kárky — počkat
- Den/noc cyklus — počkat (statická regional atmosféra stačí)
- Více workerů per hráč — 1 stačí
- Listing board / aukce — direct trade stačí
- Branching questy — lineární stačí
- Steam / Apple auth — počkat
- Tauri/Capacitor desktop wrapper — počkat
- Více vesnic než Blatiny — počkat
- Dungeons — počkat
- Guildy / klany — počkat
- PvP arena — počkat (i když je v scope)
- Fast travel — počkat
- Cosmetics shop — počkat
- **Client-side movement prediction + reconciliation** — post-MVP. Klient aktuálně čeká na server ENTITY_MOVED a pak interpoluje (RS3 model). Při změně směru za pohybu sprite "dohání" server pozici rychlejším pohybem (1-2 tile catch-up). Plná oprava: klient optimisticky predikuje A* path lokálně, posílá MOVE_REQUEST, server potvrdí/opraví → klient reconciluje. Vyžaduje sdílenou walkable masku na klientu + reconciliation logic. Aktuální stav je pro MVP akceptovatelný (RS3 má stejný efekt), ale pro polish (Phase 18+) zvážit.

---

## Změnový log

- **2026-05-03** — Draft 1, vytvořeno na základě dokončeného design phase. Phases 0-22 + pre-flight + týdenní rituály + risk checkpoints + parking lot.
- **2026-05-03** — **Phase 0 dokončena** (PR #1). Lokální stack běží: Postgres 16 + Nakama 3.24 v Dockeru, klient přes Vite dev server na :5173, runtime modul načten z `server/dist/index.js`.
- **2026-05-03** — **Phase 1 dokončena** (PR #2 + PR #4). Persistentní guest auth přes `authenticateDevice` + WebSocket session, `device_id` v `localStorage`, Boot → Login → World scene flow s funkčním error retry. Login screen má placeholder buttony pro Discord / Google / E-mail (Phase 19). Na okraj přidán **ADR-018 — isometric rendering kontrakt** (PR #3): drift fix vůči [01 Scope](01-scope-and-pillars.md), explicitní lock 2:1 dimetric projekce + Y-sort konvence pro Phase 3+.
- **2026-05-03** — **Phase 2 dokončena**. Server: `rpc.profile.create_character` (validace username regex + unikátnost, display_name UTF-8 length, gender enum, appearance 0–11 ranges; init Player + 4 atributy + 17 skillů + 24-slot inventory + 11-slot equipment ve třech Storage kolekcích) a `rpc.profile.get_self` (kompletní player state nebo `{exists:false}`). Klient: `CharacterCreationScene` (text-mode form, Tab/šipky/Enter), Boot → Login → CharCreate / WorldScene routing podle existence postavy, `client.rpc` HTTP wrapper v [client/src/rpc.ts](../client/src/rpc.ts). Demo ověřeno přes Playwright: 3 postavy v DB s plnými bloby ve všech kolekcích, re-login po reload trefí WorldScene přímo.
- **2026-05-03** — **Phase 3 dokončena**. Klient: `client/src/render/projection.ts` (worldToScreen / screenToWorld / screenToTile, 2:1 dimetric per ADR-018, `TILE_W_PX=64` / `TILE_H_PX=32`), `client/src/render/ysort.ts` (depth bandy: terrain 0–999, props 1000–9999, dynamic 10000+ s per-tile Y_SCALE pro sub-tile řazení). Test mapa `client/public/maps/test_50x50.tmj` (50×50, isometric orientation, grass/dirt-crossroads/water patch) + placeholder tileset `placeholder_iso_tileset.png` + 4-směr character spritesheet `client/public/sprites/placeholder_character.png` (SE/SW/NW/NE, 32×48 / frame). `WorldScene` načítá mapu, vytváří `Phaser.Tilemap` (auto-detected iso orientation z .tmj), renderuje terrain layer, spawnuje postavu na `current_position` (anchor 0.5, 1 → feet v diamond centru) s `depthForDynamic(world_y)`, camera follow s bounds podle map extents, HUD s display_name + zone + tile coords. Default spawn `DEFAULT_SPAWN_POSITION` posunut z (50,50) na (25,25) — crossroads test mapy. Smoke test ověřen v Playwright (desktop 1374×729 + mobile 480×640, fresh + re-login flow, 0 console errors).
- **2026-05-03** — **Nakama upgrade 3.24.0 → 3.38.0**. Po dotazu uživatele jsem dohledal, že 3.24.0 + 3.24.1 mají bug způsobující `400 "RPC ID must be set"` na všechny HTTP `/v2/rpc/{id}` calls (fix v 3.24.2, viz [forum thread](https://forum.heroiclabs.com/t/nakama-upgrade-3-24-1-then-error-rpc-id-must-be-set-message-rpc-id-must-be-set-code-3/5725)). Bumpli jsme rovnou na latest stable 3.38.0, abychom v MVP fázi měli aktuální stack. `nakama-runtime` v1.45.0 (server-side TS API) je s 3.38.0 kompatibilní bez změn. Klientský `callRpc` helper se vrátil z dočasného `socket.rpc` workaroundu na čistý `client.rpc` HTTP.
- **2026-05-03** — **ENTITY_MOVED migrated z per-tile na path-based broadcast** (fix/phase-4-path-based-movement). Phase 4 follow-up fix po user-reportovaném trhaném pohybu („1 → 2, pauza, 2 → 3, pauza"). Per-tile broadcast (4b) měl jitter 300–400 ms ze server tick rounding (`floor((tick - pathStartedAt) * speed / TICK_HZ)`); 100 ms klient tween skončil před dalším updatem → viditelné pauzy. Refactor na path-based protokol per nový ADR-019 (RuneScape/Tibia model): server posílá `ENTITY_MOVED` 1× po validaci `MOVE_REQUEST` s celou path; klient buildí Phaser TweenChain z path tilů a lerpuje plynule per-tile (linear, `1000/speed_tps` ms per link, depth update onActive). Mid-path change cíle = re-broadcast s aktuální pozicí jako `from` + krátký catch-up tween 50 ms na klientu (drift correction). `WORLD_SNAPSHOT` joiner-flow nyní obsahuje in-flight path data pro plynulý naskok do běžící party. Server `matchLoop` stále drží advance logic pro chunk index + autosave (Phase 5), ale neposílá per-tile zprávy. Bandwidth O(N) → O(1) per pohyb.
- **2026-05-03** — **Phase 4 dokončena** (PR #10 + PR #11 + PR #12 squash merge). Server-authoritative movement end-to-end ve třech sub-tasks. **4a (PR #10):** singleton match `world.main` přes `rpc.world.find_or_create_match` (handshake idempotentní přes `nk.matchList` lookup), `matchInit` / `matchJoin` / `matchLeave` / `matchLoop` scaffolding, walkable mask infra (parsing tilemap → bool grid), presences keyed by userId v match state. **4b (PR #11):** `Op.MOVE_REQUEST` handler s rate limit (10 req/s per presence, `rate_limited` reject), input validation (`malformed`, `out_of_bounds`), A* pathfinding na walkable masce (Manhattan heuristic, `MAX_PATH_LENGTH_TILES` cap → `too_far` reject), nearest-walkable BFS fallback (radius `NEAREST_WALKABLE_BFS_RADIUS` — click do vody snap-uje na nejbližší walkable břeh; pokud nikoho nenajde → `no_path`), tile-by-tile move v `matchLoop` při `MOVE_TICK_INTERVAL` (~3 tiles/s), `Op.ENTITY_MOVED` broadcast do 3×3 chunkového okolí přes `broadcastToChunkArea` (chunk-cluster-ready per ADR-005), `Op.MOVE_REJECTED` na sender-only s důvodem + echo `client_seq`, joiner-only `Op.WORLD_SNAPSHOT` v `matchJoin` (entity v 3×3 chunkovém okolí joineru) + `Op.ENTITY_SPAWNED` broadcast ostatním, `Op.ENTITY_DESPAWNED` při `matchLeave`. **4c (PR #12):** klient `WorldScene` onmatchdata dispatch table (WORLD_SNAPSHOT / ENTITY_SPAWNED / ENTITY_DESPAWNED / ENTITY_MOVED / MOVE_REJECTED), render ostatních hráčů jako placeholder character sprites (`Map<userId, Sprite>` keyed by entity_id, depth `depthForDynamic(world_y)` per ADR-018, frame fixed na FRAME_FACING_SE — animace pohybu Phase 6+), 100 ms linear tween na ENTITY_MOVED (server tile cadence ~333 ms, lerp pokrývá rezervu, depth update synchronně před tween aby Y-sort nezakmital, `tweens.killTweensOf` před každým novým tween), click-to-move přes globální `pointerdown` → `screenToTile(pointer.worldX, pointer.worldY)` → `sendMatchState(MOVE_REQUEST)` s incrementing `clientSeq` (žádný optimistic update — server je single source of truth, TODO post-MVP prediction + reconciliation), MOVE_REJECTED HUD toast (red text, ScrollFactor 0, depth 100_001, 1500 ms fadeOut tween, `rate_limited` ignorován pro anti-spam UX), shutdown cleanup (`tweens.killAll()` + destroy sprites + leaveMatch). **Smoke test:** Playwright 2-tab scénář — PlayerOne + PlayerTwo, oba vidí druhého z WORLD_SNAPSHOT bulk init, click-to-move na (30,25) a (20,25) propaguje cross-tab, click do vody (12,36) → server BFS snap na (12,34) (břeh) bez MOVE_REJECTED, anti-cheat `target:{x:99999,y:99999}` přes dev tools → `out_of_bounds` reject + červený toast „Tam se nedostaneš (out_of_bounds)", 0 console errors mimo favicon 404.
- **2026-05-04** — **Phase 4.5 dokončena** (PR #16–#21). Operational hardening per [remediation plan](05-review-2026-05-03/00-REMEDIATION-PLAN.md) sekce A + B3: CI workflow GitHub Actions (A1), Vitest 47 testů na pathfinding/walkable/movement pure utily (A2), secrets hygiene s rename `local.yml` → `local.dev.yml` + prod template + generate-keys.sh (A4), backup/restore skripty + ops runbook RPO 6h/RTO 1h (A3), audit log `irij.audit_log` partitioned table + golang-migrate Docker sidecar + `logAudit` helper integrace (A5+B3), Playwright golden path smoke test (A6).
- **2026-05-05** — **Phase 5 dokončena**. `server/src/match/autosave.ts`: batched `savePlayersState` helper (batch storage read + merge in-memory position/HP + batch write, bez OCC — match state je single source of truth). `matchLoop`: autosave trigger každých `PLAYER_AUTOSAVE_INTERVAL` (300 ticků = 30 s). `matchLeave`: final flush s `last_logout_at` **před** odstraněním presence ze state. `matchTerminate`: flush všech zbývajících hráčů při graceful shutdown. `matchJoin` již od Phase 4 čte `player_state.current_position` ze Storage a spawnuje tam — žádná změna potřeba. 10 nových unit testů v `autosave.test.ts` (standing + mid-path pozice, logout flag, batching, graceful error handling, preserve untracked fields). Nový Playwright smoke test `persistence.spec.ts`: move → reload → verify position ≠ (25,25). Celkem 65 server testů + 51 shared testů.
- **2026-05-06** — **Phase 7 dokončena**. Server: `server/data/items.json` (20 MVP itemů — zbraně, brnění, food, materiály, whetstone, currency), `server/src/lib/items.ts` (module-level catalog loader, `categoryToEquipSlot`, `getWeaponClass`, `isTwoHanded`, `getFoodHpRestore`). `server/src/match/inventory.ts`: `handleInteractObject` (pickup drop — Chebyshev ≤ 2, OCC retry, ENTITY_DESPAWNED + INVENTORY_CHANGED unicast), `handleEquipRequest` (swap inventory↔equipment, 2H/shield mutex, holster auto-pull, EQUIPMENT_CHANGED broadcast), `handleUnequipRequest`, `handleItemDropRequest` (OCC remove + DropInstanceState spawn + ENTITY_SPAWNED), `handleItemUseRequest` (food consume → HP restore + COMBAT_RESOLVED). `WorldMatchState` rozšířen o `interactRequestLog`. Klient: `InventoryPanel` + `EquipmentPanel` DOM overlay (otevírání klávesou [I], 24-slot grid s emoji ikonami, click-to-select + Equipovat/Použít/Zahodit akce), `WorldScene` napojení (INVENTORY_CHANGED / EQUIPMENT_CHANGED / HOLSTER_AUTOPULL handler, drop pickup detekce při click, `updatePlayerWeaponVisual` — sprite tint 0xaad4ff = ozbrojený / 0xffffff = neozbrojený). 17 nových unit testů (addItemsToInventory, categoryToEquipSlot, item catalog functions) + Playwright `inventory.spec.ts` smoke test. Celkem 100 server testů. PR #30.
- **2026-05-05** — **Phase 6 dokončena**. Server: `server/data/mobs.json` (vlk level 5 HP 30 + obří krysa level 2 HP 15), `server/data/loot_tables.json`, `server/data/mob_spawns.json` (4 spawny na test mapě). `server/src/match/ai.ts`: AI state machine (idle → chase → attack → leash_return → dead), aggro radius detekce, 8-dir A* pathfinding pro chase, leash s full HP regen. `server/src/match/combat.ts`: `ATTACK_REQUEST` handler (Chebyshev range check, 4/s rate limit, target alive validation), combat tick 600 ms (per G1 rozhodnutí — OSRS tempo), player→mob damage (bare-hand 0–3, 5% miss / 5% crit), mob→player damage (stats z definice, 10% miss), mob death (loot roll, drop entity spawn, ENTITY_DIED broadcast s xp_awarded, timed respawn), player death (MVP: full HP reset, mob disengage). `server/src/match/state.ts`: MobInstanceState, DropInstanceState, chunk index helpers (addMobToChunk/removeMobFromChunk/moveMobBetweenChunks, addDropToChunk/removeDropToChunk, getMobsInChunkArea). `matchInit` načítá mob/loot/spawn JSON data, `matchJoin` WORLD_SNAPSHOT zahrnuje moby + dropy, `matchLeave` uvolňuje mob targeting, `matchLoop` integruje advanceMobMovement + runAiTick (AI_TICK_INTERVAL=5) + runCombatTick (COMBAT_TICK_INTERVAL=6) + checkMobRespawns + cleanupExpiredDrops. Klient: placeholder wolf/rat/drop sprite sheets, click-to-attack (findMobAtTile s adjacent tile tolerance), HP bary (Phaser Rectangle, barva green→yellow→red podle %), floating damage text (800ms fade-up tween, color-coded miss/normal/crit/self), XP toast při mob kill, COMBAT_RESOLVED/ENTITY_DIED dispatch v onmatchdata. `shared/src/types/mob.ts` (MobDefinition, MobStats, LootTable, AiState), `shared/src/constants` (COMBAT_TICK_INTERVAL=6, MELEE_RANGE_TILES, ATTACK_RATE_LIMIT_MAX, DROP_DESPAWN_TICKS, MOB_RESPAWN_CHECK_INTERVAL), rozšířený EntitySpawned/WorldSnapshotEntity o mob_id/display_name_cs/level/items fieldy. 10 nových unit testů (parseAttackRequest + chebyshevDistance). Celkem 75 server + 51 shared = 126 testů. Smoke test: 2 Playwright testy zelené (golden-path + persistence).
- **2026-05-03** — **Pathfinding migrace 4-směrový → 8-směrový** (post-Phase 4 fix). User-reported zubatý pohyb v iso projekci (cesta po crossroads jela schodovitě N-E-N-E místo NE-NE-NE). Phase 4b A* byl 4-conn s Manhattan heuristikou bez technického důvodu krom „matchne iso aesthetic" — naopak iso projekce zve k diagonálům. Přepnuto na 8-směrový A* (cardinal + 4 diagonal) s octile cost (cardinal=1, diagonal=√2), octile heuristikou, no-corner-cutting check (diagonál požaduje obě adjacent cardinal walkable — anti-přiniknutí rohem mezi dvě stěny), diagonal-first expansion order (vizuálně přímější cesty při f-tie). `MAX_PATH_LENGTH_TILES` zachován jako cap v krocích (samostatný `steps` counter, nezáleží na zastoupení diagonál). `nearestWalkable` BFS rovněž přepnut na 8-conn (Chebyshev distance místo Manhattan) — bez toho by 4-conn fallback vrátil tile dál, ke kterému se 8-conn A* dostane kratší cestou. Klient (`WorldScene.update()`) **bez změny** — lerp je směrově agnostický (lineární mezi sousedními tile centry, funguje stejně pro cardinal i diagonal). Nový [ADR-020](04-tech-adr.md#adr-020-8-směrový-pohyb-octile-a) dokumentuje rozhodnutí; ADR-018 sprite směry update na cíl 8 (Phase 4c MVP zatím static `FRAME_FACING_SE`).
- **2026-05-06** — **Phase 9 dokončena**. Shared: `shared/src/types/npc.ts` (`NpcDefinition`, `DialogTree`, `DialogNode`, `DialogOption`, `DialogEffect` discriminated union, `DialogText { cs, en }`), `shared/src/messages/dialog.ts` (`InteractNpcRequest`, `DialogOpen`, `DialogOptionPayload`, `DialogChooseRequest`, `DialogClose` reason enum). Server data: `server/data/npcs.json` Starý Kovář (talkable + merchant flag, position 27,25 = ≤2 dlaždice od default spawnu (25,25) per docs/03 range constraint) + Selka v hospodě (talkable only, smoke coverage), `server/data/dialogs/kovar_blatiny.json` 4-node tree (root → smalltalk_node ↔ root, root → shop_node give_item whetstone ↔ root, root → lore_node gated `show_if knowledge: lore.polednice_rumor`), `server/data/dialogs/selka.json` 2-node minimal. Server: `server/src/lib/dialogs.ts` static catalog loader (NPC + dialog map), `server/src/match/dialog.ts` `handleInteractNpc` (rate limit 5/s, Chebyshev ≤ 2 range, talkable flag check, opens session storing `currentNodeId` per-userId), `handleDialogChoose` (10/s rate, validates session match + range re-check + option visibility, applies effects, advances OR closes), `handleDialogCloseRequest`, effect resolver (`applyGiveItem` / `applyDeductItem` / `applyDeductCurrency` přes OCC retry na PLAYER_INVENTORY, `unlock_knowledge`/`change_reputation`/`start_quest`/`complete_quest_step` jsou Phase 11+ stub jen s `logAudit`). `state.ts` rozšířen o `npcDefinitions` / `npcInstances` / `npcsByChunk` chunk index + `dialogSessions` per-player, NPC instances spawnnuty v `matchInit` na `default_position`, NPC entries injectovány do `WORLD_SNAPSHOT` joiner-only (3×3 chunk scope), dialog dispatch (INTERACT_NPC=30 / DIALOG_CHOOSE=111 / DIALOG_CLOSE=112) wired v `matchLoop`, `cleanupDialogSession` v `matchLeave`. Client: `client/src/ui/DialogPanel.ts` DOM overlay (speaker emoji portrait + display name label + node text + vertical option buttons s hover styling, ESC nebo "Sbohem" close), `WorldScene` napojení (`DIALOG_OPEN` → showNode, `DIALOG_CLOSE` → hide, click-to-talk priority před mob/drop/move click handlerem, world clicks ignored když je dialog open), `EntityManager.spawnNpc` reuse character spritesheetu s per-NPC tint (`npc.kovar_blatiny` → 0xd49d4f amber, `npc.selka_hospoda` → 0xc8d4ad pale lime). Phase 9 záměrně skrývá `show_if`-gated options (Phase 11+ doplní real knowledge / quest / reputation gates). 21 nových server unit testů (`parseInteractNpcRequest` / `parseDialogChooseRequest` / `isOptionVisible` / NPC + dialog catalog integrity — 121 server + 71 shared total). Playwright `dialog.spec.ts`: spawn → INTERACT_NPC → DIALOG_OPEN s "Starý Kovář" speakerem + 3 options (gated lore option hidden) → click "Co máš na prodej?" → text changes na shop_node → "Sbohem" close → 0 console errors.
- **2026-05-06** — **Phase 11 dokončena**. Shared: `shared/src/types/quest.ts` (`QuestDefinition` + `QuestStepDefinition` + `QuestObjectiveDefinition` discriminated union pro `talk_to_npc` / `kill_mob` / `interact_with_object` + `QuestRewardDefinition` + `QuestPrerequisites` + `PlayerQuestProgress` + `PlayerQuestBlob` + `asPlayerQuestBlob` narrowing helper + `emptyQuestBlob` factory + `QuestObjectDefinition`), `shared/src/messages/quest.ts` (`QuestProgress` event 'started'/'advanced' + `QuestCompleted`), `DialogOptionVisibility` rozšířen o `reputation_min: { village_id, value }` (přejmenováno z plain number) + `quest_state.current_step_id?` + `quest_state.not_current_step_id?` pro fine-grained kovář dialog větvení. `WorldSnapshotEntity` + `EntitySpawned` přidávají `quest_object` type + `quest_object_id` field. Nová `STORAGE_COLLECTIONS.PLAYER_QUESTS` collection + `InteractObjectRequest.action` enum rozšířen o `'interact'`. Server data: `server/data/quest_objects.json` s krvavým amuletem (38,38), `server/data/quests/synovec_kovar.json` (3-step lore quest s `interact_with_object` → `kill_mob` → `talk_to_npc` objectives + rewards xp.melee 1500/thievery 300/vitality 200, weapon.melee.sword.bronze, 250 denárů, knowledge lore.polednice_origin, reputation village.blatiny +200), nová `mob.hastrman` (lvl 8, HP 45, melee, dmg 2-5) + spawn (40,40) + `loot.hastrman` (bones + raw_meat + 10-25 denárů), kovář NPC dostává `quest_giver: true` flag, dialog `kovar_blatiny` rozšířen o 4 nové nodes (polednice_quest_offer/in_progress/complete/lore_after) + 4 nové gated options v root (quest_offer/quest_active_check/quest_complete/quest_lore) demonstrující všechny `show_if` brány (quest_state s current_step_id/not_current_step_id + knowledge). Server: `server/src/lib/quests.ts` (static catalog loader), `server/src/match/quest.ts` (engine — `loadPlayerQuestBlob` lazy-create + `getQuestBlob` mirror, `tryStartQuest` s prerequisites validation knowledge/completed_quests/min_reputation, `progressObjective` discriminated dispatcher pro 3 objective types + automatic step advance + `completeQuest` s reward distribution: XP přes existující `awardXp` source='quest', items+denáry přes OCC retry na PLAYER_INVENTORY, knowledge dedup add, reputation clamp 1000 max, blob persist přes OCC retry, broadcast QUEST_PROGRESS/QUEST_COMPLETED unicast, `unlockKnowledge` idempotent + `changeReputation` clamping helpers + `checkOptionVisibility` pure gate evaluator, `sendActiveQuestsSnapshot` pro matchJoin reload), `server/src/match/state.ts` rozšířen o `QuestObjectInstanceState` + chunk index helpers `addQuestObjectToChunk` / `removeQuestObjectFromChunk` / `getQuestObjectsInChunkArea` + `playerQuestBlobs` mirror + `playerQuestVersions` cache + `questObjectInstances` + `questObjectsByChunk`. `server/src/match/dialog.ts` `isOptionVisible(option, state, userId)` plně evaluuje show_if přes blob; `applyDialogEffect` implementuje `unlock_knowledge`/`change_reputation`/`start_quest` (broadcast QUEST_PROGRESS event='started')/`complete_quest_step` (delegate na progressObjective). `server/src/match/inventory.ts` rozšiřuje INTERACT_OBJECT handler o `action='interact'` branch s `handleQuestObjectInteract` (Chebyshev ≤ 2 + propagace na progressObjective, MVP: globálně viditelný objekt — opakovaný interact je no-op idempotentně, per-player consume_on_interact je odsunut na Phase 12+). `server/src/match/combat.ts` po awardXp v `handleMobDeath` volá progressObjective(type:kill_mob). `server/src/match/world.ts` matchInit načítá quest_objects, matchJoin volá loadPlayerQuestBlob + sendActiveQuestsSnapshot, WORLD_SNAPSHOT zahrnuje quest objekty (3×3 chunk + ne-consumed filter), matchLeave čistí quest mirror. `server/src/rpc/profile.ts` inicializuje empty PlayerQuestBlob při char create. Klient: `client/src/ui/QuestPanel.ts` DOM overlay (toggle [Q] nebo HUD button — aktivní questy s title + step description + kill_mob counter, deník dokončených questů s ✓ markem, vždy re-render i pokud hidden). `client/src/world/EntityManager.ts` `spawnQuestObject` — placeholder magenta hvězda + label, `findQuestObjectAtTile` + `getQuestObjectPosition`. `client/src/scenes/WorldScene.ts` napojení (QUEST_PROGRESS dispatch + 'started' toast + 'Synovec Starého Kováře' append do panelu, QUEST_COMPLETED dispatch + reward toasty (denáry + knowledge unlocks), click-to-interact flow s `tickQuestObjectApproach` analogický gather/NPC approach, click priority quest_object > mob > drop > move). 14 nových server unit testů v `quest.test.ts` (catalog integrity 3× / tryStartQuest 4× / progressObjective kill_mob 3× / interact_with_object 1× / completion full reward flow 1× / unlockKnowledge+changeReputation 3× / checkOptionVisibility post-quest 1×), 11 doplněných `dialog.test.ts` testů na `checkOptionVisibility` (knowledge gates, reputation_min schema změnu, quest_state s current_step_id/not_current_step_id, completed gate). Smoke test `client/tests/smoke/quest.spec.ts` — full flow: boot → guest auth → kovář dialog → quest_offer option → start_quest effect → QuestPanel zobrazí "Synovec Starého Kováře" → MOVE_REQUEST k amuletu (38,38) → INTERACT_OBJECT → quest log update na Hastrman step. Celkem 79 shared + 165 server testů + 8 Playwright smoke (přidán quest.spec.ts; updated dialog.spec.ts option count 4→5 kvůli novému quest_offer option v root). PR pending.
- **2026-05-06** — **Phase 10 dokončena**. Shared: `shared/src/types/gathering.ts` (`ResourceNodeDefinition` typ + `CraftStationDefinition`), `shared/src/messages/gathering.ts` (GATHER_RESOURCE/PROGRESS/COMPLETED + CRAFT_REQUEST/PROGRESS/COMPLETED payloady), `shared/src/skills/rarity.ts` čistý `rollCraftedRarity` (T1 95/5/0, T2 85/13/2, T3 70/25/5, T4 50/35/15) + `rollCraftFail`. EntitySpawned + WorldSnapshotEntity rozšířeny o `resource_node` / `craft_station` discriminated typy. Server data: `server/data/resource_nodes.json` (5 nodes — 3× kámen yielding 10× pazourek, 1× měděná žíla yielding 3× ruda, 1× dub yielding 2× dřevo) + `server/data/craft_stations.json` (smith_forge.kovar u kováře 26,25) + `server/data/recipes.json` (3 standardní recepty: whetstone.t1 1× pazourek → 1× brusek smithing 1, weapon.dagger.bronze 1× měď + 1× dub → 1× bronzová dýka smithing 1, weapon.sword.bronze 2× měď + 1× dub → 1× bronzový meč smithing 5; všechny smith_forge + tool.hammer). Items doplněny: `material.stone.flint`, `tool.pickaxe.bronze`, `tool.axe.bronze`. Server: `server/src/lib/recipes.ts` static catalog loader (recipes / nodes / stations), `server/src/match/state.ts` rozšířen o `ResourceNodeInstanceState` + `GatherSessionState` + `CraftSessionState` + chunk index helpers `addResourceNodeToChunk` / `addCraftStationToChunk`. `server/src/match/gathering.ts` `handleGatherResource` (rate limit 5/s, Chebyshev ≤ 2 range, tool inventory check, skill level gate, cancel competing session, start session), `advanceGatherSessions` (per-tick range re-check + 500ms progress broadcasts + completion → OCC inventory add + ENTITY_DESPAWNED + GATHER_COMPLETED + XP via `awardXp`), `checkResourceNodeRespawns` (RESOURCE_RESPAWN_CHECK_INTERVAL=15s tick, mark available + ENTITY_SPAWNED), `cancelGatherSession`. `server/src/match/crafting.ts` `handleCraftRequest` (rate limit 5/s, recipe lookup, prerequisites validation: skill level + tool + station proximity ≤2 + inputs + free output capacity, MAX_CRAFT_BATCH=50), `advanceCraftSessions` (per-cycle station re-check + progress broadcasts + cycle completion: re-validate + OCC consume inputs + roll fail/rarity + add output + XP, decrements remainingCycles → start next cycle nebo batch_done), `cancelCraftSession`. `server/src/match/world.ts` matchInit naloaduje resource nodes + stations do state, matchJoin WORLD_SNAPSHOT zahrnuje available nodes + všechny stations v 3×3 chunk scope, matchLoop dispatchuje GATHER_RESOURCE / CRAFT_REQUEST + volá `advanceGatherSessions` / `advanceCraftSessions` / `checkResourceNodeRespawns`, MOVE_REQUEST success ruší jakoukoli probíhající gather/craft session, matchLeave čistí gather + craft session. Klient: `client/src/world/EntityManager.ts` rozšířen o `spawnResourceNode` (placeholder colored circle + label) + `spawnCraftStation` (placeholder rectangle + label) + `findResourceNodeAtTile` / `findCraftStationAtTile` / `isStationInRange`. `client/src/ui/CraftingPanel.ts` DOM overlay (toggle [C] nebo HUD button, recipe rows s 1×/5×/30× tlačítky, status řádek s progress + outcome). `client/src/ui/GatherProgressBar.ts` floating bar (zobrazí se na GATHER_PROGRESS, fade na GATHER_COMPLETED). `client/src/scenes/WorldScene.ts` napojení (handleResourceNodeClick + tickGatherApproach analogický NPC click flow, GATHER_PROGRESS / GATHER_COMPLETED / CRAFT_PROGRESS / CRAFT_COMPLETED dispatch, klik na craft station otevře panel, `+stone toast` při gather completion). 23 nových unit testů (rarity 11× / gather parser + catalog 9× / craft parser + catalog 12×) + Playwright `gathering.spec.ts` (5+ resource nodes + 1+ smith_forge spawnnuté, crafting panel toggle [C] → 3+ recipe rows render → close, gather bar attached). Celkem 79 shared + 140 server testů + 7 Playwright smoke. PR pending.
- **2026-05-07** — **Phase 12 UX hardening (po reálném otestování)**. User reportoval 3 P0 bugy: (a) klik „Vzít úkol" nedělal nic viditelného, (b) „Vyzvednout odměnu" se nikdy neukazovalo, (c) QuestPanel zobrazoval `blatiny.deliver_bones` místo českého titulku. Diagnostika + opravy: **Bug A** root cause — server po unicast `JOB_TASK_PROGRESS event=taken` (taken_by_self=true) okamžitě posílal broadcast `JOB_BOARD_UPDATED` s `changed=[task]` projektovaným **bez per-player kontextu** (`projectTaskView(task, null, null)` ⇒ taken_by_self=false), klient v `onUpdated` přepsal svůj lokální per-player stav. Fix v `JobBoardPanel.onUpdated`: při merge changed entries zachovat lokální `taken_by_self` / `self_progress` / `self_submittable` z předchozího stavu, brát ze server payloadu jen globální fieldy (`current_takers`, `priority_bonus_multiplier`, atd.). **Bug B** — pro deliver_item server vrací `self_submittable: false` (server netracuje inventory v progress mapě, server validuje až při submit), klient nikdy nepřepočítal lokálně. Fix: nová `JobBoardCallbacks.getInventoryCount` callback, klient v `effectiveSubmittable(task)` pro deliver_item počítá `getInventoryCount(target) >= count`, render zobrazí counter `Doručit X: have/need`. WorldScene po `INVENTORY_CHANGED` volá `jobBoardPanel.onInventoryChanged()` + `questPanel.onInventoryChanged()` — sebrání itemu okamžitě odemkne „Vyzvednout odměnu" tlačítko bez čekání na server tick. **Bug C** — `QuestPanel.onJobProgress` měl fallback `payload.template_id`, který se použil když klient ještě neznal task definici. Fix v shared message: server vždy posílá `title` + `description` + `objective` v `JOB_TASK_PROGRESS` (přes nový helper `buildProgressPayload`), klient z payloadu okamžitě staví minimal `JobBoardTaskView` pro QuestPanel render. **Plus**: nový opcode `JOB_TASK_REJECTED=78` + payload `JobTaskRejected { action, reason, task_id?, detail? }` se 9 reason kódy (`unknown_task`, `task_full`, `already_taken`, `not_taken`, `out_of_range`, `inventory_short` s detailem `{item_id, need, have}`, `objective_not_met`, `rate_limited`, `no_issuer_in_range`); refactor všech handlerů (`handleJobBoardOpenRequest`, `handleJobTaskTaken`, `handleJobTaskSubmit`, `handleJobTaskAbandon`) — žádný silent return, vždy reject s reason. Klient `WorldScene.handleJobTaskRejected` + `formatJobRejectReason` lokalizuje na české toasty (např. „Odevzdat úkol: chybí ti 3× material.bone (máš 2/5)."). Acceptance toasty: `event=taken` → „Úkol přijat: <title>", `event=abandoned` → „Úkol zrušen: <title>", `event=expired` → „Úkol vypršel: <title>", `event=progress` + submittable → „Úkol připraven". `WorldScene.handleJobBoardOpen` volá `dialogPanel.hide()` před panelem (open_job_board dialog effect má next:null = DIALOG_CLOSE jde také, ale order není garantovaný). Server `cleanupOrphanJobs` v matchJoin: pro task_ids v `blob.jobs` které neexistují v `state.jobBoardTasks` (server restart fresh pool / fulfilled_max expirace) pošle klientu `JOB_TASK_PROGRESS event=expired` + odstraní z blobu + persist; pak teprve `sendActiveJobsSnapshot` posílá pouze validní entries. Stable DOM identifikátory (`data-task-id`, `data-taken`, `data-action`) na panelu pro deterministic Playwright selektory. 6 nových server unit testů (`task_full` / `out_of_range` / `already_taken` reject reasons; JOB_TASK_PROGRESS event=taken obsahuje title; submit reject `not_taken` / `objective_not_met` / `inventory_short` s detail; abandon success/reject; cleanupOrphanJobs cleans + sends 'expired' / keeps valid). 3 nové Playwright smoke testy: full take/abandon flow s ověřením stable DOM a českého titulku v QuestPanelu, out_of_range reject přes JOB_BOARD_OPEN_REQUEST, deliver_item flow (take → patch inventory → submittable button viditelné → submit → abandon cleanup). Celkem **79 shared + 196 server testů + 11 Playwright smoke** (vše zelené po regression check).
- **2026-05-07** — **Phase 12 dokončena**. Shared: `shared/src/types/jobBoard.ts` (`JobBoardObjectiveDefinition` discriminated kill_mob/deliver_item, `JobBoardReward`, `JobBoardTaskTemplate`, runtime `JobBoardTask`, `PlayerJobBoardEntry`, `CompletedJobEntry`), `shared/src/messages/jobBoard.ts` (`JobBoardOpenRequest/Open`, `JobTaskTakenRequest`, `JobTaskSubmitRequest`, `JobTaskAbandonRequest`, server-→-client `JobBoardTaskView` + `JobTaskProgress`/`JobTaskCompleted`/`JobBoardUpdated`). Opcodes 60-69 zaplněny: 62 JOB_TASK_TAKEN, 63 JOB_TASK_PROGRESS, 64 JOB_TASK_COMPLETED, 65 JOB_BOARD_UPDATED + nové 66 JOB_BOARD_OPEN_REQUEST, 67 JOB_BOARD_OPEN, 68 JOB_TASK_SUBMIT, 69 JOB_TASK_ABANDON. `DialogEffect` rozšířen o `open_job_board { village_id }`. `XpAwarded.source` enum doplněn `'job'`. `PlayerQuestBlob` rozšířen o `jobs` (active per-task entries) + `jobs_completed` (deník) + backward-compat narrowing v `asPlayerQuestBlob`. Server data: `server/data/job_board_templates.json` (5 templates pro `village.blatiny`: deliver kosti×5/pazourek×8/dub×4 + kill rats×3/wolves×2 — všechny issued+delivered to Selka), `server/data/dialogs/selka.json` rozšířen o option "Co je na hospodském boardu?" s `open_job_board` effect (next: null = effect-only). Server: `server/src/lib/jobBoardTemplates.ts` static catalog loader (per-village index), `server/src/match/jobBoard.ts` engine — `seedInitialJobBoard` v matchInit, `pickTemplateWeighted` (random vážený), `priorityForAge` (5 min → 1.2×, 15 min → 1.5×, 30 min → 2.0×; MVP zkrácené z docs hodnot 24h/48h/5d), `runJobBoardGenerationTick` (každých `JOB_BOARD_GENERATION_INTERVAL` = 30 min: aging existing + expirace > 60 min bez takerů + refill pool do `POOL_TARGET_SIZE=5`), `handleJobBoardOpenRequest` (ručně requestnutý view, range check k issuer NPC ≤ 2), `sendJobBoardOpen` (volá se i z dialog effectu `open_job_board`), `handleJobTaskTaken` (max_concurrent_takers gate + range check + per-player blob entry persist), `progressJobObjectivesKillMob` (volá se z `combat.handleMobDeath` po awardXp + quest.progressObjective; iteruje aktivní jobs, capuje progress na count, broadcastuje `JOB_TASK_PROGRESS` unicast), `handleJobTaskSubmit` (range k deliver_to NPC + objective re-validace: kill_mob progress check, deliver_item OCC inventory deduct via `tryDeductDeliveryItems`, reward distribuce přes `awardXp` source='job' + currency add + reputation clamp 1000, fulfilled_count++ s expirací při `fulfilled_max`), `handleJobTaskAbandon` (entry remove + current_takers decrement). `state.ts` rozšířen o `jobBoardTasks` / `jobBoardTasksByVillage` / `jobBoardCounter`. `world.ts` matchInit volá `seedInitialJobBoard(0)`, matchJoin re-attachne hráče do `taker_user_ids` aktivních tasků (po reconnect), matchLeave uvolní slot ve všech taskech kde byl takerem (current_takers reflektuje connected hráče), matchLoop dispatchuje 4 nové opcodes + volá `runJobBoardGenerationTick`. `combat.ts` po quest progressObjective volá `progressJobObjectivesKillMob`. `dialog.ts` `applyDialogEffect` přidán case `open_job_board` (resolve npc.npcId → sendJobBoardOpen). Klient: `client/src/ui/JobBoardPanel.ts` DOM overlay (centered modal, header s X close, task rows: title + URGENTNÍ badge (priority ≥ 2.0) / +N% bonus, description, objective+reward+takers meta line, akční tlačítka „Vzít úkol" / „Vyzvednout odměnu" / „Zrušit" podle stavu, sort: taken_by_self → priority desc → task_id), rozšířený `client/src/ui/QuestPanel.ts` o sekci "Hospodské úkoly" (kill_mob counter + ready ✓ marker při submittable). `WorldScene` napojení (4 nové opcode handlery + lazy `ensureJobBoardPanel` po prvním JOB_BOARD_OPEN, JOB_TASK_COMPLETED toast). 25 nových server unit testů v `jobBoard.test.ts` (catalog 3× / priorityForAge 2× / pickTemplateWeighted 2× / isObjectiveSatisfied 3× / makeTaskFromTemplate 1× / seedInitialJobBoard 1× / handleJobTaskTaken 3× / progressJobObjectivesKillMob 3× / handleJobTaskSubmit 4× / handleJobTaskAbandon 1× / projectTaskView 2×) — celkem 190 server + 79 shared = **269 testů**. Playwright `jobboard.spec.ts` smoke (Selka dialog → "Co je na hospodském boardu?" → JOB_BOARD_OPEN → panel render s template tituly + Vzít úkol tlačítky → close X). Parking lot pro post-MVP: `economic_state` model vesnice, escort/repair objective types, multi-village pool, persistence napříč server restarty (MVP regeneruje fresh pool při matchInit). PR pending.
- **2026-05-06** — **Phase 8 dokončena**. Shared: `shared/src/skills/xp.ts` (RSC-style exponential lookup `xp(L) = floor((L + 250 · 2^(L/7))/4)`, lvl 99 ≈ 9M XP — provisional cíl 10M, ladí se post-MVP, `xpForLevel` / `levelForXp` / `levelProgress`), `shared/src/skills/award.ts` čistá funkce `distributeXpAward(xpAward, skilly, atributy, sources)` — klasifikuje vstupní `Record<string, number>` podle `ATRIBUT_NAMES` set (atribut vs skill), source skill = první non-atribut entry s positive amount, diminishing returns přes hard threshold (`SOFTCAP_LEVEL=60` → `SOFTCAP_OVERFLOW_FACTOR=0.2`) tracked v per-(atribut, source_skill) `xp_contributed` accumulátoru. Nový `irij-shared/skills` subpath export. Opcodes `XP_AWARDED=76` a `LEVEL_UP=77` v 70-79 system rangi. Server: `server/src/match/xp.ts` `awardXp` glue — volá pure distribuci, mutuje `PlayerPresenceState` (skilly/atributy/sources/totalLevel/totalXp top-level reassign per Goja constraint), write-through do `PLAYER_SKILLS` storage (single batched `nk.storageWrite` per kill), broadcast XP_AWARDED unicast killerovi + 1× LEVEL_UP unicast per leveled-up entry. `matchJoin` rozšířen o read PLAYER_SKILLS a load do presence (kick při missing blob). `runCombatTick` + `handleMobDeath` propagují `nk` parametr pro storage zápisy. Klient: `client/src/ui/SkillPanel.ts` DOM overlay (toggle [K] nebo HUD button, 4 atributy + 17 skillů s lokalizovanými CS labels + emoji ikonami, XP bar přes `levelProgress`, total level v headeru), `WorldScene` napojení (`XP_AWARDED` toast „+200 Boj zblízka", `LEVEL_UP` toast žluté „LEVEL UP! Boj zblízka → 3", state mirror přes `handleXpAwarded` / `handleLevelUp`, `localizeXpName` mapuje skill/atribut keys na CS displaye). Stávající XP toast v `handleEntityDied` byl nahrazen XP_AWARDED kanálem (mob's nominal `xp_award` v ENTITY_DIED zůstává jako metadata pro ostatní hráče). 20 nových shared unit testů (XP curve monotone + 99 boundary + roundtrip; distributeXpAward klasifikace + diminishing + level_ups + immutability) + Playwright `skills.spec.ts` (panel toggle, render všech 21 řádků, XP_AWARDED → total level update). Celkem 71 shared + 100 server testů. PR #32.
