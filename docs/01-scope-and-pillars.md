# 01 — Scope & Pillars

**Stav:** Draft 1 — 2026-05-01
**Účel:** Definovat, co tahle hra _je_ a co _není_, aby se scope nerozléval. Tenhle dokument vyhrává spory.

---

## Pracovní název
**Irij** *(pracovní; finální jméno potvrdíme, až bude svět vystavěný. Dříve placeholder "RSC" = "Runescape Classic".)*

## Jednověté shrnutí
**Tick-based browser MMORPG ve světě slovanského folklóru** s důrazem na skill grind, lore-driven questy a sociálně-ekonomickou hru, navržené tak, aby ho šlo hrát hodinu denně i jednou za týden bez frustrace.

## Cílová audience
- Hráči, co znají a milují RSC / OSRS / Tibii / Highspell
- Lidé, co si chtějí zahrát fantasy MMO _v prohlížeči_, bez stahování
- Diaspora česky/slovensky/polsky mluvících hráčů, kteří ocení slovanský folklór jako primární téma (a kterým "ještě jeden generic medieval" nesedí)
- Sólo i sociální hráči — hra musí dávat smysl oboum
- **Desktop _i_ mobil** — viz sekce "Platformy" níže

## Platformy

- **Desktop browser je primární** — full UI, plná hustota informací, plná hra
- **Mobil (iOS Safari + Android Chrome) je first-class druhá platforma** — ne afterthought
- Sdílený codebase (Phaser běží na obojím), **dva odlišné UI layouty** — desktop dense, mobil compact (rozhodnuto: cesta A)
- **Stejná postava na obou** — hráč otevře desktop ráno, mobil v tramvaji, stejný progress
- **MVP = PWA** ("add to home screen", žádný App Store)
- **Pozdější:** Tauri Mobile jako primární native wrapper, **Capacitor jako fallback** pokud Tauri Mobile narazí (např. kvůli iOS App Store certifikaci nebo nezralosti)

### Co z toho plyne pro design
- **UI nemůže být plně Project-Zomboid-dense.** Desktop verze ano, mobil potřebuje "compact mode" — větší tap targety, méně oken najednou, kontextové menu místo pravého kliku
- **Combat tick 0.3-0.4 s + movement 10 Hz** je na mobilu bezproblémový (velmi nízký datový tok)
- **Click-to-move + click-to-attack se přirozeně mapuje na tap** — Phaser řeší touch nativně
- **Inventář / skill grid musí být použitelný palcem** — minimální velikost slotu cca 44×44 px (Apple HIG)
- **Chat na mobilu** je největší UX výzva (klávesnice ukrojí 50 % obrazovky); navrhneme jako overlay, ne fixed panel
- **Performance budget:** cílíme na střední Android (~2022, 4 GB RAM, Adreno 6xx). Pixel art tomu pomáhá zásadně, ale šetříme na particles, počtu entit na obrazovce a velikosti tilemap chunků

## Cílové měřítko (prvních 6 měsíců)
- **~100 CCU** v peaku, single shard
- **Player-owned land/budovy** přímo na hlavní mapě jako vědomá feature (pro 100 lidí to projde)
- **Strategie pro budoucí škálování:** odsunuto, ne řešíme teď. Pokud explodujeme: shardy s opt-in přesunem postavy, zatím nespecifikováno.

---

## Tři pilíře

Pokud bychom museli kterýkoli z těchto pilířů škrtnout, přestává hra dávat smysl.

### Pilíř 1 — Skill grind & specializace
- **Mnoho skillů** v duchu RSC (předpokládáme cca 12-18, finální seznam později)
- **Soft-class systém** — žádné rigidní classy, ale specializace, která hráče "zabarví" (např. Stopař, Kovář, Bylinkář, Šaman)
- **Snadno přetrénovatelné** — specializace není doživotní rozhodnutí, jen aktivní zaměření
- **Levely cca 1-99** v RSC stylu — exponenciální křivka, smysluplné milníky kolem 50/75/99

### Pilíř 2 — Quest- a lore-driven svět
- **Bohatý slovanský lore** jako kostra — Baba Jaga, Polednice, Hastrman, Vlkodlak, Perun, Veles, lesní duchové
- **Hybrid s klasickou fantasy** — můžou se objevit i draci, goblini, elfové, ale jako "jiný národ" / "z jiného světa", ne základ
- **Hodně single-player contentu** — questy s rozhodnutími, větvení, mini-příběhy v každé vesnici
- **Každá vesnice/město má svou identitu** — vlastní NPC, vlastní potřeby, vlastní příběhy
- **Lore = motivace, ne výzdoba** — co se stalo na hřbitově za Jitřenkou? Proč z lesa nikdo nepřichází zpátky? Tohle hráče táhne dál, ne jen XP bar

### Pilíř 3 — Sociální ekonomika bez denního grindu
- **NPC potřeby + hráčské poptávky řídí ekonomiku** — obchodník v každé vesnici inzeruje, co potřebuje; hráči vyvěšují své poptávky
- **Pasivní / offline mechaniky** — questy a produkce, které pokračují i bez tebe (do limitu), aby hráč mohl mít _život_
- **Stackování úkolů** — když nebudeš hrát týden, nepřijdeš o všechno; questy se dají dokončit po částech
- **Alternativní odměny** — místo peněz reputace ve vesnici, přístup k unikátnímu craftu, slevy, suroviny
- **Sociální chat jako první-class feature** — vesnice je živá ne kvůli grindu, ale kvůli lidem v ní

---

## Vizuální / herní styl

- **2D pixel art, isometrický pohled** ve stylu reference [Image #1, 2026-05-01]
- **Stylové reference:** Tibia, Project Zomboid (UI density), Stardew Valley (pixel art warmth), klasické české ilustrace folklóru (Aleš, Lada — atmosféra, ne přímá inspirace)
- **Atmosféra:** "středoevropská vesnice za soumraku" — teplá ale lehce strašidelná, nikdy ne disneyovsky veselá
- **Paleta:** tlumená země, mech, dřevo, pochodňové žluté, večerní modrá, Polednice bílá; žádné neonky
- *(Detailní style guide jako samostatný dokument později)*

---

## Combat & PvP

- **Tick-based**, rychlejší než OSRS:
  - Movement broadcast ~10 Hz (100 ms)
  - Combat / akční tick ~0.3-0.4 s (~3 Hz)
- **Click-to-move + click-to-attack** RSC-style
- **PvP je opt-in:**
  - Aréna (instance pro souboje 1v1, 2v2, party)
  - Volitelná "wilderness"-style zóna s rizikem/odměnou — _kdo tam jde, ví že jde_
  - **Hlavní mapa NIKDY není PvP** — žádný gank ve vesnici

---

## Co tato hra **NENÍ** (non-goals)

Vědomá rozhodnutí, ke kterým se _nevrátíme_ bez explicitní revize tohoto dokumentu:

- **Není daily-grind hra.** Žádné "musíš se připojit každý den nebo přijdeš o pokrok."
- **Není pay-to-win** ani gacha. (Monetizace TBD, ale ne tudy.)
- **Není 3D.** Žádné "časem to převedeme do 3D." Pixel art je rozhodnutí, ne provizorium.
- **Není hardcore PvP MMO.** Nečekáme EVE, Albion ani Old School Wilderness vibes mimo opt-in zónu.
- **Není simulátor reálné ekonomiky** s grafy a sklady velkoobchodu. Ekonomika je hřiště, ne diplomová práce.
- **Nemá rigidní classy** s exclusivními skillsety.
- **Nemá daily login bonusy, battle pass, FOMO eventy.**

---

## MVP scope (pro vertikální slice)

Co _musí_ být v prvním hratelném MVP, aby dokázal stack a vibe:

- 1 startovní vesnice (Blatiny), 1 přilehlý les, 1 řeka
- 5-10 NPC s identitou + 2-3 questy
- 3 skilly (Combat + 2 gathering, např. Hornictví, Rybaření)
- 1 typ monstra (Polednice / Vlk / Lesní strašidlo)
- Inventář, banka (truhla v hospodě), basic crafting (1 stůl, 3 recepty)
- Chat (lokální + globální), basic obchod hráč-hráč
- Login / persistence postavy

Co je _explicitně out_ pro MVP: PvP, player housing, pasivní mechaniky, lore branchy, většina skillů, druhá zóna.

---

## Otevřené otázky / parking lot

*(Seznam toho, co budeme řešit později — píšeme sem ať to nezatěžuje hlavní design teď)*

- Konkrétní seznam skillů (řešíme v Data modelu)
- Combat formule a balance (řešíme po MVP)
- Monetizační model (volné, paid one-time, kosmetika? — nerozhodnuto, neblokuje vývoj)
- Mechaniky pasivního příjmu / offline progrese — _design_ nutný před beta, ne před MVP
- Strategie shardů pro případ úspěchu — řešíme až bude problém
- Lokalizace (CZ-only? CZ+EN? jen EN?) — _návrh: CZ + EN od MVP, krátké stringy_
- Anti-bot strategie (slovanské folklórní MMO bot farmy zatím nebudou priorita)

---

## Změnový log

- **2026-05-01** — Draft 1, vytvořeno na základě Q&A session
- **2026-05-01** — Draft 1.1: mobil povýšen z "bonus" na first-class druhou platformu, přidána sekce Platformy s designovými implikacemi
- **2026-05-01** — Draft 1.2: rozhodnuto cesta A pro UI layout (oddělený desktop/mobil); MVP = PWA, později Tauri (Capacitor jako fallback). **Status: schváleno, dokument 1 uzavřen.**
- **2026-05-01** — Draft 1.3: startovní vesnice přejmenována Jitřenka → Blatiny (Jitřenka byl pracovní název z reference screenshotu).
