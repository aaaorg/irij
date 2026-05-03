# QA / Test Engineer Review

## TL;DR

Repo má **nulový automated test coverage** — `pnpm test` je no-op, žádný runner. ADR-017 (Vitest + Postgres testcontainer + manual e2e) je **Proposed**, ne realizovaný. Manuální Playwright smoke per `feedback_real_browser_verification.md` funguje pro Phase 1-4 (sólo dev, malý surface), ale **nebude škálovat** do Phase 6+ (combat, ekonomika, persistence) — regresní matrice se znásobí. Server-side game logika (`pathfinding.ts`, `walkable.ts`, brzo combat formulas) jsou **pure functions, ideální Vitest cíl** — odložit zavedení = každá refaktor pumpa odhaluje regresi až v reálu. Anti-cheat checkpoint v Phase 4 byl manuální (dev tools `MOVE_REQUEST` spoof) — stejné scénáře v Phase 5+ (autosave race, position spoof přes reconnect) je nutné automatizovat dřív, než se stane „klikat všechno znova". **Doporučení:** založit Vitest pro `server/src/match/*` a `shared/*` **ihned** (1-2 dny), formalizovat Playwright smoke do `client/tests/smoke/` se 2-3 golden paths a CI gate. E2e proti živému Nakamě v Postgres testcontaineru je P1, ne P0. Bundle size + FCP budget z ADR-013 dnes nikdo neměří.

## Co je dnes v pořádku

1. **Pure utilities napsané testovatelně** — `pathfinding.ts` exportuje `findPath()` jako pure function s explicit options, `walkable.ts` má `maskFromTiledMap`/`isWalkable`/`nearestWalkable` bez Nakama runtime dep. Komentář v pathfinding.ts to explicitně reflektuje („Snadno mockuvatelné kdyby někdy vznikl test runner"). Smoke asserts ve walkable.ts (řádky 173-182) jsou ready-to-port.
2. **Goja constraint disciplína** je lessons-learned-driven (memory `feedback_nakama_state_mutation.md`, `feedback_nakama_init_pattern.md`) — zdokumentovaná v CLAUDE.md, takže testy budou cílit konkrétní pasti, ne fishing expedition.
3. **Real-browser verifikační protokol** existuje a je vynucovaný (`feedback_real_browser_verification.md` + CLAUDE.md bod 6 git workflow) — Playwright MCP s `browser_console_messages` check, dev-only `window.__irijGame` hook pro programmatic scene access. Repeatable a documented.
4. **Sdílené opcodes a constants** ([opcodes.ts](../../shared/src/messages/opcodes.ts), constants) jsou single-source — kontrakt klient/server testovatelný v jednom test souboru bez stub mocking.
5. **TypeScript strict mode + `noUncheckedIndexedAccess`** chytá podstatnou část „regrese typu undefined" už při `pnpm typecheck` — Vitest tedy nemusí pokrývat triviální guards, soustředí se na business logic.

## Mezery v testování

1. **[P0] Nula automated coverage pro pure server logic.** A* + walkable + (brzo) combat formulas, XP curve, fractional skill awards — vše pure, vše regresně náchylné. 4-conn → 8-conn migrace v ADR-020 byla risk-free jen díky tomu, že kód je triviální; další pathfinder change bez testů = ruleta.
2. **[P0] Žádný kontraktní test opcodes ↔ payloads.** Pokud kdokoli změní Op číslo nebo přidá required field do payloadu, klient/server desync se projeví až v Playwright smoke. Validace přes Zod nebo TypeScript-only `satisfies` checks v testu (round-trip `JSON.parse(JSON.stringify(msg)) satisfies T`) chybí.
3. **[P1] Anti-cheat checkpointy nejsou automatizované.** Phase 4 vyžadovala manuál spoof přes dev tools (out_of_bounds reject) — Phase 5 přidá autosave race, Phase 6 attack-out-of-range, Phase 7 inventory-overflow exploit. Manuálně klikat každou regresní iteraci = odložené debt.
4. **[P1] Žádný server runtime smoke proti živé Nakamě.** Match handler join/leave/move sekvence se dnes ověřuje pouze přes 2-tab Playwright. Postgres testcontainer + Nakama Docker + headless WebSocket klient by chytil 90 % regresí bez Phaser overhead.
5. **[P2] Performance budgety neexistují jako gate.** ADR-013 říká „bundle <5 MB, FCP <2 s" ale `vite build` neměří, žádný `lighthouse-ci` ani `bundlesize`. Phase 20 budget audit najde problém pozdě.
6. **[P2] Persistence/idempotence regrese (Phase 5).** Spawn-na-poslední-pozici po re-login + autosave během match crash recovery jsou klasické off-by-one bug magnety. Bez testu „join → move → kill server → restart → join → expect pos == last_save" se chyba projeví u hráčů.

## Doporučené akce

1. **[P0, ~1 den] Zaveď Vitest** v root + per-package `test` script. První suite: `server/src/match/pathfinding.test.ts` + `walkable.test.ts` (port stávajících smoke komentářů + edge cases: corner-cutting, max-path cap, unreachable target). `pnpm test` pak něco dělá. Žádný coverage target — pokrýt **constraints z 02a-e**, jak ADR-017 sám předepisuje.
2. **[P0, ~0.5 dne] Opcode/payload kontraktní test** v `shared/src/messages/__tests__/`: parametrizovaný test že každá `OpCode` value je unique + má alespoň jeden payload type referenced from a fixture. Catch-net pro accidental duplicate při merge konfliktu.
3. **[P1, ~1 den] Formalizuj Playwright smoke do `client/tests/smoke/`** — 2-3 deterministic scénáře (login → char create → world spawn; login → world → click-to-move; 2-tab cross-visibility). Použij `window.__irijGame` hook, `expect(consoleErrors).toEqual([])`. Spustitelné `pnpm test:smoke` lokálně, gate v CI (až bude).
4. **[P1, ~2 dny po Phase 5] Server integration testy přes Postgres testcontainer.** `@testcontainers/postgresql` + Nakama Docker z `infra/`, headless `@heroiclabs/nakama-js` klient v Vitest, scénáře: char create → join match → move → autosave → reconnect → expect persisted state. Phase 5 deliverable je krytý automaticky, ne manuálně.
5. **[P2, ~0.5 dne] Anti-cheat regresní suite** jako součást integration testů: malformed payload, out_of_bounds, rate_limit (>10/s), no_path do bezvýchodné enklávy. Každý nový reject reason = 1 test. Phase 4 anti-cheat checkpoint pak není manuálně checklist, ale red/green.
6. **[P2, odložit do Phase 18-20] Bundle + Lighthouse gate.** Před Phase 20 audit přidat `bundlesize` (5 MB cap z ADR-013) a `lighthouse-ci` headless run jako advisory check. **Neřešit teď** — bundle je dnes ~Phaser 3 MB + game code ~50 KB, daleko od cap.

## Reference

- [docs/04 ADR-017 Test strategy](../04-tech-adr.md#adr-017-test-strategy) — Proposed Vitest + testcontainer + manual e2e
- [server/src/match/pathfinding.ts](../../server/src/match/pathfinding.ts) — pure A*, prime Vitest cíl
- [server/src/match/walkable.ts](../../server/src/match/walkable.ts) — smoke asserts v komentáři čekají na port
- [shared/src/messages/opcodes.ts](../../shared/src/messages/opcodes.ts) — kontraktní gap
- [CLAUDE.md sekce „Co v repu zatím není"](../../CLAUDE.md) — `pnpm test` je explicitně no-op
- [feedback_real_browser_verification.md](/home/jakub/.claude/projects/-home-jakub-git-irij/memory/feedback_real_browser_verification.md) — Playwright protokol
- [docs/00 Phase 4 anti-cheat checkpoint](../00-action-plan.md) — manuál dev-tools spoof, automatizační kandidát
- Vitest docs (https://vitest.dev), Heroic Labs Nakama testing patterns (testcontainers + nakama-js headless), Phaser scene unit testing — Phaser community konsenzus je „skip unit, jdi e2e", ROI nízké
