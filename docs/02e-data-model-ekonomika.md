# 02e — Data model: Ekonomika

**Stav:** Draft 1 — 2026-05-01
**Účel:** Definovat NPC obchody, banku, hráč-hráč trade, tržiště, hospodský board (= NPC poptávky), NPC workery a gold sinks.
**Sourozenci:** 02a Postava, 02b Itemy, 02c Svět, 02d NPC/Mobi/Questy.

---

## 1. NPC obchody

### Model: static ceny + limited stock + respawn (rozhodnutí 2026-05-01)

NPC obchodník má pevné ceny (`buy_price`, `sell_price`), ale **omezený stock** který se postupně doplňuje.

### Entita: `MerchantTable` (definice + dynamický stock)

```jsonc
{
  "id": "merchant.kovar_blatiny",
  "owner_npc_id": "npc.kovar_blatiny",
  "type": "specialist.smithing",        // general | specialist.<category>
  "sell_items": [
    {
      "item_id": "weapon.melee.sword.bronze",
      "sell_price_denar": 250,
      "stock_max": 3,
      "stock_current": 3,
      "respawn_per_hour": 1             // 1 ks za hodinu
    },
    {
      "item_id": "tool.pickaxe.bronze",
      "sell_price_denar": 80,
      "stock_max": 5,
      "stock_current": 5,
      "respawn_per_hour": 2
    }
  ],
  "buy_items": [
    { "item_id": "material.ore.iron", "buy_price_denar": 18, "buy_limit_per_day": 100 },
    { "item_id": "material.ore.copper", "buy_price_denar": 8, "buy_limit_per_day": 100 }
  ]
}
```

### Specialist vs. general store (rozhodnutí 2026-05-01)

| Typ obchodu                      | Buy logic                                                     |
| -------------------------------- | ------------------------------------------------------------- |
| `general` (obecný kupec)         | Kupuje **všechno** za ~50 % sell ceny.                        |
| `specialist.<category>`          | Kupuje **jen své kategorie** za ~80-100 % sell ceny + bonus.  |

Příklad: hráč chce prodat železnou rudu.
- **General store:** koupí za 10 d
- **Specialist Kovář:** koupí za 18 d (specialista vždy lepší, ale specifický)

To motivuje hráče cestovat za správným kupcem, ale dává fallback (general store) když nemá energii.

### Stock respawn mechanika

- **Tick:** server periodicky (např. každých 15 min) iteruje merchant tables a doplňuje stock podle `respawn_per_hour` proporcionálně.
- **Cap:** nikdy nad `stock_max`. Když je stock plný, respawn se prostě neaplikuje.
- **Buy limit:** `buy_limit_per_day` zabraňuje botům prodávat NPC nekonečně rudy. Reset každý den 00:00 server time.

### Vesnické multi-vlastnictví

Některé MerchantTables nepatří jen jednomu NPC. Příklad: tržiště v Blatinách má **NPC trh manažera** (`npc.trh_blatiny`) s general buy_table, ale `sell_items` je vlastně **MarketListing tabulka** od hráčů (viz dále).

---

## 2. Banka

(Reusing rozhodnutí z 02a: neomezená, shared napříč vesnicemi.)

**Přístupové body:**
1. **NPC banker** v každé vesnici (`flags.banker: true`)
2. **Bank chest** (`object.bank_chest`) v hospodě každé vesnice — jako fallback bez NPC

Server kontroluje proximity (≤ 2 dlaždice) k některému access pointu.

**Žádné poplatky.** Bank přístup zdarma.

---

## 3. Hráč-hráč obchod

### Direct trade window (MVP)

Klasický RSC pattern.

1. Hráč A klikne pravým "Trade" na hráče B
2. Otevře se okno s dvěma sloupci (A nabídka / B nabídka)
3. Oba dávají itemy + denáry do svého sloupce
4. Oba kliknou "Accept" → server validuje (oba mají, co nabízejí; oba mají místo v inventáři) → swap atomicky
5. Pokud někdo změní svůj sloupec po accept, accept se _zruší_ a oba musí znovu (anti-scam)

### Entita: `TradeSession` (transient match state, nepersistuje)

```jsonc
{
  "id": "trade.uuid",
  "player_a": "uuid",
  "player_b": "uuid",
  "offer_a": [{ "item_id": "...", "quantity": 5 }, ...],
  "offer_b": [...],
  "currency_a": 100,
  "currency_b": 50,
  "accepted_a": false,
  "accepted_b": false,
  "started_at": "...",
  "expires_at": "..."                    // 5 min timeout
}
```

> **Atomicita:** server provede swap v jediné transakci. Pokud někdo nemá místo / nemá item → celá trade rollback.

### Listing board (post-MVP)

Trvalá veřejná nabídka itemů od hráčů, viditelná všem v dané vesnici. Princip:
- Hráč vyvěsí item s `ask_price_denar`
- Item je **uložen v listingu** (z inventáře hráče se odečte)
- Kdokoli může koupit za vyvěšenou cenu
- Když koupí → server přesune item kupujícímu, denáry prodávajícímu, vesnice si vezme **5 % poplatek**

### Entita: `MarketListing` (post-MVP, ale schéma teď, ať máme architekturu)

```jsonc
{
  "id": "listing.uuid",
  "village_id": "village.blatiny",
  "seller_id": "uuid",
  "item_id": "weapon.melee.sword.iron",
  "item_instance_id": null,
  "quantity": 1,
  "ask_price_denar": 350,
  "listed_at": "...",
  "expires_at": "...",                   // např. 7 dní
  "fee_pct": 5                           // gold sink → vesnice
}
```

> **MVP:** direct trade window funguje. Listing board parking lot, ale schéma je připravené.

---

## 4. Tržiště v Blatinách (rozhodnutí 2026-05-01: hráčské listingy)

Když listing board přijde post-MVP, **tržiště v Blatinách bude jeho první implementace**. NPC trh manažer (`npc.trh_blatiny`) je interface — kliknutím na něj otevře market UI.

Pro MVP: tržiště má jen pár fixních NPC stánků (general store, pekař, košíkář) jako flavor + 1-2 questgivery.

---

## 5. Hospodský board = NPC poptávkový systém (sjednoceno 2026-05-01)

**Tohle je core mechanika pillaru 3** — ekonomika kde NPC i hráči poptávají, hráči to plní.

### Filozofie

- **Procedurálně generované tasky** podle ekonomické situace vesnice
- **Sdílený pool**, ne per-hráč — task je jeden, může ho splnit více hráčů paralelně
- **"Zapomenuté tasky"** (které nikdo dlouho neplní) získávají **prioritu + bonus reward**
- **Stackovatelné** — hráč si vezme task, nemusí ho splnit dnes, drží ho v aktivních

### Entita: `JobBoardTask` (sdílený, persistent)

```jsonc
{
  "id": "task.uuid",
  "village_id": "village.blatiny",
  "type": "deliver_items",               // deliver_items | kill_mobs | gather | escort | repair
  "title_cs": "Pekař potřebuje pšeničnou mouku",
  "description_cs": "Pekař Vavřinec potřebuje 20× pšeničné mouky pro slavnost. Nech to v jeho kádi vedle pece.",
  "issued_by_npc_id": "npc.pekar_blatiny",
  "deliver_to_npc_id": "npc.pekar_blatiny",
  "objective": {
    "item_id": "material.flour.wheat",
    "quantity_required": 20
  },
  "reward": {
    "currency_denar": 100,
    "xp": { "cooking": 50 },
    "reputation": { "village.blatiny": 5 }
  },
  "max_concurrent_takers": 5,            // kolik hráčů to může mít aktivní zároveň
  "current_takers": 2,
  "fulfilled_count": 3,                  // kolikrát už bylo splněno
  "fulfilled_max": 10,                   // kolikrát celkem může být splněno než zmizí
  "issued_at": "...",
  "expires_at": "...",                   // 7 dní default; pokud nikdo neplní, expires
  "priority_bonus_multiplier": 1.0       // bumpne se na 1.5 / 2.0 pokud task stárne
}
```

### Sdílený vs per-hráč: rozhodnutí

**Sdílený pool s `max_concurrent_takers`** (rozhodnutí 2026-05-01).

- **Task vidí všichni hráči ve vesnici**
- **Více hráčů ho může mít aktivní zároveň** (`max_concurrent_takers` = 3-10 podle typu)
- Každý kdo splní → dostane reward jednorázově. Když `fulfilled_count >= fulfilled_max`, task zmizí
- Tím **vesnice ekonomicky funguje jako reálný systém**: pekař opravdu potřebuje 20×N mouky, ne 20× per hráč
- **No FOMO:** task má více slotů, hráč co se nepřihlásí dnes má šanci zítra

### Procedurální generování

Server periodicky (každých ~30 min) generuje nové tasky podle:

1. **Pool of templates** (`job_board_templates.json`) — např. "fetch X items from category Y" / "kill X mobs of type Y" / "deliver to NPC Z"
2. **Vesnické potřeby:** každá vesnice má `economic_state` (nedostatek čeho, přebytek čeho) — odvozeno z fulfillment historie + ekonomického modelu
3. **Random fluctuation** pro zajištění novosti

Task aging:
- Pokud `current_takers == 0` po 24h → `priority_bonus_multiplier *= 1.2`
- Po 48h → 1.5
- Po 5 dnech → 2.0 + zobrazený jako "URGENTNÍ" v UI
- Po 7 dnech a 0 takers → expires

> **Engineering pozn.:** ekonomický model vesnice začíná jednoduše — fixní pravděpodobnostní distribuce nad templaty. Real supply/demand model přijde post-MVP.

### Entita: `PlayerJobBoardEntry` (per-hráč state)

| Pole          | Typ        | Persist | Poznámka                                                   |
| ------------- | ---------- | ------- | ---------------------------------------------------------- |
| `player_id`   | UUID       | ✓       |                                                            |
| `task_id`     | string     | ✓       |                                                            |
| `taken_at`    | timestamp  | ✓       |                                                            |
| `progress`    | u32        | ✓       | Per-objective counter (pro multi-step tasks).              |
| `state`       | enum       | ✓       | `active` / `completed` / `abandoned`                       |

> **Stackable:** žádný cap na počet aktivních tasků v MVP (může později) — hráč si může vzít celý board, splní co stihne.

### Job board task typy v MVP

| Type             | Příklad                                           | Objective                                |
| ---------------- | ------------------------------------------------- | ---------------------------------------- |
| `deliver_items`  | "Pekař potřebuje 20× mouky"                       | Mít v inventáři + odevzdat NPC           |
| `kill_mobs`      | "Stráž potřebuje 5 vlčích kůží z Hvozdu"          | Zabít X mobů                             |
| `gather`         | "Bylinář chce 30× máty"                           | Sbírat resource (= sub-typ deliver)      |
| `repair`         | "Stará paní potřebuje opravit plot — donesnout 5× dřeva" | deliver + interaction               |
| `escort`         | (post-MVP)                                        | Doprovod NPC z A do B                    |

---

## 6. NPC worker delegation (rozhodnutí 2026-05-01)

Hráč může task delegovat NPC pracovníkovi. NPC úkol vykoná v reálném čase, hráč dostane **menší podíl** odměny.

### Entita: `PlayerNpcWorker`

```jsonc
{
  "player_id": "uuid",
  "worker_id": "worker.uuid",
  "hired_from_village": "village.blatiny",
  "hired_at": "...",
  "current_task_id": "task.uuid",
  "task_started_at": "...",
  "task_completes_at": "...",            // wall-clock real time, např. 30-60 min
  "queued_tasks": ["task.uuid", "task.uuid"],
  "wage_pct": 40                         // NPC si bere 40 %
}
```

### Mechanika

1. Hráč najímá NPC workera u příslušného NPC (např. ve vesnici je "Pomocník Lukáš" co dělá fetch tasky). Najímání = jednorázový poplatek (např. 100 d).
2. Hráč delegate active task na workera. Worker začne — `task_completes_at = now + duration`. Duration závisí na typu tasku (kill: ~60 min, gather: ~45 min, deliver: ~20 min).
3. **Hráč nemusí být online.** Worker pracuje v reálném čase.
4. Po dokončení → reward distribuce:
   - **Hráč: 60 %** denárů, **40 %** XP, 100 % reputace, **0 %** knowledge unlocks (knowledge nejdou delegovat)
   - **NPC worker: 40 %** denárů jako "wage" (gone, gold sink)
5. Hráč si můž **queueovat víc tasků** (cap např. 5) — worker je dělá sériově.

### Cap a balance

- **MVP: 1 worker per hráč.** Více workers = post-MVP.
- Worker **neumí** legendary upgrade tasks, escort tasks, ani questy. Jen běžný job board.
- Pokud hráč hraje sám = 100 % reward; pokud delegate = 60 %. Aktivní hraní se vyplatí, ale offline progress je možný.
- Worker quality (wage_pct) může škálovat s **vesnickou reputací** — Hrdina najímá levnější workery (30 % wage), Cizinec dražší (50 %).

### Entita: `WorkerCompletionLog` (audit)

```jsonc
{
  "player_id": "uuid",
  "worker_id": "uuid",
  "task_id": "task.uuid",
  "completed_at": "...",
  "rewards_given": { "currency_denar": 60, "xp": {...}, "reputation": {...} },
  "wage_paid": 40
}
```

Pro hráčovu transparentnost (co worker udělal, když byl offline).

---

## 7. Gold sinks (rozhodnutí 2026-05-01)

| Sink                                  | Velikost / frekvence | Status   |
| ------------------------------------- | -------------------- | -------- |
| NPC services (kovář ti ukoval zbraň) | per use, ~50-500 d   | MVP      |
| Knowledge unlocks od masterů          | one-shot, ~200-2000 d| MVP      |
| NPC worker hire fee                   | one-shot, ~100 d     | MVP      |
| NPC worker wage (40 % task reward)    | per task             | MVP      |
| Listing board fee (5 % sale)          | per transaction      | post-MVP |
| Cosmetic items u krejčího             | one-shot             | post-MVP |
| Bank přesun mezi vesnicemi            | (banka shared, neexistuje) | n/a |
| Reset specializace                    | (žádné specializace) | n/a      |
| Player housing rent / koupě           | one-shot + maint     | post-MVP |
| Fast travel poplatky                  | per use              | post-MVP |
| Repair zbraní (durability)            | (žádná durability)   | n/a      |

> **MVP gold sink mix je dostatečný pro 100 CCU komunitu.** Až přijde víc hráčů, potřeba více sinks (typicky housing + cosmetics + fast travel).

> **Anti-inflation moniroting:** server loguje **denně total denáry v ekonomice** (suma `currency.denar` přes všechny hráče + listings + bank). Pokud křivka roste exponenciálně → přidat sink. Pokud klesá → snížit některý sink. Implementace post-MVP.

---

## Constraints / invariants

1. **Trade atomicity:** swap items + denáry musí být atomická transakce. Když cokoli selže, rollback obou stran.
2. **Stock validation:** server vždy validuje `stock_current > 0` před nákupem od NPC.
3. **Buy limit:** server validuje `buy_limit_per_day` proti hráčovu denní counter (per NPC × per day).
4. **Listing escrow:** items na listingu jsou _vyňaty z hráčova inventáře_ — nemůžou být použity ani prodány jinde dokud je listing aktivní.
5. **Job board concurrent takers:** server validuje `current_takers < max_concurrent_takers` při pokusu vzít task.
6. **Job board fulfillment cap:** `fulfilled_count < fulfilled_max` — nelze splnit task který už dosáhl capu.
7. **Worker delegation:** validate, že hráč má active task před delegací; validate worker není busy s jiným.
8. **Worker offline progress:** server tickuje workery i když hráč offline; reward je credit-na-account, hráč ho vidí při loginu.
9. **Currency clamp:** stejné jako v 02b — max stack 1 000 000 d v inventáři.
10. **Reputation rewards:** server clampuje na `[−∞, 1000]` (reuse z 02d).

---

## Open questions / parking lot

- [ ] **Listing board UI** — post-MVP (schéma připraveno).
- [ ] **Real supply/demand model** vesnice — post-MVP.
- [ ] **Více workerů per hráč** + worker leveling — post-MVP.
- [ ] **Cosmetic items u krejčího** — post-MVP.
- [ ] **Player housing economic loop** (rent, sklady, farma) — post-MVP, s housingem.
- [ ] **Fast travel poplatky** — post-MVP.
- [ ] **Anti-inflation monitoring dashboard** — post-MVP, ale logy začneme sbírat od MVP.
- [ ] **Cross-village ekonomika** (kovář v Blatinách prodává zbraně, ale stahuje stripcomy z Černého lesa) — post-MVP.
- [ ] **Black market / pašování** (Lupičství skill využití mimo pickpocket) — post-MVP.
- [ ] **Tax collector NPC** který bere podíl ze všech transakcí ve vesnici → městský rozpočet → questy financované z rozpočtu — post-MVP, krásný organic mechanism.

---

## Změnový log

- **2026-05-01** — Draft 1, vytvořeno na základě potvrzených rozhodnutí. Sjednoceno: hospodský board JE NPC poptávkový systém (ne dva oddělené). Sdílený pool s `max_concurrent_takers`. NPC worker delegation s 60/40 split. Direct trade pro MVP, listing board schéma připraveno, UI post-MVP.
