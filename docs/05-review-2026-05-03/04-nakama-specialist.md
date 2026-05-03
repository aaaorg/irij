# Nakama Specialist Review

## TL;DR

Server používá Nakama 3.38 + JS runtime idiomaticky a s neobvykle dobrou znalostí Goja gotchas — InitModule pattern, top-level named functions a "spread + reassign" mutace match state jsou důsledně dodržené ve všech handlerech. Build pipeline (esbuild IIFE → post-strip) je funkční, ale fragilní (regex-based unwrap), watch mode si nevyrobí runnable bundle, a chybí post-build sanity check. Hlavní rizika do produkce: (1) `find_or_create_match` race produkuje sirotky a nemá lock, (2) match je single-process / single-node — žádný path k horizontal scaling, (3) chybí storage OCC version handling na Player blobu (Phase 5 autosave to bude potřebovat), (4) Postgres connection pool sdílený s Nakamou bez ringfencing, (5) konzole má hardcoded admin/password v repu. Pro 100 CCU MVP je to OK; pro production je nutný hardening konfigurace + autosave OCC + observability.

## Úspěchy

1. **Goja constraints respektované do detailu.** `state.ts` má extenzivní komentář k Export() chování + plain object místo `Map`/`Set` + spread+reassign helpery; `movement.ts` to systematicky aplikuje při každé presence mutaci. Tohle je nejčastější pitfall v JS runtime a tady je vyřešený proaktivně.
2. **InitModule pattern + match registration** přesně jak Nakama AST walker očekává — top-level named functions, shorthand property references v `registerMatch`, žádné helper wrapery. Komentáře v `main.ts`/`world.ts` to vysvětlují pro budoucí změny.
3. **Single-tick `tickRate: TICK_HZ` + counter pattern** zatím nepoužitý ale připravený (constants definované, doc note v CLAUDE.md). Idiomatičtější než spawnovat víc match handlerů.
4. **Storage permissions** explicitní (`PERMISSION_OWNER_READ=1`, `PERMISSION_NO_WRITE=0`) — klient čte přes RPC, write je server-only. Správný server-authoritative idiom.
5. **Username uniqueness** přes `accountUpdateId` (unique index na `users.username`) místo own table — využívá Nakama account model jak má.

## Rizika & gotchas

1. **[P0] `find_or_create_match` race → orphan matches.** Komentář to přiznává ("pro 100 CCU MVP přijatelné"), ale orphan match drží match goroutine + state v paměti až do idle timeoutu. S 50+ paralelními loginy po cold start (např. po deployi) může vzniknout 5–10 orphans. Fix: použij `nk.matchSignal` na deterministický match ID nebo CAS lock přes storage object `world:singleton` před `matchCreate`.
2. **[P0] Hardcoded `admin/password` v `infra/nakama/local.yml`** + `session.encryption_key` literál v repu. Pro local dev OK, ale `local.yml` nemá v názvu nic, co by zabránilo deployi do prod. Doporučuji `infra/nakama/prod.yml.example` + `.env`-driven secrets + commit-hook na `password:` regex.
3. **[P1] IIFE strip je regex-based a fragile.** `build.js` matchuje `var __irij_server = (() => {\n` literálně — esbuild minor upgrade může změnit IIFE prefix (např. přidat banner, jiný formatting, async IIFE pro top-level await) a strip tiše vyrobí broken JS. Watch mode strip explicitně neběží = `pnpm watch` není použitelný pro Nakama load. Doporučuji: (a) nahradit za `format: 'cjs'` + extract InitModule via `module.exports` re-assignment, NEBO (b) přidat post-build assertion `grep -E "^function InitModule" dist/index.js` co failne build pokud strip neuspěl.
4. **[P1] Phase 5 autosave nemá OCC pattern.** `nk.storageWrite` podporuje `version` field pro CAS — pokud autosave (každých 30s) běží paralelně s RPC, který modifikuje stejný blob (např. `profile.update_settings`), bez version checku poslední write vyhraje a XP se může ztratit. Před Phase 5 specifikuj OCC strategii: server čte `version`, autosave passuje stejnou version → na conflict re-read + retry s exponential backoff (max 3×).
5. **[P1] Match je single-process; "chunk-cluster ready" je aspirace, ne path.** Nakama 3.x match běží na single node a single goroutine; "100 CCU EU" je realistic ceiling pro JS runtime na jednom matchi (Goja je ~5–10× pomalejší než V8, A* + broadcast loops v 10 Hz se škálují O(N²) ve 3×3 chunk scope). Při překročení budeš muset rewrite na (a) Go runtime, (b) Nakama Cluster Edition (paid), nebo (c) shardovat match na region. Žádný z těchto cest není v scope MVP — ale dokument by měl explicitně říct, že "post-MVP scaling" znamená přepis match logiky do Go.
6. **[P2] Postgres connection pool sdílený s Nakamou.** ADR-004 plánuje `nk.sqlExec` proti stejnému DB. Nakama spravuje svůj pool + connection lifetime; long-running queries z TS runtime mohou pool vyhladovět a zablokovat core auth/session writes. Doporučení: pro cross-player queries (audit log, listings) preferuj **separátní pool** přes vlastní Postgres connection (možno přes Nakama config `database.address` listing) nebo akceptuj shared pool s explicit `LOCK TIMEOUT` a query budgetem.

## Doporučené akce

1. **Před Phase 5:** Specifikuj autosave OCC pattern v ADR-004 doplnění (read-with-version → write-with-version → retry on `runtime.ErrStorageRejectedVersion`).
2. **Před prvním produkčním deploy:** Přepiš `find_or_create_match` na CAS lock přes `storageWrite` se `version=""` (create-if-not-exists) na klíči `world:singleton:active_match_id`. Eliminuje race.
3. **Stabilizuj build:** Přidej v `build.js` po `unwrapIife()` runtime check (`assert grep -E "^function InitModule\\(" dist/index.js`) co failne build pokud post-strip rozbije top-level. Watch mode buď podporuj plně (strip i v rebuildu) nebo dokumentuj jako "build-only".
4. **Konfigurační hygiena:** Přejmenuj `local.yml` → `local.dev.yml`, přidej `prod.yml.example` s placeholder secrets a `.gitignore` na `prod.yml`. Vytvoř bootstrap script generující 32ch encryption keys.
5. **Observability infra:** Nakama exportuje Prometheus metrics na `/metrics` — zapni `metrics.prometheus_port: 9100` v config + scrape job. Pro 100 CCU stačí, ale bez tohoto neuvidíš storage write contention ani match tick budget violations.
6. **Backups:** `postgres-data` volume zatím není zálohovaný; before MVP launch nastav `pg_dump` cron → user's NAS (z memory `project_external_infra`). Nakama Storage je v Postgres, takže jeden dump pokrývá vše.

## Reference

- Memory: `feedback_nakama_init_pattern.md`, `feedback_nakama_state_mutation.md`
- Nakama JS runtime docs: <https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/>
- Match Handler API: <https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/match-handler/>
- Storage OCC: `runtime.ErrStorageRejectedVersion` v `heroiclabs/nakama/server/core_storage.go`
- ADR-004 (Hybrid Storage), ADR-005 (Single match), ADR-007 (Tickrates), ADR-019 (Path-based broadcast)
- Nakama 3.x release notes: <https://heroiclabs.com/docs/nakama/getting-started/release-notes/>
- Goja runtime constraints: `runtime_javascript_init.go`, `runtime_javascript_match_core.go` (heroiclabs/nakama master)
