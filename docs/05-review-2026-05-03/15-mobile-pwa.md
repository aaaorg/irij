# Mobile / PWA Specialist Review

## TL;DR

Irij je dnes **ne-installable PWA** — manifest existuje (vite-plugin-pwa), ale **chybí ikony**, takže Chrome/Safari install prompt nezahodí (`beforeinstallprompt` neproběhne, "Add to Home Screen" nedá maskable preview). Viewport meta má `user-scalable=no` (a11y regrese, WCAG 2.5.5). Phaser config nenastavuje `resolution: window.devicePixelRatio` → na retině/Adreno se renderuje rozmazaně nebo se zbytečně přeplácá GPU. Touch input v `WorldScene.handlePointerDown` funguje (Phaser Pointer = unified mouse+touch), ale UI buttony v Login/CharCreation jsou desktop-only (klávesnice, šířka 280 px = OK, ale character creation **nejde palcem vůbec** — je `keydown`-only). Žádný code split, Phaser 3.90 + Nakama JS = ~1.4 MB minified initial bundle. Service worker cache pattern OK per ADR-013, ale `globPatterns` chybí `.webp/.woff2`.

## Co je dnes ready

1. **vite-plugin-pwa nainstalován** + `registerType: autoUpdate`, `theme_color`, `display: standalone` — rámec stojí.
2. **Service worker scope korektní per ADR-013** — `globPatterns: ['**/*.{js,css,html,png,svg}']` cachuje shell, ne match traffic (ten jede přes WS, SW ho přirozeně nezachytí).
3. **Phaser `Scale.RESIZE` + `CENTER_BOTH`** — viewport reaguje na rotaci/resize bez letterboxu (`onResize` no-op je fine, HUD má `setScrollFactor(0)`).
4. **`pixelArt: true` + `roundPixels: true` + `antialias: false`** — správné pro pixel-art tilemap, šetří fillrate na slabých GPU.
5. **Vite `server.host: true`** — LAN testing z reálného mobilu funguje out-of-the-box.

## Rizika

- **P0 — PWA neinstalovatelná.** `manifest.icons: []` (TODO komentář v `vite.config.ts`). Bez 192×192 + 512×512 + maskable ikony Chrome neukáže install prompt, iOS A2HS dá generic favicon. Lighthouse PWA score = fail.
- **P0 — `user-scalable=no` v `index.html`.** Apple HIG i WCAG 2.5.5 to zakazují (a11y, slabozrakí hráči). Pinch-zoom u Phaser canvasu nedává smysl, ale prevence jde přes `touchAction: 'none'` na canvas elementu, ne globálním viewport meta.
- **P1 — Chybí `resolution: window.devicePixelRatio`** v Phaser config. Na iPhone (DPR 3) renderuje na 1× a CSS-scale upscaluje → blur. Pro pixel-art je `Math.min(DPR, 2)` rozumný cap (anti-jaggy bez fillrate exploze na Adreno 6xx).
- **P1 — Žádné safe-area-inset.** Notch iPhonů přeřízne HUD `(12, 12)` levý horní text. Potřeba CSS `env(safe-area-inset-top)` na app containeru a/nebo Phaser HUD offset.
- **P1 — CharacterCreationScene je `keydown`-only.** Mobil bez fyzické klávesy = postavu nevytvoříš. Phase 2 demo pasuje desktop-only. Phase 17/20 musí přidat HTML overlay `<input>` (nebo Phaser Rex Plugin TextEdit) pro text + tap-able šipky pro cycle pole.
- **P2 — Bundle size unaudited.** Phaser 3.90 minified ~1.1 MB + nakama-js ~120 kB + i18next ~50 kB → ~1.3 MB JS samotného (před Brotli ~350 kB). Pro <2 s FCP na 4G jsme OK, ale **žádný code split** — Login + CharCreate + World jdou v jednom chunku, dynamic `import('./scenes/WorldScene')` ušetří ~30 % first paint.
- **P2 — 10 Hz broadcast na mobilu při locked screen.** iOS Safari throttle background tab WebSocket na 1 Hz a po ~30 s ho killne. ADR-019 deterministic interpolace na to počítá (`Date.now()` baseline survive), ale **chybí explicit `visibilitychange` handler** — tab return musí re-requestnout `WORLD_SNAPSHOT`, jinak hráč vidí stale state do prvního ENTITY_MOVED.

## Doporučené akce

1. **Vygenerovat ikony** (192/512/maskable + apple-touch-icon 180) z placeholder logo, doplnit do `vite.config.ts` `manifest.icons` + `<link rel="apple-touch-icon">` v `index.html`. **Blokuje Phase 20 demo.**
2. **Zrušit `maximum-scale=1.0, user-scalable=no`** ve viewport meta, místo toho přidat CSS `#app { touch-action: none; }` na canvas wrapper — pinch-zoom blokovaný jen tam, kde dává smysl.
3. **Phaser config: `resolution: Math.min(window.devicePixelRatio, 2)`** + listener na `matchMedia('(resolution)')` pro DPR change při dock/external display. Mobile-test na iPhone + Pixel 6.
4. **Code split Login → CharCreate → World přes lazy scene add** (`scene.add('WorldScene', () => import(...))`). Sníží initial JS o ~25 %, FCP <1.5 s realistic.
5. **`visibilitychange` handler ve `WorldScene`**: na `visibilityState === 'visible'` po >5 s pauze pošli RPC `world.request_snapshot` (nebo re-join match). Bezpečnější než spoléhat na ENTITY_MOVED.
6. **Phase 20 polish: HTML `<input type="text">` overlay** pro CharCreation + chat (přes DOMElement Phaser plugin). Mobil dostane native klávesnici, desktop si beze změny zvyká. Přidat `inputmode="text"`, `enterkeyhint="send"` pro chat — sníží frustraci na iOS.

## Reference

- web.dev — [PWA Install criteria 2025](https://web.dev/articles/install-criteria) (manifest + icons + SW + HTTPS)
- web.dev — [Maskable icons](https://web.dev/articles/maskable-icon)
- Apple HIG — [Layout / Tap targets](https://developer.apple.com/design/human-interface-guidelines/layout) (≥44×44 pt), [Safe area insets](https://developer.apple.com/design/human-interface-guidelines/layout#Safe-areas)
- WCAG 2.5.5 Target Size + 2.5.5 Pinch-zoom (`user-scalable=no` = a11y fail)
- Phaser 3 docs — `Phaser.Scale.RESIZE`, `resolution`, `roundPixels` (mobile rendering)
- Vite PWA Plugin v1 docs — `registerType`, `workbox.globPatterns`, dev SW
- Tauri Mobile 2.x (alpha-stable transition late 2025) — webview-based, identický bundle s PWA = migrace = wrapper, ne refactor
- Capacitor 6 (2025) — fallback cesta, **vyžaduje** stejnou PWA shell, takže investice do manifestu/SW není ztracená
- Nakama Heroic Labs — WebSocket reconnect best practices (mobile background tab)
- ADR-013 [docs/04-tech-adr.md L415](../04-tech-adr.md#adr-013-mobile--pwa-strategie), Phase 20 [docs/00-action-plan.md L333](../00-action-plan.md#phase-20--pwa--mobil-polish)
