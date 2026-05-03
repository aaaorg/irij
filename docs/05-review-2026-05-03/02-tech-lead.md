# Tech Lead Review

**Reviewer:** Tech Lead (cross-stack architecture)
**Datum:** 2026-05-03
**Scope:** Phase 0–4 hotové. Single-source-of-truth shared package, klient/server boundary, match handler architektura, tickrate model, TS config, server bundle, pathfinding, technický dluh.

## TL;DR

Architektura je na sólo-dev MVP nadprůměrně disciplinovaná: shared package je skutečně používaný (opcodes, types, konstanty čte klient i server), boundary RPC ↔ match data je čistě řezaný, ADR-005 chunk-cluster-ready vzor (`presencesByChunk`, `broadcastToChunkArea`, 3×3 scope) je už teď implementovaný správně, takže post-MVP split nebude refaktor logiky. ADR-019 path-based broadcast + deterministic klient `update()` je zralé rozhodnutí (RuneScape/Tibia model, zero-bandwidth scaling, self-correcting po hidden-tab). Hlavní rizika: **server bundle IIFE-strip hack** (regex unwrap, brittle vůči esbuild update), **Goja state mutation kontrakt** je nepokrytý testy, walkable mask je single source of truth pro server, ale klient ho neuvidí (out-of-bounds drift při Phase 18 polish), a `any` cast `mapJson as any` v `world.ts` ruší jistotu, kterou TS jinak drží. Tickrate counter pattern je v pořádku, ale zatím chybí scaffold (žádné counters v `matchLoop` mimo movement).

## Úspěchy

1. **Shared package skutečně funguje jako single source of truth.** `Op` enum, `Position`, `EntityMoved`, `MoveRejectReason`, konstanty `MOVEMENT_SPEED_TPS_BASE` a `TICK_HZ` jsou importované klientem i serverem ze stejného `irij-shared/*` exportu. Žádný drift, žádná duplicita. `"main": "./src/index.ts"` (bez build kroku) byl správné rozhodnutí pro sólo-dev tempo.
2. **Chunk-cluster-ready architektura je víc než lip service.** `presencesByChunk` index, `chunkKeyOf`, `recipientsInRangeOfChunk`, `broadcastToChunkArea` jsou skutečně používané pro spawn/despawn/move broadcasty — žádná globální iterace nad celým světem. Post-MVP split 4×4 chunků = 1 match opravdu nebude vyžadovat přepis game logiky.
3. **ADR-019 path-based broadcast + deterministic klient update** je zralé inženýrství. Bandwidth O(1) per pohyb, hidden-tab self-correction přes `Date.now()` baseline, late-join `WORLD_SNAPSHOT` zahrnuje in-flight path suffix — to je pattern z RuneScape/Tibia, ne reinvence.
4. **Goja constraints jsou explicitně dokumentované v komentářích `state.ts`/`movement.ts`** (spread + reassign top-level field, plain object místo Map/Set, named functions místo helper). Tichá past, kterou solo dev za 6 měsíců zapomene — komentáře jsou jediná obrana, dělají svou práci.
5. **Octile A\* + no-corner-cutting + diagonal-first expansion + binary min-heap** je textbook quality. `MAX_PATH_LENGTH_TILES` jako step counter (ne cost) drží sémantiku konstanty stabilní napříč diagonálami, což je nuance, kterou většina hobby implementací míjí.

## Rizika

1. **[P0] esbuild IIFE-strip hack je fragile.** `build.js` regex-uje `var __irij_server = (() => {\n` a `})();\s*$` — jakákoliv změna v esbuild output formatteru (nový minifikátor, source map injection, prologue tweak) tichě rozbije unwrap a Nakama hodí `failed to find InitModule`. Žádný integration test to nezachytí. Mitigation: smoke check post-build (`grep -E "^function InitModule" dist/index.js`) jako exit-1 guard, plus pin `esbuild` version exact (ne `^0.28.0`).
2. **[P0] `mapJson as any` cast v `world.ts:52`** ruší typovou jistotu právě tam, kde jí potřebuješ nejvíc — walkable mask init z bundlnutého `.tmj`. Pokud Tiled exportuje s mírně jinou strukturou (různé layer types, group layers, infinite maps), runtime KO bez TS warningu. Mitigation: definuj `TiledMap` typ v `shared/src/types/world.ts` a používej ho jak v esbuild loaderu, tak v `walkable.ts`.
3. **[P1] Race v `worldFindOrCreateMatch`** je dokumentovaná, ale orphan match s 0 hráči pořád běží a tickuje 10 Hz dokud Nakama idle timeout neudeří. Při flash-mob scénáři (Discord post → 50 lidí v 5 s) vznikne 2–3 orphans. Mitigation: nakama `nk.matchSignal` z prvního successful joinu, který terminuje ostatní; nebo idempotentní hash ID `world.main` přes `nk.matchCreate({ singleton: true })` (ověř Nakama docs).
4. **[P1] Walkable mask drift mezi server a klient.** Server parsuje `.tmj` v `maskFromTiledMap`, klient parsuje stejný `.tmj` přes `Phaser.Tilemap`, ale obě strany mají vlastní logiku „co je walkable" (server: `NON_WALKABLE_TILE_GIDS`; klient: zatím nic, bere screen click a posílá serveru). V Phase 18 polish s plnou Blatiny mapou + objects layerem bude klient muset filtrovat clicky lokálně (UX ≠ network roundtrip pro každý klik na strom), což znamená duplikaci logiky. Mitigation: `shared/src/world/walkable.ts` s purě funkcí `isWalkableGid(gid)` importovanou oběma stranami; nebo server endpoint `rpc.world.get_walkable_chunk(cx, cy)` s in-memory cachem klienta.
5. **[P1] Tickrate counters nejsou scaffold.** `matchLoop` zatím dělá jen `advanceMovement` + zpracování zpráv. Combat/AI/autosave ticky přijdou v Phase 5–6, ale není tu ani placeholder counter (`if (tick % COMBAT_TICK_INTERVAL === 0) ...`). Riziko: první implementace combatu si counter naoctroju ad-hoc bez jednotné struktury, vznikne spaghetti. Mitigation: zaveď `runScheduledTicks(state, tick)` helper s explicitní table-driven enumerací.
6. **[P2] `state.moveRequestLog` je per-userId rate limit, ale roste neomezeně po `matchLeave`.** Cleanup je v `matchLeave`, ale pokud presence projde `matchTerminate` cestou (server restart grace), entries se neuklidí. Pro 100 CCU triviální, dokumentuj jako known limit.

## Technický dluh & landminy

1. **Žádný test runner.** `pnpm test` je placeholder. Pathfinding (octile cost, no-corner-cutting), parseMoveRequest, rate limit sliding window, `computeCurrentPosition` při change-mid-path, walkable BFS — všechno čistě funkční, perfektně testovatelné Vitestem za večer. Bez testů každý refaktor = playtest roulette.
2. **`number[]` místo `Uint8Array` v `WalkableMask`** kvůli Goja round-trip safety. Pro 50×50 OK, ale 256×256 = 65 536 entries × 8 byte boxed number = ~0.5 MB heap per match jen pro masku. Měřitelné při 16 chunků 64×64. Post-MVP otestuj, jestli Goja `Uint8Array` opravdu nedrží napříč handlery — pokud ano, switch.
3. **Klient `clientSeq` se inkrementuje, ale server ho jen echo-uje v `MOVE_REJECTED` a do `presence.clientSeq`. Žádné reconciliation.** Komentář to přiznává jako post-MVP TODO, ale jakmile přijde combat predikce v Phase 6+, chybějící reconciliation framework způsobí, že každá feature si vymyslí vlastní seq tracking. Postav reconciliation scaffolding teď, dokud je málo opcodes.
4. **`callRpc` HTTP wrapper pro RPC vs `socket.sendMatchState` pro match data** — boundary funguje, ale klient nemá společnou error-handling vrstvu. Každý RPC volající chytá `try/catch` ručně. Phase 5+ to znásobí. Zaveď `Result<T, RpcError>` discriminated union v `shared/src/messages/`.
5. **`pnpm build:shared` je `tsc --noEmit`** (komentář v `package.json` říká „shared se nebuilduje, čte se TS přímo"). Klient (Vite) i server (esbuild) zvládají TS přímo, takže tohle funguje, ale `dist/` v shared neexistuje a nikdy nebude — což znamená, že pokud někdy budeš publikovat shared jako npm balík (post-MVP modding API?), čeká tě nečekaný refaktor `exports`. Triviální dnes, otrava později.

## Doporučené akce

1. **Přidej post-build guard do `server/build.js`:** po `unwrapIife()` načti `dist/index.js` a fail-fast, pokud regex `^function InitModule\b` nematchne na top-level. 5 řádků kódu, eliminuje silent failure z #1.
2. **Definuj `TiledMap` typ v `shared/src/types/world.ts`** a nahraď `mapJson as any` v `world.ts:52` skutečným typed importem. Stejný typ použij ve `walkable.ts` `maskFromTiledMap` parametru.
3. **Postav Vitest scaffold + 5 unit testů:** `findPath` happy path + `MAX_PATH_LENGTH` cap + no-corner-cutting, `nearestWalkable` 8-conn semantika, `parseMoveRequest` invalid shapes, rate limit sliding window edge cases, `computeCurrentPosition` mid-path. ROI: zachytí regrese při Phase 6+ combat refaktoru pathfindingu.
4. **Zaveď `runScheduledTicks(state, tick, dispatcher)` helper s table-driven counters** (`combat: COMBAT_TICK_INTERVAL`, `ai: AI_TICK_INTERVAL`, `autosave: PLAYER_AUTOSAVE_INTERVAL`). Phase 5 autosave přijde jako první volání. Sjednotí counter pattern napříč fázemi.
5. **Sdílená walkable typology v shared.** Přesun `NON_WALKABLE_TILE_GIDS` z `shared/src/constants` (kde už je) plus `isWalkableGid(gid)` pure funkce do `shared/src/world/walkable.ts`. Klient i server importuje. Připraví Phase 18 polish bez drift rizika.
6. **Pin `esbuild` na exact version** (`0.28.0` ne `^0.28.0`) v `server/package.json`. Krok zmírní #1 do doby, než přidáš guard.

## Reference

- [Nakama JS runtime — Match Handler API](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/) — kontrakt `matchInit`/`matchLoop`/state mezi handlery, používá Goja interpreter.
- [Goja runtime](https://github.com/dop251/goja) — pure-Go ES5.1+ JS, podpora ES2015+ částečná; chybí stabilní semantika round-trip pro `Map`/`Set`/`Uint8Array` v Nakama match state, viz komentáře v `state.ts`.
- [RuneScape/Tibia path-based movement protokol](https://oldschool.runescape.wiki/w/Pathfinding) — referenční model pro ADR-019.
- [Theta\* any-angle pathfinding](https://news.movingai.com/theta) — kandidát post-MVP, jakmile bude movement animation system.
- Repo: `server/build.js`, `server/src/match/world.ts`, `server/src/match/movement.ts`, `server/src/match/pathfinding.ts`, `server/src/match/state.ts`, `server/src/match/walkable.ts`, `client/src/scenes/WorldScene.ts`, `client/src/render/projection.ts`, `shared/src/messages/movement.ts`, `shared/src/constants/index.ts`, `tsconfig.base.json`.
