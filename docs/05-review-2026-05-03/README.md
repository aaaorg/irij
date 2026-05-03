# Review 2026-05-03 — Multi-rolová kontrola projektu Irij po Phase 4

**Co to je:** komplexní review provedené 17 simulovanými specialisty v různých rolích (engineering director, tech lead, Phaser, Nakama, backend, frontend/UX, DB, networking, game design, DevOps, security, art, QA, product, mobile/PWA, i18n, community/marketing). Každá role samostatně prozkoumala aktuální stav projektu a vrátila strukturovaný report (úspěchy, rizika P0/P1/P2, doporučené akce, reference na konzultované zdroje).

**Záměr:** poskytnout Jakubovi kompletní obraz o tom, kde projekt **stojí silně**, kde **má operační dluh**, a co by měl řešit ve které fázi. Výstup je **podklad pro rozhodování**, ne checklist k slepému provedení.

**Vstupy:**
- Stav: Phase 0–4 hotové (lokální stack, guest auth, char creation, isometric mapa, server-authoritative movement).
- Kontext: `CLAUDE.md`, `docs/00-action-plan.md`, `docs/01-scope-and-pillars.md`, `docs/02a–e`, `docs/04-tech-adr.md`, plné repo včetně klient/server/shared.

---

## Doporučená cesta čtení

1. **Začni tady:** [00-EXECUTIVE-SUMMARY.md](00-EXECUTIVE-SUMMARY.md) — 5-10 min, top wins, top P0 rizika napříč rolemi, **tři rozhodnutí, která potřebujeme**.
2. **Pak akční plán:** [00-REMEDIATION-PLAN.md](00-REMEDIATION-PLAN.md) — strukturované akce (Sekce A–J) seřazené podle priority a fáze, s konkrétními soubory a kroky pro implementačního agenta.
3. **Pro detail v oblasti:** otevři role-specifický report 01–17 podle zájmu (každý ~500-700 slov, struktura: TL;DR / úspěchy / rizika / doporučení / reference).

---

## Mapa rolí

| #   | Role                       | TL;DR jedním řádkem                                                                                       | Soubor                                                            |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 01  | Engineering Director       | Nadprůměrné základy, ale Phase 18 cliff + chybí backup runbook + 12+ měsíců do alfy.                       | [01-engineering-director.md](01-engineering-director.md)          |
| 02  | Tech Lead                  | Disciplinovaná architektura; landminy: IIFE strip, `as any`, walkable drift, žádné testy.                  | [02-tech-lead.md](02-tech-lead.md)                                |
| 03  | Phaser specialista         | Klient idiomatický; P0 chybí PreloadScene + sprite atlas + chunked tilemap pro Phase 18.                   | [03-phaser-specialist.md](03-phaser-specialist.md)                |
| 04  | Nakama specialista         | Goja gotchas vyřešené; P0 secrets v repu, find_or_create_match race, OCC pro autosave chybí.                | [04-nakama-specialist.md](04-nakama-specialist.md)                |
| 05  | Backend / TS engineer      | Pure utily čisté; P1 ad-hoc validace, RPC neoznačuje failures, `as Player` casty bez narrowing.            | [05-backend-engineer.md](05-backend-engineer.md)                  |
| 06  | Frontend / UX              | P0: PWA neinstalovatelná (`icons:[]`), char creation mobil-bricked, i18n dead deps, viewport hostile.       | [06-frontend-ux.md](06-frontend-ux.md)                            |
| 07  | DB / Storage architekt     | Hybrid správně; P0 OCC pattern, banka-blob, prázdné migrace, audit log volume neplánovaný.                  | [07-db-architect.md](07-db-architect.md)                          |
| 08  | Networking / Realtime      | Path-based design správně; P0 AOI = "broadcast all" na 50×50, RTT neměřený, žádný reconnect.                | [08-networking.md](08-networking.md)                              |
| 09  | Game Designer              | Pilíře koherentní; P0 combat tick 0.3 s je chyba, 1 mob v MVP nestačí, NPC delegace = alt-farm exploit.    | [09-game-designer.md](09-game-designer.md)                        |
| 10  | DevOps / SRE               | Lokální stack pevný; P0 prázdný `.github/`, žádný CI, secrets, restore drill.                                | [10-devops-sre.md](10-devops-sre.md)                              |
| 11  | Security                   | Server-auth solidní; P0 secrets v repu + server-key v Vite bundlu + auth flood + audit log neexistuje.       | [11-security.md](11-security.md)                                  |
| 12  | Art Director               | Iso kontrakt OK; P0 license risk `Isometric_tileset.zip`, žádný style guide, 8-směr nereálný pro sólo.      | [12-art-director.md](12-art-director.md)                          |
| 13  | QA / Test                  | Manuální Playwright OK pro Phase 1-4; P0 Vitest na pure utily teď, jinak Phase 6+ bude regresní ruleta.    | [13-qa-test.md](13-qa-test.md)                                    |
| 14  | Product Manager            | Silná teze; reálný timeline 6-9 měsíců (jaro 2027); audience triáda hrozí roztržením; monetizace + GTM.    | [14-product-manager.md](14-product-manager.md)                    |
| 15  | Mobile / PWA               | Rámec PWA, ale neinstalovatelná; P1 retina blur, viewport regrese, char creation desktop-only.              | [15-mobile-pwa.md](15-mobile-pwa.md)                              |
| 16  | i18n / Lokalizace          | i18next v deps ale nezapojený; ADR-016 ("od dne 1") porušený; posunout setup do Phase 5a.                   | [16-i18n.md](16-i18n.md)                                          |
| 17  | Community / Marketing      | GTM = nula; brand drift risk, Discord 6 měsíců pozdě, audience = OSRS/RSC veteráni a slovan. diaspora.     | [17-community-marketing.md](17-community-marketing.md)            |

---

## Sumář P0 napříč rolemi (deduplicated)

Tyto rizika se opakují u 2+ rolí — řeší se v Sekcích A–E remediation planu:

- **Žádné CI / testy / backup** — A1, A2, A3 (Engineering Director, DevOps, QA, Tech Lead, DB Architect)
- **Secrets v repu + server-key v bundlu** — A4 (Security, Nakama, DevOps)
- **OCC pattern chybí pro autosave** — B1, B2 (DB Architect, Nakama)
- **Build pipeline fragile (IIFE strip + esbuild pin + race)** — C1, C2, C3 (Tech Lead, Nakama)
- **PWA + i18n + char creation mobile** — E1, E2, E3 (Frontend/UX, Mobile/PWA, i18n, Engineering Director)
- **GTM = nula** — I1, I2, I3 (Community/Marketing, Product)
- **Decision points** — G1 combat tick, G2 sprite směry, H1 license — gating, vyžadují Jakubovo rozhodnutí.

---

## Co tato review **není**

- **Není code review v PR smyslu** — neidentifikuje konkrétní řádky chyb, ale architektonické a operační vzory.
- **Není rozkaz k provedení** — implementační agent musí gating každý P0 item s Jakubem.
- **Není odhad ceny ani timeline** — Product report navrhuje 2× buffer, ale finální call je Jakubův.
- **Není vyčerpávající** — review se cíleně omezila na 17 rolí. Další úhly (např. legal/compliance pro CZ herní zákony, accessibility a11y nad rámec WCAG basics) jsou parking-lot pro pozdější vlnu.

---

## Datum a kontext review

- **Datum:** 2026-05-03
- **Stav projektu při review:** Phase 4 právě dokončena (8-směrový A* + path-based broadcast + klient interpolace + click-to-move + cross-tab Playwright smoke).
- **Recent PRs:** #10 (4a match join), #11 (4b movement protocol), #12 (4c klient click-to-move), #13 (path-based ENTITY_MOVED), #14 (8-směrový A*).
- **Engineering verze:** Nakama 3.38.0, Phaser 3.90, Vite 7, TypeScript 5.9, pnpm 9.15.9, Node 22+.

**Příští review doporučeno:** po dokončení Phase 11 (první lore quest end-to-end) — milestone, kdy bude první real signál o "lore-driven feel" a kde se má aplikovat kill-switch kritérium z J2.
