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

- [ ] Implementovat `client/src/render/projection.ts` — `worldToScreen(x, y)` a `screenToWorld(sx, sy)` per ADR-018
- [ ] Implementovat `client/src/render/ysort.ts` — helper pro depth-by-y sprite sort
- [ ] Vytvořit **Tiled** test mapu 50×50 dlaždic, **isometric orientation, 64×32 px tile footprint**
- [ ] Najít / vyrobit první tileset (placeholder — Kenney isometric set, nebo přiložený `Isometric_tileset.zip` ve workdir, nebo AI generated). **Top-down assety nepoužitelné.**
- [ ] V `client/public/maps/` uložit `test_50x50.tmj` (Tiled JSON export, isometric) + tileset PNG
- [ ] V `WorldScene.preload()` načíst mapu + tileset
- [ ] V `WorldScene.create()` vytvořit Phaser Tilemap (`orientation: ISOMETRIC`), render terrain layer
- [ ] Načíst placeholder character sprite (4 směry pro iso kompas), render na startovní pozici
- [ ] Camera follow (`this.cameras.main.startFollow(player)`) — operuje na screen coords po projekci
- [ ] Phaser Scale.RESIZE responsivně reaguje na resize okna
- [ ] **Demo:** isometric mapa + statická postava uprostřed, zoom OK na desktop i na mobil

---

## Phase 4 — Server-authoritative movement ⏱ ~5-7 dnů

Cíl: dva hráči se vidí pohybovat, server rozhoduje, klient interpoluje.

- [ ] V `server/src/match/world.ts`:
  - [ ] Implementovat `matchInit` (registruj match jako `world.main`)
  - [ ] V `matchJoin` načíst player state ze Storage, uložit do `state.presences`
  - [ ] Implementovat handler pro `Op.MOVE_REQUEST`
  - [ ] Validovat target je walkable, vzdálenost ≤ MAX_PATH_LENGTH
  - [ ] Pathfinding A* na walkable masce mapy (přidat knihovnu nebo napsat ručně)
  - [ ] V `matchLoop` posunovat hráče po tile-by-tile podle path
  - [ ] Broadcast `Op.ENTITY_MOVED` 10× za sekundu všem v match
- [ ] V klientovi:
  - [ ] Po loginu: `socket.joinMatch('world.main')`
  - [ ] Click-to-move: detect tile click, send `MOVE_REQUEST`
  - [ ] Subscribe na `ENTITY_MOVED`, interpoluj sprite movement
  - [ ] Render ostatní hráče (nový sprite per presence)
- [ ] Otevři dvě browser okna (anebo browser + telefon na LAN), ověř že se vidí
- [ ] **Demo:** video s dvěma postavami pohybujícími se ve světě

**Anti-cheat checkpoint:** pokus se v dev tools poslat `MOVE_REQUEST` s `target: {x: 99999, y: 99999}` — server musí odmítnout. Pokud to projde, fixni dřív než pokračuješ.

---

## Phase 5 — Persistence ⏱ ~2 dny

Cíl: pozice + inventář přežijí logout/login.

- [ ] V `matchLoop` autosave každých 30 s — flush `state.presences[playerId]` do Storage
- [ ] V `matchLeave` final flush + zaznamenat `last_logout_at`
- [ ] V `matchJoin` načíst `current_position`, spawnut tam
- [ ] **Demo:** pohybuj se, zavři okno, znovu se připoj, postav se objeví na poslední pozici

---

## Phase 6 — První mob + combat ⏱ ~5-7 dnů

Cíl: vlk v lese, lze ho zabít, dropuje loot, dává XP.

- [ ] V `server/data/mobs.json` definovat `mob.wolf` (level 5, HP 30, melee)
- [ ] V `server/data/loot_tables.json` definovat `loot.wolf`
- [ ] V `server/src/match/world.ts` mob spawn logic
  - [ ] V `matchInit` načíst spawn pointy z mapy
  - [ ] Spawnout `mob.wolf` instance v `state`
  - [ ] AI tick (každých 500 ms): detekce hráče v aggro_radius, chase, leash návrat
- [ ] Handler `Op.ATTACK_REQUEST`
  - [ ] Validace dosah, cooldown, target alive
  - [ ] Combat tick (300 ms): resolve damage, broadcast `COMBAT_RESOLVED`
- [ ] Mob death: roll loot table, spawn drop entities, broadcast `ENTITY_DIED`
- [ ] Klient: render mob sprite, attack button, HP bar, floating damage text
- [ ] **Demo:** zabít vlka, vidět loot na zemi (ještě bez pickupu)

---

## Phase 7 — Inventář + equipment ⏱ ~5-7 dnů

Cíl: pickup loot, inventář UI, equip zbraň, holster system.

- [ ] V `server/data/items.json` definovat MVP item katalog (~20 itemů — sword bronze/iron, leather armor, whetstone t1, food bread, materials)
- [ ] Server: handler pro `INTERACT_OBJECT` na drop entitu → přesunout item do inventáře
- [ ] Server: validace inventory full
- [ ] Server: handlery `EQUIP_REQUEST`, `UNEQUIP_REQUEST`, `ITEM_USE_REQUEST`, `ITEM_DROP_REQUEST`
- [ ] Server: holster system — auto-pull při combat akci, atd.
- [ ] Klient: inventář UI panel (24 slotů), drag-drop nebo click-to-equip
- [ ] Klient: equipment panel (10 slotů + holster)
- [ ] Klient: render equipped weapon sprite na postavě (layered)
- [ ] **Demo:** zabít vlka, sebrat dýku, equipnout, vidět změnu vizuálu postavy

---

## Phase 8 — XP + skilly ⏱ ~3-4 dny

Cíl: combat dává XP, levely rostou, atributy fractional XP fungují.

- [ ] Implementovat XP curve (lookup table 1-99, 99 ≈ 10M)
- [ ] Server: na kill mob → `xp_award` z mob def → split mezi skill + atributy (skills.md fractional curve)
- [ ] Diminishing returns logika (`PlayerAtributSource` tracking)
- [ ] Broadcast `STATUS_EFFECT_APPLIED` při level up (vizuální celebration)
- [ ] Klient: skill panel UI s atributy + skilly + XP bary
- [ ] Klient: level up notifikace ("LEVEL UP! Útok 6→7")
- [ ] **Demo:** zabít 5 vlků, vidět melee skill stoupat, atributy fractional přidávat

---

## Phase 9 — První NPC + dialog ⏱ ~5-7 dnů

Cíl: Starý Kovář v Blatinách stojí na mapě, dá se s ním pokecat.

- [ ] V `server/data/npcs.json` definovat `npc.kovar_blatiny` s flagy
- [ ] V `server/data/dialogs/kovar_blatiny.json` definovat dialog tree
- [ ] Server: `INTERACT_NPC` handler s validacemi
- [ ] Server: dialog engine — node lookup, option filtering podle knowledge/quest/reputation
- [ ] Server: efekty (give_item, deduct_currency, unlock_knowledge, change_reputation, start_quest)
- [ ] Klient: dialog UI — speaker portrait, text, options
- [ ] Klient: lokalizace (zatím jen CS, framework připravený)
- [ ] **Demo:** přijdi ke kováři, vyber option "Co máš na prodej?", dostaň item za denáry

---

## Phase 10 — Gathering + crafting ⏱ ~5-7 dnů

Cíl: těžit rudu, kovat brus, použít v boji.

- [ ] V mapě označit `tile_meta` pro mining nodes (kamenolom)
- [ ] V `server/data/recipes.json` definovat 3-5 receptů (brus, dýka, šíp, chléb)
- [ ] Server: `GATHER_RESOURCE` handler s validacemi (tool, level, dosah)
- [ ] Server: gather progress + completed broadcast
- [ ] Server: `CRAFT_REQUEST` handler — validace inputs, station proximity, fail roll
- [ ] Server: rarity rolling (T1 → 95/5/0/0)
- [ ] Klient: gather animation + progress bar
- [ ] Klient: crafting UI panel — list dostupných receptů, queue
- [ ] **Demo:** vytěž 3× kámen, dojdi do kovárny, ukov 30× brusů, použij v boji

---

## Phase 11 — První quest ⏱ ~5-7 dnů

Cíl: jeden lore quest end-to-end (start dialog → kroky → reward).

- [ ] Napsat **kvalitní lore quest** "Synovec Starého Kováře" — 3 kroky, lore text, větvení dialog
- [ ] V `server/data/quests/` JSON definici
- [ ] Server: quest state machine — start, progress, complete
- [ ] Server: objective handlers (`talk_to_npc`, `kill_mob`, `interact_with_object`)
- [ ] Server: reward distribuce (XP, item, denáry, knowledge unlock, reputace)
- [ ] Klient: quest log UI — aktivní questy, progress, map markery
- [ ] Klient: quest deník (completed, čtitelný lore)
- [ ] **Demo:** projít celý quest, dostat odměnu, knowledge unlock se objeví v deníku

---

## Phase 12 — Job board MVP ⏱ ~5-7 dnů

Cíl: hospodský board s procedurálně generovanými tasky.

- [ ] V `server/data/job_board_templates.json` definovat 5-10 templates
- [ ] Server: procedurální generátor (každých 30 min new tasky podle vesnické economic_state)
- [ ] Server: shared pool s `max_concurrent_takers`
- [ ] Server: aging mechanika (priority bonus pro zapomenuté tasky)
- [ ] Server: `JOB_TASK_TAKEN`, `JOB_TASK_PROGRESS`, `JOB_TASK_COMPLETED` handlery
- [ ] Klient: job board UI v hospodě (NPC interakce → list tasků)
- [ ] Klient: aktivní tasky panel
- [ ] **Demo:** vezmi task "Pekař potřebuje 20× mouky", vyrob/seberi, odevzdej, dostan reward

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

---

## Změnový log

- **2026-05-03** — Draft 1, vytvořeno na základě dokončeného design phase. Phases 0-22 + pre-flight + týdenní rituály + risk checkpoints + parking lot.
- **2026-05-03** — **Phase 0 dokončena** (PR #1). Lokální stack běží: Postgres 16 + Nakama 3.24 v Dockeru, klient přes Vite dev server na :5173, runtime modul načten z `server/dist/index.js`.
- **2026-05-03** — **Phase 1 dokončena** (PR #2 + PR #4). Persistentní guest auth přes `authenticateDevice` + WebSocket session, `device_id` v `localStorage`, Boot → Login → World scene flow s funkčním error retry. Login screen má placeholder buttony pro Discord / Google / E-mail (Phase 19). Na okraj přidán **ADR-018 — isometric rendering kontrakt** (PR #3): drift fix vůči [01 Scope](01-scope-and-pillars.md), explicitní lock 2:1 dimetric projekce + Y-sort konvence pro Phase 3+.
- **2026-05-03** — **Phase 2 dokončena**. Server: `rpc.profile.create_character` (validace username regex + unikátnost, display_name UTF-8 length, gender enum, appearance 0–11 ranges; init Player + 4 atributy + 17 skillů + 24-slot inventory + 11-slot equipment ve třech Storage kolekcích) a `rpc.profile.get_self` (kompletní player state nebo `{exists:false}`). Klient: `CharacterCreationScene` (text-mode form, Tab/šipky/Enter), Boot → Login → CharCreate / WorldScene routing podle existence postavy, `client.rpc` HTTP wrapper v [client/src/rpc.ts](../client/src/rpc.ts). Demo ověřeno přes Playwright: 3 postavy v DB s plnými bloby ve všech kolekcích, re-login po reload trefí WorldScene přímo.
- **2026-05-03** — **Nakama upgrade 3.24.0 → 3.38.0**. Po dotazu uživatele jsem dohledal, že 3.24.0 + 3.24.1 mají bug způsobující `400 "RPC ID must be set"` na všechny HTTP `/v2/rpc/{id}` calls (fix v 3.24.2, viz [forum thread](https://forum.heroiclabs.com/t/nakama-upgrade-3-24-1-then-error-rpc-id-must-be-set-message-rpc-id-must-be-set-code-3/5725)). Bumpli jsme rovnou na latest stable 3.38.0, abychom v MVP fázi měli aktuální stack. `nakama-runtime` v1.45.0 (server-side TS API) je s 3.38.0 kompatibilní bez změn. Klientský `callRpc` helper se vrátil z dočasného `socket.rpc` workaroundu na čistý `client.rpc` HTTP.
