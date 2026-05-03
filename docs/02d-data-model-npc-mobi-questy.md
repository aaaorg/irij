# 02d — Data model: NPC, Mobi, Questy

**Stav:** Draft 1 — 2026-05-01
**Účel:** Definovat strukturu NPC, mobů a questů, jejich AI/state machine, lootů a odměn.
**Sourozenci:** 02a Postava, 02b Itemy, 02c Svět, 02e Ekonomika.

---

## 1. NPC

NPC = neinteraktivní postava ve světě. Většinou ve vesnicích, případně na cestách. Liší se od mobů tím, že **nejsou primárně pro boj** — primárně pro interakci.

### Konvence rolí — flag-based, ne enum

NPC má **set boolean flagů**, ne jednu roli. Jeden NPC může být zároveň `merchant` + `quest_giver` + `pickpocketable`. To dovoluje organicky kombinovat (kovář je merchant + crafter + master + někdy quest_giver).

| Flag             | Co umí                                                                |
| ---------------- | --------------------------------------------------------------------- |
| `talkable`       | Defaultně `true`. Lze s ním vést dialog (vždy aspoň "Pozdrav").       |
| `merchant`       | Prodává a kupuje itemy. Má inventory + buy/sell tables.               |
| `banker`         | Dává přístup k truhle (banka).                                        |
| `quest_giver`    | Má questy k zadání. Vidí je hráč splňující prerequisites.             |
| `master`         | Učí knowledge / odemyká recepty. Často s reputační podmínkou.         |
| `crafter`        | Provede crafting akci za poplatek (ušetří hráči čas / nemá skill).    |
| `attackable`     | Lze na něj zaútočit. Má combat staty. Killing má následky.            |
| `pickpocketable` | Lze ho okrást skillem Thievery. Má pickpocket loot table + difficulty.|

### Entita: `Npc` (statická definice + dynamický stav)

```jsonc
{
  "id": "npc.kovar_blatiny",
  "name_cs": "Starý Kovář",
  "display_name_cs": "Starý Kovář",     // jméno nad postavou (zelené pokud friendly)
  "appearance_id": "sprite.npc.kovar_001",
  "default_position": [142, 88],
  "wanders": false,                      // statické vs. patrol
  "patrol_path": null,
  "flags": {
    "talkable": true,
    "merchant": true,
    "quest_giver": true,
    "master": true,
    "crafter": true,
    "attackable": false,                 // klíčový starostlivý NPC, nezabitelný
    "pickpocketable": true               // ale dá se okrást
  },
  "village_id": "village.blatiny",
  "merchant_table_id": "merchant.kovar_blatiny",
  "pickpocket_loot_table_id": "pickpocket.kovar_blatiny",
  "pickpocket_difficulty": 25,           // Thievery skill needed
  "dialog_root": "dialog.kovar_blatiny.root",
  "stats": null,                          // null protože unattackable
  "respawn_after_death_s": null
}
```

Pokud `attackable: true`, NPC má `stats` strukturu jako mob (HP, damage, defense), `respawn_after_death_s` (např. 3600 = 1h), a smrt má **konsekvence ve vesnici** (viz Reputace).

### Pickpocket mechanika

Hráč inicíuje pickpocket akci na NPC s `pickpocketable: true`:
1. Roll: `success_chance = (player.thievery_level - npc.pickpocket_difficulty + d20)` vs. threshold.
2. **Success:** hráč dostane drop z `pickpocket_loot_table` + Thievery XP.
3. **Fail:** NPC zařve, **village reputation -10**, guards se aktivují (post-MVP), pro MVP jen reputation hit + krátký combat lockout s NPC.
4. **Cooldown:** ne. Hráč může pokoušet znova hned. (Anti-grind: `pickpocket_difficulty` u stejného NPC stoupá s každým pokusem během 24h, resetuje se denně.)

### Dialog system — stateful s knowledge unlocky (rozhodnutí 2026-05-01)

Komplexita (c) z brainstormu. Dialog tree je **JSON struktura** s nodes a edges, podporuje:
- Branching odpovědi (hráč si vybírá)
- **Knowledge gates** — některé možnosti se zobrazí jen pokud má hráč konkrétní `PlayerKnowledge`
- **Quest state gates** — některé možnosti až po dokončení questu
- **Reputation gates** — některé až po reputaci ≥ X

```jsonc
{
  "id": "dialog.kovar_blatiny.root",
  "nodes": {
    "root": {
      "speaker": "npc.kovar_blatiny",
      "text_cs": "Á, ty jsi z Blatin? Co potřebuješ?",
      "options": [
        { "text_cs": "Co máš na prodej?", "next": "shop_open" },
        { "text_cs": "Slyšel jsem o Polednici v bažině...", "next": "polednice_quest", "show_if": { "knowledge": "lore.polednice_rumor" } },
        { "text_cs": "Naučíš mě kovat dýku?", "next": "teach_dagger", "show_if": { "reputation_min": 100 } },
        { "text_cs": "Sbohem.", "next": "exit" }
      ]
    },
    "polednice_quest": {
      "speaker": "npc.kovar_blatiny",
      "text_cs": "Tak ty jsi taky slyšel? Můj synovec se z bažiny nevrátil...",
      "options": [
        { "text_cs": "Pomohu ti najít ho.", "next": "exit", "effect": { "start_quest": "quest.synovec_kovar" } }
      ]
    },
    "teach_dagger": {
      "speaker": "npc.kovar_blatiny",
      "text_cs": "Dobře, ukážu ti to. Bude tě to stát 200 denárů.",
      "options": [
        { "text_cs": "Beru.", "next": "exit", "effect": { "deduct_currency": 200, "unlock_knowledge": "recipe.weapon.dagger.iron" } }
      ]
    }
  }
}
```

Effect typy: `start_quest`, `complete_quest_step`, `unlock_knowledge`, `deduct_currency`, `add_currency`, `give_item`, `take_item`, `change_reputation`, `teleport`.

> **Engineering pozn.:** dialog tree spravujeme jako JSON v `dialogs/*.json`. Lokalizace: tag `text_cs` pro češtinu, `text_en` pro angličtinu (odsunuto post-MVP, MVP jen `cs`).

---

## 2. Vesnická reputace (rozhodnutí 2026-05-01)

Hráč má **per-village reputaci** v rozsahu `0-1000`, default 100 (neutral newcomer).

### Entita: `PlayerReputation`

| Pole          | Typ   | Persist | Poznámka                                                  |
| ------------- | ----- | ------- | --------------------------------------------------------- |
| `player_id`   | UUID  | ✓       |                                                           |
| `village_id`  | string| ✓       | `village.blatiny`, `village.cerny_les`, ...               |
| `value`       | i32   | ✓       | -∞ to 1000. Neguje pokud okrádá / zabíjí.                 |
| `last_change` | timestamp | ✓   | Pro audit / decay.                                        |

### Reputační triggery

| Akce                                                      | Reputation delta            |
| --------------------------------------------------------- | --------------------------- |
| Dokončení vesnického questu                               | +50 (small) až +500 (epic)  |
| Pickpocket fail                                           | -10                         |
| Útok na friendly NPC                                      | -100                        |
| Zabití friendly NPC                                       | -500 (možná permanentní)    |
| Splněný task z hospodského board                          | +1 to +10                   |
| Velký donatění chrámu (denáry)                            | +5 per 100 denárů           |
| Krádež na tržišti (post-MVP)                              | -20                         |

### Reputační efekty

- **0-50 (Vyhnanec):** NPC s tebou nemluví, obchodníci ti neprodávají, guards na tebe útočí (post-MVP)
- **50-100 (Cizinec):** základní interakce, vyšší ceny u obchodníků (+25 %)
- **100-300 (Známý):** standardní ceny, většina questů přístupná
- **300-600 (Vážený):** -10 % ceny, přístup k masterům
- **600-1000 (Hrdina):** -25 % ceny, exclusivní questy, NPC tě zdraví jménem

> **Decay:** žádný. Reputaci nezískáš a neztratíš pasivně — jen aktivními činy.

> **Cross-village interakce:** zabití NPC v Blatinách = -500 v Blatinách, ale ostatní vesnice neví. Až post-MVP přijde "rumor system" (zprávy se šíří mezi vesnicemi).

---

## 3. Mobi

Mob = nepřátelská entita, primárně pro boj. Statický spawn point + AI.

### Entita: `Mob` (definice + runtime instance)

```jsonc
{
  "id": "mob.wolf",
  "name_cs": "Vlk",
  "appearance_id": "sprite.mob.wolf",
  "level": 5,
  "stats": {
    "hp_max": 30,
    "damage_min": 2,
    "damage_max": 5,
    "attack_speed_ticks": 4,
    "defense_melee": 3,
    "defense_ranged": 1,
    "defense_magic": 0,
    "weapon_class": "melee",
    "movement_speed_tps": 2.5
  },
  "ai_behavior_id": "ai.aggressive_basic",
  "loot_table_id": "loot.wolf",
  "xp_award": {
    "melee": 35,
    "vitality": 10
  },
  "aggro_radius_tiles": 5,
  "leash_radius_tiles": 15,
  "level_aggro_threshold": 10,           // hráči s combat_level >= mob.level + 10 nedostanou aggro
  "respawn_min_s": 60,
  "respawn_max_s": 180
}
```

### Mob AI behavior — patrol paths v MVP (rozhodnutí 2026-05-01)

Komplexita (b) z brainstormu — basic + patrol.

**Behavior types** (statická knihovna):

| ID                       | Popis                                                                  |
| ------------------------ | ---------------------------------------------------------------------- |
| `ai.passive`             | Nikdy neútočí. Útěk při ataku. (Jelen, zajíc.)                         |
| `ai.defensive`           | Útočí jen při napadení. Pak chase do leash.                            |
| `ai.aggressive_basic`    | Aggro v `aggro_radius` na hráče s combat_level v rozsahu. Chase + leash.|
| `ai.aggressive_patrol`   | Chodí po `patrol_path`, jinak jako aggressive_basic.                   |
| `ai.scripted_*`          | Speciální encounter behavior pro Polednici, Hastrmana atd. (post-MVP detail). |

**Patrol path** = seznam dlaždic, mob je obchází. Při aggro path pauzuje.

### Aggro level gating (rozhodnutí 2026-05-01)

```
if abs(player.combat_level - mob.level) > mob.level_aggro_threshold:
    no aggro
```

Vlky lvl 5 ignorují hráče lvl 50+. Hráč lvl 50 musí na dračí mob, ne na vlka, aby získal XP.

### Loot tables (rozhodnutí 2026-05-01 — schéma OK)

```jsonc
{
  "id": "loot.wolf",
  "rolls": [
    { "item_id": "material.hide.wolf", "quantity": [1, 2], "chance_pct": 100 },
    { "item_id": "material.bone.wolf", "quantity": [1, 1], "chance_pct": 100 },
    { "item_id": "consumable.food.raw_meat", "quantity": [1, 1], "chance_pct": 30 },
    { "item_id": "weapon.melee.dagger.bronze", "quantity": [1, 1], "chance_pct": 0.5 },
    { "item_id": "consumable.rune.t1", "quantity": [3, 8], "chance_pct": 5 }
  ]
}
```

Server rolluje každý řádek nezávisle. `chance_pct` = 100 = vždy. Pro **rare/epic drops** se aplikuje rarity rolling z 02b — drop má základní item_id, rarity rolluje při dropu.

> **Žádné legendary z lootu.** Konsistent s 02b — legendary jen z upgrade receptů + knowledge.

### MVP mob katalog (sample)

| ID                  | Display          | Level | Region                    | Pozn.                          |
| ------------------- | ---------------- | ----- | ------------------------- | ------------------------------ |
| `mob.wolf`          | Vlk              | 5     | Hvozd Tichoušek           | aggressive                     |
| `mob.bandit`        | Bandita          | 8     | Cesty                     | aggressive, dropuje denáry     |
| `mob.boar`          | Divočák          | 12    | Hvozd Tichoušek (deeper)  | defensive                      |
| `mob.hastrman`      | Hastrman         | 25    | Bažina Černav             | aggressive_patrol              |
| `mob.polednice`     | Polednice        | 40    | Bažina (scheduled spawn)  | scripted, regional broadcast   |
| `mob.deer`          | Jelen            | 3     | Lovecké pláně             | passive (hunting)              |
| `mob.rabbit`        | Zajíc            | 1     | Lovecké pláně             | passive                        |

---

## 4. Questy

### Quest filozofie (rozhodnutí 2026-05-01)

- **Žádné daily questy.**
- **Žádné fetch questy** ("přines mi 10 železa") — ty jdou na **board v hospodě** (entity v 02e).
- Questy = **promakané lore příběhy** s hlubinami, charakterem, volbami (i když mechanicky lineární).
- Hlavní lore questy + vedlejší vesnické questy. Kvalita > kvantita.
- **MVP target: 3-5 questů celkem**, hluboce napsaných. Ne 50 mělkých.

### Entita: `Quest` (definice)

```jsonc
{
  "id": "quest.synovec_kovar",
  "title_cs": "Synovec Starého Kováře",
  "category": "side",                    // main | side | hidden
  "village_id": "village.blatiny",
  "level_recommendation": 10,
  "prerequisites": {
    "knowledge": ["lore.polednice_rumor"],
    "completed_quests": [],
    "min_reputation": { "village.blatiny": 50 }
  },
  "starts_with_dialog": "dialog.kovar_blatiny.polednice_quest",
  "steps": [
    {
      "id": "find_clue_in_swamp",
      "description_cs": "Najdi stopu po synovci v Bažině Černav.",
      "objective": { "type": "interact_with_object", "target": "object.bloody_amulet", "position": [205, 178] }
    },
    {
      "id": "defeat_hastrman",
      "description_cs": "Poraz Hastrmana, který zná pravdu.",
      "objective": { "type": "kill_mob", "target": "mob.hastrman", "count": 1 }
    },
    {
      "id": "return_to_kovar",
      "description_cs": "Vrať se ke Starému Kováři s amuletem.",
      "objective": { "type": "talk_to_npc", "target": "npc.kovar_blatiny", "dialog": "polednice_quest_complete" }
    }
  ],
  "rewards": {
    "xp": { "melee": 5000, "thievery": 1000 },
    "items": [{ "item_id": "weapon.melee.sword.iron", "quantity": 1 }],
    "currency_denar": 500,
    "knowledge": ["lore.polednice_origin"],
    "reputation": { "village.blatiny": 200 }
  },
  "lockout_after_complete": true        // nelze zopakovat
}
```

### Objective types (MVP)

| Type                   | Parametry                                     | Popis                              |
| ---------------------- | --------------------------------------------- | ---------------------------------- |
| `talk_to_npc`          | target, dialog                                | Promluv s NPC (s konkrétním nodem) |
| `kill_mob`             | target, count                                 | Zabít X kusů                       |
| `gather_item`          | target, count                                 | Mít v inventáři                    |
| `deliver_item`         | target_npc, item, count                       | Donést NPC                         |
| `interact_with_object` | target_object, position                       | Najít a použít objekt na mapě      |
| `reach_position`       | position, radius                              | Dojít na souřadnici                |
| `complete_quest`       | target_quest                                  | Pre-req chain                      |

> **Branching:** post-MVP. MVP má lineární kroky.

### Entita: `PlayerQuest` (runtime stav)

| Pole              | Typ        | Persist | Poznámka                                                |
| ----------------- | ---------- | ------- | ------------------------------------------------------- |
| `player_id`       | UUID       | ✓       |                                                         |
| `quest_id`        | string     | ✓       |                                                         |
| `state`           | enum       | ✓       | `not_started` (default unwritten) / `active` / `completed` / `failed` |
| `current_step_id` | string?    | ✓       | Aktivní krok                                            |
| `step_progress`   | JSON       | ✓       | Per-objective counter (např. `{"kill_mob": 3}`)         |
| `started_at`      | timestamp  | ✓       |                                                         |
| `completed_at`    | timestamp? | ✓       |                                                         |

### Quest rewards (rozhodnutí 2026-05-01 — vše v mixu)

Každý quest reward struct je union z:
- **XP** per skill (a atributy via fractional curve)
- **Itemy**
- **Denáry**
- **Knowledge unlocks** (`PlayerKnowledge` rows)
- **Vesnická reputace** (`PlayerReputation` delta)

**Žádný money-only reward.** Každý quest dá _něco unikátního_ — knowledge, item, příběh, reputaci. Money je vedlejší.

### Quest log UX (info pro #5 Style guide / klient)

- "Aktivní questy" panel v UI, max 5 najednou (MVP cap)
- Každý zobrazuje: title + aktuální step description + progress bar / counter
- Map markery na cílové pozice (s toggle on/off)
- Completed questy v "deníku" (lore čtení)

---

## 5. Knowledge unlocks (cross-cutting)

Tahle entita už byla zavedena v 02b. Reusable napříč:
- Recipes (legendary smithing)
- Dialog options (NPC reaguje na "vidíš, že už víš o Polednici")
- Quest prerequisites
- Hospodský board (post-MVP — task vyžaduje kvalifikaci)
- Lore deník

Knowledge ID pattern:
- `recipe.legendary_smithing.iron` — recept
- `lore.polednice_origin` — příběh
- `lore.bažina_secret` — místo
- `cert.master_smith` — kvalifikace

---

## Constraints / invariants

1. **NPC interaction:** server validuje flagy (talkable/merchant/...) před akcí.
2. **Pickpocket:** server roluje skill, klient nikdy nedeterministicky neurčí success.
3. **Reputation gating:** server kontroluje reputaci před zobrazením dialog options / questů.
4. **Quest prerequisites:** server odmítá `start_quest` pokud nejsou splněna.
5. **Mob aggro:** server-side, klient nikdy nerozhoduje, na koho mob útočí.
6. **Loot rolls:** server-side. Klient dostane jen výsledek.
7. **XP rewards:** server validuje, že hráč objective skutečně splnil (není to klient self-report).
8. **Reputation cap:** value clamp `[-∞, 1000]`, server clampuje při delta.
9. **Knowledge atomicita:** unlock_knowledge effect je idempotentní — re-trigger nezpůsobí duplicate.

---

## Open questions / parking lot

- [ ] Branching questy — post-MVP.
- [ ] Quest fail states (selhal jsi, restart cooldown) — post-MVP, MVP nemá fail.
- [ ] Cross-village rumor system — post-MVP.
- [ ] Mob group AI — post-MVP.
- [ ] Scripted encounter detail pro Polednici / Hastrmana — design až při implementaci.
- [ ] NPC schedules (kovář pracuje od 8 do 18 herního času) — post-MVP, závisí na den/noc.
- [ ] Reputation decay — rozhodnuto NE pro MVP.
- [ ] Shared / party quests — post-MVP.
- [ ] Repeatable quest mechanika (ne daily, ale opakovatelné) — pokud potřeba, post-MVP.
- [ ] Kill quest progress sharing v partě — post-MVP.

---

## Změnový log

- **2026-05-01** — Draft 1, vytvořeno na základě potvrzených rozhodnutí. NPC flag-based role, dialog stateful s knowledge gates, vesnická reputace, mob AI patrol, loot table schéma, quest filozofie "kvalita > kvantita", žádné daily/fetch.
