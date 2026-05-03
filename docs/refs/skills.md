# Skills & atributy

Status: brainstorm draft (session 2026-05-01)
Cíl hry: **total level chad** — pobídka hrát všechny skilly, ne jen specializovat.

## Filozofie

RSC Attack/Strength/Defence trojice byla uzavřený systém pro melee buildy. Ranged a Magic žily mimo. Tady to řešíme rozdělením na **dvě vrstvy**:

1. **Atributy** (4) — passivně rostou ze souvisejících aktivit, nejdou grindit napřímo.
2. **Skilly** (17) — aktivně se trénují, dávají primární XP.

Obě vrstvy mají **stejnou mechaniku**: XP bar, lvl 1–99, ding na levelu, započítávají se do total levelu. Liší se jen tím, jak XP přitéká.

## Atributy (4)

| Atribut         | Roste z                                                         | Ovlivňuje                                                                   |
| --------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Síla**        | melee, kovářství, hornictví, dřevorubectví                      | melee damage, draw weight luku, nošení těžké zbroje, kovářské tempo         |
| **Obratnost**   | lukostřelba, krejčovství, alchymie, vaření, rybaření, lupičství | accuracy (melee i ranged), evasion, jemné řemeslo                           |
| **Inteligence** | kouzelnictví, alchymie, bylinkářství, vyprávění, modlitba       | magic damage & accuracy, lektvar potency, lore odhalení, favor accumulation |
| **Životy**      | jakákoli bojová akce + modlitba                                 | HP pool (jako RSC Hitpoints)                                                |

### Distribuce XP

Každá akce dává primární XP do skillu (100 %) + fractional XP do souvisejících atributů (10–30 %).

| Akce                   | Primární skill | Atributy                            |
| ---------------------- | -------------- | ----------------------------------- |
| Useknout goblina mečem | Boj zblízka 4  | Síla 1.2, Obratnost 0.4, Životy 1.3 |
| Vykovat železný meč    | Kovářství 4    | Síla 0.8                            |
| Vystřelit z luku       | Lukostřelba 4  | Obratnost 1.2, Síla 0.4             |
| Uvařit elixír          | Alchymie 4     | Inteligence 1.0, Obratnost 0.4      |
| Vytěžit rudu           | Hornictví 4    | Síla 0.6                            |
| Vyprávět v hospodě     | Vyprávění 4    | Inteligence 1.2                     |
| Modlit se v chrámu     | Modlitba 4     | Inteligence 0.8, Životy 0.5         |

### Anti-cheese: diminishing returns z jednoho zdroje

Aby hráč nedělal botfarmu na jeden atribut přes jednu aktivitu, **každý zdroj atributu má soft cap**:

- Síla z Boje zblízka cap sft cap na expy co udělají cca lvl 60 z toho zdroje, pak dostává jen třeba 20% expů
- Nad lvl 60 musí přijít XP z kovářství / hornictví / dřevorubectví.

Tím atribut **vynucuje rozmanitost činností** — což je přesně total level chad design.

## Bojové skilly (4)

- **Boj zblízka** — meč/sekera/kopí/palcát; varianta zbraně dává sub-bonus.
- **Lukostřelba** — luk, kuše, vrhací zbraně.
- **Kouzelnictví** — útočná, defensivní i utility magie.
- **Obrana** — štít, blokování, uhýbání. Mix Síly (těžký štít) a Obratnosti (parry).

### Combat triangle

```
Boj zblízka  >  Lukostřelba  >  Kouzelnictví  >  Boj zblízka
   (drtí lehkou zbroj)  (probíjí mág. ochranu)  (proráží těžkou zbroj)
```

### Vzorce (draft)

- `melee_damage = (Síla × 0.5 + BojZblízka × 0.7) × zbraň_mod × triangle_mod`
- `ranged_accuracy = (Obratnost × 0.4 + Lukostřelba × 0.6)`
- `magic_damage = (Int × 0.6 + Kouzelnictví × 0.8) × hůl_mod`
- `evasion = (Obratnost × 0.3 + Obrana × 0.7)`

## Sběrné skilly (5)

- **Hornictví** — ruda, kámen, drahokamy.
- **Dřevorubectví** — dřevo všech druhů.
- **Rybaření** — sladká i slaná voda.
- **Bylinkářství** — sběr a pěstování bylin pro Alchymii a Vaření.
- **Lov** — stopování, pasti, stahování zvěře pro maso a kůže.

## Řemeslné skilly (5)

- **Kovářství** — zbraně, zbroj, kovové nástroje. Top-tier zbraně vyžadují min. lvl `Boj zblízka` (musíš znát balanc, ze kterého kuješ).
- **Vaření** — jídlo s buffy. Top-tier vyžaduje `Bylinkářství`.
- **Krejčovství** — látky, kožené zbroje, oděvy. Ochranné zbroje vyžadují `Obrana` (víš, kam přidat výztuž).
- **Alchymie** — lektvary, jedy, runy. Potency škáluje s `Inteligence`, ne jen s Alchymií.
- **Tesařství** — nábytek, housing prvky, hole, luky a šípy. Luky vyžadují `Lukostřelba`.

## Sociální skilly (3)

- **Vyprávění** — pasivní lore odhalení v hospodách, odemyká questy, charisma checks.
- **Modlitba** — kapacita & efektivita víry. Detail v [faith.md](faith.md).
- **Lupičství** — kapsování, zámky, plížení. Stinná protiváha Modlitbě.

## Provázanost skill ↔ řemeslo (klíčová mechanika)

Ne každý kovář umí kovat top-tier meč. Aby ses dostal k legendární výrobě, musíš sám dělat to, co vyrábíš.

| Řemeslo                           | Sub-skill gate    |
| --------------------------------- | ----------------- |
| Kovářství meče (lvl 70+)          | Boj zblízka 50    |
| Stolařství luku (lvl 70+)         | Lukostřelba 50    |
| Krejčovství zbroje (lvl 70+)      | Obrana 50         |
| Vaření buff jídla (lvl 60+)       | Bylinkářství 40   |
| Alchymie potion potency           | Inteligence škála |
| Stolařství magické hole (lvl 70+) | Kouzelnictví 50   |

Tohle vytváří **organic skill graph** — hráč ladící svého lukostřelce přirozeně investuje do Stolařství, aby si dělal luky.

## Cap a total level

- Cap: **99 pro každý skill i atribut** (RSC tradice).
- XP křivka: RSC-style exponential.
- **Total level = součet všech skillů + atributů** = 21 × 99 = max **2079**.
- Maxer status, leaderboard, in-game cape.

## Otevřené otázky

- [ ] Diminishing returns — exact thresholdy a křivka.
- [ ] Combat triangle modifier — kolik %?
- [ ] Lvl 99 perks per skill — jako OSRS skill capes (teleport / passive)?
- [ ] Subskilly v rámci `Boj zblízka` — meč vs sekera vs kopí; samostatné XP nebo jen ekvip mastery?
