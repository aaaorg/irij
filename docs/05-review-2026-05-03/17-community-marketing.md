# Community & Marketing Review

**Reviewer:** Community Manager / Marketing DevRel
**Datum:** 2026-05-03
**Scope:** Go-to-market readiness pre-MVP, sólo dev, browser MMORPG slovanský folklór

## TL;DR

Engineering jede zdravě (Phase 4 ✓), ale **GTM stack je nulový** — žádný landing page, žádný Discord, žádný teaser, žádný mailing list. Action plan staví Discord až do Phase 22 (closed alpha s 3-5 kámoši), což je pozdě o 6+ měsíců — ztrácíš celý devlog hype-cycle a komunitu, která mohla být beta-ready. Slovanský folklór je marketingově silnější než si myslíš (Witcher cult-following), ale ne pro CZ/SK/PL diasporu jako primární audience — to je niche bonus, ne core. Core jsou OSRS/Highspell/Project Gorgon refugees, kteří žijí v `r/MMORPG`, `r/2007scape`, OSRS Discord clusteru a mají chuť na nový tick-based browser MMO. Doporučuji posunout brand foundation + Discord + devlog cadence **NA TEĎ**, ne na Phase 22.

## Foundation status

1. **Brand:** žádný název final lock (Irij = pracovní), žádné logo, žádný style guide artifact. Doména `irij.cz` migruje na Cloudflare — landing page `coming-soon` chybí. **P0.**
2. **Discord:** Developer App ID existuje (`1500444816025321554`) pro auth, ale **community server neexistuje**. Action plan ho zakládá až v Phase 22. **P0.**
3. **Devlog:** žádný YouTube kanál, žádný blog, žádný Twitter/Bluesky. Konkurenti (Elegon, Mistwilds, Noia Online) jedou týdenní devlogy 28+ epizod a stavějí audience před launchem.
4. **Mailing list / pre-alpha signup:** neexistuje. Mailcow SMTP je připravený technicky, ale forma kde sbírat e-maily neexistuje.

## Rizika

- **P0 — Silent launch.** Closed alpha s 3-5 kámoši bez veřejné stopy = po Phase 22 stojíš na nule audience. Highspell + Project Gorgon ukazují, že indie MMO **přežívá z komunity, ne z featur** — Project Gorgon má 18k Discord po 8 letech grindu. Když budeš stavět audience od nuly v Phase 22, ztratil jsi 6+ měsíců compoundingu.
- **P0 — Brand identity drift.** "Irij" je pracovní název v `01-scope-and-pillars.md` ("finální jméno potvrdíme později"). Každý měsíc bez locknutého názvu = každý devlog/screenshot/tweet musí být přejmenován. Lock teď, nebo nikdy.
- **P1 — Sólo dev community management burnout.** Project Gorgon Miraverre drama (2026-04) = 8 let nucený mod. 100 CCU s 1 dev = každá nepřítomnost na Discordu eskaluje. Potřebuješ 1-2 trusted mody **před** otevřením Discordu.
- **P1 — Slovanský folklór = orientalismus risk.** Witcher Netflix vs. knihy — Slavic character "almost completely disappears" pro Western audience. Buď autentický (Polednice, Hastrman, Veles bez vysvětlivek) nebo generic-ifikovaný; půl-cesta zní jako kostýmovaný párty.
- **P2 — CZ/SK/PL diaspora není scaleable channel.** Audience tam je, ale ~stovky lidí, ne tisíce. Neztrácej 50 % marketing energie na český Twitter. Hlavní GTM je EN-first, slovanský folklór jako USP, ne jako jazykové ghetto.

## Doporučené akce

1. **Tento týden — Brand lock + landing page.** Rozhodnout: Irij final, nebo nový název. Postavit `irij.cz` jako single-page coming-soon (statické HTML na Cloudflare Pages): logo placeholder, 1-2 isometric screenshoty z Phase 3, 3 pilíře, e-mail signup form (mailcow backend). 1 den práce.
2. **Tento týden — Discord server + 2 mody.** Otevři server **soft** (nikam nepostuj odkaz veřejně), vytvoř kanály, pozvi 2 trusted lidi z OSRS/Highspell scene jako mody **před** marketing pushem. Ne "Phase 22 udělám Discord", ale "Phase 22 už má Discord 200 členů".
3. **Phase 5-10 — Devlog cadence: bi-weekly YouTube + týdenní screenshot.** 1 video / 2 týdny (10-15 min, B-roll z gameplay + voice-over o jednom system) + týdenní `r/MMORPG` Saturday screenshot thread + Bluesky/Mastodon mikro-update. ROI: YouTube je evergreen, Reddit je discovery, Bluesky/Mastodon je daily presence pro core audience.
4. **Phase 8-12 — Audience targeting.** Žij v `r/MMORPG`, `r/2007scape`, `r/runescape`, Highspell Discord, Project Gorgon Discord, OSRS Ely.gg server. **Nepostuj svou hru první 4 týdny** — staň se známým jménem, pak teprve drop devlog. Cold post = downvote. (Game Marketing Genie: "studios that prioritize engagement early see better results at launch".)
5. **Phase 18-20 — Pre-alpha mailing list + Steam page (i když jen browser).** Steam Coming Soon page je největší free discovery surface; browser-only MMO tam stejně patří jako "external link to play". 1k wishlistů před closed alpha = `r/MMORPG` post pickup. Choo-Choo Charles šel z 1k → 100k za měsíc po MVP trailer dropu.
6. **Phase 22 — Closed alpha s telemetry, ne jen vibes.** 3-5 kámošů je málo na D1/D7 retention křivku, ale dost na frustration logging. Sbírat: time-to-first-quest-complete, click-misses na isometric click-to-move, chat usage, session length distribution, voluntary churn důvod (exit survey). KPI cíl pre-soft-launch: D1 100 % (lol, jen 5 lidí), D7 60 %+, qualitative "vrátil bych se" 4/5. Press/influencer outreach (Settled, Aussie OSRS, Highspell creators) **až po** soft beta s 50+ hráči — jinak cringe.

## Reference

- [Highspell launch coverage (YouTube)](https://www.youtube.com/watch?v=LJDhhutTFRY) — RS-like browser MMO ukazuje, že tick-based niche má hladovou audience.
- [Project Gorgon launch + Discord](https://store.steampowered.com/app/342940/Project_Gorgon/) + [Massively OP launch coverage](https://massivelyop.com/2026/01/28/indie-mmorpg-project-gorgon-is-set-to-launch-early-this-afternoon/) — 18k Discord, 1900 VIP day-1, 8 let community grind.
- [Project Gorgon mod drama (2026-04)](https://massivelyop.com/2026/04/18/project-gorgons-miraverre-server-has-erupted-in-drama-over-player-pop-and-moderation/) — sólo dev community management burnout case study.
- [How Not To Launch An Indie MMORPG](https://www.youtube.com/watch?v=DqJG2kw5re0) — silent launch anti-pattern.
- [Indie game marketing for solo devs (Game Developer)](https://www.gamedeveloper.com/business/the-best-indie-games-marketing-strategy-for-solo-developers).
- [Choo-Choo Charles MVP-to-100k-wishlist](https://medium.com/wannabe-indie-game-developer/how-to-make-an-mvp-of-a-video-game-the-choo-choo-charles-case-study-b7324201bbf9).
- [MMO retention benchmarks (Bakharev, 2026-04)](https://medium.com/@alexander.bakharev_16063/so-you-want-to-build-an-mmo-7-18-retention-live-service-operations-7d3486eaba18) — MMO D1 80 %+ at launch, D180 30 % = healthy.
- [Witcher Slavic authenticity gap (Reactor)](https://reactormag.com/the-cult-of-the-witcher-slavic-fantasy-finally-gets-its-due/) + [Path Witcher blog](https://thepathwitcher.blog/2021/06/25/the-witcher-is-slavic-and-it-isnt/) — autenticita vs. univerzalizace pro Western audience.
- [Official OSRS Discord (261k)](https://discord.com/invite/osrs), [Ely.gg RS community (40k)](https://discord.com/invite/rs3) — kde žije primární cílovka.
- [Solsten D1/D7/D30 retention drivers](https://solsten.io/blog/d1-d7-d30-retention-in-gaming).
