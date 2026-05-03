# Networking / Realtime Review

**Reviewer perspektiva:** senior networking / realtime engineer
**Datum:** 2026-05-03
**Scope:** Match Data + RPC vrstva, opcode katalog, broadcast scope, transport (Nakama WebSocket, JSON).

## TL;DR

Síťová vrstva je na MVP úrovni nadprůměrně promyšlená — path-based ENTITY_MOVED (ADR-019) je správný design pro click-to-move grid MMO a dramaticky redukuje uplink/downlink ve srovnání s naivním 10 Hz tile snapshot streamem. Opcode layout (group-by-feature, 1–119, řídké rezervy) je rozšiřitelný a přiměřeně malý. Hlavní díry jsou (1) **CHUNK_SIZE = 64 tilů na 50×50 mapě**, takže 3×3 AOI = celý svět a žádný spatial culling reálně neexistuje, (2) chybí klient-side **clock sync / RTT measurement** (Date.now() baseline má lineární drift vs. server tick), (3) **bezpečnostní hygiena RPC** (rate limit middleware, profanity, anti-spam pro chat) je spec, ne kód, a (4) **reconnect / session resume** klient v podstatě nemá — `ondisconnect` jen restartuje LoginScene.

## Úspěchy

1. **Path-based ENTITY_MOVED (ADR-019)** — O(1) bandwidth per move, deterministic klient lerp z wall-clock baseline, self-correcting proti hidden-tab drift. Lepší než Quake-snapshot model i naivní per-tile broadcast pro tento žánr.
2. **Group-by-feature opcode rozsahy 1–119** — single source of truth v `shared/src/messages/opcodes.ts`, číslo zarovnané v 10-blocích s rezervou ~5 slotů per doménu, malý wire footprint (1B varint).
3. **Joiner-only WORLD_SNAPSHOT s in-flight path daty** — `path?`, `speed_tps?`, `started_at_tick?` v `WorldSnapshotEntity` zajistí, že late-joiner vidí běžící hráče v pohybu, ne staticky na startu pathu. Korektně řeší klasický "snapshot lag" problém.
4. **Per-userId rate limit pro MOVE_REQUEST (sliding 1s/10)** — implementováno v `movement.ts` se správnou Goja-safe top-level reassign mutací; `MOVE_REJECTED` enum (`malformed | rate_limited | stunned | out_of_bounds | no_path | too_far`) granulární a klient potlačuje toast pro `rate_limited` (správný UX).
5. **Chunk-cluster ready architektura** — broadcast jde přes `recipientsInRangeOfChunk` index, ne globální iteraci; post-MVP rozdělení na multi-match je bezbolestné.

## Rizika

1. **[P0] AOI je v praxi „broadcast all".** `CHUNK_SIZE_TILES = 64`, mapa 50×50, takže každý hráč = chunk (0,0) a 3×3 okolí pokrývá celý svět. Pro 100 CCU na single match to znamená každý ENTITY_MOVED jde všem (~100×). Test/dev to nezachytí, ale jakmile se mapa zvětší na MVP_WORLD_SIZE_TILES=256 (4×4 chunky), 3×3 stále = 9/16 mapy = ~56% all. **Doporučení:** snížit `CHUNK_SIZE_TILES` na 16 (tibia-like, AOI ~48×48 tilů) ještě před prvním load testem.
2. **[P0] Klient nemá clock sync ani RTT measurement.** `Date.now() - startedAtMs` ignoruje (a) klient–server clock skew (uživatel s posunutými hodinami = sprite skáče), (b) network latency (klient lerpuje vždy ~RTT/2 za serverem). `SERVER_TICK` opcode (73) je rezervovaný ale nepoužitý. Pro 100 ms+ RTT z mobilu mimo EU bude pohyb cizích hráčů poskakovat. **Doporučení:** Phase 5/6 implementovat `SERVER_TICK` 1 Hz heartbeat s `server_time_ms` + klient EWMA RTT estimator a posunout `startedAtMs += rttHalfMs`.
3. **[P1] Frame size estimate (path-based, JSON).** Typický `EntityMoved` payload pro 10-tile path: `{"entity_id":"<UUID 36>","from":{"x":25,"y":25},"path":[{"x":26,"y":25},...×10],"speed_tps":3,"started_at_tick":1234}` ≈ **~280 B JSON**. 100 hráčů × 1 move/3s × 100 recipientů × 280 B = **~930 KB/s** server uplink. Ne katastrofa, ale ADR-008 odhad „1 MB/s" je optimistický a předpokládá funkční AOI (viz P0). S Cloudflare WebSocket compression (per-message-deflate) realistický faktor 2–3×.
4. **[P1] WORLD_SNAPSHOT může nabobtnat.** V současné podobě 100 hráčů = 100 entity entries × ~150 B JSON = **~15 KB** singleton payload v matchJoin. Nakama WebSocket frame default cap je obvykle ~16 KB; nad to klient může být odpojen. Mob/drop layer Phase 6+ ten payload vynásobí. **Doporučení:** chunked snapshot (per chunk batch) nebo opt-in `entities_compressed` flag.
5. **[P1] Reconnect / session resume neexistuje.** `WorldScene.ondisconnect` → `scene.start('LoginScene')`, žádný auto-reconnect, žádný `socket.send` retry buffer, žádný "session resume" pattern. Mobilní hráči s wifi-cellular handoffem ztratí běh. **Doporučení:** klient implementuje exponential backoff reconnect + Nakama session refresh; server `matchJoinAttempt` tolerantní k re-join se stejným userId (4b komentář to plánuje, ale není to napsané).
6. **[P2] Chat / RPC rate limity = spec only.** `docs/03` má rate-limit tabulku (CHAT 5/10s, profanity, whisper online check), ale `shared/src/messages/chat.ts` definuje jen typy a žádný server handler ani middleware nikde neexistuje. Chat opcodes (50/51) jsou stále na plánu pro Phase 6+, ale anti-spam infra (sliding window helper, profanity dict) by měla být generická a sdílená s MOVE_REQUEST limiterem — teď je rate logic hardcoded inline.

## Doporučené akce

1. **Phase 5 polish:** snížit `CHUNK_SIZE_TILES` na 16, přidat unit test ověřující že 3×3 broadcast pro hráče v centru velké mapy obsáhne <30% presencí. Aktualizovat ADR-007 o důvod.
2. **Phase 5/6:** implementovat `SERVER_TICK` (op 73) 1 Hz + klient RTT/clock-skew EWMA. Bez tohohle je deterministic lerp lhaní pro >50 ms RTT.
3. **Phase 6 před chat:** generický `RateLimiter` modul (sliding window, configurable per opcode), middleware kolem dispatch v `matchLoop` před per-handler kódem. Aktuální MOVE-inline pattern se nesmí kopypastovat do `ATTACK_REQUEST`, `CAST_SPELL_REQUEST`, `CHAT_MESSAGE`.
4. **Phase 5:** klient-side reconnect strategy — exponential backoff (1s, 2s, 4s, max 30s), session resume přes Nakama refresh token, "Reconnecting…" UI overlay místo skoku zpět na LoginScene. Server `matchJoinAttempt` musí dovolit re-join se stejným userId (kick old presence + accept new).
5. **Před prvním stress testem:** instrumentace — server `dispatcher.broadcastMessage` wrapnout v `outboundBytesCounter`, `matchLoop` měřit p50/p95 ms, klient logovat počet ENTITY_MOVED/s + RTT odhad. Bez baseline nemáš co optimalizovat při přechodu na Protobuf.
6. **Schema versioning:** ADR-008 / docs/03 zmiňuje `schema_version` field jako default 1, ale žádný payload ho zatím nemá. Dodat aspoň do `WorldSnapshot` před Phase 5, jinak budou breaking changes vyžadovat lockstep client/server deploy.

## Reference

- ADR-006/007/008/009/019/020 — `docs/04-tech-adr.md`
- Glenn Fiedler, "Snapshot Compression" / "State Synchronization" (gafferongames.com) — proč path-based je správný pro tento žánr (pole 8.4)
- Tibia / OSRS protocol reverse-eng (TibiaAPI, RuneLite) — single broadcast cesty, klient interpoluje
- Cloudflare WebSocket idle timeout 100s — Nakama heartbeat 15s pokrývá
- Nakama match data API — `dispatcher.broadcastMessage(opcode, data, presences?)`, podporuje string i Uint8Array (Protobuf-ready)
