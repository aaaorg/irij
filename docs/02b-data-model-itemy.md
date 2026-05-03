# 02b — Data model: Itemy

**Stav:** Draft 1 — 2026-05-01
**Účel:** Definovat strukturu itemů, jejich kategorie, vlastnosti, vztah k craftění a tier/rarity systém.
**Sourozenci:** 02a Postava, 02c Svět, 02d NPC/Mobi/Questy, 02e Ekonomika.

---

## Konvence

- **Identifikátory v kódu = English snake_case** (`weapon.melee.sword.iron`, `consumable.whetstone`).
- **Display jména pro hráče = česky** v lokalizační vrstvě (`name_cs`, `description_cs`). EN strings volitelně (`name_en`).
- **String IDs** všude, žádné numerické (rozhodnutí 2026-05-01).

---

## Item definition vs item instance

Dvě úrovně:

### Item definition (statická data)
- Definuje _co_ je item: kategorie, stats, váha, cena, ikonka.
- Žije v **`items.json`** (versioned static data v repo).
- Jeden záznam per item type. Např. "Železný meč" (`weapon.melee.sword.iron`) = jedna definice.
- Imutabilní za běhu — změna definice = patch + redeploy.

### Item instance (runtime stav)
- Konkrétní výskyt itemu v inventáři / equipement / na zemi / v truhle.
- Má `item_id` (= reference do definice) + `quantity` + případně `instance_id` pro state-bearing items.
- Pro **stackable** itemy (consumables, materials, currency): jen quantity.
- Pro **non-stackable** state-bearing itemy (zbraně s enchantmenty post-MVP): `instance_id` + JSON state blob.

> **MVP zjednodušení:** všechny itemy v MVP jsou buď čistě stackable, nebo non-stackable bez per-instance stavu. `instance_id` necháváme v schématu, ale nevyplňujeme.

---

## Item base schema

Společná pole pro všechny itemy v `items.json`:

```jsonc
{
  "id": "weapon.melee.sword.iron",
  "category": "weapon.melee.sword",
  "tier": 2,                          // 1-4+ (T1 = entry, T4 = endgame MVP)
  "rarity": "common",                 // common | rare | epic | legendary
  "name_cs": "Železný meč",
  "name_en": "Iron Sword",
  "description_cs": "Pevný meč z kovaného železa. Vyžaduje Boj zblízka 20.",
  "weight_kg": 3.5,
  "stackable": false,
  "max_stack": 1,                     // 1 pro non-stackable, jinak 1000+
  "icon": "icons/weapon/sword_iron.png",
  "value_denar": 250,                 // base shop value v denárech
  "level_req": { "melee": 20 },       // map skill → min level
  "tradeable": true,                  // false pro questovky a vázané
  "destroyable": true,                // false pro questovky
  "specialized": { ... }              // per-category fields, viz níže
}
```

### Pole `specialized` per kategorie

#### `weapon.melee.*` / `weapon.ranged.*` / `weapon.magic.*`
```jsonc
{
  "damage_min": 6,
  "damage_max": 14,
  "attack_speed_ticks": 4,            // počet 100ms ticků mezi údery
  "weapon_class": "melee",            // melee | ranged | magic
  "two_handed": false,                // pokud true → blokuje shield slot
  "range_tiles": 1                    // melee=1, bow=7, staff=5
}
```

#### `weapon.shield`
```jsonc
{
  "block_chance_pct": 15,
  "damage_reduction_pct": 20
}
```

#### `armor.*`
```jsonc
{
  "slot": "body",                     // head | body | legs | hands | feet | cape
  "defense_melee": 10,
  "defense_ranged": 8,
  "defense_magic": 4,
  "movement_penalty_pct": 5           // těžké brnění zpomaluje
}
```

#### `consumable.whetstone`
```jsonc
{
  "weapon_class_required": "melee",
  "damage_bonus_pct": 15,             // +% damage per swing
  "charges_per_unit": 1               // = 1 swing per kus (stack = total swings)
}
```

#### `consumable.arrow`
```jsonc
{
  "weapon_class_required": "ranged",
  "damage_flat_bonus": 4,             // přidaný flat damage k výstřelu
  "level_req": { "ranged": 1 }
}
```

#### `consumable.rune`
```jsonc
{
  "weapon_class_required": "magic",
  "spell_tier_unlocked": 1,           // jaké spell tiery lze cast s touto runou
  "level_req": { "magic": 1 }
}
```

#### `consumable.food`
```jsonc
{
  "hp_restore": 8,
  "buff_id": null,                    // optional: temporary buff applied
  "buff_duration_s": 0,
  "consume_time_ticks": 3             // jak dlouho trvá jíst
}
```

#### `consumable.potion`
```jsonc
{
  "effect_id": "remove_homesickness",
  "magnitude": 1,
  "duration_s": 0                     // 0 = instant effect
}
```

#### `material.*`
Žádná specialized pole — jen base. Materiály jsou input pro crafting.

#### `tool.*`
```jsonc
{
  "tool_type": "pickaxe",             // pickaxe | axe | fishing_rod | knife | chisel | hammer | sewing_kit
  "gathering_tier": 2,                // umí těžit suroviny do tieru 2
  "skill_used": "mining"              // primární skill
}
```

#### `currency.denar`
```jsonc
{
  "stackable": true,
  "max_stack": 1000000,
  "value_denar": 1                    // sebe-referenčně
}
```

> **Měna:** **jen denáry, single denomination** (rozhodnutí 2026-05-01). Žádné copper/silver/gold tiery — jen jedna mince. Velké částky se zobrazují s tisícovým oddělovačem ("12 450 d").

#### `quest.*`
Žádná specialized pole. `tradeable: false`, `destroyable: false`. Quest itemy jsou vázané na hráče.

#### `cosmetic.*` (post-MVP placeholder)
```jsonc
{
  "cosmetic_slot": "head",            // překryje equipment slot vizuálně, žádné staty
  "skin_id": "headgear_floral_crown_001"
}
```

---

## Tier a rarity systém

### Tier (1-4+)
- **Tier = power gate.** Vyšší tier = větší staty + vyšší level requirement.
- T1 = startovní (lvl 1-20)
- T2 = mid-early (lvl 20-40)
- T3 = mid-late (lvl 40-60)
- T4 = endgame MVP (lvl 60-99)
- T5+ = parking lot pro post-MVP expansion

### Rarity (orthogonal to tier)
| Rarity      | Vizuál (tooltip rámeček) | Význam                                                                  |
| ----------- | ------------------------ | ----------------------------------------------------------------------- |
| `common`    | bílá / šedá              | Defaultní crafted items, low-tier drops.                                |
| `rare`      | modrá                    | Vzácné drop z mobů / lepší crafting roll. Stats +5-10 % vs common.      |
| `epic`      | fialová                  | Boss drops, very rare crafting roll. Stats +15-25 % vs common.          |
| `legendary` | oranžová / zlatá         | Pojmenované unikáty z hlavních questů / world bossů. Stats +25-50 %.    |

### Tier × Rarity mapping pro crafting

Default crafted item rolling **caps at epic** (rozhodnutí 2026-05-01):
- T1: 95 % common, 5 % rare
- T2: 85 % common, 13 % rare, 2 % epic
- T3: 70 % common, 25 % rare, 5 % epic
- T4: 50 % common, 35 % rare, 15 % epic

> **Skill bonus:** vysoký level v crafting skillu (např. Smithing 99) zvyšuje šanci na vyšší rarity ve své kategorii (posun common → rare → epic). Konkrétní vzorec ladíme po MVP.

> **Legendary se nerolluje z běžného craftingu** — vyžaduje samostatný upgrade recept, viz níže.

> Boss drops a quest rewards mají _předem definovanou_ rarity; nerollují náhodně.

### Legendary upgrade recepty

Legendary itemy nejsou _vyrobitelné z nuly_ — vznikají **upgrade-em existujícího epic itemu** přes samostatné mistrovské recepty, které musí být _odemčeny_ skrz hru (questy, NPC mistři, vzácné svitky).

```jsonc
{
  "id": "recipe.legendary.weapon.sword.iron",
  "type": "upgrade",
  "input_item": {
    "item_id": "weapon.melee.sword.iron",
    "min_rarity": "epic",
    "consumed": true                     // upgrade item se spotřebuje
  },
  "extra_inputs": [
    { "item_id": "material.gem.bloodstone", "quantity": 1 },
    { "item_id": "material.essence.ancient", "quantity": 3 }
  ],
  "primary_skill": { "name": "smithing", "level": 99 },
  "secondary_skills": [
    { "name": "melee", "level": 80 }
  ],
  "station_required": "smith_forge",
  "tool_required": "tool.hammer",
  "crafting_time_ms": 60000,             // dlouhý proces
  "unlock_required": "knowledge.legendary_smithing.iron",
  "fail_chance_pct": 25,                 // při fail materiály ztraceny, base epic item zachován
  "output": {
    "item_id": "weapon.melee.sword.iron",
    "rarity_override": "legendary"
  },
  "xp_award": {
    "smithing": 5000,
    "strength": 800
  }
}
```

**Klíčové vlastnosti legendary upgradů:**
- **Vyžadují epic input** — nelze přeskočit common/rare/epic řetězec
- **Knowledge gate** (`unlock_required`) — musíš se recept naučit od NPC mistra, vyhrát z questu, najít svitek
- **Vzácné suroviny navrch** — typicky drahokam + esence z bossů
- **Vysoké fail rate** (~20-30 %) — při fail extra suroviny ztraceny, ale **base epic item zůstane**
- **Endgame skill cap** — primary skill 99, secondary 70-80
- **Dlouhý crafting time** (30-120 s) — symbolicky "pečlivá práce mistra"

> **Knowledge unlocks** jsou samostatná entita — viz `Knowledge` níže.

### Entita: `PlayerKnowledge`

Hráč si musí _naučit_ určité recepty / lore / dovednosti. Bez tohoto unlocku recipe ani neuvidí v UI.

| Pole              | Typ        | Persist | Poznámka                                                  |
| ----------------- | ---------- | ------- | --------------------------------------------------------- |
| `player_id`       | UUID       | ✓       |                                                           |
| `knowledge_id`    | string     | ✓       | Např. `knowledge.legendary_smithing.iron`.                |
| `unlocked_at`     | timestamp  | ✓       | Pro audit / "achievement" view.                           |
| `source`          | enum       | ✓       | `quest` / `npc_master` / `scroll` / `discovery`.          |

> Knowledge se odemyká interakcí ve světě — odměna z questu, naučení od NPC za poplatek + reputaci, čtení svitku v knihovně, "objev" při experimentu (např. použít epic + nová surovina = šance na discovery).

---

## Crafting recepty

### Entita: `Recipe` (statická data v `recipes.json`)

```jsonc
{
  "id": "recipe.weapon.sword.iron",
  "output": { "item_id": "weapon.melee.sword.iron", "quantity": 1 },
  "inputs": [
    { "item_id": "material.ore.iron", "quantity": 3 },
    { "item_id": "material.wood.oak", "quantity": 1 }
  ],
  "primary_skill": { "name": "smithing", "level": 20 },
  "secondary_skills": [
    { "name": "melee", "level": 15 }   // gate pro top-tier zbraně (skills.md design)
  ],
  "station_required": "smith_forge",
  "tool_required": "tool.hammer",
  "crafting_time_ms": 4000,
  "xp_award": {
    "smithing": 80,
    // atribut XP via fractional curve, viz skills.md
    "strength": 15
  },
  "fail_chance_pct": 5                 // šance na fail = ztráta surovin (modifikuje level)
}
```

### Crafting stations

| Station            | Display            | Lokace                         | Skilly                  |
| ------------------ | ------------------ | ------------------------------ | ----------------------- |
| `smith_forge`      | Kovárna            | Vesnice (kovář)                | Smithing                |
| `cooking_fire`     | Ohniště            | Hospoda + outdoor              | Cooking                 |
| `tailoring_table`  | Krejčovský stůl    | Vesnice (krejčí)               | Tailoring               |
| `alchemy_table`    | Alchymistický stůl | Vesnice (bylinář)              | Alchemy, Herbalism      |
| `carpentry_bench`  | Truhlářský stůl    | Vesnice (truhlář)              | Carpentry               |
| `temple_altar`     | Oltář              | Chrám                          | Prayer (rune crafting)  |

> Některé recepty (např. T1 jednoduché) lze udělat **bez stationy** přímo v inventáři; vyšší tiery vyžadují station + tool. Konkrétně určuje recipe.

---

## MVP item katalog (sample, nikoli kompletní)

Cílový rozsah ~65 itemů. Tady ukázka napříč kategoriemi pro MVP — kompletní seznam bude v `items.json` v repo.

### Zbraně (~12 v MVP)
| ID                              | Tier | Display              | Skill req     |
| ------------------------------- | ---- | -------------------- | ------------- |
| `weapon.melee.sword.bronze`     | 1    | Bronzový meč         | melee 1       |
| `weapon.melee.sword.iron`       | 2    | Železný meč          | melee 20      |
| `weapon.melee.sword.steel`      | 3    | Ocelový meč          | melee 40      |
| `weapon.melee.axe.bronze`       | 1    | Bronzová sekera      | melee 1       |
| `weapon.ranged.bow.short`       | 1    | Krátký luk           | ranged 1      |
| `weapon.ranged.bow.long`        | 2    | Dlouhý luk           | ranged 30     |
| `weapon.magic.staff.oak`        | 1    | Dubová hůl           | magic 1       |
| `weapon.magic.staff.birch`      | 2    | Březová hůl          | magic 25      |
| `weapon.shield.bronze`          | 1    | Bronzový štít        | defense 1     |
| `weapon.shield.iron`            | 2    | Železný štít         | defense 20    |
| ...                                                                          |

### Brnění (~15 v MVP)
3 tiery × 5 slotů (head/body/legs/hands/feet) = 15. Cape/amulet/ring volitelně post-MVP.

### Consumables (~9 v MVP)
| ID                              | Tier | Display              | Použití             |
| ------------------------------- | ---- | -------------------- | ------------------- |
| `consumable.whetstone.flint`    | 1    | Pazourkový brus      | melee +10 %         |
| `consumable.whetstone.slate`    | 2    | Břidlicový brus      | melee +20 %         |
| `consumable.arrow.wood`         | 1    | Dřevěný šíp          | ranged base         |
| `consumable.arrow.iron`         | 2    | Železný šíp          | ranged +flat dmg    |
| `consumable.rune.t1`            | 1    | Runa nováčka         | magic spell tier 1  |
| `consumable.rune.t2`            | 2    | Runa kovaná          | magic spell tier 2  |
| `consumable.food.bread`         | 1    | Chléb                | +6 HP               |
| `consumable.food.fish_grilled`  | 2    | Pečená ryba          | +12 HP              |
| `consumable.potion.posila`      | 1    | Lektvar Posila       | remove homesickness |

### Materiály (~10 v MVP)
| ID                          | Display          | Skill získání                |
| --------------------------- | ---------------- | ---------------------------- |
| `material.ore.copper`       | Měděná ruda      | mining 1                     |
| `material.ore.iron`         | Železná ruda     | mining 15                    |
| `material.ore.coal`         | Uhlí             | mining 30                    |
| `material.wood.oak`         | Dubové dřevo     | woodcutting 1                |
| `material.wood.birch`       | Březové dřevo    | woodcutting 20               |
| `material.fish.herring`     | Sleď             | fishing 5                    |
| `material.herb.mata`        | Máta             | herbalism 1                  |
| `material.hide.deer`        | Jelení kůže      | hunting 10                   |
| `material.stone.flint`      | Pazourek         | mining 1                     |
| `material.cloth.linen`      | Lněné plátno     | drop / nákup                 |

### Tools (~4 v MVP)
- `tool.pickaxe.bronze` (T1), `tool.pickaxe.iron` (T2)
- `tool.axe.bronze` (T1)
- `tool.fishing_rod.basic` (T1)
- `tool.knife.basic` (T1, pro stahování zvěře)

### Currency
- `currency.denar` (jediná měna)

### Quest items (~3 v MVP, jen placeholder)
- `quest.lost_amulet`, `quest.bandit_letter`, `quest.broken_seal`

> **Kompletní rozpis MVP itemů** patří do `items.json` v repo, ne do designového dokumentu. Tahle tabulka jen demonstruje schéma a rozsah.

---

## Constraints / invariants

1. **Equipment validation:** `equipped_item.category.matches(slot)` — server odmítá equipovat brnění do weapon slotu apod.
2. **Holster validation:** `holster.item.weapon_class_required == equipped_weapon.weapon_class`.
3. **Level requirements:** server odmítá equipovat / use itemu pokud `player.skill[name] < level_req[name]`.
4. **Tradeable:** `tradeable: false` items nelze hodit, prodat, ani dropnout (RSC quest item pattern).
5. **Stack overflow:** přidání nad `max_stack` → server odmítá / overflow se vrátí jako "vrátka v inventáři".
6. **Tool requirement:** crafting recept odmítne pokračovat bez patřičného `tool_required` v inventáři / vybavení.
7. **Station proximity:** server validuje, že hráč je ≤ 2 dlaždice od potřebné `station_required`.
8. **Currency clamp:** `currency.denar.quantity` cap 1 000 000 — anti-overflow + ekonomický gating; větší obnos jde přes banku.

---

## Open questions / parking lot

- [ ] **Item enchantment / vepsání run:** post-MVP, nedělat teď.
- [ ] **Custom weapon naming:** rozhodnuto NE (2026-05-01).
- [ ] **Durability:** rozhodnuto NE (2026-05-01).
- [ ] **Legendary z běžného craftingu:** rozhodnuto NE — vyžaduje upgrade recept + knowledge unlock (2026-05-01).
- [ ] Konkrétní hodnoty fail_chance vs skill level — balance po MVP.
- [ ] Tier × rarity drop distribuce u mobů — řešíme v 02d.
- [ ] Bind-on-equip / bind-on-pickup pro epic+ items — post-MVP.
- [ ] Tier upgrading (T2 meč → T3 se zlatým pruhem) — post-MVP.
- [ ] Set bonusy (4 kusy stejného setu = bonus) — post-MVP.
- [ ] **Discovery mechanic** — odemčení knowledge experimentem (epic + nová surovina = šance objevit). Detail post-MVP.

---

## Změnový log

- **2026-05-01** — Draft 1, vytvořeno na základě potvrzených rozhodnutí o EN/CZ konvencích, denárech jako jediné měně, žádném custom naming, žádné durability, single-tiered combat run typu.
- **2026-05-01** — Draft 1.1: legendary cap z běžného craftingu odstraněn — vyžaduje samostatný upgrade recept + knowledge unlock. Přidána entita `PlayerKnowledge` a recipe `type: "upgrade"`.
