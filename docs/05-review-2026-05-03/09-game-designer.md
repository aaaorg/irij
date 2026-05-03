# Game Designer Review

**Reviewer:** Senior MMO game designer (RSC/OSRS/Tibia/Highspell/Project Gorgon background)
**Datum:** 2026-05-03
**Skoupené dokumenty:** 01 Scope & Pillars, 02a–02e Data model, 00 Action Plan

---

## TL;DR

Irij má **silně koherentní design vision** — tři pilíře (skill grind / lore / sociální ekonomika) se navzájem podpírají, ne škrtí. MVP scope je realistický pro sólo dev, ale „1 mob + 3 skilly" je na vertikální slice **na hranici příliš úzké** — bez druhého mobu a druhého gathering loopu hráč po 30 min cítí prázdno. Největší designové riziko je **3 Hz combat tick** (rychlejší než OSRS 0.6 s i Highspell ~0.6 s) — pravděpodobně vyrobí mobile latency frustraci a kolizi s anti-bot/anti-tick-manipulation. Anti-grind „pasivní + offline + stackovatelné" je odvážné a unikátní, ale **NPC worker delegace je exploit magnet** (multi-account + alt farm). Slovanský folklór je čistý diferenciátor — **drž ho i v MVP**, ne až v Phase 18 polish. Player housing odsunout je správně. Job board sdílený pool s aging multiplikátorem je elegantnější než 90 % browser MMO konkurence.

---

## Co je silné

1. **Tři pilíře se navzájem zesilují** — anti-daily-grind filozofie není v rozporu se skill-grind pilířem, protože stackovatelné questy + offline workers + soft caps per atribut zdroj (02a) udržují progres _smysluplný_ i pro hodinu týdně. To je **vzácně dobře vyřešené** — většina „casual MMO" buď zabije grind úplně (Albion směr), nebo si nechá daily lockouty (WoW).
2. **NPC reputační systém per-village (02d)** s knowledge gates v dialozích = elegantní way how dělat „lore-driven" bez branching quest enginu. Project Gorgon dělá podobně přes NPC favor a drží hráče roky.
3. **Job board s aging priority bonus + shared pool s `max_concurrent_takers`** (02e) řeší klasický problém browser MMO ekonomik — fetch quest spam a zaplavený board. Aging multiplier je smart anti-staleness mechanika, kterou OSRS nemá.
4. **Holster slot** (02a) je čistý UX win — eliminuje ammo/rune juggling, který v OSRS žere inventory sloty a frustruje switchery. Tichý auto-pull = invisible polish.
5. **Žádný drop-on-death + žádná durability** (02a/02b) je správný call pro casual cílovku. Kombinace 10min Stesk debuff (tikající i offline) + tři cleanse paths (chrám/lektvar/vyprávěč) jako organic gold sink je krásná lore-economic mechanika.

---

## Designová rizika

1. **[P0] Combat tick 0.3–0.4 s je pravděpodobně chyba.** OSRS `0.6 s` ([wiki](https://oldschool.runescape.wiki/w/Game_tick)), Tibia `1 s` cycle, Highspell `~0.6 s`. Důvod není „pomalý hardware roku 2001" — je to **APM headroom pro tick manipulation gameplay** + tolerance mobile latence (4G ping 50–150 ms = už 30–50 % tvého ticku). Při 300 ms ticku _každý_ packet jitter je viditelný a anti-cheat detekce tick-skip exploitů je peklo. **Doporučení: 0.6 s combat tick (matchne OSRS), 0.1 s movement** (zachováš). Drift od 01 Scope draft 1.3 — proběhlo to bez analýzy konkurence.
2. **[P0] „1 typ monstra" v MVP scope je nedostatek.** Vlk samotný = 30 min content. Druhý mob s **odlišným damage typem** (např. Bandita = ranged drop denáry, Vlk = melee drop kůže) testuje **damage type system + loot diversity + aggro level gating** (02d) v jednom slice. Bez něj jsi otestoval _jen_ basic case.
3. **[P1] NPC worker (02e) je exploit magnet.** 60 % reward × N alt accounts = farma. OSRS to neudělalo z dobrého důvodu. **Mitigace:** worker progression cap by `account_age_h × reputation` (ne jen `wage_pct` per reputation), max 1 worker / IP / 24h hire fee, audit log na cross-account item transfers. Anti-bot tooling absent z MVP byl _hlavní důvod_ shutdown RSC ([article](https://www.gamedeveloper.com/game-platforms/jagex-shutting-down-i-runescape-classic-i-after-17-years)).
4. **[P1] Soft cap diminishing returns per atribut zdroj** (02a `PlayerAtributSource`, 60 lvl threshold → 20 % rate) je **netransparentní pro hráče** + matematicky komplexní. Hráč grindí Strength přes Smithing, narazí na neviditelnou zeď a nepochopí proč. **Doporučení: viditelný UI breakdown** („Síla z Boje: 60/99, Síla z Kovářství: 60/60 (cap)") + možná posunout threshold na 75 (pozdější frustrace, dává hráči pocit progrese déle).
5. **[P1] 8-směrový pohyb (ADR-020) bez 8-směrového combat range je nesoulad.** OSRS používá 4-conn cardinal _částečně_ proto, že melee range = 1 tile cardinal a aggro / aggression boxes jsou počítány Manhattan. Pokud máš 8-směr movement ale 1-tile melee range, **diagonal melee combat se rozbije** (stojíš NE, target SW = vzdálenost √2, nedosáhneš?). Tibia má 8-směr a počítá Chebyshev. **Vyřeš v Phase 6 explicitně** — ADR-020 zmiňuje pohyb, ne combat range projection.
6. **[P2] „Stesk po Domově" tikající offline** (02a) je legitimní design (nutí cleanse), ale narazí na anti-daily-grind pilíř — hráč co se přihlásí po týdnu má clean state ale mu naběhl 10min debuff od poslední smrti. Nikdy. **Doporučení: cap real-time wallclock na 24h** nebo přepni na „debuff existuje dokud nezačneš znovu hrát + 10 min hry" (login-relative).

---

## Doporučené akce / experimenty

1. **Zpomal combat tick na 0.6 s v Phase 6** než to zacementuješ. Levný refactor teď, drahý za 6 měsíců.
2. **Přidej druhý mob do MVP scope** (Bandita, ranged + denáry drop). Cost: ~3 dny v Phase 6, payoff: testuje damage types + ranged combat path.
3. **Phase 11 quest playtest před scaling questů** (action plan už to flaguje jako risk checkpoint, dobré). Konkrétně: pozvat 2 lidi mimo dev, dej jim 30 min, sleduj _kde se nudí_ — to je tvá design křivka.
4. **Anti-bot tooling concept v Phase 12** (ne implement, jen audit log schema): per-IP rate limits, account age × first-quest-completion ratio, item-transfer-velocity flags. Bez toho RSC fate ([article](https://www.gamedeveloper.com/game-platforms/jagex-shutting-down-i-runescape-classic-i-after-17-years)).
5. **Slovanský folklór ne odsouvat do Phase 18** — alespoň _názvy_ regionů, item flavor texts, NPC dialogy nepiš jako placeholder. Diferenciátor je v _detailech jazyka_, ne v Phase 18 art passu. Cizí cílovka (EN-only) tím neodradíš pokud je atmosféra konzistentní (Witcher dělal slovanský fantasy globálně).
6. **Přidej „Combat XP odměna za vyhnutí se boji"** (sneak past mob jako mini-objective). Project Gorgon tohle dělá brilliant — odměna ne-combat playstyles ([review](https://www.mmowire.com/articles/project-gorgon-review-2026)). Levné, ale lock-in proti „skillgrindu jako monoton" feedbacku.

---

## Reference

- [OSRS Game tick](https://oldschool.runescape.wiki/w/Game_tick) — 0.6 s rationale + tick manipulation gameplay
- [Tibia Combat Controls](https://tibia.fandom.com/wiki/Combat_Controls) — 8-směr + range Chebyshev
- [HighSpell: A Toxic Grind](https://www.8bit.tv/2025/07/highspell-a-toxic-grind/) — RSC successor retention failure modes
- [Project Gorgon Review 2026](https://www.mmowire.com/articles/project-gorgon-review-2026) — skill grind through curiosity, NPC favor systems
- [Jagex shutting down RuneScape Classic](https://www.gamedeveloper.com/game-platforms/jagex-shutting-down-i-runescape-classic-i-after-17-years) — anti-bot tooling debt = death
- [Massively OP — Offline progression risks](https://forums.mmorpg.com/discussion/399205/mmos-with-offline-passive-progression) — alt account exploit patterns
