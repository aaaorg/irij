# Engineering Director Review

**Reviewer:** Engineering Director / VP of Engineering perspektiva (15+ let online games + web systems)
**Datum:** 2026-05-03
**Předmět:** Irij — sólo-dev browser MMORPG, Phase 0–4 hotové

## TL;DR

Projekt má **nadprůměrně zdravé základy** pro sólo-dev MMO: explicitní ADR proces, server-authoritative už od Phase 4, čisté monorepo, smart pick stacku (Nakama + Phaser + TS) a disciplinovaný git/PR workflow. **Hlavní riziko není technologie ani architektura, ale scope a content ekonomika** — 22 fází k closed alpha s ~3-4 h/den tempem znamená 12+ měsíců do alfy a obrovskou content záplavu (questy, dialogy, loot, sprites) v Phase 18, kde sólo dev historicky umírá. Druhé klíčové riziko: chybějící CI, testy a backup runbooks na repu, který už drží auth + persistenci.

## Úspěchy

- **Skutečná server-authoritative implementace v Phase 4** — A* + walkable mask + rate limit + anti-cheat smoke test (out_of_bounds reject ověřený přes dev tools). Spousta sólo-dev MMO tady selže a hra se stane otevřeným cheatovacím polem; tady je ten základ správně už před prvním mob spawnem.
- **ADR jako living document, ne formalita** — ADR-018, 019, 020 jsou _post-hoc reaction_ na drift mezi dokumenty (top-down placeholder vs. iso scope) a real-world bug reports (jitter, zubaté cesty). To je vyzrálý engineering culture signál; většina sólo projektů tohle ignoruje a později se v tom utopí.
- **Monorepo + sdílené types napříč klient/server (ADR-003, 010)** — eliminuje největší triviální zdroj bugů ve full-stack TS hrách (drift opcodes, payload shapes). Single source of truth v `shared/src/messages/opcodes.ts` je profesionální detail.
- **Tickrate model s counter-based dispatchem (ADR-007)** — místo tří match handlerů jeden `match_loop` 10 Hz s counter-driven combat/AI/autosave. Přesně to, co říká Heroic Labs best practice; nezávisle objevené.
- **Path-based broadcast (ADR-019) + 8-směrový A\* (ADR-020) jako reakce na hraní** — nejen napsané, ale opravené po user feedbacku. Tohle je rytmus, který sólo MMO potřebují, protože nemůžou mít QA tým.

## Rizika

- **P0 — Phase 18 "Polish + content" je content cliff.** 14 dnů na celou 256×256 mapu + 10 NPC + 5 mobů + 3 questy + 30 itemů + 15 receptů + audio pass + UI polish. Reálně to je 2–3 měsíce sólo, ne 14 dnů. Highspell, 8BitMMO i Faehnor strávily _roky_ tvorbou contentu po dokončení core loopu. Pokud na to nejsi připravený, alpha se odsune o 6+ měsíců.
- **P0 — Žádný backup runbook, restore drill ani CI před Phase 21.** Repo už persistuje hráče (Nakama Storage). Ztráta dat = ztráta důvěry kámošů v alfa testech. Restore drill patří před Phase 5, ne do Phase 21.
- **P1 — Žádné testy nikde (`pnpm test` je no-op).** Combat formulas, A* a economy bez unit testů budou regresní noční můrou kolem Phase 8–13, kdy se rules začnou prolínat. ADR-017 to slibuje, action plan to nezahrnuje do žádné fáze explicitně.
- **P1 — Nakama JS runtime constraints jsou shovaná mina.** Single-threaded `goja`, žádné async funkce v RPC, AST parsing `InitModule` (proto nesmíš helper funkce). Fixní, ale když narazíš na `nk.httpRequest` blocking call v match handleru s 100 CCU, propadneš se. Žádný stress test plánovaný před closed alpha.
- **P1 — Sólo + 3-4 h/den + 22 fází = unrealistic timeline.** 1 fáze ≈ 5-7 dní × 22 = 110-150 dnů ideálně, reálně 2× tolik kvůli debugging/refactor/burnout. Plán neobsahuje žádný buffer ani "kill switch" feature.
- **P2 — i18n až v Phase 17** je technický dluh. Pokud quest dialogy v Phase 9–12 vznikají hardcoded CS strings, refactor v Phase 17 je velký lift. ADR-016 říká "od dne 1", action plan to porušuje.

## Doporučené akce

- **Posuň Phase 5 (persistence) + restore drill _před_ Phase 6.** Ihned. Persistovaný hráčský state bez ověřeného restore = data loss waiting to happen. Cost: 1 den setup pg_dump cron + 1 den drill skriptu.
- **Vlož "Phase 4.5 — minimal CI + Vitest skeleton" (~2 dny).** Github Actions: typecheck + build + 1 test runner + (post-Phase 6) combat formula tests. Bez toho každá feature uprostřed Phase 8–18 bude rozbíjet něco staršího.
- **Předem splash-test Nakama TS runtime na 100 CCU teď** přes load script (10 fake klientů × 10 connections, click-to-move bombing). Validuj `goja` perf claim z ADR-003 _před_ Phase 6 combat, ne po Phase 18 launch.
- **Reorder: i18n framework v Phase 9 (current 17), translation backfill zůstává v 17.** Náklad ~1 den teď, ušetří ~3 dny refactoru později. ADR-016 to ostatně diktuje.
- **Cut Phase 18 scope na half nebo split do 18a/18b.** Zveř upřímný odhad: 1 mapa + 5 NPC + 1 quest + 1 mob = MVP demo loop. Zbytek je beta content.
- **Přidej "kill switch" review po Phase 11.** Risk checkpoint to zmiňuje, ale není to akce — naformuluj _kritérium_, kdy projekt zabít/pivot (např. "po Phase 11 jsem strávil X týdnů, hra mě nudí 30 min playtest = pivot na single-player"). Ochrana před sunk cost klamem.

## Reference

- [Heroic Labs Nakama TS Runtime docs](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/) — single-threaded `goja`, async limitations
- [Nakama production scale](https://heroiclabs.com/nakama/) — "1 trillion requests/month", g1-small minimum
- [Phaser news: Noxious — 2D isometric MMORPG](https://phaser.io/news/2026/04/noxious-2d-isometric-mmorpg-phaser) — proof-of-concept, že Phaser MMO 2026 funguje
- [Phaser large-scale performance pitfalls](https://www.mindfulchase.com/explore/troubleshooting-tips/game-development-tools/troubleshooting-phaser-performance-and-memory-issues-in-large-scale-games.html) — scene cleanup, asset preload, GPU texture leaks
- [Highspell — RSC spiritual successor](https://highspell.itch.io/highspell) — solo/small team, browser-based, content-driven, MVP simplicity model
- [Faehnor Online — solo MMO 2026](https://massivelyop.com/2026/02/18/get-lost-says-solo-dev-created-early-access-mmo-faehnor-online/) — current solo MMO benchmark; "začalo 2019, sólo od 2022" = 4+ let do early access
