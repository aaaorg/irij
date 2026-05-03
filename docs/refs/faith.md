# Faith — Modlitba, bohové a obětiny

Status: brainstorm draft (session 2026-05-01)
Související: [skills.md](skills.md)

## Filozofie

Modlitba není UI klik. Je to **rituál vázaný na geografii** — chrámy, oltáře, skryté háje. Tím se víra stává **důvodem cestovat světem** a obětní místa se stávají strategickými body.

Slovanský pantheon je USP proti západním fantasy hrám. Kombinujeme **historicky doložené hlavní bohy** (Perun, Veles, Mokoš, Svarog, Dažbog) s **ručně psanými podbohy** (vlastní lore, vlastní questliny).

## Tři vrstvy systému

1. **Hlavní bůh** (1 aktivní) → permanentní pasivní buff.
2. **Aktivní krátkodobé buffy** → obětiny v chrámech/oltářích, trvání ~1 hod.
3. **Skill Modlitba** → kapacita, trvání, účinnost a discount na obětiny.

## Hlavní bohové (5)

| Bůh | Doména | Permanentní pasivní buff (max favor) |
|---|---|---|
| **Perun** | hrom, válka, řád | +5 % melee damage |
| **Veles** | podsvětí, magie, lest, dobytek | +5 % stealth a lupičství success rate |
| **Mokoš** | matka země, plodnost, voda | +5 % HP regen mimo boj |
| **Svarog** | nebeský oheň, kovář bohů | +5 % řemeslo quality / crit craft |
| **Dažbog** | slunce, štědrost, lov | +5 % ranged accuracy |

### Pravidla hlavního boha

- **Pouze 1 hlavní bůh aktivní.**
- Změna = **expensive cleansing quest** + ztráta favoru u opuštěného (cooldown týdny IRL nebo questline).
- Permanentní buff škáluje s favorem: favor 0 = 0 %, favor 100 = full 5 %.

### Konflikty

- **Perun ↔ Veles** je klasický slovanský mýtus (boj nebes a podsvětí). Sloužit oběma najednou nemožné. Aktivní favor Peruna 50+ = blokuje favor u Velese.
- Ostatní bohové mají měkčí vztahy — penalty jen pri aktivních questech proti.

## Favor

- Rozsah: **−100 až +100** per bůh.
- **Získáváš:** obětmi, questy v doméně, aktivitou v doméně (Perun: vyhrané souboje; Mokoš: vyléčení spojenci; Svarog: vykované předměty).
- **Ztrácíš:** akcemi proti doméně (Perunovi vadí útěk z boje; Mokoš vadí lov březí zvěře; Velesovi vadí poctivost při obchodu).
- **Decay:** −1 favor / IRL den, pokud nejsi aktivní → udržuje hráče v rituálu.

## Obětní místa (geografie víry)

### Tři tiery

| Typ | Lokace | Obětiny | Buffy |
|---|---|---|---|
| **Hlavní svatyně** | 1 na boha celosvětově (poutě) | top-tier (legendární item, krev bosse) | 60–120 min, max síla, vzácné podbohy |
| **Městský oltář** | každé větší město, hlavní bohové | mid-tier (kovaný předmět, lektvar) | 30–45 min, mid síla |
| **Skrytý háj / hrobka** | divočina, podbozi | speciální (vázáno na podboha) | 15–60 min, niche efekty |

### Obětiny

| Tier | Příklady | Trvání buffu | Účinnost |
|---|---|---|---|
| Drobná | chleba, ryba, květina | 15 min | weak (50 %) |
| Střední | kovaný předmět, lektvar, kožešina | 30 min | mid (75 %) |
| Velká | legendární zbraň, krev bosse, vzácný runestone | 60–120 min | full (100 %) |

Obětina je **spotřebována**.

## Skill Modlitba — co levelíš

Modlitba ≠ favor. Je to **kapacita a efektivita rituálu**.

| Lvl | Kapacita aktivních buffů | Trvání multiplier | Discount obětiny | Speciál |
|---|---|---|---|---|
| 1 | 1 | 1.0× | 0 % | — |
| 25 | 1 | 1.2× | 10 % | favor decay −50 % |
| 50 | 2 | 1.5× | 25 % | retroaktivní buff (oběť → buff i mimo místo) |
| 75 | 3 | 1.8× | 40 % | second wind (1× za den auto-revive na 30 % HP) |
| 99 | 3 | 2.0× | 50 % | **Channeling**: vyvolat hlavního boha do battle, jednorázový obří efekt s týdenním cooldownem |

### Kde se skill levelí

- Modlení v chrámech (passivní XP / minutu).
- Pokládání obětin (XP úměrné tieru).
- Dokončení questlinů podbohů.
- Channeling end-game.

## Podbohové

Ručně psaní. Každý podbůh = úzká specializace + mini-questline + vlastní obětní háj.

### Pravidla

- Podbůh **slouží hlavnímu bohu**. Aktivace podboha vyžaduje min. favor +30 u jeho hlavního.
- Hráč má **2 sloty pro podbohy** (lvl 50+ Modlitby aktivuje druhý slot).
- Podbozi dávají **niche aktivní buffy** přes obětiny ve svých hájech (nikoli v městských oltářích).

### Ukázka podbohů (placeholder lore)

#### Pod Perunem

- **Burnoš** — bůžek prvního úderu. Buff: +damage na první ráně boje.
- **Štíhloň** — bůžek soubojů jeden na jednoho. Buff: +stats v duelech, ne v davu.
- **Hromohlav** — bůžek bouřkových nocí. Buff: bonus damage v noci za bouřky.

#### Pod Velesem

- **Mraz** — pán nočního lovu. Buff: stealth attack damage.
- **Šeptal** — drobný bůžek šepotu. Buff: +XP Vyprávění o tajemstvích.
- **Hadolíz** — bůžek jedů. Buff: Alchymie poison potions potency.
- **Bahnomor** — bůžek bahna a pastí. Buff: trapping success v Lovu.

#### Pod Mokoší

- TBD — kandidáti: bůžek studny, bůžek porodu, bůžek úrody.

#### Pod Svarogem

- TBD — kandidáti: bůžek měchu, bůžek brusu, bůžek prvního výhně.

#### Pod Dažbogem

- TBD — kandidáti: bůžek úsvitu, bůžek vlčí stopy, bůžek lukostřelby na dálku.

## Otevřené otázky

- [ ] Cleansing quest pro změnu hlavního boha — design (jednou v životě? cyklicky? expensive?).
- [ ] Channeling lvl 99 — konkrétní efekty per bůh.
- [ ] Podbozi pod Mokoší / Svarogem / Dažbogem — vymyslet jména a buffy.
- [ ] PvP a faction war — má Perun/Veles split vést k organizovaným střetům, nebo zůstat solo flavor?
- [ ] Atheismus — co dostane hráč, který odmítne všechny bohy? Penalty, nebo vlastní niche build (např. „Bezvěrec" perk pro nezávislost na obětinách)?
