# Security Engineer Review

## TL;DR

Bezpečnostní postoj projektu Irij je pro Phase 4 nadprůměrný v **architektuře** (server-authoritative je doopravdy server-authoritative, ADR-012 explicitně vyjmenovává principy, opcode katalog je single source of truth, MOVE_REQUEST má rate-limit + bounds + walkable + path-length validaci). Ale **operational security a auth flow** jsou stále jen scaffolding: shared `serverKey` na klientovi (anti-pattern Nakama), guest-only auth bez upgrade flow, plaintext admin credentials a encryption keys committed v `infra/nakama/local.yml`, žádný IP rate-limit, žádný audit log, console port 7351 nemá v plánu hardening. Phase 19 (OIDC + email + reset) má v action planu jeden řádek na guest→OIDC link bez zmínky o TOCTOU / account-takeover protekci. Před produkcí je potřeba kromě "silných keys" ještě 5–6 konkrétních věcí, jinak první script-kiddie udělá masové creation accountů a/nebo přečte console.

## Co je solidní

1. **MOVE_REQUEST validační pipeline** ([server/src/match/movement.ts:114](../../server/src/match/movement.ts)) — parse + shape check, sliding-window rate-limit (10/s/userId), bounds, walkable + nearestWalkable BFS, A\* path s `MAX_PATH_LENGTH_TILES`. `target:{x:99999,y:99999}` se odmítne na `out_of_bounds`. `Math.floor` na float souřadnicích blokuje exploit přes `0.0001` precision drift.
2. **Storage permissions correct** — `profileCreateCharacter` zapisuje s `permissionRead=1` (owner-only) + `permissionWrite=0` (server-only). Klient nemůže mutate Player blob ani přečíst cizí.
3. **Single source of truth pro mapu** — server bundle import `client/public/maps/test_50x50.tmj`, žádný drift mezi walkable masks. Bez toho by client mohl posílat MOVE_REQUEST do "díry", co server nevidí.
4. **ADR-012 principy správně formulované** — vše na serveru, no-client-RNG, audit log na kritické akce, honeypot detection, JWT každá zpráva. Jako _scaffold_ to drží směr.
5. **Username unikátnost přes Nakama account index** ([profile.ts:115](../../server/src/rpc/profile.ts)) místo own check — eliminuje race window mezi `usersGetUsername` a `accountUpdateId`.

## Rizika / vektory

1. **P0 — Secrets v repu.** [infra/nakama/local.yml](../../infra/nakama/local.yml) commit-ne `console.password: password`, `session.encryption_key`, `refresh_encryption_key`, `socket.server_key`. Postgres heslo `localdev` je v `docker-compose.yml`. Pro dev OK; ale Phase 21 má jen "silné encryption keys" v jednom bulletu — chybí strategy (env-only, Docker secrets, age/sops, rotation cadence). Pokud se zapomene a deploy se postaví podle dev compose → instant compromise.
2. **P0 — Server key je shared secret na klientovi.** `irij-local-server-key` je v [client/src/nakama.ts:21](../../client/src/nakama.ts) jako default a Vite ho zabakuje do bundlu. Nakama server key není auth — je to API gate. Útočník ho přečte z bundlu a může otevřít své vlastní klienty. Nakama doporučuje rotation + obscurity, ale skutečnou ochranu dělá session JWT. Důsledek: bot/farmer accounts jsou tak triviální, jak triviální je registrace = guest auth = instantní.
3. **P0 — Guest spam / account flood.** `authenticateDevice(deviceId, true)` s `create=true` + neomezený `deviceId` (klient si vymyslí) + žádný IP rate-limit znamená, že útočník vyrobí 10k accountů za minutu, naplní Postgres a Storage Engine. Phase 19 nemluví o IP-level rate-limitu ani CAPTCHA. Cloudflare WAF má v free tieru 5 rules — to je správné místo, ale není to v action planu.
4. **P1 — Guest → OIDC upgrade TOCTOU.** Phase 19 task "guest → upgrade flow (link na OIDC)" — pokud guest A linkne Discord ID, které už má linkované OIDC account B, nebo pokud sequence `unlink_old + link_new` neběží v transakci, je to klasický account-takeover vektor. Nakama `linkCustom`/`linkOauth` je atomic per-call, ale chybí rule: "pokud OIDC subject už má jiný `Player.id`, odmítni a nabídni merge wizard."
5. **P1 — Žádný audit log v Phase 4.** ADR-012 bod 5 (audit log do Postgres) není implementovaný; `migrations/` je prázdný. Login, character creation, MOVE_REJECTED s podezřelým patternem (50× `out_of_bounds`/min) nikde ne-loguje persistentně. Bez toho post-incident forensics = nic.
6. **P1 — Per-IP a global rate-limit chybí.** Movement má per-userId, ale `profile.create_character`, `auth.ping`, budoucí `chat`, `trade_offer`, `gather` per-RPC limity nemají. Útočník s 1k guest accounty udělá 10k RPC/s. Nakama má built-in rate limiter (per IP, per session) — není zapnutý v `local.yml`.
7. **P2 — Console port 7351 + admin/password.** I když produkce dostane silné heslo, port 7351 by neměl být `EXPOSE`-d na internet vůbec — buď bind na `127.0.0.1` + SSH tunnel, nebo VPN/Cloudflare Access. Action plan Phase 21 mluví o UFW 22/80/443, ale `docker-compose.yml` má `ports: 7351:7351` bez interface restrikce, takže si to v prod compose musí někdo pamatovat změnit.

## Doporučené akce

1. **Před Phase 19:** vytvořit `infra/nakama/prod.yml.example` s placeholders + `.env`-driven secrets injection (heroiclabs supports `${ENV_VAR}` substitution), commit `.example` only, real `.env` do `.gitignore`. Doc: "rotation každých 90 dní + při personal change."
2. **Phase 19 spec rozšíření:** OIDC subject collision rule (linkOidc → check existující mapping → reject s `oidc_already_linked` error), dvouf-ůrovňový upgrade UI (guest A potvrdí "ztratíš pokrok B" pokud subject už linknutý). Email reset přes signed token + 15min TTL + single-use, ne plain link.
3. **Phase 4.5 (insert before Phase 5):** Postgres tabulka `audit_log(ts, user_id, ip, event, payload_json)`, helper `logAudit(nk, ...)`, volat z `profileCreateCharacter`, MOVE_REJECTED (sample 1/100), všechna budoucí trade/bank RPC. ADR-012 bod 5 → reálný kód.
4. **Cloudflare WAF rule sada** přidat do Phase 21 jako explicit checklist: (a) rate-limit `/v2/account/authenticate/device` 30/min/IP, (b) block known-bad ASNs, (c) bot-fight mode ON, (d) challenge na > 5 failed auth/min.
5. **Console hardening:** v `docker-compose.prod.yml` portu 7351 dát `127.0.0.1:7351:7351`, dokument SSH tunnel (`ssh -L 7351:localhost:7351`). Nebo Cloudflare Access za free tier (5 users zdarma) — dostane MFA zadarmo.
6. **GDPR baseline:** export-my-data RPC + delete-my-account RPC s 30-day grace, přidat do Phase 19 nebo Phase 21. EU hráči to mohou požadovat dle GDPR čl. 15/17. Privacy policy + ToS jsou v ADR-011 zmíněné jako "potřebné" — bez nich Discord OAuth setup ani neprojde.

## Reference

- OWASP Top 10 2025 (web app baseline) + OWASP Game Security Framework (anti-cheat patterns: BOLA, A07 auth failures, A10 SSRF — relevantní pro OIDC redirects)
- Nakama docs: [Authentication](https://heroiclabs.com/docs/nakama/concepts/authentication/), [Server config](https://heroiclabs.com/docs/nakama/getting-started/configuration/) — built-in rate limiter, IP allowlist, JWT key rotation
- OAuth 2.0 Security BCP (RFC 9700, draft 2025): PKCE mandatory, redirect URI exact-match, OIDC `sub` claim jako primary linking key
- Jagex (RuneScape) post-mortems 2007/2020: server-authoritative je nutná podmínka, ale audit log + behavior signatures dělají reálnou detekci botů
- Heroic Labs forum: "device auth + create=true is not auth, it's a session bootstrap" — rate-limit IP nebo CAPTCHA pro production
- Cloudflare Free tier WAF + Bot Fight Mode dokumentace
- GDPR čl. 15 (right of access) + čl. 17 (right to erasure) — EU hostovaná hra musí mít implementaci, ne jen privacy policy

---

**Cesta:** `/home/jakub/git/irij/docs/05-review-2026-05-03/11-security.md`
