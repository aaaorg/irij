# Frontend / UX Review

**Reviewer:** senior frontend / UX engineer
**Datum:** 2026-05-03
**Scope:** `client/` v stavu po Phase 4 (movement). UI je explicitně text-mode, polish se plánuje na Phase 17/20.

## TL;DR

Klient je **inženýrsky čistý a deterministicky napsaný** (ADR-019 movement, scene flow Boot → Login → CharCreate → World, Phaser `Scale.RESIZE` + camera follow, render projection oddělená od world-space). Pro Phase 4 dev-build je to zcela adekvátní. **UX-side ale leží ladem několik investic, které měly proběhnout od day 1** podle vlastních ADR: i18next je v `package.json` ale nikde se neimportuje (ADR-016 přitom říká „všechny user-facing stringy přes `t()` od dne 1"), PWA manifest existuje ale **bez ikon = fail install kritérium**, char-creation je hardcore keyboard-only (Tab/Enter/šipky) a **na mobilu nepoužitelný**, žádný global error/disconnect overlay (jen `scene.start('LoginScene')`), žádný loading progress bar pro `preload()`. Nic z toho není showstopper teď, ale dluh roste a Phase 17/20 to bude muset vyčistit naráz.

## Úspěchy

1. **Scene flow je čistý a defenzivní** — `WorldScene` i `CharacterCreationScene` mají fallback na `LoginScene` při chybějícím connection/profile v registry; reset state v `create()` (Phase 2 lesson learned o Phaser scene lifecycle).
2. **Deterministic movement (ADR-019)** je správně implementovaný v `WorldScene.update()` — wall-clock baseline + recompute every frame, self-correcting po background tab return. Phaser tween by selhal kvůli rAF pause v hidden tabu, tohle ne.
3. **Render kontrakt drží** — `worldToScreen` / `screenToTile` v `render/projection.ts`, `depthForDynamic` y-sort v `render/ysort.ts`, server kód nikde nezná pixel coords (ADR-018 dodržen).
4. **Device-ID + guest auth** je odolný — fallback bez `crypto.randomUUID`, graceful degradace v Safari private mode (localStorage throw → in-memory ID).
5. **Vite dev konfig** myslí na LAN testing (`server.host: true`), `optimizeDeps.exclude: ['irij-shared']` řeší konkrétní HMR past s workspace TS source.

## Rizika & gotchas

1. **[P0] PWA manifest bez ikon** — `vite.config.ts` má `icons: []` s TODO komentářem. Web App Manifest spec a Chrome installability checklist vyžadují min. 192×192 a 512×512 (a maskable variant). Bez nich `beforeinstallprompt` nikdy nefiruje, „Add to Home Screen" v Chrome je disabled, iOS Safari ignoruje manifest úplně. Tj. dnes **nejsme installable PWA, jen stránka se service workerem**.
2. **[P0] i18n je dead dependency** — `i18next` + `i18next-browser-languagedetector` jsou v `package.json`, žádný `import` v `src/`. Stringy hardcoded česky inline v scene kódu (`'Hrát jako host'`, `'Vytvoř postavu'`, `'Tam se nedostaneš'`). ADR-016 explicitně říká „od dne 1, framework otestovaný, ne placeholder" — porušeno. Migrace všech existujících stringů do `t()` v Phase 17 = nontriviální PR napříč všemi scenes.
3. **[P0] Mobile char-creation je rozbité** — `CharacterCreationScene` poslouchá pouze `this.input.keyboard?.on('keydown', ...)`. Na mobilu není fyzická klávesnice a Phaser `Input.Keyboard` ji sám neopen-ne. Hráč na iOS Safari/Android Chrome se k vytvoření postavy **dnes vůbec nedostane**. Fix vyžaduje DOM `<input>` overlay nebo on-screen virtuální klávesnici; není to „polish v Phase 17", je to blocker.
4. **[P1] Žádný loading state pro `preload()`** — `WorldScene.preload()` načítá tilemap + tileset + spritesheet, ale `BootScene` po 300 ms `delayedCall` přepne dál a `WorldScene` ukáže prázdné brown pozadí dokud `create()` nedoběhne. Při slow 3G to bude vypadat jako zaseklá hra. Phaser `LoaderPlugin` má `'progress'` event — neviditelný progress bar je low-effort.
5. **[P1] Touch hit targety nejsou auditované** — login buttons jsou 280×48 px (OK, >44 px Apple HIG). HUD click-shield v `WorldScene` je 200×30 px (pod 44 px). „Discord (brzy)"/„Google (brzy)" buttons jsou disabled bez visual disclosure proč — chybí tooltip/aria. Phaser-rendered text má **nulovou screen reader podporu** — celá hra je dnes pro slepé hráče neviditelná (post-MVP, ale stojí to říct nahlas).
6. **[P1] Reconnect strategie chybí** — `socket.ondisconnect` v `WorldScene` skočí rovnou na `LoginScene` s žádným toastem. Žádný retry, žádný „spojení ztraceno, obnovuji…". Pro mobile (přepínání WiFi/LTE, suspend) to znamená: každé přerušení = retap „Hrát jako host" + reload světa od nuly. Nakama JS socket má `socket.adapter` a heartbeat, ale příjmu o disconnect tu chybí UX vrstva. `viewport meta` má navíc `maximum-scale=1.0, user-scalable=no` — přístupnost minus (zoom je legitimní AT feature).

## Doporučené akce

1. **Vygeneruj PWA ikony hned** (192/512/maskable, 1 hod práce v jakémkoli icon generatoru — `pwa-asset-generator` CLI). Bez nich PWA neexistuje, i kdyby všechno ostatní bylo dokonalé. Doplň do `vite.config.ts` `manifest.icons`.
2. **Posuň i18n boot z Phase 17 na teď** — minimálně `i18next.init()` v `main.ts` + dva soubory `cs.json`/`en.json` se stávajícími ~30 stringy. Nebraň migraci; čím déle to leží, tím větší dluh. Hodina práce, vyhneš se cross-cutting PR později.
3. **Char-creation: DOM overlay s `<input>`** — Phaser `DOMElement` GameObject nebo prosté HTML přes Phaser canvas pro 2 textová pole. Auto-otevře mobile keyboard, podporuje IME (čeština s diakritikou), accessibility zdarma. Současné kód-point Backspace handlování přestane být potřeba.
4. **Loading progress bar v `BootScene` + `WorldScene.preload()`** — Phaser ukázkový pattern (`this.load.on('progress', ...)`). 30 řádků, eliminuje „prázdná obrazovka = hra je rozbitá" UX.
5. **Reconnect handler** — místo `scene.start('LoginScene')` ukázat full-screen overlay „Spojení ztraceno, obnovuji… [Zkusit znovu]" + retry s exponential backoff (1s/2s/5s). Nakama `client.authenticateDevice` je idempotentní, socket.connect lze opakovat. UX vyhrává nad „šel jsi do tunelu = ztratíš match".
6. **Odstraň `maximum-scale=1.0, user-scalable=no` z viewport meta** — prevence pinch-zoom je hostile k přístupnosti a iOS Safari to stejně z velké části ignoruje od iOS 10. Pokud problém je „double-tap to zoom" v UI, řeš to `touch-action: manipulation` na `#app`, ne globálním zákazem zoomu.

## Reference

- [W3C Web App Manifest — icons](https://www.w3.org/TR/appmanifest/#icons-member) + [Chrome installability criteria](https://web.dev/articles/install-criteria)
- [Apple HIG — Layout (44pt minimum tap target)](https://developer.apple.com/design/human-interface-guidelines/layout)
- [i18next — Best practices](https://www.i18next.com/overview/getting-started)
- [vite-plugin-pwa docs](https://vite-pwa-org.netlify.app/) — manifest + workbox patterns
- [MDN — `<meta name="viewport">` accessibility](https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag#accessibility_concerns)
- [Phaser 3 Loader progress example](https://phaser.io/examples/v3.85.0/loader/file-types/view/loader-events)
- Konkurenční srovnání: **Highspell** (browser RuneScape-like) má proper loading screen + responsive UI; **Tibia web** má fallback DOM input pro chat; **RuneScape NXT** je native, neporovnatelné, ale UX patterns (chat overlay, hotbar) stojí za studii v `client/src/scenes/`.
- Interní: [docs/04 ADR-013](../04-tech-adr.md#adr-013-mobile--pwa-strategie), [ADR-016](../04-tech-adr.md#adr-016-lokalizace--cs--en-od-mvp-potvrzeno), [docs/00 Phase 17/20](../00-action-plan.md), [docs/01 Platformy](../01-scope-and-pillars.md#platformy).
