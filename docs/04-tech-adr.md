# 04 — Tech Architecture Decision Record

**Stav:** Draft 1 — 2026-05-01
**Účel:** Zaznamenat technologická rozhodnutí, jejich důvody a alternativy. Pomáhá za 6 měsíců, kdy zapomeneš proč jsi co zvolil.
**Sourozenci:** 01 Scope, 02a-e Data model, 03 Message katalog (next), 05 Style guide.

---

## Kontext

- **Hra:** browser-first 2D MMO ve stylu RSC, slovanský folklór, ~100 CCU target
- **Vývojář:** sólo (ty), silný programátor, AI asistence významná
- **Platformy:** desktop browser (primární) + mobil (PWA, first-class)
- **Rozsah:** série dokumentů 02 obsahuje kompletní logický data model a herní design
- **Nefunkční požadavky:** server-authoritative (anti-cheat), škálovatelný do 50 000×50 000 dlaždic, EU latence, self-hostable

---

## ADR-001: Klientský engine = **Phaser 3** (potvrzeno)

**Status:** Accepted

**Rozhodnutí:** Phaser 3 (latest LTS, v3.85+) jako klientský engine, TypeScript jako jazyk.

**Důvody:**
- 2D pixel-art isometric je core vizuální volba (rozhodnutí [01 Scope](01-scope-and-pillars.md), engineering detail v [ADR-018](#adr-018-isometric-rendering--explicitní-engineering-kontrakt)) → 2D-first engine = Phaser
- TypeScript ekosystém je nejlépe pokrytý LLM/Claude tooling
- Phaser nativně podporuje touch + mouse (mobile/desktop sjednoceno)
- Tilemap support hotový (Tiled editor → JSON → Phaser Tilemap)
- PWA-ready, servable jako static bundle z CDN
- Komunita + příklady masivní

**Zvažované alternativy:**
- **Babylon.js** — odmítnuto: 3D-first, neoptimální pro pixel art
- **Godot 4 HTML5** — odmítnuto: komunitní SpacetimeDB SDK, web export má bottlenecky, MCP zralé ale ekosystém pro web menší než Phaser
- **PixiJS přímo** — odmítnuto: low-level, Phaser nad ním již má vrstvu kterou bychom psali sami
- **Unity WebGL** — odmítnuto: brand-trust hangover, AI tooling slabší pro web
- **Vlastní engine na canvas/WebGL** — odmítnuto: scope creep

**Důsledky:**
- Build pipeline: Vite + TypeScript
- Bundle target: ESM modules, modern browsers (ES2022+)
- Mobile: stejný bundle jako desktop, responsivní UI vrstva (viz ADR-013)

---

## ADR-002: Backend = **Nakama** (potvrzeno)

**Status:** Accepted

**Rozhodnutí:** [Nakama](https://heroiclabs.com/nakama/) (Heroic Labs), self-hosted v Dockeru.

**Důvody:**
- Battle-tested (testováno na 2M CCU), production-grade
- First-party JavaScript/TypeScript klient SDK
- Built-in: auth, friends, chat, leaderboards, matches, storage, RPC
- Match handler pattern přímo passuje na náš design (server-authoritative game state)
- Self-hostable, Apache 2.0 license — žádný vendor lock-in
- Postgres backend internally → můžeme piggybackovat pro vlastní queryable data
- Aktivní projekt, dobrá dokumentace

**Zvažované alternativy:**
- **SpacetimeDB** — odmítnuto: RLS experimentální (kritické pro náš security model), tenký production cohort, žádný oficiální Godot SDK; přitažlivý, ale ne pro security-conscious solo dev v 2026
- **Colyseus** — odmítnuto: room-based, špatně padne na "jeden persistentní svět"
- **Roll-your-own (Go + WebSockets)** — odmítnuto: solo dev má cennější věci na práci než znovu psát friends, leaderboards, chat
- **Photon** — odmítnuto: vendor lock-in, ne self-hostable v open verzi

**Důsledky:**
- Server hostujeme jako Docker container (Postgres + Nakama)
- Použijeme Nakama match handler API + Storage Engine + RPC
- Limity: 1 match handler je single-threaded, scaling pattern viz ADR-006

---

## ADR-003: Server runtime jazyk = **TypeScript** (návrh, lock potřebný)

**Status:** Proposed (čeká schválení)

**Rozhodnutí:** Nakama runtime moduly psané v **TypeScript**, ne Go ani Lua.

**Důvody:**
- **Sdílené typy mezi klientem a serverem** — největší produktivita win pro solo dev. `shared/types.ts` definuje `Player`, `JobBoardTask`, message payloady. Klient i server importují stejný kód.
- TypeScript je výborný pro Claude/AI asistenci — silně typed, predictable
- Méně context switching (jeden jazyk celý stack)
- Pro 100 CCU je TS výkon naprosto dostatečný — Nakama TS runtime běží přes V8 / `goja`
- Existující Nakama TS examples + dokumentace

**Zvažované alternativy:**
- **Go** — výkonnější, oficiální Nakama runtime, ale: žádné sdílené typy s klientem, dva ekosystémy, větší cognitive load. Pro 100 CCU zbytečné.
- **Lua** — podporováno, ale typeless, malá komunita pro complex backendy

**Důsledky:**
- Nakama runtime modul = `*.ts` zkompilovaný do `*.js` (bundle)
- Sdílené `types/` package importovaný oběma stranami
- Performance: pokud later narazíme na bottlenecky, _hot path_ funkce lze přepsat do Go modulu (Nakama umí kombinovat)

---

## ADR-004: Storage layer = **hybrid (Nakama Storage + Postgres přímo)** (návrh, lock potřebný)

**Status:** Proposed

**Rozhodnutí:** Hybrid přístup:

| Data type                                       | Storage                  | Důvod                                          |
| ----------------------------------------------- | ------------------------ | ---------------------------------------------- |
| Player state (Player, Skills, Atributy, Inventory, Equipment, Status) | **Nakama Storage Engine** (JSON blobs) | Per-player ownership, write-through z match state, single key lookup |
| Bank                                            | **Nakama Storage**       | Per-player, lazy load, large blob OK           |
| World data (mob spawns, resource nodes, NPC stocks, listings, job board tasks) | **Postgres tables (přímý přístup)** | Cross-player queries, indexované, time-based aggregace |
| Audit log (forensika, anti-cheat events, worker logs) | **Postgres tables**      | Insert-only, queryable, retention policy       |
| Static catalog data (`items.json`, `recipes.json`, `mobs.json`, `dialogs.json`, `quests.json`, `job_board_templates.json`) | **Read-only files v repo + in-memory cache** | Versioned, žádný runtime lookup do DB          |
| Map data (per-chunk JSON)                       | **Static files** servirované z CDN | Velký, statický, klient si fetchuje on-demand  |

**Důvody:**
- **Nakama Storage** je idiomatický pro per-player state, s built-in versioning a permissions
- **Postgres** je nutný pro "list všechny aktivní listingy ve vesnici X", "top 100 hráčů podle total_level", anti-inflation aggregace
- **Static catalogs** patří do repa, ne do DB — jsou versioned spolu s kódem

**Zvažované alternativy:**
- **Vše v Nakama Storage** — odmítnuto: cross-player queries nejsou efektivní (museli bychom skenovat collection)
- **Vše v Postgres** — odmítnuto: ztratíme Nakama features (matchmaker, friends, chat) které jedou na Storage
- **Redis pro hot data** — overkill pro 100 CCU, přidá pohyb component

**Důsledky:**
- Nakama interně používá Postgres (CockroachDB volitelně) — připojíme se na _ten samý_ Postgres ve vlastním schématu
- Schema migration: `golang-migrate` v separátním adresáři `migrations/`
- Backup strategy: pg_dump cron job

---

## ADR-005: Match handler architektura = **single match for MVP, chunk-cluster ready** (návrh)

**Status:** Proposed

**Rozhodnutí:**
- **MVP:** jediný match handler pro celý svět (256×256 dlaždic, 16 chunků 64×64)
- **Architektura:** kód strukturovaný jako kdyby chunky byly samostatné — žádný globální scan, vždy "okolí hráče" lookup. Match je jen tenký orchestrator.
- **Post-MVP scaling:** rozdělení na **chunk-cluster matches** (např. 4×4 chunků = 1 match), s cross-match relay pro hráče u hranic.

**Důvody:**
- 100 CCU v jediném matchi v Nakamě = pohodlný výkon (testováno do 1k+ players per match)
- MVP nemá scaling pressure, ale code shape je důležitý
- Chunk-cluster split lze udělat post-MVP bez prepisu game logiky, jen partition layeru

**Zvažované alternativy:**
- **Match per zone** (Blatiny = 1 match, Bažina = 1 match) — odmítnuto: arbitrary boundary, problém u hraničních interakcí
- **Match per player** — odmítnuto: žádný shared state, nesmyslné pro MMO
- **Distributed actor system (Erlang-style)** — odmítnuto: Nakama nepodporuje, tahalo by jiný stack

**Důsledky:**
- Match handler = single Nakama match s ID `world.main`
- Match state structurován kolem chunků (Map<ChunkId, ChunkState>)
- Spatial queries vždy přes chunk index (nikdy globální iterace)

---

## ADR-006: Autoritativní model = **server-authoritative everything**

**Status:** Accepted

**Rozhodnutí:** Klient _navrhuje_ akce ("chci se přesunout na X", "chci útočit Y"), server _rozhoduje_ a broadcastuje výsledek.

**Pravidla:**
- Klient nikdy nemodifikuje vlastní stav autoritativně. Vše prochází serverem.
- Klient _interpoluje_ pohyb a _předpovídá_ vlastní akce pro UX (žádná latence při click-to-move), ale server může výsledek přepsat.
- Server validuje **každý vstup** proti pravidlům z 02a-e (constraints sekce každého doc).

**Důvody:** anti-cheat, zachování integrity, jediná zdroj pravdy.

**Důsledky:**
- Vyšší latence pro některé akce (server roundtrip), klient kompenzuje predikcí
- Server musí běžet všechen game logic (movement validation, combat resolution, ...)
- Klient je "thin renderer" + UI

---

## ADR-007: Tickrates a frekvence

**Status:** Accepted (rozhodnutí z 02a, lock zde)

| Tick / Event                       | Frekvence            | Poznámka                                      |
| ---------------------------------- | -------------------- | --------------------------------------------- |
| Movement broadcast                 | 1× per MOVE_REQUEST acceptance (path-based) | Server pošle celou path; klient lokálně lerpuje plynule. Viz [ADR-019](#adr-019-entity_moved--path-based-broadcast-runescapetibia-model). |
| Combat tick                        | 3 Hz (~330 ms)       | Server resolves útoky/spelly                  |
| AI tick (mobs, workers)            | 2 Hz (500 ms)        | Mob behavior, worker progress                 |
| Resource respawn check             | 0.067 Hz (15 s)      | Mining nodes, herbs                           |
| Job board generation               | 0.000556 Hz (30 min) | Procedurální nové tasky                       |
| Player state autosave              | 0.033 Hz (30 s)      | Snapshot match state → Storage                |
| Anti-inflation log                 | 0.000012 Hz (denně)  | Total denáry v ekonomice                      |

**Engineering pozn.:** Nakama match handler `match_loop` je single tick rate. Použijeme nejvyšší (10 Hz) jako master, ostatní pomocí counterů ("každý 30. tick = combat tick", apod.). Kalendářové eventy (denní reset buy_limit) přes wall-clock.

---

## ADR-008: Networking transport = **WebSocket + JSON pro MVP, Protobuf opt-in později**

**Status:** Accepted

**Rozhodnutí:**
- **MVP:** WebSocket (Nakama default) + JSON message format
- **Post-MVP optimization:** Protobuf binary nakama messages, _pokud_ profiling ukáže bottleneck

**Důvody:**
- JSON je debuggable, čitelný v dev tools, parseable v každém jazyce
- Pro 100 CCU + 10 Hz movement broadcast = ~10 KB/s/hráč = ~1 MB/s/server. Triviální.
- Nakama umí binary rovnou, switch je <1 den práce když bude potřeba

**WebTransport / HTTP/3:** Cloudflare HTTP/3 zapneme (zdarma), ale aplikační vrstva = WebSocket. Pro náš tickrate (10 Hz movement, ne real-time FPS) WebTransport benefit ≈ 0. Re-evaluace pokud profiling ukáže perf bottleneck nebo pokud klient přestaneme distribuovat browser-only (Tauri desktop wrapper).

---

## ADR-009: Hosting = **self-host na existujícím serveru, Cloudflare před tím** (potvrzeno)

**Status:** Accepted

**Rozhodnutí:**
- **MVP fáze:** self-host na existujícím serveru uživatele (stack a kapacita TBD při setupu)
- **Komponenty:** Nakama + Postgres + nginx (TLS termination + static asset serving) v Docker Compose
- **DNS + CDN:** Cloudflare (uživatel už používá pro DNS — rozšíření o proxy + CDN)
- **Před launch musíš ověřit u existujícího serveru:**
  - Min. 4 GB RAM (8 GB komfort), 2+ vCPU, 50 GB SSD
  - EU lokace pro nízkou latenci (CZ ideálně)
  - Veřejná IPv4, otevřené porty 80/443/22
  - Docker + Docker Compose nainstalované
  - Backup strategie (snapshots / off-site)

### Cloudflare CDN setup pro náš use case

Tři komponenty, každá s jinou cache strategií:

**1. Game traffic (WebSocket) — `play.<doména>` nebo `api.<doména>`**
- DNS: A record na server IP
- **Cloudflare proxy ZAPNUTÝ (oranžový mrak)** — DDoS protection, TLS, HTTP/3 free
- **Cache: bypass** (WebSocket není cacheable)
- **Důležité — WebSocket support:** Cloudflare WebSocket podporuje, ale má **idle timeout 100 s** bez aktivity → musíš mít heartbeat. Nakama má built-in ping každých ~15 s, není problém.
- **Cloudflare WebSocket compression** = enable (`Speed → Optimization → WebSocket: ON`)

**2. Static game assets (sprites, mapy, audio) — `assets.<doména>`**
- DNS: A record na server IP (stejný server, ale jiný subdomain → tlačí Cloudflare cache aggressivně)
- **Proxy ZAPNUTÝ**
- **Cache settings (Page Rule nebo Cache Rule):**
  - URL pattern: `assets.<doména>/*`
  - Cache Level: **Cache Everything**
  - Edge Cache TTL: **1 měsíc** (statický obsah)
  - Browser Cache TTL: **1 týden**
- **Cache busting:** versioned filenames (`sprite_kovar_v3.png`) nebo query string `?v=3`
- Server posílá `Cache-Control: public, max-age=2592000, immutable` u versioned souborů

**3. Web klient (HTML/JS/CSS bundle) — `<doména>` nebo `app.<doména>`**
- DNS: A record na server IP
- **Proxy ZAPNUTÝ**
- **Cache:**
  - `index.html` → no-cache (vždy fetch nejnovější)
  - `*.js`, `*.css` (versioned by Vite hash) → cache 1 měsíc immutable
- Vite vygeneruje `assets/index-<hash>.js`, takže cache bust je automatický

**Cloudflare features pro free tier (zdarma):**
- TLS / HTTP/3 / WebSocket: ✓
- DDoS protection (basic): ✓
- Page Rules: 3 zdarma (nám stačí)
- Cache Rules (newer, lepší než Page Rules): unlimited
- Argo Smart Routing: ❌ (placený, +$5/měsíc, redukuje latenci ~20-30 % — zvážit post-MVP)
- WAF custom rules: 5 free (rate limiting, IP blocks)

**Doporučená Cache Rule sada (Free tier):**
```
Rule 1: assets.<doména>/* → Cache Eligible, Edge TTL 1 month, Browser TTL 1 week
Rule 2: <doména>/index.html → Bypass cache
Rule 3: <doména>/assets/* → Cache Eligible, Edge TTL 1 month
```

### Zvažované alternativy:
- **Hetzner Cloud** — odmítnuto: máš vlastní server, Hetzner zbytečný náklad
- **Heroic Cloud (Nakama managed)** — odmítnuto: drahý, vendor lock
- **AWS / GCP / Azure** — odmítnuto: 3-5× dražší
- **Vercel / Render / Fly.io** — odmítnuto: bezstavové, Postgres + Nakama tam špatně padá

### Důsledky:
- Deployment: GitHub Actions → SSH → `docker compose pull && docker compose up -d`
- Backup: pg_dump cron, retention 30 dní; **off-site backup je tvoje rozhodnutí** — doporučuju Hetzner Storage Box (€4/1 TB) nebo Backblaze B2 (~$6/TB)
- Monitoring: Nakama Prometheus endpoint + Grafana Cloud (free tier 10k series)

### Post-MVP scaling cesta:
- Pokud existující server přestane stačit → migrace na Hetzner Cloud (CCX23 ~€30/měsíc) nebo větší VPS
- 5k+ CCU → split Postgres na vlastní VPS, Nakama na vlastním
- 20k+ CCU → managed Postgres + multiple Nakama nodes (Nakama umí cluster)

---

## ADR-010: Repository struktura = **monorepo, TypeScript references**

**Status:** Proposed

**Rozhodnutí:** Monorepo, struktura:

```
irij/
├── client/                  # Phaser klient (TypeScript)
│   ├── src/
│   ├── public/             # static assets (sprites, audio)
│   ├── index.html
│   └── package.json
├── server/                  # Nakama TypeScript runtime modul
│   ├── src/
│   ├── data/               # items.json, recipes.json, ...
│   └── package.json
├── shared/                  # sdílené types + utilities
│   ├── src/
│   │   ├── types/          # Player, Item, Message, ...
│   │   ├── messages/       # message schemas
│   │   └── constants/      # tickrate, capy, vzorce
│   └── package.json
├── infra/                   # Docker Compose, Hetzner provisioning
│   ├── docker-compose.yml
│   ├── Dockerfile.nakama
│   └── nginx/
├── migrations/              # Postgres migrations
├── docs/                    # tato složka
├── tools/                   # scripts (asset pipeline, content tools)
└── README.md
```

**Build:** Vite (client) + esbuild (server), pnpm workspaces.

**Důvody:**
- Sdílené types napříč client/server bez publikace npm balíku
- Atomické PR (client + server change v jednom commit)
- Solo dev vlastníci celý stack — monorepo eliminuje cross-repo synchronizační overhead

**Zvažované alternativy:**
- **Tři repa (client / server / shared)** — odmítnuto: bolest při typech changing
- **Nx / Turborepo** — odmítnuto: overkill pro solo dev. pnpm workspaces stačí

---

## ADR-011: Autentizace = **OIDC + email/password + guest, vše od MVP** (potvrzeno)

**Status:** Accepted

**Rozhodnutí:** Pluralita autentizačních cest od MVP:

| Metoda                | Status MVP | Provider / mechanismus                              |
| --------------------- | ---------- | --------------------------------------------------- |
| Discord OIDC          | ✓ MVP      | Discord Developer App, OAuth2 flow                  |
| Google OIDC           | ✓ MVP      | Google Cloud project, "Sign in with Google"         |
| Email + password      | ✓ MVP      | Nakama built-in                                     |
| Guest (device-anon)   | ✓ MVP      | Nakama device ID auth, později linkovatelné         |
| Apple Sign-In         | ⏸ post-MVP | Vyžaduje Apple Developer Program $99/rok; smysl s iOS appkou |
| Steam                 | ⏸ post-MVP | Steam OpenID 2.0 (ne OIDC, complex integration)     |

**Důvody:**
- OIDC = standard 2026, hráči očekávají "Sign in with Discord" v gaming kontextu zvlášť
- Discord má v gaming komunitě nejvyšší adopci → priorita 1
- Google = univerzální fallback
- Apple Sign-In = nutnost pokud chceš později iOS App Store distribuci
- Guest = zero-friction onboarding, hráč si může zahrát i bez registrace
- Email/password = pro hráče bez OIDC accountu nebo pro recovery

### Engineering pozn. per provider:

**Discord OIDC**
- Setup: [discord.com/developers/applications](https://discord.com/developers/applications) → New Application → OAuth2 → Add Redirect URI
- Scopes: `identify email`
- Bonus: získáš avatar URL + username, nice UX import

**Google OIDC**
- Setup: Google Cloud Console → OAuth 2.0 Client IDs → Web application
- Scopes: `openid email profile`
- Compliant s Nakama OIDC implementation

**Apple Sign-In** ⏸ post-MVP
- Vyžaduje **Apple Developer Program ($99/rok)** — uspoříme dokud iOS app není na stole
- Web flow složitější (Sign in with Apple JS SDK), Services ID + private key + JWT generování
- Implementujeme až s iOS distribuovaným klientem (Capacitor / Tauri Mobile wrapper)

**Steam** ⏸
- Steam **nepodporuje pravé OIDC**, jen své OpenID 2.0
- Integrace přes [OpenID Steam Web API](https://steamcommunity.com/dev) je možná, ale vyžaduje custom middleware v Nakama runtime
- Smysl jen pokud distribuujeme přes Steam (= post-MVP)
- Parking lot

### Account linking
- Hráč má jeden `Player.id`, může mít linkované **více auth metod** (Nakama umí `link_email`, `link_custom`, `link_oauth`)
- Guest hráč může později link na Discord → keep progress
- Email/password lze přidat k OIDC accountu pro fallback (Discord ban etc.)

### Důsledky:
- Setup work pro MVP launch: ~1-2 dny per provider, plus Apple Developer Program si musíš zaplatit
- Login UI: tlačítka per provider + "Login with email" + "Play as guest"
- Account recovery: email reset link (vyžaduje SMTP — Sendgrid free tier 100/den nebo Mailgun free 100/den)
- ToS / Privacy Policy potřebné — OIDC providers vyžadují deklarované ToS/Privacy URL při setup

---

## ADR-012: Anti-cheat / security scaffold

**Status:** Accepted (referenční, detail v 02a-e constraints)

**Pravidla:**
1. **Server validuje vše** — žádný klient self-report (XP, position, item ownership, currency, ...)
2. **Per-player rate limiting** v match handleru — sliding window (např. max 100 reducer-style calls per 10 s)
3. **Speed cap validation** — `tiles_per_second ≤ 3` (provisional)
4. **Action plausibility checks** — útok na entitu mimo dosah, equip nepatřičné kategorie, atd.
5. **Audit log** každé kritické akce do Postgres (login, logout, big trades, big XP gains, NPC kills, knowledge unlocks, suspicious patterns)
6. **Session validation** — Nakama JWT na každé message
7. **No client-trusted RNG** — všechny rolly server-side
8. **Honeypot detection** — items/places, kde se nikdo "legit" nedostane; pokud tam někdo je → flag

**Implementační detail:** v 03 Message katalog popíšeme konkrétní validace per zpráva.

**MVP scope:** základní validace + audit log. Sofistikované detekční algoritmy (machine learning bot detection, behavioral signatures) = post-MVP, jen pokud problém vznikne.

---

## ADR-013: Mobile / PWA strategie

**Status:** Accepted (rozhodnutí z 01, technický detail zde)

**Komponenty:**
- **PWA manifest** + **service worker** — installable na mobile home screen
- **Responsivní UI vrstva** — dva odlišné UI layouty (desktop dense / mobil compact), pickované podle viewport width
- **Phaser scale mode** = `Phaser.Scale.RESIZE` s respect minimum tile size
- **Touch input** = Phaser pointer events (sjednocené s myší)
- **Service worker** = jen lobby/login cache, **ne** offline gameplay (nedává smysl pro MMO)

**Engineering:**
- Bundle size budget: < 5 MB initial, lazy load assets
- First Contentful Paint < 2 s na 4G
- Image atlases pro sprite (Phaser TexturePacker)
- Audio sprites (Howler.js přes Phaser plugin)

**Tauri / Capacitor wrapping:** parking lot pro post-MVP. Bundle je stejný, jen wrapper navíc.

---

## ADR-014: Asset pipeline + content authoring

**Status:** Proposed

**Pipeline:**
1. **Sprites:** AI generated (Scenario, PixelLab) → manual cleanup v Aseprite → atlas (TexturePacker) → klient
2. **Maps:** [Tiled](https://www.mapeditor.org/) editor → JSON export → klient + server (oba parsují)
3. **Items / recipes / mobs / NPC / dialogs / quests:** JSON v `server/data/` — autorováno ručně
4. **Audio:** ElevenLabs (SFX/music) → manual mastering → ogg/mp3 → klient
5. **Animations:** Phaser sprite sheets (frames v atlasu, JSON definice)

**Kritická věc:** maps/items/recipes/NPCs/dialogs/quests jsou _content_, ne kód. Mají vlastní validační schémata (JSON Schema) + content lint v CI.

**Authoring tooling (post-MVP):** vlastní web editor pro item/recipe/quest tvorbu. Pro MVP stačí JSON v IDE.

---

## ADR-015: Observability stack

**Status:** Proposed

**Rozhodnutí:**
- **Metrics:** Nakama Prometheus endpoint → Grafana Cloud (free tier, 10k series limit OK pro MVP)
- **Logs:** Nakama strukturované JSON logs → Loki (Grafana Cloud) nebo lokálně do souborů + logrotate
- **Errors:** Console + log soubory pro MVP. Sentry post-MVP (free tier 5k events/month)
- **Traces:** žádné distributed tracing v MVP

**Co měříme od dne 1:**
- CCU peak / hour
- Match handler tick latency (P50/P95/P99)
- Database query latency
- Failed reducer calls (anti-cheat signal)
- Daily total denáry (anti-inflation)
- Player retention D1/D7/D30
- Error rate per endpoint

---

## ADR-016: Lokalizace = **CS + EN od MVP** (potvrzeno)

**Status:** Accepted

**Rozhodnutí:**
- **MVP:** plně dvojjazyčně **CS** + **EN** od dne 1
- Default lokál podle browser `navigator.language` (cs → CS, jinak EN)
- Hráč může přepnout v settings (persistovat přes `Player.settings`)
- **Lokalizační vrstva** od dne 1: všechny user-facing stringy přes `t(key)` funkci
- **i18n knihovna:** [i18next](https://www.i18next.com/) (klient) + custom thin wrapper (server)

**Důvody:**
- Mít druhý jazyk od dne 1 = framework je _otestovaný_, ne placeholder
- Uvolňuje budoucí jazyky (PL, SK, DE) jako pure content add — bez refactoru
- Větší dosah z launch (en-EU + en-US gaming komunita)
- AI překlad CS → EN pro většinu stringů funguje + manuální review questů a dialogů (kde hraje slovanský charakter)

**Lokalizační storage:**
- `shared/locales/cs.json`, `shared/locales/en.json` — strings sdílené mezi klient/server
- `client/src/locales/cs.json`, `en.json` — UI-only strings
- **Quest dialogy a NPC texty** žijí v content datech (`server/data/dialogs/*.json`) jako struktura `{ "cs": "...", "en": "..." }` per node

**ICU MessageFormat** pro plurálky a interpolace (`"Máš {count, plural, =0 {žádné mince} =1 {jednu minci} other {# mincí}}"`).

**CI lint:** kontrola, že každý klíč existuje v _obou_ jazycích (chybějící překlad = build fail).

**Workflow pro nový string:**
1. Přidám `t('quest.kovar.intro')` v kódu
2. CS hodnota do `cs.json`
3. EN hodnota do `en.json` (manuální nebo AI-asistovaná)
4. CI ověří kompletnost

**Post-MVP languages:** PL, SK přijdou nejdřív (slovanský folklór = top market), DE/FR/ES dle popularity. Framework je připravený.

---

## ADR-018: Isometric rendering — explicitní engineering kontrakt

**Status:** Accepted (2026-05-03)

**Kontext:** [01 Scope](01-scope-and-pillars.md) odst. „Vizuální / herní styl" stanoví **2D pixel art, isometrický pohled** (Tibia jako reference). [ADR-001](#adr-001-klientský-engine--phaser-3-potvrzeno) to opakuje („2D pixel-art isometric je core vizuální volba"). V průběhu draftování ale došlo k drift mezi dokumenty:

- [00 Action plan](00-action-plan.md) Phase 3 doporučuje [Kenney's Tiny Town](https://kenney.nl/assets/tiny-town) jako placeholder — to je **top-down ortogonální** asset, ne isometric
- [shared/src/constants/index.ts](../shared/src/constants/index.ts) má `TILE_SIZE_PX = 48` bez specifikace orientace; pro 2:1 isometric je standardní footprint **64×32** nebo **128×64**, ne 48×48
- [CLAUDE.md](../CLAUDE.md) zmiňuje pouze „2D pixel art" bez slova „isometric"

Tento ADR drift opravuje a fixuje engineering kontrakt **dřív, než vznikne první sprite nebo render kód** (Phase 0+1 jsou pure auth/connect, bez rendering).

### Rozhodnutí

1. **Projection:** 2:1 dimetric (standardní „pixel art isometric"). Tile footprint na obrazovce **64×32 px** logicky, render scale podle device pixel ratio.
2. **Logický grid je pořád ortogonální** — server, pathfinding (A*), collision masky, chunk index pracují s `(x, y)` world tile coords. Isometric je čistě klient-side render projection.
3. **World ↔ screen projection** v `client/src/render/projection.ts`:
   ```ts
   // tile (x,y) → screen (sx,sy), origin v top tile
   sx = (x - y) * (TILE_W / 2)
   sy = (x + y) * (TILE_H / 2)

   // inverze pro click-to-tile
   x = (sx / (TILE_W / 2) + sy / (TILE_H / 2)) / 2
   y = (sy / (TILE_H / 2) - sx / (TILE_W / 2)) / 2
   ```
   Konstanty: `TILE_W = 64`, `TILE_H = 32`.
4. **Y-sort depth ordering** — všechny dynamické sprity (postavy, mobi, drops, projektily) musí mít `sprite.depth = world_y * DEPTH_SCALE + sprite.feet_offset` per frame. Bez tohoto strom v popředí nebude překrývat postavu vzadu. Helper v `client/src/render/ysort.ts`.
5. **Tilemap orientation** — Phaser `Tilemap` s `orientation: ISOMETRIC`, mapy autorované v Tiled jako isometric (staggered orientation u Tiled je separátní volba — nepoužíváme, držíme se klasického isometric).
6. **Multi-height objekty** (zdi, střechy, schody) — autorováné jako vícevrstvé Tiled objekty + per-layer depth offset. Z-fighting řešen explicitními depth bandami (terrain `0–999`, props `1000–9999`, dynamic entities `10000+`).
7. **Sprite sheets postav** — minimum **4 směry** (NE, NW, SE, SW v isometric kompasu), ideálně 8 pro animace; každý směr má walk cycle ≥ 4 framy. Equipment overlay (zbraň, helma, …) layer-renderován per direction.
8. **Camera** — `Phaser.Cameras.Main` s `centerOn(player.screen_x, player.screen_y)`; smooth follow v isometric je identický jako v ortho, jen souřadnice přes projekci.

### Co se _nemění_

- Server-authoritative model ([ADR-006](#adr-006-autoritativní-model--server-authoritative-everything))
- Tickrate stack ([ADR-007](#adr-007-tickrates-a-frekvence)) — render frekvence ≠ tick frekvence
- Message protokol — všechny pozice v messages jsou world-space `(x, y)` tiles, ne screen pixels
- Chunk architektura ([ADR-005](#adr-005-match-handler-architektura--single-match-for-mvp-chunk-cluster-ready))
- A* pathfinding — operates na logickém gridu

### Důsledky

- **Konstanty update:** `TILE_SIZE_PX = 48` v [shared/src/constants/index.ts](../shared/src/constants/index.ts) má dvojí význam (logický grid step, render scale) — split na `TILE_W_PX = 64` a `TILE_H_PX = 32` pro render, logický `(x, y)` zůstává v tiles bez px units
- **Asset cost:** všechny postavy a equipmenty musí být kresleny pod 30°/2:1 angle, 4–8 směrů. AI gen (PixelLab, Scenario) to zvládá, ale prompt engineering bude jiný než pro top-down
- **Tiled mapy:** první tilemap pro Phase 3 musí být authorovaná jako isometric, ne ortho. To znamená Tiled `New Map → Orientation: Isometric, Tile size 64×32`
- **Phase 3 placeholder:** Kenney's Tiny Town **NEpoužitelný** (top-down). Náhrada: Kenney's [Isometric Pack](https://kenney.nl/assets?q=isometric) (CC0), nebo přiložený `Isometric_tileset.zip` (Ancient Isometric, 2:1 projection, 512×256 zdroj — bude nutné rescalovat na ~64×32 nebo držet vyšší detail s odpovídajícím viewport)
- **Y-sort overhead:** ~O(n log n) sort dynamických spritů per frame; pro 100 CCU + ~50 mobů + drops triviální
- **Click accuracy:** click-to-tile inverzní projekce + tile-shape hit test (kosočtverec, ne čtverec) — pomocný util `pointInIsoTile(px, py, tile_x, tile_y)`

### Náklady přechodu (z hypotetického top-down stavu)

Phase 0 + 1 jsou nedotčené (pure connect, žádný render). Náklady jsou tedy jen ve fázích, které ještě nezačaly:

| Fáze | Náklad navíc proti top-down | Poznámka |
| ---- | --------------------------- | -------- |
| Phase 3 (statická mapa) | +0.5 dne | Iso tilemap render + projection util |
| Phase 4 (movement) | +2 hod | Click-to-tile inverze, sprite Y-sort |
| Phase 6 (combat) | 0 | Combat je world-space; jen Y-sort floating dmg textů |
| Phase 7 (equipment vizuál) | +30–50 % asset času | 4–8 směrů per layer vs 4 v top-down |
| Phase 18 (polish + content) | +20 % asset času | Iso authoring je o něco pomalejší než ortho 3/4 |

**Total scope dopad:** odhadem +3–5 dnů přes celý MVP, primárně asset overhead. Render-side overhead je jednorázový (projekce + ysort util, ~1 den implementace).

### Zvažované alternativy

- **Top-down ortogonální (čistý 2D shora dolů)** — odmítnuto: ploché, nesplňuje atmosférický cíl ze [01 Scope](01-scope-and-pillars.md) („středoevropská vesnice za soumraku, lehce strašidelná")
- **Stardew-style 3/4 perspective** (ortogonální grid + sprite tilt) — odmítnuto: nedovolí multi-height (zdi, dveře, věže) bez triků, atmosféra méně mystická než pravé iso
- **3D s pixel art shaderem** (low-poly + dithered post-process) — odmítnuto: out of scope pro 2D-first Phaser engine ([ADR-001](#adr-001-klientský-engine--phaser-3-potvrzeno))
- **Staggered isometric** (Tiled feature, hexagonálně-ish posun řad) — odmítnuto: méně standardní, tooling pro asset gen slabší

### Risks

| Riziko | Pravděpodobnost | Mitigace |
| ------ | --------------- | -------- |
| AI asset gen vyrobí inconsistent angle (29° vs 30° vs 35°) | střední | Style guide ADR-014 lock + manual touch-up + reference grid template |
| Y-sort glitches u multi-tile entit (velký mob, vůz) | střední | Per-entity „anchor tile" konvence, dokumentovat v ADR-014 |
| Click-to-tile nepřesný na hraně dlaždice | nízká | Pomocný `snapToNearestWalkable()` server-side při validaci `MOVE_REQUEST` |

---

## ADR-019: ENTITY_MOVED = path-based broadcast (RuneScape/Tibia model)

**Status:** Accepted (2026-05-03)

**Kontext:** Phase 4b implementoval movement protokol s per-tile-boundary `ENTITY_MOVED` broadcast — server v `matchLoop` posílal zprávu pokaždé, když hráč překročil tile (~333 ms při 3 tps). Klient v 4c tween-oval na 100 ms. Jenže server ticky jsou diskrétní (10 Hz, advance přes `floor((tick - pathStartedAt) * speed / TICK_HZ)`), takže reálný interval kolísal 300–400 ms; klient tween skončil v 100 ms a sprite stál až 300 ms — uživatel reportoval „1 → 2, pauza, 2 → 3, pauza".

**Rozhodnutí:** Server posílá `ENTITY_MOVED` **JEDNOU** po validaci `MOVE_REQUEST` s celou path (`from + path[]`). Klient drží `EntityMovementState { from, path, speedTps, startedAtMs }` per entity a v Phaser scene `update()` callback **každý frame** přepočítá sprite pozici z deterministic formule `tilesElapsed = (Date.now() - startedAtMs) * speedTps / 1000`. Žádné Phaser tweens pro pohyb — `requestAnimationFrame` v hidden tabu pause-uje a způsobil by drift od serveru. Server stále drží integer tile coords v match state pro chunk index, autosave (Phase 5) a anti-cheat dosah validaci, ale `matchLoop` neposílá per-tile zprávy.

**Klient self-correcting drift recovery:**
- Hidden tab → Phaser scene pause → `update()` neběží → sprite stojí. `Date.now()` mezitím roste.
- Tab return → Phaser scene resume → `update()` se zavolá s velkým `elapsedMs` → sprite **automaticky** chytí current correct pozici (snap na last tile pokud `tilesElapsed >= path.length`, jinak lerp na correct sub-tile mid-path).
- Mid-path interrupt = server pošle nový `ENTITY_MOVED` s `from = currentServerPosition`, klient přepíše state, sprite od příští frame jede z nové baseline.
- Žádný explicit Page Visibility API handler ani periodic resync — wall-clock baseline + per-frame deterministic compute pokrývá všechny edge cases.

**Důvody:**
- Přesně to, co dělají RuneScape, Tibia a další click-to-move grid MMOs — single broadcast cesty, klient interpoluje
- Bandwidth O(1) per move (vs O(N) tilů)
- Klient zná celou path → plynulý lerp bez jitter ze server tick rounding
- Path-aware lerp: BFS-fallback ohyb (klik za vodu → server snape na shore + path s ohybem) se klientovi vykreslí korektně po celé cestě, ne straight-line z A do B
- Mid-path interrupt = re-broadcast nového ENTITY_MOVED s aktuální pozicí jako `from` — natural fit do path-based modelu

**Zvažované alternativy:**
- **Quake-style 10–20 Hz position snapshot** (float pozice + klient interpolation buffer 100 ms) — odmítnuto: overengineered pro click-to-move grid game bez projektilů a PvP areny, vyžaduje float state na serveru, vyšší bandwidth než path-based
- **Per-tile broadcast** (původní 4b) — odmítnuto: jitter ze server tick rounding (300–400 ms interval), vyšší bandwidth (O(N) per pohyb), klient pauzy mezi tily

**Důsledky:**
- Bandwidth O(1) per move
- Klient plynulý path-aware lerp přes deterministic update-loop, self-correcting proti hidden-tab drift
- `WORLD_SNAPSHOT` v `matchJoin` zahrnuje in-flight path data (`path?`, `speed_tps?`, `started_at_tick?` na entity entries) → joiner vidí ostatní v plynulém pohybu, ne stojící na current tile dokud se znovu nehnou
- Interrupt mechanismus (combat stun, change cíle uprostřed pathu) = re-broadcast nového `ENTITY_MOVED` s novou path od aktuální pozice. Combat-driven interrupts přijdou v Phase 6 (mob aggro); MVP scope = jen change cíle (klik někam jinam mid-path)
- Klient–server clock drift: klient používá `Date.now()` jako baseline, takže ~50 ms network latency mezi server tick a klient receipt znamená klient lerpuje vždy o ~50 ms za serverem. Pro 100 CCU lokální dev zanedbatelné. Post-MVP polish: explicit clock sync přes `SERVER_TICK` opcode (73, momentálně nepoužitý) + 1 Hz `WORLD_SNAPSHOT` keepalive jako fallback proti acumulated drift
- `ADR-007` tickrate tabulka (řádek „Movement broadcast") aktualizována: per-tick frekvence se mění na „1× per MOVE_REQUEST acceptance"

---

## ADR-017: Test strategy

**Status:** Proposed

**MVP:** **Unit testy pro server logic** (combat formulas, recipes, validations). Klient testy ne (Phaser je interactive, ROI nízký).

**Stack:**
- Vitest pro unit testy (TS-friendly, rychlý)
- Postgres test container pro integration testy server logic
- **No e2e** v MVP — manual playtesting

**Code coverage:** žádný hard target; pokrýt _pravidla_ z constraints sekcí (02a-e), aby regrese rozhodnutí byly chyceny.

---

## Risks & mitigations

| Riziko                                                  | Pravděpodobnost | Dopad   | Mitigace                                                                |
| ------------------------------------------------------- | ---------------- | ------- | ----------------------------------------------------------------------- |
| Nakama TS runtime perf bottleneck                       | nízká           | střední | Hot path lze přepsat do Go modulu (Nakama umí kombinovat)               |
| Hetzner VPS výpadek                                     | nízká           | vysoký  | Daily backup off-site, restore runbook                                  |
| Postgres data loss                                      | velmi nízká     | kritický| pg_dump 4× denně, off-site, monthly restore drill                       |
| Nakama upstream breaking change                         | nízká           | střední | Pin Docker image versi, upgrade jen po testu                            |
| 100 CCU překročíme rychleji než čekáme                  | střední         | nízký   | Scaling roadmap (ADR-009) je readiness, ne instant; few weeks lead time |
| Phaser ekosystém změna / abandon                        | velmi nízká     | vysoký  | Phaser 3 LTS, komunita stabilní, code je framework-agnostic z 60 %      |
| Vendor lock SpacetimeDB-style — N/A                     | n/a             | n/a     | Self-host Nakama eliminuje                                              |
| AI asset gen quality regress (modely se zhoršují)       | nízká           | nízký   | Style guide + manual touch-up vždy nutné                                |

---

## Schválená rozhodnutí

Všechny pending ADRy schváleny (2026-05-01):
- ADR-003: TypeScript na serveru ✓
- ADR-004: Hybrid Nakama Storage + Postgres ✓
- ADR-009: Self-host na existujícím serveru, Cloudflare DNS+CDN ✓
- ADR-010: Monorepo (pnpm workspaces) ✓
- ADR-011: OIDC (Discord/Google/Apple) + email/password + guest, vše od MVP ✓
- ADR-016: CS + EN od MVP ✓

## Otevřené otázky pro setup fázi

Tyto se vyřeší při skutečném provisioningu, ne v designu:
- [ ] **Specs existujícího serveru** — RAM, CPU, disk, lokace (před první deploy)
- [ ] **Doménové jméno** + Cloudflare zone setup
- [ ] **SMTP provider** pro email reset (Sendgrid free / Mailgun free / Postmark trial)
- [ ] **Off-site backup** target (Hetzner Storage Box / Backblaze B2 / S3)

---

## Změnový log

- **2026-05-01** — Draft 1, vytvořeno na základě potvrzených volby Phaser + Nakama z brainstormu, plus návrhy pro language/storage/hosting/struktura.
- **2026-05-01** — Draft 1.1: lock TypeScript server, hybrid storage, self-host na existujícím serveru s Cloudflare CDN guidance, OIDC+email+guest auth od MVP, CS+EN lokalizace od MVP. Apple Sign-In flagged jako conditional (iOS plan).
- **2026-05-02** — Draft 1.2: Apple Sign-In přesunut do post-MVP (čeká na iOS app rozhodnutí). MVP auth: Discord + Google + Email + Guest.
- **2026-05-03** — Draft 1.3: přidán ADR-018 (isometric rendering — engineering kontrakt). Isometric byl už v scope od 01 Scope a ADR-001, ale chyběla projection/Y-sort/tile-size specifikace a v action planu Phase 3 + CLAUDE.md byl zamíchán top-down placeholder (Kenney Tiny Town). ADR-018 drift fixuje a uzamyká 2:1 dimetric, 64×32 footprint, depth ordering konvenci. Kódový dopad zatím nulový (Phase 0+1 jsou pure connect, žádný render).
- **2026-05-03** — Draft 1.4: přidán ADR-019 (ENTITY_MOVED = path-based broadcast). Phase 4 follow-up po user-reported trhaném pohybu („1 → 2, pauza, 2 → 3, pauza"); per-tile broadcast (4b) měl jitter 300–400 ms ze server tick rounding. ADR-019 přepíná protokol na single broadcast s celou path (RuneScape/Tibia model), klient lokálně lerpuje plynule. ADR-007 tickrate tabulka updatovaná.
- **2026-05-03** — Draft 1.5: ADR-019 doplněn o **klient deterministic update-loop** (místo Phaser TweenChain). User-reported drift po alt-tab: Phaser tweens jedou přes `requestAnimationFrame`, browser ho v hidden tabu pause-uje, sprite po návratu do tabu pokračoval od starého stavu místo current server position. Fix: klient drží wall-clock baseline (`Date.now()`) a v scene `update()` každý frame deterministic-ky recomputuje sprite pozici z elapsed × speed_tps. Self-correcting bez Page Visibility API — tab return = první update spočítá correct pozici a sprite skočí/lerpne na ni.
