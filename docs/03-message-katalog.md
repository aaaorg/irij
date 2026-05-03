# 03 — Message / RPC katalog

**Stav:** Draft 1 — 2026-05-02
**Účel:** Katalog všech zpráv mezi klientem a serverem. Pro každou: směr, payload, validace, broadcast cíle, frekvence.
**Sourozenci:** 02a-e Data model, 04 Tech ADR.

---

## Konvence

### Třídy zpráv

Nakama podporuje tři kanály komunikace, využíváme všechny:

| Kanál              | Použití                                                              |
| ------------------ | -------------------------------------------------------------------- |
| **RPC** (`socket.rpc`) | Akce iniciovaná klientem, request-response.                       |
| **Match Data** (`socket.sendMatchState`) | Real-time game zprávy uvnitř match handleru. Klient → server akce + server → klient broadcasts. |
| **Notifications** (`socket.notifications`) | Server → klient asynchronní eventy (achievement, system message, mail). |

**Default:** Match Data pro game-loop akce, RPC pro out-of-band (login, profile, market listing operace), Notifications pro user-perceived asynchronní eventy.

### Naming convention

- Všechny IDs **lowercase_snake_case**, anglicky
- Klient → server: imperativní (`move_request`, `attack_request`, `take_job_task`)
- Server → klient: stavová deskripce (`world_snapshot`, `entity_moved`, `combat_resolved`)
- RPC: `rpc.<doména>.<akce>` (`rpc.market.list_create`, `rpc.profile.update_settings`)

### Schéma definice

Každá zpráva má TS type v `shared/messages/`. Kód obě strany sdílí:

```typescript
// shared/messages/movement.ts
export interface MoveRequest {
  type: 'move_request';
  target: { x: number; y: number };
  client_seq: number;            // klient sekvenční číslo, pro reconciliation
}

export interface EntityMoved {
  type: 'entity_moved';
  entity_id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  speed_tps: number;
  server_tick: number;
}
```

Wire format: JSON (rozhodnutí 04 ADR-008).

### Match Data opcodes

Nakama Match Data potřebuje numerický `opcode` per zpráva. Mapping:

```typescript
export const Op = {
  // Movement (1-9)
  MOVE_REQUEST: 1,
  ENTITY_MOVED: 2,
  WORLD_SNAPSHOT: 3,
  MOVE_REJECTED: 4,

  // Combat (10-19)
  ATTACK_REQUEST: 10,
  CAST_SPELL_REQUEST: 11,
  COMBAT_RESOLVED: 12,
  ENTITY_DAMAGED: 13,
  ENTITY_DIED: 14,

  // Inventory (20-29)
  ITEM_USE_REQUEST: 20,
  ITEM_DROP_REQUEST: 21,
  EQUIP_REQUEST: 22,
  UNEQUIP_REQUEST: 23,
  INVENTORY_CHANGED: 24,
  EQUIPMENT_CHANGED: 25,
  HOLSTER_AUTOPULL: 26,

  // Interaction (30-39)
  INTERACT_NPC: 30,
  INTERACT_OBJECT: 31,
  GATHER_RESOURCE: 32,
  GATHER_PROGRESS: 33,
  GATHER_COMPLETED: 34,

  // Trade (40-49)
  TRADE_OFFER: 40,
  TRADE_UPDATE: 41,
  TRADE_ACCEPT: 42,
  TRADE_CANCEL: 43,
  TRADE_RESOLVED: 44,

  // Chat (50-59)
  CHAT_MESSAGE: 50,
  CHAT_BROADCAST: 51,

  // Quest / Job board (60-69)
  QUEST_PROGRESS: 60,
  QUEST_COMPLETED: 61,
  JOB_TASK_TAKEN: 62,
  JOB_TASK_PROGRESS: 63,
  JOB_TASK_COMPLETED: 64,
  JOB_BOARD_UPDATED: 65,

  // World / system (70-79)
  ENTITY_SPAWNED: 70,
  ENTITY_DESPAWNED: 71,
  REGIONAL_BROADCAST: 72,
  SERVER_TICK: 73,
  STATUS_EFFECT_APPLIED: 74,
  STATUS_EFFECT_EXPIRED: 75,

  // Crafting (80-89)
  CRAFT_REQUEST: 80,
  CRAFT_PROGRESS: 81,
  CRAFT_COMPLETED: 82,

  // Banking & shop (90-99)
  BANK_OPEN: 90,
  BANK_DEPOSIT: 91,
  BANK_WITHDRAW: 92,
  SHOP_OPEN: 93,
  SHOP_BUY: 94,
  SHOP_SELL: 95,

  // Worker / pickpocket (100-109)
  WORKER_HIRE: 100,
  WORKER_DELEGATE: 101,
  WORKER_RECALL: 102,
  WORKER_TASK_DONE: 103,
  PICKPOCKET_REQUEST: 104,
  PICKPOCKET_RESULT: 105,

  // Dialog (110-119)
  DIALOG_OPEN: 110,
  DIALOG_CHOOSE: 111,
  DIALOG_CLOSE: 112,
} as const;
```

Důvod numeric opcodes: Nakama API vyžaduje, plus binární optimization pokud bychom přepnuli z JSON.

---

## Auth (RPC)

### `rpc.auth.login_oidc`
**Směr:** klient → server.
**Payload:** `{ provider: 'discord' | 'google', code: string, redirect_uri: string }`.
**Response:** `{ session_token, user_id, is_new_user }`.
**Validace:** Nakama OIDC handler ověří code u providera, vyextrahuje `iss`+`sub` → mapuje na `Player.id`.

### `rpc.auth.login_email`
**Směr:** klient → server.
**Payload:** `{ email, password }`.
**Response:** `{ session_token, user_id }` nebo `{ error }`.
**Validace:** bcrypt verify, rate limit 5 attempts / 15 min / IP.

### `rpc.auth.guest_create`
**Směr:** klient → server.
**Payload:** `{ device_id }` (UUID generovaný v klientu, persisted v localStorage).
**Response:** `{ session_token, user_id }`.

### `rpc.auth.link_oidc` (post-MVP polish)
Linkuje OIDC provider k existujícímu accountu (např. guest → Discord).

### `rpc.auth.password_reset_request` / `rpc.auth.password_reset_confirm`
Standardní reset flow přes SMTP, token v emailu, expirace 1 h.

---

## Profile (RPC)

### `rpc.profile.create_character`
**Směr:** klient → server (po prvním loginu).
**Payload:** `{ username, display_name, gender, appearance: { hair_id, skin_tone_id, outfit_id } }`.
**Validace:**
- Username unikátní, regex `^[a-zA-Z0-9_]{3,16}$`
- Display name UTF-8, 3-24 chars, profanity check
- appearance values v range 0-11
**Effect:** vytvoří Player + 21 Atribut/Skill rows + default inventory + spawne ho v Blatinách.

### `rpc.profile.get_self`
**Směr:** klient → server.
**Response:** plný `Player` blob + skilly + atributy + inventory + equipment + status effects.
**Použití:** při loginu / po reconnect.

### `rpc.profile.update_settings`
**Směr:** klient → server.
**Payload:** `{ settings: { ui_layout, audio_volume, locale, ... } }`.

### `rpc.profile.change_display_name` (post-MVP — fee mechanika)
Změna `display_name`, deduct denáry, cooldown.

---

## Movement (Match Data)

### `MOVE_REQUEST` (klient → server)
**Payload:** `{ target: {x, y}, client_seq: number }`.
**Validace:**
- `target` v rozsahu walkable mask
- Cesta A* z aktuální pozice na target ≤ 64 dlaždic (anti-teleport request)
- Hráč není pod stunem / jinou movement blokací
**Effect:** server pathfindne, uloží path do match state, začne broadcastit pohyb.
**Response (implicit):** `ENTITY_MOVED` série.

### `ENTITY_MOVED` (server → klient broadcast)
**Payload:** `{ entity_id, from, to, speed_tps, server_tick }`.
**Frekvence:** 10 Hz, jen entity v zorném poli příjemce (3×3 chunky kolem).
**Klient:** interpolace, vizuální posun.

### `WORLD_SNAPSHOT` (server → klient)
**Payload:** `{ tick, entities: [{ id, type, position, hp_pct, ... }], objects, drops }`.
**Frekvence:** 1 Hz "keepalive snapshot" + on-demand při entry do nové oblasti.
**Použití:** klient resync po lag spike, post-load full state.

### `MOVE_REJECTED` (server → klient sender)
**Payload:** `{ reason: 'malformed' | 'rate_limited' | 'stunned' | 'out_of_bounds' | 'no_path' | 'too_far', client_seq: number }`.
**Doručení:** unicast (jen sender), žádný broadcast okolí.
**Reason enum:**
- `malformed` — payload nelze JSON.parse, chybí pole, špatné typy. Ochrana proti vadným klientům.
- `rate_limited` — překročen 10 req/s sliding window per userId.
- `stunned` — hráč má status effect blokující movement (4b: stub, Phase 6+ implementuje).
- `out_of_bounds` — `target.{x,y}` mimo dimenze walkable mask. Anti-cheat.
- `no_path` — target není walkable a v `NEAREST_WALKABLE_BFS_RADIUS` (8) tilů žádný walkable.
- `too_far` — A* nenajde cestu (unreachable), nebo cesta překročí `MAX_PATH_LENGTH_TILES` (64).

**Klient:** echo `client_seq` umožňuje reconciliation s lokální prediction. 4b klient jen `console.warn`; 4c použije pro snap-back na poslední server-confirmed pozici.

---

## Combat (Match Data)

### `ATTACK_REQUEST` (klient → server)
**Payload:** `{ target_id, client_seq }`.
**Validace:**
- Target existuje, není mrtvý
- Target v dosahu (`weapon.range_tiles`)
- Hráč není v cooldownu (`now - last_attack >= attack_speed_ticks * 100ms`)
- Hráč má holster naplněný pokud weapon vyžaduje (ranged/magic), nebo melee bez bonusu
- Hráč není stunlocked
- Pokud target je friendly NPC, kontroluj `attackable: true`

### `CAST_SPELL_REQUEST` (klient → server)
**Payload:** `{ spell_id, target_id | target_position, client_seq }`.
**Validace:** weapon = magic, holster = rune tier ≥ spell tier, mana / cooldown OK, level req splněn.

### `COMBAT_RESOLVED` (server → broadcast)
**Payload:** `{ attacker_id, target_id, damage, hit_type: 'normal' | 'critical' | 'miss' | 'block', remaining_hp }`.
**Broadcast scope:** všichni v zorném poli attackera + targetu.

### `ENTITY_DAMAGED` (server → klient targeta + okolí)
**Payload:** `{ entity_id, damage, current_hp, source_id }`.
**Použití:** floating damage text, HP bar update.

### `ENTITY_DIED` (server → broadcast)
**Payload:** `{ entity_id, killer_id, drops: [...] | null, xp_awarded: { skill, amount }[] }`.
**Effect:** klient přehraje death animaci, dropy se objeví na zemi.

---

## Inventory & Equipment (Match Data)

### `ITEM_USE_REQUEST` (klient → server)
**Payload:** `{ slot_index, action: 'consume' | 'examine' | 'drop' }`.
**Validace:**
- Slot existuje a není prázdný
- Item je consumable pokud action = consume
- Hráč není v boji (pro některé item types — TBD)

### `EQUIP_REQUEST` / `UNEQUIP_REQUEST`
**Payload:** `{ source_slot_index, target_equipment_slot }`.
**Validace:**
- Item kategorie matches `target_equipment_slot`
- Level requirements splněny (`player.skill[name] ≥ level_req[name]`)
- 2H weapon ↔ shield mutex
- Holster: weapon_class match

### `INVENTORY_CHANGED` (server → klient)
**Payload:** `{ changes: [{ slot_index, item_id?, quantity? }, ...] }`.
**Důvod:** delta-based update, ne full inventory broadcast.

### `EQUIPMENT_CHANGED` (server → klient + okolí)
**Payload:** `{ player_id, slot, item_id }`.
**Broadcast:** vlastník + okolní hráči (vidí změnu vizuálu postavy).

### `HOLSTER_AUTOPULL` (server → klient)
**Payload:** `{ from_inventory_slot, to_holster, item_id, quantity }`.
**Použití:** transparentní notifikace, klient updatuje UI counter. Bez popupu.

---

## Interakce (Match Data)

### `INTERACT_NPC` (klient → server)
**Payload:** `{ npc_id, action: 'talk' | 'shop' | 'bank' | 'worker' | 'pickpocket' }`.
**Validace:**
- NPC v dosahu (≤ 2 dlaždice)
- NPC má příslušný flag (`talkable`, `merchant`, `banker`, ...)

### `INTERACT_OBJECT` (klient → server)
**Payload:** `{ object_id | position, action }`.
**Použití:** truhla v hospodě (banka), oltář v chrámu, dveře, knihy.

### `GATHER_RESOURCE` (klient → server)
**Payload:** `{ resource_node_id }`.
**Validace:**
- Node v dosahu
- `current_state == 'available'`
- Hráč má `tool_required` v inventáři / equipped
- `skill_level ≥ tier_required`

### `GATHER_PROGRESS` (server → klient)
**Payload:** `{ node_id, progress_pct, eta_ms }`.
**Frekvence:** během gather animace, každých 500 ms.

### `GATHER_COMPLETED` (server → klient)
**Payload:** `{ node_id, items_received: [...], xp_awarded: {...} }`.

---

## Crafting (Match Data)

### `CRAFT_REQUEST` (klient → server)
**Payload:** `{ recipe_id, quantity }`.
**Validace:**
- Recipe known (`PlayerKnowledge` pokud `unlock_required`)
- Skilly + levely splněny
- Inputy v inventáři
- Tool v inventáři / equipped
- Station v dosahu

### `CRAFT_PROGRESS` (server → klient)
**Payload:** `{ progress_pct, eta_ms }`.

### `CRAFT_COMPLETED` (server → klient)
**Payload:** `{ outputs: [...], xp_awarded: {...}, fail: bool }` (fail = inputy ztraceny, output není).

---

## Trade (Match Data)

### `TRADE_OFFER` (klient → server)
Iniciuje trade s jiným hráčem.
**Payload:** `{ target_player_id }`.
**Validace:** target v dosahu (≤ 3 dlaždice), oba nejsou v boji, target nemá pending trade.
**Effect:** server vytvoří `TradeSession`, oba hráči dostanou notifikaci s otevřením trade UI.

### `TRADE_UPDATE` (klient → server)
Hráč mění svou nabídku.
**Payload:** `{ trade_id, offer_items: [...], offer_currency }`.
**Effect:** server validuje vlastnictví items + denárů, broadcastne update druhé straně, zruší případné `accepted` flagy.

### `TRADE_ACCEPT` (klient → server)
**Payload:** `{ trade_id }`.
**Effect:** flag `accepted_a` nebo `_b`. Když oba accepted → server provede atomický swap (viz 02e).

### `TRADE_CANCEL` (klient → server)
Zruší trade.

### `TRADE_RESOLVED` (server → oba hráči)
**Payload:** `{ trade_id, success: bool, error?: string }`.

---

## Chat (Match Data)

### `CHAT_MESSAGE` (klient → server)
**Payload:** `{ channel: 'local' | 'global' | 'trade' | 'whisper', text, target?: 'player_id' }`.
**Validace:**
- Text length ≤ 200 chars
- Profanity filter (per-locale dict)
- Rate limit: 5 zpráv / 10 s
- Whisper target online

### `CHAT_BROADCAST` (server → klient)
**Payload:** `{ channel, sender_id, sender_display_name, text, server_time }`.
**Broadcast scope:**
- `local`: hráči v ~15 dlaždicích kolem sendera
- `global`: všichni v match
- `trade`: subscribed na trade channel
- `whisper`: jen target

### `REGIONAL_BROADCAST` (server → klient)
**Payload:** `{ region: 'bazina_cernav', message_id: 'polednice_spawned', text }`.
**Broadcast scope:** všichni hráči v daném regionu.
**Použití:** scheduled mob spawn, world events.

---

## Dialog (Match Data)

### `DIALOG_OPEN` (klient → server, nebo server → klient pokud quest auto-trigger)
**Payload:** `{ npc_id }` nebo `{ dialog_id }`.
**Effect:** server načte dialog tree, vyfiltruje options podle knowledge / quest state / reputation, pošle root node.

### Server → klient dialog node
**Payload:** `{ dialog_id, node_id, speaker_npc_id, text, options: [{ id, text, available: bool }] }`.

### `DIALOG_CHOOSE` (klient → server)
**Payload:** `{ dialog_id, node_id, option_id }`.
**Validace:** option je `available: true`.
**Effect:** server aplikuje effects (start_quest, give_item, change_reputation, ...), pošle next node nebo close.

### `DIALOG_CLOSE` (klient → server)
Hráč zavřel dialog UI.

---

## Quest (Match Data + RPC)

### `QUEST_PROGRESS` (server → klient)
**Payload:** `{ quest_id, step_id, progress_delta, current_progress }`.
**Trigger:** automaticky při akci splňující quest objective.

### `QUEST_COMPLETED` (server → klient)
**Payload:** `{ quest_id, rewards: { xp, items, currency, knowledge, reputation } }`.

### `rpc.quest.list_active` (klient → server)
Klient si fetchne aktivní questy (např. po loginu).
**Response:** `[ PlayerQuest, ... ]`.

### `rpc.quest.abandon`
Hráč opouští quest.

---

## Job board (Match Data + RPC)

### `rpc.job_board.list` (klient → server)
**Payload:** `{ village_id }`.
**Response:** `[ JobBoardTask ]` se stávajícím `current_takers`, `priority_bonus_multiplier`.

### `JOB_TASK_TAKEN` (klient → server)
**Payload:** `{ task_id }`.
**Validace:** `current_takers < max_concurrent_takers`.

### `JOB_TASK_PROGRESS` (server → klient)
**Payload:** `{ task_id, progress, target }`.

### `JOB_TASK_COMPLETED` (server → klient)
**Payload:** `{ task_id, rewards }`.

### `JOB_BOARD_UPDATED` (server → klient broadcast vesnice)
**Payload:** `{ village_id, added: [task], removed: [task_id], changed: [{...}] }`.
**Frekvence:** při generování nových / vyplnění starých tasků.

---

## Worker / Pickpocket (Match Data + RPC)

### `rpc.worker.hire` (klient → server)
**Payload:** `{ village_id }`.
**Validace:** dostatek denárů, ještě nemá workera.
**Effect:** vytvoří `PlayerNpcWorker` row, deduct fee.

### `rpc.worker.delegate`
**Payload:** `{ task_id }`.
**Validace:** task je v active state hráče, worker není busy.

### `rpc.worker.recall`
Stáhne workera z aktuálního tasku, žádný reward.

### `WORKER_TASK_DONE` (server → klient, async)
**Payload:** `{ worker_id, task_id, rewards_given, wage_paid }`.
**Doručení:** Notifications channel pokud hráč offline → dostane při příštím loginu.

### `PICKPOCKET_REQUEST` (klient → server)
**Payload:** `{ npc_id }`.
**Validace:** NPC `pickpocketable: true`, v dosahu.

### `PICKPOCKET_RESULT` (server → klient)
**Payload:** `{ success: bool, items_received?: [...], xp_awarded?, reputation_delta }`.

---

## Banking & Shopping (Match Data + RPC)

### `BANK_OPEN` / `BANK_DEPOSIT` / `BANK_WITHDRAW`
**Payload:** open: `{ access_point_id }`, deposit/withdraw: `{ item_id, quantity }`.
**Validace:** access point v dosahu, source/target slot exists.

### `SHOP_OPEN` (klient → server)
**Payload:** `{ npc_id }`.
**Response:** `MerchantTable` snapshot (sell items, buy items, current stock).

### `SHOP_BUY` / `SHOP_SELL`
**Payload:** `{ npc_id, item_id, quantity }`.
**Validace:**
- Buy: stock_current ≥ quantity, hráč má denáry
- Sell: hráč má item v inventáři, NPC kupuje tuto kategorii, buy_limit_per_day not exceeded
**Effect:** atomická transakce (item ↔ denáry).

---

## Market listing (post-MVP, schéma připraveno)

### `rpc.market.list_create` (post-MVP)
**Payload:** `{ village_id, item_id, quantity, ask_price_denar }`.

### `rpc.market.list_search`
**Payload:** `{ village_id, category?, max_price?, sort? }`.

### `rpc.market.list_buy`
**Payload:** `{ listing_id, quantity? }`.

### `rpc.market.list_cancel`
**Payload:** `{ listing_id }`.

---

## Status effects (Match Data)

### `STATUS_EFFECT_APPLIED` (server → klient)
**Payload:** `{ entity_id, effect_id, magnitude, duration_s, expires_at }`.
**Použití:** debuff/buff icon nad postavou + timer v UI.

### `STATUS_EFFECT_EXPIRED` (server → klient)
**Payload:** `{ entity_id, effect_id }`.

---

## System & lifecycle (Match Data + Notifications)

### `ENTITY_SPAWNED` / `ENTITY_DESPAWNED` (server → klient broadcast)
Mob spawne / despawne, hráč se přihlásí / odhlásí, drop se objeví / zmizí.

### `SERVER_TICK` (server → klient, throttled)
**Payload:** `{ tick, server_time_ms }`.
**Frekvence:** 1 Hz.
**Použití:** klient sync s server clock pro animace, status timers.

### Notifications
Nakama Notifications channel pro out-of-match eventy:
- Worker task completed (offline)
- Quest unlocked (po splnění prerequisites)
- Friend přihlášen (post-MVP)
- System message (maintenance, ban, ...)
- Mail (post-MVP)

---

## Rate limiting per zpráva

Server middleware vynucuje per-player rate limity:

| Zpráva                     | Limit                   |
| -------------------------- | ----------------------- |
| `MOVE_REQUEST`             | 10 / s                  |
| `ATTACK_REQUEST`           | 4 / s (combat tick max) |
| `CAST_SPELL_REQUEST`       | 4 / s                   |
| `CHAT_MESSAGE`             | 5 / 10 s                |
| `INTERACT_NPC`             | 5 / s                   |
| `EQUIP_REQUEST` / `UNEQUIP`| 5 / s                   |
| `ITEM_USE_REQUEST`         | 5 / s                   |
| `TRADE_OFFER`              | 1 / 30 s (anti-spam)    |
| `PICKPOCKET_REQUEST`       | 1 / 5 s                 |
| `rpc.auth.login_*`         | 5 / 15 min / IP         |
| `rpc.market.list_*`        | 10 / min                |
| Catch-all RPC              | 30 / min                |

Překročení = drop message + audit log entry. Opakované překročení = temp ban (post-MVP).

---

## Constraints / invariants

1. **Server is authoritative.** Klient nikdy neaplikuje vlastní effekt akce dokud server nepotvrdí.
2. **Client_seq pro reconciliation.** Klient maže lokální prediction až na základě server ack.
3. **Idempotence:** RPC volání by měly být safe-to-retry. Server eviduje recent client_seq per player + drop duplicates.
4. **Validace na vstupu:** každý server-side handler VALIDUJE všechny pole, klient nikdy netrustujeme.
5. **Broadcast scope minimum:** posíláme jen entity v zorném poli. Žádný "broadcast all" výjimka pro `REGIONAL_BROADCAST`.
6. **Audit log:** kritické akce (combat kill, trade complete, big XP, knowledge unlock, currency >1000 transfer) jdou do Postgres audit_log.
7. **Schema versioning:** každá message má `schema_version` field (default 1), pro rolling upgrades.
8. **Backward compat:** breaking changes ve schématu vyžadují klient/server lockstep deploy nebo dual-handler grace period.

---

## MVP cutoff

V MVP implementujeme všechny zprávy označené v tomto dokumentu, **kromě**:
- Market listing (parking)
- Quest abandon (parking, předpokládáme commit)
- Mail / friends notifications (post-MVP)
- Account linking RPCs (post-MVP polish)

Celkem v MVP: **~45 zpráv**. Spolu s ~20 RPCs.

---

## Open questions / parking lot

- [ ] Approval mechanika pro některé RPCs (např. trade s vysokou hodnotou — confirmation step?)
- [ ] Compression: Nakama umí gzip per-message, zapneme kdyby bandwidth bottleneck.
- [ ] Replay log: posílat do Postgres pro deterministický replay (post-MVP debugging tool).
- [ ] Spectator mode messages (post-MVP).
- [ ] Anti-cheat heuristics (impossible movement patterns, statistical outlier detection).

---

## Změnový log

- **2026-05-02** — Draft 1, vytvořeno na základě kompletního data modelu (02a-e) a tech ADR (04). 45+ zpráv strukturovaných do 12 domén, opcode mapping, rate limiting tabulka.
