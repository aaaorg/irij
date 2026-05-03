# 02a — Data model: Postava

**Stav:** Draft 1 — 2026-05-01
**Účel:** Definovat persistovaná data postavy hráče. Sourozenec dokumentu [refs/skills.md](refs/skills.md), který popisuje _design_ skillů; tenhle dokument popisuje _datovou strukturu_.
**Sourozenci v sérii 02:** 02b Itemy, 02c Svět, 02d NPC/Mobi/Questy, 02e Ekonomika.

---

## Přístup k modelování

- **Logické entity, ne SQL DDL.** Konkrétní storage layer (Nakama Storage Engine s JSON blobs, vs. přímý Postgres přes Nakama runtime) řešíme v ADR (#4) a v implementaci. Tady definujeme _co_ ukládáme, ne _kam_.
- **Per-player ownership.** Skoro všechno je vlastněno jedním hráčem; cross-player vazby (trade, chat) jsou v 02e.
- **Persistence vs match state.** Některá data jsou _persistentní_ (přežívají logout), některá jsou _match state_ (žijí v paměti Nakama match handleru, snapshotují se periodicky). Označuji tagem.
- **Identita.** `player_id` = Nakama `user_id` (UUID z OIDC auth). Žádný vlastní auth.

---

## Entita: `Player` (root)

Jeden řádek na hráče. Většina polí persistentní; HP a pozice se snapshotují z match state.

| Pole                       | Typ            | Persist | Poznámka                                                                                                |
| -------------------------- | -------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID           | ✓       | = Nakama `user_id`. Primární klíč.                                                                      |
| `username`                 | string (3-16)  | ✓       | Unikátní, immutable. Validace: a-zA-Z0-9_, žádné mezery.                                                |
| `display_name`             | string (3-24)  | ✓       | Zobrazované jméno, lze měnit (poplatek?). Validace povolí UTF-8 (Žofie, Břetislav).                     |
| `gender`                   | enum           | ✓       | `M` / `F`. Affects sprite rendering.                                                                    |
| `appearance`               | struct         | ✓       | Viz `Appearance` níže.                                                                                  |
| `created_at`               | timestamp      | ✓       |                                                                                                         |
| `last_login_at`            | timestamp      | ✓       | Pro offline regen / pasivní mechaniky později.                                                          |
| `last_logout_at`           | timestamp      | ✓       | Doplněk k last_login pro analýzu.                                                                       |
| `total_xp`                 | u64            | ✓ cache | Denormalizovaný součet XP přes všechny skilly+atributy. Updatováno při level-up.                        |
| `total_level`              | u32            | ✓ cache | Denormalizovaný součet levelů. Max 21 × 99 = 2079.                                                      |
| `current_zone_id`          | string         | ✓       | Kde se hráč naposledy odhlásil; tam se objeví při loginu.                                               |
| `current_position`         | (i16, i16)     | ✓       | Tile coordinates uvnitř zóny.                                                                           |
| `hp_current`               | u16            | ✓       | Aktuální HP. Při loginu = uloženo, regen běží od `hp_last_update_at`.                                   |
| `hp_last_update_at`        | timestamp      | ✓       | Pro výpočet offline regen.                                                                              |
| `death_debuff_expires_at`  | timestamp?     | ✓       | NULL pokud žádný debuff. Tikající i offline.                                                            |
| `mana_current`             | u16            | ✓       | Pokud bude mana — TBD v skills.md / faith.md kontextu. Placeholder pole.                                |
| `mana_last_update_at`      | timestamp      | ✓       | Stejně jako HP.                                                                                         |
| `tutorial_completed`       | bool           | ✓       | Zobrazení onboarding flow.                                                                              |
| `settings`                 | JSON           | ✓       | UI preference, audio volumes, chat filters atd. — opaque klientský state.                               |

### Sub-struct: `Appearance`

Layered sprite design, **3 kategorie × 12 voleb** pro MVP (rozhodnutí 2026-05-01):

| Pole           | Typ | Rozsah | Poznámka                                                          |
| -------------- | --- | ------ | ----------------------------------------------------------------- |
| `hair_id`      | u8  | 0-11   | Styl + barva v jednom (12 kombinací). Layered nad hlavou.         |
| `skin_tone_id` | u8  | 0-11   | 12 odstínů.                                                       |
| `outfit_id`    | u8  | 0-11   | Startovní vesničanský outfit ve 12 barevných variantách.          |

> **Pozdější rozšíření (post-MVP):** `outfit_id` se rozdělí na `top_id` / `bottom_id` / `feet_id` jakmile přijdou kosmetické dropy. Equipment items (zbroj, helma) překryjí outfit při rendringu.

> **Render note (info pro #5 Style guide):** sprite skládáme z child sprites v Phaser containeru. Pořadí Z (od spodu): tělo (skin) → outfit → equipment → vlasy → equipment helmet.

---

## Entita: `PlayerAtribut`

Jeden řádek na (hráč × atribut). Vždy 4 řádky na hráče (Síla, Obratnost, Inteligence, Životy).

| Pole       | Typ   | Persist | Poznámka                                                          |
| ---------- | ----- | ------- | ----------------------------------------------------------------- |
| `player_id`| UUID  | ✓       | FK na Player.                                                     |
| `name`     | enum  | ✓       | `strength` / `dexterity` / `intelligence` / `vitality` (display: "Síla" / "Obratnost" / "Inteligence" / "Životy"). |
| `xp`       | u64   | ✓       | Suma XP. Level se počítá z této hodnoty přes XP curve.            |
| `level`    | u8    | ✓ cache | Cachované pro rychlé čtení. Updatuje se při level-up.             |

**Level curve (provisional, ladíme později):**
- 1→2: 100 XP
- Exponenciální křivka, 99 ≈ **10M XP** (rozhodnutí 2026-05-01, mírnější než RSC 13M).
- Konkrétní vzorec v separátní `xp_curve.md` (TBD), nebo lookup table.

### Entita: `PlayerAtributSource` (pro diminishing returns)

skills.md design vyžaduje **soft cap per zdroj**: Síla získaná z Boje zblízka má cap při lvl-60-ekvivalentu, nad tím 20 % rate. Implementace = trackujeme XP per (atribut, source skill).

| Pole               | Typ   | Persist | Poznámka                                                              |
| ------------------ | ----- | ------- | --------------------------------------------------------------------- |
| `player_id`        | UUID  | ✓       |                                                                       |
| `atribut_name`     | enum  | ✓       |                                                                       |
| `source_skill`     | enum  | ✓       | Který skill k tomu zdrojem přispěl.                                   |
| `xp_contributed`   | u64   | ✓       | Kumulativní XP z tohoto zdroje (po aplikaci diminishing factoru).     |

**Algoritmus award_atribut_xp(player, atribut, source, base_xp):**
```
contributed = lookup(player, atribut, source).xp_contributed
threshold   = XP_for_level(60)  // ~3.4M XP po křivce
factor      = 1.0 if contributed < threshold else 0.2
gained      = base_xp * factor
contributed += gained
atribut.xp  += gained
// Konkrétní hodnoty (60, 0.2) jsou v parking lotu skills.md
```

> **Open question (skills.md):** hard threshold vs. smooth křivka (sigmoid). Hard threshold je jednodušší pro implementaci a srozumitelnější pro hráče; sigmoid je elegantnější ale neviditelný. **Navrhuju hard threshold pro MVP.**

---

## Entita: `PlayerSkill`

Jeden řádek na (hráč × skill). 17 skillů → 17 řádků na hráče po vytvoření postavy.

| Pole       | Typ   | Persist | Poznámka                                                          |
| ---------- | ----- | ------- | ----------------------------------------------------------------- |
| `player_id`| UUID  | ✓       |                                                                   |
| `name`     | enum  | ✓       | Viz [skills.md](refs/skills.md) — 17 skillů.                      |
| `xp`       | u64   | ✓       |                                                                   |
| `level`    | u8    | ✓ cache | Max 99.                                                           |

> Atributy a skilly mají _identický_ datový tvar; možná to nakonec bude jedna tabulka s `kind: 'atribut' | 'skill'`. Implementační detail ADR.

---

## Equipment (vybavení)

Pevné sloty, jeden item per slot.

| Slot       | Typ itemu (kategorie)            | Poznámka                                                  |
| ---------- | -------------------------------- | --------------------------------------------------------- |
| `helmet`   | `armor.head`                     |                                                           |
| `cape`     | `armor.cape`                     |                                                           |
| `amulet`   | `accessory.amulet`               |                                                           |
| `weapon`   | `weapon.*`                       | 1H i 2H. 2H zablokuje `shield`.                           |
| `body`     | `armor.body`                     |                                                           |
| `shield`   | `weapon.shield`                  |                                                           |
| `legs`     | `armor.legs`                     |                                                           |
| `gloves`   | `armor.hands`                    |                                                           |
| `boots`    | `armor.feet`                     |                                                           |
| `ring`     | `accessory.ring`                 |                                                           |
| `holster`  | `consumable.whetstone` / `consumable.arrow` / `consumable.rune` | **Sjednocený combat consumable slot** (display: "Pouzdro"). Viz sekce "Holster" níže. |

### Entita: `PlayerEquipment`
Reprezentace: jeden řádek na (hráč × slot), nebo struct embedded v `Player`. **Pro Nakama Storage doporučuju embedded ve struct**, protože sloty jsou fixní a vždy se čtou společně.

| Pole         | Typ                  | Persist | Poznámka                          |
| ------------ | -------------------- | ------- | --------------------------------- |
| `player_id`  | UUID                 | ✓       |                                   |
| `slot`       | enum                 | ✓       |                                   |
| `item_id`    | u32?                 | ✓       | NULL = prázdný slot.              |
| `quantity`   | u32                  | ✓       | Vždy 1, kromě `holster` (= zbývající charges).            |
| `instance_id`| UUID?                | ✓       | Pro nestackable s vlastním stavem (durability, enchant). Stackable nemá. |

### Holster — sjednocený combat consumable slot (display: "Pouzdro")

**Jeden equip slot pro combat spotřební**, automatický výběr podle vybavené zbraně:

| Vybavená zbraň          | Akceptovaný consumable     | Co se děje při akci                        |
| ----------------------- | -------------------------- | ------------------------------------------ |
| Melee (meč/sekera/kopí) | `consumable.whetstone`     | Každý úder spotřebuje 1 charge (= +damage) |
| Lukostřelba (luk/kuše)  | `consumable.arrow`         | Každý výstřel spotřebuje 1 šíp             |
| Hůl / amulet            | `consumable.rune`          | Každé damage kouzlo spotřebuje 1 runu      |
| Holé ruce               | (nic)                      | Degradovaný damage, lze bojovat vždy       |

**Tiery (jeden druh runy / brusu / šípu, různé úrovně síly):**
- Whetstones: T1 (lvl 1) → T4 (lvl 70)
- Arrows: T1 → T4+ vyšší tiery
- Runes: T1 → T4+, **vyšší tiery vyžadují podpůrné skilly** (např. T3+ rune potřebuje Modlitbu / Alchymii / Lupičství k craftění) — detail v 02b

> **Combat runes = jeden druh.** Mág nosí jen nejvyšší dostupný tier. Element affinity / non-combat runes jsou parking lot pro post-MVP.

**Auto-pull:** když `holster.quantity = 0`, server transparentně přesune další stack stejného `item_id` z `Inventář`. Žádná notifikace hráči, žádný UI prompt — jen tichá výměna. Hráč switchující zbraně/armor mezi styly nemusí překlikávat holster.

**Bez consumable:**
- Melee → bojuje, ale bez damage buffu (žádné +%)
- Ranged → nemůže střílet
- Magic → nemůže castnout damage spelly (utility kouzla bez nákladu mohou existovat — TBD)

---

## Inventář (mobile-friendly)

**Dva taby** (rozhodnutí 2026-05-01):

### Tab 1 — `Inventář` (24 slotů)

Generic carryable items: zbraně, jídlo, lektvary, questovky, peníze (jako item, RSC-style — _ne_ separátní wallet).

| Pole         | Typ   | Persist | Poznámka                                  |
| ------------ | ----- | ------- | ----------------------------------------- |
| `player_id`  | UUID  | ✓       |                                           |
| `slot_index` | u8    | ✓       | 0-23.                                     |
| `item_id`    | u32?  | ✓       | NULL = slot prázdný.                      |
| `quantity`   | u32   | ✓       | 1 pro non-stackable.                      |
| `instance_id`| UUID? | ✓       | Stejně jako equipment — stav-bearing items. |

### Tab 2 — `Vak surovin` (váhový limit)

**Pouze items kategorie `material.*`** (ruda, dřevo, ryby, byliny, kůže, vlna...). Žádné sloty, jen řádky. Limit = sum of weights.

| Pole         | Typ   | Persist | Poznámka                                                          |
| ------------ | ----- | ------- | ----------------------------------------------------------------- |
| `player_id`  | UUID  | ✓       |                                                                   |
| `item_id`    | u32   | ✓       | Musí být `material.*`. Validace serverem.                         |
| `quantity`   | u32   | ✓       |                                                                   |

**Capacity formula (provisional):**
```
max_weight_kg = 30 + (sila_level × 0.5)
// L1 = 30 kg, L99 ≈ 80 kg
```

**Item weights** definují itemy v [02b](02b-data-model-itemy.md). Příklady: ruda 1.0 kg/ks, dřevo 0.5 kg/ks, ryba 0.3 kg/ks.

> **Mounts / kárky / skladovací zvířata:** parking lot pro post-MVP.

### Banka (truhla v hospodě)

**Neomezená kapacita**, dostupná v každé vesnici. Nesynchronizovaná s inventářem (musíš dojít k truhle).

| Pole         | Typ   | Persist | Poznámka                                                          |
| ------------ | ----- | ------- | ----------------------------------------------------------------- |
| `player_id`  | UUID  | ✓       |                                                                   |
| `slot_index` | u32   | ✓       | Pro hráčem definované řazení.                                     |
| `item_id`    | u32   | ✓       | Jakákoli kategorie.                                               |
| `quantity`   | u32   | ✓       |                                                                   |
| `instance_id`| UUID? | ✓       |                                                                   |

> **Decision:** banka je _shared_ napříč všemi vesnicemi (RSC-style), ne per-vesnice (klasická MMO friction). Naše hra se nesnaží tlačit hráče do questování přesunů kvůli logistice.

---

## Death state

**"Stesk po Domově" debuff** (rozhodnutí 2026-05-01):

- Aktivuje se při smrti
- Trvání: 10 minut wall-clock (tiká i offline — záměr)
- Efekt: `-25% XP gain` napříč všemi skilly + `-15% damage dealt` (combat)
- Cleansable třemi způsoby:
  1. **Obětina v chrámu** (zdarma, ale musíš dojít) → posiluje Modlitbu (malé XP do Modlitby)
  2. **Lektvar Posila** (Alchymie crafted item, prodejný) → ekonomická cesta
  3. **Vyprávěč v hospodě** (drobný poplatek za session) → posiluje Vyprávění (malé XP)

### Entita: `PlayerStatus` (active effects)

Generic tabulka pro všechny aktivní efekty (debuff/buff). Death debuff je první případ; lektvarové buffy a další přijdou později.

| Pole          | Typ        | Persist | Poznámka                                                           |
| ------------- | ---------- | ------- | ------------------------------------------------------------------ |
| `player_id`   | UUID       | ✓       |                                                                    |
| `effect_id`   | enum       | ✓       | `stesk_po_domove`, `food_buff`, `prayer_active`, ...               |
| `applied_at`  | timestamp  | ✓       |                                                                    |
| `expires_at`  | timestamp  | ✓       |                                                                    |
| `magnitude`   | i16        | ✓       | Stack úroveň / síla (např. lektvar L1 vs L3).                      |
| `source_meta` | JSON       | ✓       | Kontext (kdo zabil, jaký lektvar atd.) — pro debugging/forensiku.  |

> **Drop on death:** RSC dropoval items. Pro casual hru navrhuji **žádný drop pro MVP** — jen debuff. Pokud bude opt-in wilderness zóna, tam ano. Otevřená otázka.

---

## Combat level (derivovaný)

**Není to skill ani atribut.** Vypočítaný z atributů + bojových skillů, zobrazený nad postavou pro PvP matchmaking a wildy gating.

```
combat_level = (
  vitality * 0.30 +
  strength * 0.20 +
  dexterity * 0.20 +
  intelligence * 0.10 +
  max(melee, ranged, magic) * 0.15 +
  defense * 0.05
)
// Max teoretický ≈ 99 — odpovídá tvému "1-100 pro začátek"
```

> **Vzorec je provisional** — balance ladíme po MVP. Vzorec patří do logiky, ne do schématu (není persistovaný; spočítá se on-demand nebo cachuje při level-up).

---

## Match state vs persistent state — co kde žije

| Stav                         | Persist (DB) | Match state (RAM) | Sync trigger                                  |
| ---------------------------- | ------------ | ----------------- | --------------------------------------------- |
| Player core (id, name, ...)  | ✓            | snapshot at login | login                                         |
| Atributy, Skilly XP/lvl      | ✓            | mirror            | každý XP gain → write-through                 |
| Pozice, current_zone         | ✓ snapshot   | live              | každých 30 s auto-save + na logout            |
| HP, mana                     | ✓ snapshot   | live              | změna HP > threshold + 30 s auto-save + logout|
| Inventář, equipment, vak     | ✓            | mirror            | každá změna → write-through                   |
| Banka                        | ✓            | lazy load on open | každá změna → write-through                   |
| PlayerStatus (effects)       | ✓            | mirror            | apply / expire → write-through                |
| Movement intents (path)      | ✗            | live only         | nikdy nepersistujeme                          |
| Chat history                 | partial      | live              | log do separátní tabulky pro moderaci         |

> **Write-through pattern:** většina změn jde přes Nakama match handler, který dělá in-memory update + async write do storage. Při crash dojde ke ztrátě max ~30 s pohybu, což je akceptovatelné.

---

## Constraints / invariants

Tohle je seznam pravidel, která server _musí_ vynucovat (klientovi nikdy nedůvěřujeme).

1. `total_xp = sum(skills.xp) + sum(atributy.xp)` — recalculovat při každém XP gain.
2. `total_level = sum(skills.level) + sum(atributy.level)` — max 2079.
3. `Inventář` má max 24 slotů, `slot_index` ∈ [0, 23], unique per player.
4. `Vak`: `sum(weights) ≤ max_weight_kg`. Při překročení server odmítne přidání.
5. `Equipment`: `weapon` 2H zablokuje `shield`. Server validuje při equip.
6. `hp_current ≤ hp_max` kde `hp_max = f(zivoty_level)` (vzorec TBD, viz combat level).
7. `mana_current ≤ mana_max` (TBD).
8. `username` immutable po vytvoření; `display_name` měnitelný (poplatek?).
9. Vstup do PvP zóny: `combat_level` ≥ minimum dané zóny.
10. Death debuff aplikovaný při `hp_current → 0`. Respawn na nejbližší chrám / startovní vesnice.

---

## Storage layer notes (lightweight)

**Nakama-friendly approach:**
- `player` collection — jeden JSON blob na hráče s rooty struct.
- `player_skills` collection — jeden blob na hráče s `{atributy: [...], skilly: [...], sources: [...]}`.
- `player_inventory` collection — `{inv: [...], satchel: [...], equipment: {...}}`.
- `player_bank` collection — separátní, lazy-loaded.
- `player_status` collection — pole aktivních efektů.

**Alternativa:** přímý Postgres přes Nakama runtime hooks (Nakama interně používá Postgres, můžeme tam mít vlastní tabulky). Lepší pro dotazy typu "leaderboard total_level top 100" nebo "všichni hráči v zóně X".

> **Rozhodnutí storage layer = ADR (#4).** Tady jen flagujeme, že obě cesty jsou validní.

---

## Open questions / parking lot

- [ ] **Drop on death** — rozhodnuto: žádný drop pro MVP. Wildy zóna parking lot.
- [ ] Mana mechanika — má _vůbec_ být, nebo Modlitba/Kouzelnictví tečou jinou cestou? (Závisí na faith.md.) Předběžně bez many — runy + cooldowny stačí.
- [ ] HP regen rate online vs offline (RSC 1 HP / minutu in combat, 1 HP / 6s out of combat).
- [ ] Display name change fee + cooldown.
- [ ] Soft cap threshold a factor (skills.md says lvl 60 / 20 %, ale ladíme).
- [ ] XP curve konkrétní vzorec/lookup → samostatný dokument `xp_curve.md`.
- [ ] Storage layer rozhodnutí → ADR (#4).
- [ ] Chat history retention pro moderaci — kolik dní?
- [ ] Non-combat runy pro non-combat skilly — pouze parking, řešíme post-MVP.
- [ ] Utility kouzla bez run cost (TBD) — povolit nebo ne.

---

## Změnový log

- **2026-05-01** — Draft 1, vytvořeno na základě potvrzených rozhodnutí o postavě, inventáři, smrti, char creation. Reference [refs/skills.md](refs/skills.md).
- **2026-05-01** — Draft 1.1: přidán slot `pouzdro` jako sjednocený combat consumable slot (brus / šíp / runa). Drop on death potvrzeno žádný. Auto-pull tichý. Combat runy = jeden druh, tiery, podpůrné skilly přes crafting.
- **2026-05-01** — Draft 1.2: lock konvence "EN kód, CZ display". Slot `pouzdro` → kód `holster`, atributy → kód `strength`/`dexterity`/`intelligence`/`vitality`. Categories `consumable.whetstone` / `consumable.arrow` / `consumable.rune`. Display jména v lokalizační vrstvě.
