# Product Manager Review

**Reviewer:** Senior PM (indie + AAA online games)
**Datum:** 2026-05-03
**Scope:** /home/jakub/git/irij — Phase 0–4 hotovo, Phase 22 = closed alpha cíl.

## TL;DR

Irij má **silnou produktovou tezi** (RSC + slovanský folklór + browser/mobil) a věcně dobře rozfázovaný plán. Reálný timeline ke closed alpha při 3–4 h/den je **6–9 měsíců** kalendářního času (jaro 2027), nikoli „pár měsíců" — Phase 18 je největší slippage risk (10–14 dnů odhad je optimistický o faktor 2). Hotové fáze 0–4 jsou **čistě tech foundation**, žádný pilíř ještě nebyl ani v jednom playtestu validován; první real signal přijde až Phase 11 (lore quest checkpoint). Closed alpha s 3–5 kámoši je dost pro **bug bash**, ale málo pro validaci „lore-driven feel" a sociální ekonomiky — plánuj **soft beta 20–50 hráčů (Discord, RSC/Highspell komunita)** 4–6 týdnů po Phase 22. Monetizace TBD je v pořádku, ale **rozhodnutí F2P kosmetika vs. paid one-time musí padnout před Phase 19** (auth flow + ToS). Největší dlouhodobé riziko: sólo-dev burnout na Phase 18 polish — nutný explicit „minimum playable" fallback.

## Silné stránky

1. **Ostrá produktová identita.** Slovanský folklór + tick-based + browser je dostatečně niche, aby Irij neměl head-to-head konkurenta (Highspell = generic fantasy RSC clone; OSRS = legacy moat). Diferenciace v positioning je jasná.
2. **Disciplinovaný non-goals seznam.** 7 explicitních „není" + 13 parking-lot položek = silná obrana proti scope creep, kterou většina sólo-dev MMO nemá. Tohle je nadprůměrná produktová zralost.
3. **Demo-driven fázování.** Každá fáze končí screenshot/video milestonem — to drží motivaci a forcuje vertikální slice myšlení místo horizontálních „dodělám systém X kompletně".
4. **Risk checkpoints zabudované.** Konec Phase 11 a Phase 18 jako explicit „pause-and-evaluate" gates je textbook — většina indie projektů tohle nemá a propadají Phase 18 hellem bez záchranné brzdy.
5. **Mobil first-class od začátku.** Většina indie MMO si mobil nechává „později" a pak ho nikdy neudělá. PWA-first je realistický a otevírá CZ/SK/PL diaspora segment, který na desktopu jen přes prohlížeč nehraje.

## Produktová rizika

- **[P0] Phase 18 polish slippage 2–3×.** „10–14 dnů" pro 256×256 mapu + 5 NPC art + 3 questy + 8 job templates + 30 itemů + audio je **nereálné**. Reálně 4–6 týdnů. Highspell sólo-dev na tomhle stupni strávil měsíce. Mitigace: rozdělit na 18a (mapa + NPC art) → playtest → 18b (zbytek).
- **[P0] „Lore-driven feel" není validovaný do Phase 11.** Fáze 0–10 jsou tech + ekonomika; první quest test přijde po ~3–5 měsících práce. Pokud Phase 11 playtest cítí nudu, ztratil jsi 4 měsíce. Mitigace: napsat **lore bible draft + 1 quest scénář v textu** v pre-flight, validovat s 2–3 kámoši **před** Phase 6.
- **[P1] Closed alpha 3–5 hráčů = nedostatečný signal pro sociální pilíř.** „Sociální ekonomika" potřebuje min. 15–20 současných hráčů, aby NPC poptávky / job board / direct trade dávaly smysl. S 3–5 to je glorified single-player. Mitigace: plánovat soft beta 20–50 lidí (Phase 22.5) z RSC/Highspell Discord komunit.
- **[P1] Monetizace TBD blokuje Phase 19+.** Auth flow (Discord/Google) + ToS + GDPR consent text se liší pro F2P-cosmetic vs paid-one-time vs subscription. Rozhodnutí lze odložit max. do konce Phase 11. Doporučení: **F2P + cosmetic only post-MVP**, drží anti-P2W pilíř a matchne audience expectations RSC/OSRS veteránů.
- **[P1] Audience overlap jen zdánlivý.** RSC/OSRS veteráni chtějí PvP wilderness + deep skills (99 levels, hours/day). CZ/SK/PL diaspora chce komfort + krátké session. Sólo casual hráč chce offline progress. Tohle jsou **tři produkty**. Pillar 3 (offline mechaniky, stackování) je „později" v parking lotu — zatímco pro casual segment je to *the* selling point. Riziko: launch s grindy MVP odpudí casual segment, kterého chceš nejvíc.
- **[P2] Marketing & community = nula.** Discord App ID existuje, ale žádný server, žádná dev-log presence, žádný Bluesky/Twitter, žádný itch.io page. Closed alpha bez „warm" audience = pozveš 3 kámoše a hotovo. Mitigace: založit **devlog (Bluesky + r/MMORPG monthly post)** od Phase 6 dál; do alpha nesmí jít „cold" projekt.

## Doporučené akce

1. **Pre-Phase 6: napsat lore bible (5–8 stran) + 3 quest scénáře v textu**, validovat s 2 kámoši cold-read. Kill criterion: pokud žádný neřekne „chci to hrát", redesign Pillar 2 dřív než kódíš dialog engine.
2. **Phase 11 milestone redefinovat:** ne „quest funguje technicky", ale „2 testeři ho hrají 30 min a reportují, jestli cítí lore-pull". Pokud ne → pause-and-redesign před Phase 12.
3. **Monetizace decision deadline = konec Phase 11.** Doporučuji F2P + cosmetic only (kosmetika u krejčího je už v ekonomice plánovaná). Konzistentní s anti-P2W pilířem, předvídatelné pro auth/ToS impl.
4. **Soft beta plan (Phase 22.5, ~4 týdny po closed alpha):** cíl 20–50 hráčů z RSC/Highspell/Tibia Discord komunit. Bez tohoto stupně sociální ekonomiku nezvaliduješ a jdeš do veřejné beta naslepo.
5. **Marketing minimum od Phase 6:** Bluesky devlog (1× týdně, screenshot + GIF), itch.io stránka „in development", měsíční post r/MMORPG progress thread. Cíl ke closed alpha: 200+ followers / 50+ Discord members.
6. **„Minimum playable" fallback definovat teď:** Phase 0–11 + Phase 14 + Phase 16 + Phase 21 (12 fází místo 22) = **single-player feel MMO** = 1 vesnice, 1 quest, gathering, banking, chat, deploy. Pokud burnout / Phase 18 přestřelí 6 týdnů → ship tohle jako „prototype demo" a nech komunitu rozhodnout, co dál.

## Reference

- [HighSpell — itch.io & 8Bit.TV review (2025)](https://www.8bit.tv/2025/07/highspell-a-toxic-grind/) — solo-dev RSC successor positioning
- [Project Gorgon early access timeline](https://tagn.wordpress.com/2026/01/29/project-gorgon-leaves-early-access-and-celebrates-becoming-1-0/) — 2018 EA → 2026 1.0, 8 let; lekce o sólo-dev kadenci a sustainability
- [Indie MMO Spotlight 2024 — MMORPG.com](https://www.mmorpg.com/columns/indie-mmo-spotlight-2024-indie-mmo-news-begins-2000130096)
- [10 Indie MMOs 2025+ list](https://www.mmorpg.com/features/10-indie-mmos-to-play-and-look-forward-to-playing-in-2025-and-beyond-2000133973)
- [Faehnor Online solo-dev EA launch (Massively OP, 2026)](https://massivelyop.com/2026/02/18/get-lost-says-solo-dev-created-early-access-mmo-faehnor-online/)
- [MMO alpha/beta testing expectations — JoyPlayX deep dive](https://www.joyplayx.com/article/deep-dive-into-mmo-alpha-and-beta-testing-what-to-expect)
