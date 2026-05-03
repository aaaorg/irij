# Phaser Specialist Review

Reviewer: senior Phaser 3 specialista, 5+ let
Datum: 2026-05-03
Rozsah: client/src + render util + isometric kontrakt po dokončení Phase 4

## TL;DR

Klient je čistě napsaný, idiomatický Phaser 3.90 kód s velmi dobrou volbou pro server-authoritative model: deterministic per-frame lerp v `update()` místo Phaser tweens (ADR-019) je správné rozhodnutí, které mě překvapilo pozitivně — drift recovery po hidden tabu je elegantní a přesně podle „RuneScape/Tibia" patternu. Scene flow Boot → Login → CharCreate → World je clean, registry-based DI + `SHUTDOWN` hook handlují cleanup korektně. Hlavní rizika jsou architektonická a čekají v pozdějších fázích: **Phaser 4 `TilemapGPULayer` nepodporuje isometric** (ortho-only, doloženo z Phaser docs/skill), takže 256×256 mapa v Phase 18 pojede přes klasický `TilemapLayer` a chce explicit `setCullPadding` + ověření výkonu na mobilu. Dále chybí asset preloader scene s progress barem, click-shield pro HUD je heuristika (HUD_GUARD_W/H), a sprite-sheet je dnes 32×48 single-frame — Phase 6+ bude potřebovat 8 směrů × ≥4 framy walk cycle a texture atlas, ne separátní obrázky.

## Úspěchy

1. **Per-frame deterministic lerp v `WorldScene.update()`** (WorldScene.ts:268–318) místo Phaser tweens — eliminuje drift v hidden tabu, self-correcting přes `Date.now()` baseline. Toto je **lepší** než většina komerčních klick-to-move klientů, které řeší Page Visibility API ručně.
2. **Projection / ysort util oddělené** od scéně (`render/projection.ts`, `render/ysort.ts`) s jasným ADR-018 kontraktem — depth bandy 0/1000/10000 + worldY * Y_SCALE je škálovatelný a featOffset rezerva pro sub-tile řazení je pečlivá.
3. **Camera bounds spočtené korektně** pro iso projekci (WorldScene.ts:425–431) — minX = -(H-1)·HW, plus startFollow s lerp 0.15 dává plynulý chase bez cizí závislosti.
4. **`pointer.worldX/worldY`** (ne raw `pointer.x/y`) v `handlePointerDown` — autor si byl vědom camera scroll/zoom, což je častá chyba juniorů.
5. **Idempotentní spawn** (`spawnRemotePlayerIfNeeded` čeká na `otherPlayers.has()`) + cleanup ve `SHUTDOWN` handleru (`tweens.killAll`, sprite destroy, leaveMatch fire-and-forget) — žádný leak při scene restart.

## Rizika & gotchas

1. **[P0] Phase 18 256×256 isometric mapa nemůže použít `TilemapGPULayer`** — Phaser 4 GPU layer je dle docs **ortho-only**. Klasický `TilemapLayer` v iso režimu má per-frame culling per tile a na mobilu (Adreno 6xx) může spadnout pod 60 FPS. Action plan to neřeší. Mitigace: chunked tilemap (load 5×5 chunks kolem hráče, unload zbytek) nebo delete-and-rebuild při crossing chunk boundaries. Nutné prototypovat **před** Phase 18.
2. **[P0] BootScene nepreloaduje nic** — `WorldScene.preload()` načítá tileset + tilemap JSON + spritesheet až při entry, takže první frame WorldScene má prázdný canvas s default Phaser pozadím a pak hard-pop. Pro UX nutný PreloadScene mezi Login → World s progress barem (nutné pro Phase 18 kdy assetů přibyde řádově).
3. **[P1] `pointerdown` na globální `this.input`** + heuristic HUD_GUARD_W/H (WorldScene.ts:34, 357) — jakmile přibude inventář/chat/hotbar (Phase 7+, 16), guard bude mismatch. Phaser idiomatický fix: udělat HUD jako `Container` s `setInteractive()` a v scene listeneru kontrolovat `pointer.event.target` nebo použít `input.topOnly = true` + interactive UI elements stop propagaci.
4. **[P1] Sprite sheet 32×48** (WorldScene.ts:66–69) je single-frame placeholder — pro Phase 6+ bude 8 směrů × 4-8 walk frames + idle + attack = řádově 100+ frames per character. Bez **texture atlasu** (`load.atlas()` + JSON-Hash) draw calls poletí a paměť taky. Také dnes není žádný `anims.create()` registr — Phase 6 ho bude muset zavést retroaktivně.
5. **[P1] `sprite.depth` přepočet každý frame v `update()`** pro každou movujícící entitu (WorldScene.ts:312) — pro 100 CCU + 50 mobů ne problém, ale Phaser interně při depth změně musí re-sortovat display list. Pokud `Y_SCALE = 10` zaokrouhlí depth na stejnou hodnotu mezi framy, sort by se mohl skipnout — dnes lerpedY je float, takže každý frame je jiný depth → forced re-sort. Zvážit `Math.round(lerpedY * Y_SCALE)` jako mikro-opt v Phase 18.
6. **[P2] PWA workbox `globPatterns: '**/*.{js,css,html,png,svg}'`** (vite.config.ts) precachuje **všechny** sprite/tileset PNG — pro 256×256 mapu s ~50 props v Phase 18 to bude desítky MB v service workeru. Cache jen lobby/login + lazy-load game assets. Také chybí `.webp` v glob — moderní browsery podporují, ušetří 30 %.
7. **[P2] `pixelArt: true` + `roundPixels: true`** (main.ts) je správně, ale pro iso projekci s 2:1 ratio + camera follow s `lerp 0.15` může vzniknout **subpixel jitter** kdy postava občas „skočí" 1 px. Test: pomalý pohyb po cardinal směrech, screen capture 60 FPS. Fix: integer kamera pozice (`cameras.main.useBounds = true` + manual round v post-render).

## Doporučené akce

1. **Přidej PreloadScene mezi Boot a Login** (`client/src/scenes/PreloadScene.ts`): načti tileset + character spritesheet + map JSON s `this.load.on('progress')` progress barem. Ulehčí Phase 18, kdy assetů řádově přibyde. Refactor BootScene.ts:21 — místo přímého `LoginScene` přejdi na PreloadScene.
2. **Prototypuj chunked iso tilemap** v separátní spike branchi **před** Phase 18: 256×256 logická mapa, render jen 5×5 viewport chunks (50×50 tiles each), reload on `cameras.main.scrollX/Y` boundary cross. Měř FPS na mobilu (Chrome DevTools throttle „Mid-tier mobile"). Bez tohoto je Phase 18 risk > 50 % rework.
3. **Nahraď HUD click-shield** (WorldScene.ts:34, 357) za proper Container-based UI: `const hud = this.add.container(0,0).setScrollFactor(0); hud.add([...])`. HUD elements mají `setInteractive()` a `pointerdown` v sceně používá `if (pointer.event.defaultPrevented) return`. Připrav před Phase 7 (inventář).
4. **Zaveď texture atlas + `anims` registr** v Phase 6 startu: `client/src/render/anims.ts` exportuje `registerCharacterAnims(scene)` voláný v PreloadScene.create(). Frame layout 8 directions × 4 walk frames + 1 idle = 33 frames per character; atlas ušetří draw calls 8× proti separátním sheetům.
5. **Mobile touch verification před Phase 20**: `pointerdown` v Phaseru pokrývá touch i mouse, ale **multi-touch** (pinch-to-zoom) na mobilu vyvolá `pointerdown` per touch — dnes to vystřelí MOVE_REQUEST per prst. Add `if (pointer.id !== 0) return` v handlePointerDown nebo `this.input.addPointer(0)` pro single-pointer-only.
6. **Phaser version pin**: dnes `^3.90.0` v package.json — držet v lock fileu, NEupgrade na Phaser 4 LTS bez deep regression test (Phaser 4 přepsal renderer, isometric API se nezměnilo, ale TilemapLayer culling logic ano).

## Reference

- Phaser docs/skill „TilemapGPULayer is orthographic only" (Phaser 4 changelog) — confirmuje, že velká iso mapa zůstane na CPU TilemapLayer
- Phaser 3.90 `Tilemap.getIsoTileAtWorldXY()` — alternativa k vlastnímu `screenToTile()`, ale autorův vlastní util je čistší pro server payload (vrací integer tiles bez camera offset matrix)
- ADR-018 (`docs/04-tech-adr.md:510-588`) — engineering kontrakt iso renderu, sekce „Y-sort overhead" přiznává O(n log n) sort risk
- ADR-019 (`docs/04-tech-adr.md:591+`) — path-based ENTITY_MOVED, klient self-correcting drift recovery (autor je očividně srozuměn s `requestAnimationFrame` semantikou v hidden tab)
- ADR-020 (8-conn A* + octile) — directional sprite (8 facing) bude potřeba pro Phase 6+ animace; dnes statický `FRAME_FACING_SE`
- `phaser3-rex-plugins` — board-iso plugin existuje, ale autor správně nevolil; vlastní 60 řádků projection util je čitelnější a řádově lehčí
