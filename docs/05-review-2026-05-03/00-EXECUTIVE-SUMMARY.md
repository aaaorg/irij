# Irij — Executive Summary (review 2026-05-03)

**Kdo to čte:** Jakub (sólo dev, hlavní stakeholder).
**Co to je:** syntéza review od **17 specialistů** (engineering director, tech lead, Phaser, Nakama, backend, frontend/UX, DB, networking, game design, DevOps, security, art, QA, product, mobile/PWA, i18n, community/marketing). Plné role-by-role reporty jsou v sourozeneckých souborech 01–17.
**Účel:** dát ti **hodinový přehled** stavu projektu po Phase 4 + jasně oddělit, **co máš rozhodnout** od toho, co může implementační agent rozjet sám podle [00-REMEDIATION-PLAN.md](00-REMEDIATION-PLAN.md).

---

## TL;DR ve třech větách

1. **Inženýrské základy jsou nadprůměrné na sólo-dev MMO** — disciplinovaný ADR proces, skutečně server-authoritative pohyb, čistý monorepo + shared package, RuneScape-grade path-based protokol. Tohle je vyzrálost, kterou většina podobných projektů nemá.
2. **Ale repo už drží auth + perzistenci a chybí kolem toho operační safety net** — žádný backup runbook, žádné CI, žádné testy, secrets v repu, OCC pattern pro autosave nedořešený, PWA neinstalovatelná, i18next v deps ale nezapojený, GTM/community foundation = nula.
3. **Hlavní ne-technické riziko je timeline + content cliff** — 22 fází × ~5-7 dnů sólo @ 3-4 h/den = realisticky **6-12 měsíců do closed alpha** s jaro 2027 jako střízlivým odhadem. Phase 18 polish (256×256 mapa, 30 itemů, 10 NPC, 5 mobů) je odhad 14 dnů, podobné projekty (Highspell, Faehnor) na to vystřídaly **měsíce až roky**.

---

## Co projekt dělá nadprůměrně dobře (5 winů)

1. **Skutečná server-authoritative implementace už v Phase 4** — A* + walkable mask + rate-limit + anti-cheat smoke test (`out_of_bounds` reject ověřený přes dev tools). Spousta sólo MMO si tady řekne "fixneme později" a hra se stane otevřeným cheat polem. Tady je to správně před prvním mobem.
2. **ADR jako living document, ne formalita.** ADR-018 (iso kontrakt), 019 (path-based broadcast), 020 (8-směr A*) jsou *post-hoc reakce* na drift mezi dokumenty a real-world bug reporty. To je rytmus, který sólo dev *musí* mít, protože nemá QA tým.
3. **Single source of truth napříč klient/server** — `irij-shared` package s opcodes/types/konstantami, monorepo, žádný drift. Eliminuje největší triviální zdroj bugů full-stack TS her.
4. **Path-based broadcast (ADR-019) + deterministický klient lerp** je RuneScape/Tibia-grade rozhodnutí: O(1) bandwidth per pohyb, self-correcting po hidden-tab přes `Date.now()` baseline. Lepší než typické komerční click-to-move klienty.
5. **Goja gotchas dokumentované u zdroje** (state mutation, plain object, named functions) — sólo dev za 6 měsíců to zapomene, komentáře jsou jediná obrana a dělají svou práci.

---

## TOP rizika prioritizovaná napříč rolemi (P0 = řešit teď nebo dřív než další fáze)

### P0 — Operational

- **Žádný backup runbook ani restore drill na repu, který už persistuje hráče.** Phase 21 je pozdě. *(Engineering Director, DB Architect, DevOps)*
- **Secrets plaintext v repu** (`infra/nakama/local.yml`: admin/password, encryption_key, server_key; `client/src/nakama.ts`: server-key v Vite bundlu jako veřejný). Hardcoded vzor → footgun pro produkci. *(Security, Nakama, DevOps)*
- **OCC version handling chybí** pro Nakama Storage writes. Phase 5 autosave (30 s) souběžně s explicit RPC = lost-update na inventory = duplikace itemů = anti-inflation P0. *(DB Architect, Nakama)*
- **Žádný IP rate-limit / CAPTCHA na auth.** `authenticateDevice(create=true)` + neomezený device_id = 10k bot accountů za minutu. Cloudflare WAF v Phase 21 je pozdě. *(Security)*
- **Nulové automatizované testy.** `pnpm test` no-op, žádné CI. Pure utily (`pathfinding`, `walkable`, `parseMoveRequest`) jsou ideální Vitest cíl, odložení = ruleta při Phase 6+ refactoru. *(QA, Tech Lead, Backend)*

### P0 — Frontend/UX

- **PWA není installable** — `vite-plugin-pwa` má `manifest.icons: []` (TODO komentář). Lighthouse PWA fail, žádný install prompt. *(Frontend/UX, Mobile/PWA)*
- **`CharacterCreationScene` je keyboard-only** (Phaser `keydown`). Na mobilu se hráč k vytvoření postavy **vůbec nedostane**. *(Frontend/UX, Mobile/PWA)*
- **i18next v `package.json`, ale nikde `.init()` ani `t()` calls.** Phase 17 plánuje setup po Phases 5-16, kdy už bude 300+ hardcoded CS stringů místo dnešních 30. ADR-016 ("od dne 1") porušený. *(i18n, Frontend/UX)*

### P0 — Architektura / Design

- **`server/build.js` IIFE-strip hack je regex-based** (matchuje literál `var __irij_server = (() => {\n`). Esbuild minor upgrade tichounce rozbije unwrap, Nakama spadne na "failed to find InitModule". Žádný post-build sanity check. *(Tech Lead, Nakama)*
- **`find_or_create_match` race produkuje orphan matche.** Komentář to přiznává; při flash-mob (Discord post → 50 lidí v 5 s) vznikne 2-3 orphans tickající 10 Hz. *(Tech Lead, Nakama)*
- **Combat tick 0.3-0.4 s je pravděpodobně chyba.** OSRS 0.6 s, Tibia 1 s, Highspell ~0.6 s; mobile RTT 50-150 ms na 4G sežere 30-50 % tvého ticku, anti-cheat tick-skip detekce je peklo. **Ne-cementovat před Phase 6.** *(Game Designer)*
- **Slovanský folklór style guide neexistuje, `Isometric_tileset.zip` v repu má restriktivní license.** Bez palety + reference angle + light direction lock před AI gen sessionem dostaneš 5 různých estetik. *(Art Director)*

### P0 — Produkt / GTM

- **GTM stack = nula** (žádný landing, žádný Discord, žádný devlog, žádná mailing list). Indie MMO žije z komunity vybudované **před** launchem; Phase 22 Discord je 6+ měsíců pozdě. *(Community/Marketing, Product)*
- **"Irij" není finální název** (CLAUDE.md zmiňuje "pracovní"). Brand drift při launch = ztracená rok-marketingová investice. *(Community/Marketing)*

### P1 — vybráno (top 10)

- 22 fází × 3-4 h/den = realisticky 12+ měsíců, plán neobsahuje **žádný buffer ani kill-switch kritérium**. *(Engineering Director, Product)*
- **Walkable mask drift mezi server/klient** (server: `NON_WALKABLE_TILE_GIDS`; klient: bez vlastní logiky) — Phase 18 polish bude duplikovat. *(Tech Lead)*
- **AOI je v praxi "broadcast all"** — `CHUNK_SIZE_TILES=64` na 50×50 mapě = 3×3 okolí pokrývá celý svět. *(Networking)*
- **Žádný RTT / clock sync** — `SERVER_TICK` opcode rezervovaný ale nepoužitý, klient lerpuje ~RTT/2 za serverem. *(Networking)*
- **Žádný reconnect** — `ondisconnect` skočí zpět na LoginScene, hráč ztratí session. *(Frontend/UX, Networking)*
- **Banka jako monolit blob** (Nakama Storage) → 1 MB JSON.parse blokne match loop, 255 MB jsonb cap. Lepší PG tabulka od začátku. *(DB Architect)*
- **Audit log neexistuje** (ADR-012 bod 5 nimplementovaný). Bez něho post-incident forensics = nic. *(Security, DB Architect)*
- **PG migrace (`golang-migrate`) prázdné** — Phase 6+ začne potřebovat. *(DB Architect, DevOps)*
- **8-směrový sprite plán per ADR-020 je nereálný** pro sólo dev (~6900 framů per char template). Doporučení: MVP = 4 iso směry (NE/NW/SE/SW), 50 % úspora. *(Art Director)*
- **NPC worker delegace v parking lotu, ale design pre-supposes alt-farm exploit magnet.** Bez anti-bot tooling = RSC 2018 fate. *(Game Designer, Security)*

---

## Tři rozhodnutí, která potřebuju od tebe (gating)

1. **Timeline reality check.** Současný action plan implikuje closed alpha **letos**. Reálnější odhad: jaro/léto 2027 (Phase 18 = 2-3× delší). **Akceptuješ** posun a definuješ **fallback "minimum playable"** (Phases 0-11 + 14 + 16 + 21 podle Product reportu) jako pojistku proti burnout, **nebo** pivotuješ scope (např. zrušit část Phase 18 contentu, méně skillů)?
2. **Reorder fází:** Engineering review konsenzuálně doporučuje **vložit Phase 4.5 (CI + Vitest skeleton + audit log + secrets hygiene + restore drill) PŘED Phase 5**, posunout **i18n setup z Phase 17 do Phase 5a**, a **brand+landing+Discord z Phase 22 do TENTO TÝDEN**. Akceptuješ?
3. **Combat tick rate před Phase 6.** Současný plán = 0.3-0.4 s. Game design review důrazně doporučuje **0.6 s (OSRS-tempo)** — bezpečnější pro mobil, anti-cheat snadnější, retention lepší. Rozhodnutí ovlivní celý Phase 6+ design. **Souhlasíš se 0.6 s, nebo trváš na 0.3-0.4 s s vědomím rizik?**

---

## Co dělat dál

1. **Přečíst si tento dokument** (jsi tady).
2. **Rozhodnout 3 otázky výše** (nebo požádat o doplnění informací k některé).
3. **Spustit implementačního agenta s [00-REMEDIATION-PLAN.md](00-REMEDIATION-PLAN.md)** po konzultaci se mnou (gating každého P0 itemu, abys měl kontrolu nad scope).
4. (Volitelně) nahlédnout do role-specifických reportů 01–17 pro detail v oblasti, která tě zajímá nejvíc.

---

## Mapa rolí → soubor

| #   | Role                       | Soubor                                                            |
| --- | -------------------------- | ----------------------------------------------------------------- |
| 01  | Engineering Director       | [01-engineering-director.md](01-engineering-director.md)          |
| 02  | Tech Lead                  | [02-tech-lead.md](02-tech-lead.md)                                |
| 03  | Phaser specialista         | [03-phaser-specialist.md](03-phaser-specialist.md)                |
| 04  | Nakama specialista         | [04-nakama-specialist.md](04-nakama-specialist.md)                |
| 05  | Backend / TS engineer      | [05-backend-engineer.md](05-backend-engineer.md)                  |
| 06  | Frontend / UX              | [06-frontend-ux.md](06-frontend-ux.md)                            |
| 07  | DB / Storage architekt     | [07-db-architect.md](07-db-architect.md)                          |
| 08  | Networking / Realtime      | [08-networking.md](08-networking.md)                              |
| 09  | Game Designer              | [09-game-designer.md](09-game-designer.md)                        |
| 10  | DevOps / SRE               | [10-devops-sre.md](10-devops-sre.md)                              |
| 11  | Security                   | [11-security.md](11-security.md)                                  |
| 12  | Art Director               | [12-art-director.md](12-art-director.md)                          |
| 13  | QA / Test                  | [13-qa-test.md](13-qa-test.md)                                    |
| 14  | Product Manager            | [14-product-manager.md](14-product-manager.md)                    |
| 15  | Mobile / PWA               | [15-mobile-pwa.md](15-mobile-pwa.md)                              |
| 16  | i18n / Lokalizace          | [16-i18n.md](16-i18n.md)                                          |
| 17  | Community / Marketing      | [17-community-marketing.md](17-community-marketing.md)            |

**Vstupní stránka:** [README.md](README.md) — orientace v adresáři.
**Akční plán:** [00-REMEDIATION-PLAN.md](00-REMEDIATION-PLAN.md) — strukturované akce pro implementačního agenta.
