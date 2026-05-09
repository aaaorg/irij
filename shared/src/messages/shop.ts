// Shop messages — viz docs/03-message-katalog.md sekce Banking & Shopping.
// Wire format: JSON. Opcodes 93-95 v opcodes.ts.

import type { DialogText } from '../types/npc.js';
import type { MerchantTableType } from '../types/shop.js';

// ── Klient → server ─────────────────────────────────────────────────────────

// Op.SHOP_OPEN (93) — explicit klient request. V MVP ji posílá dialog effect
// `open_shop` (server otevře unicast bez čekání na klient request) NEBO
// přímý INTERACT_NPC s action='shop' (post-MVP). Pro MVP klient nikdy
// neposílá tuto zprávu — server je iniciátor přes dialog effect.
// Necháváme typovou definici pro symetrii s docs.
export interface ShopOpenRequest {
  npc_id: string;
}

// Op.SHOP_BUY (94) — klient → server. Hráč chce koupit `quantity` kusů
// `item_id` od NPC `npc_id`. Server validuje:
//   - hráč je v range
//   - merchant table existuje a má stock ≥ quantity
//   - hráč má denáry ≥ sell_price * quantity
//   - hráč má volné slot/stack space
// Atomic: stock-- + denáry-- + item++ (přes OCC retry na PLAYER_INVENTORY).
export interface ShopBuyRequest {
  npc_id: string;
  item_id: string;
  quantity: number;
}

// Op.SHOP_SELL (95) — klient → server. Hráč prodává.
// Validace:
//   - range
//   - NPC kupuje tuto kategorii (buy_items obsahuje item_id)
//   - buy_consumed_today + quantity ≤ buy_limit_per_day
//   - hráč má item v inventáři ≥ quantity
// Atomic: item-- + denáry++ (přes OCC retry).
export interface ShopSellRequest {
  npc_id: string;
  item_id: string;
  quantity: number;
}

// ── Server → klient ─────────────────────────────────────────────────────────

// Per-table sell entry view — runtime stock_current + (mediator) static
// definice price + max + respawn rate.
export interface ShopSellEntryView {
  item_id: string;
  display_name_cs: string;
  sell_price_denar: number;
  stock_current: number;
  stock_max: number;
}

export interface ShopBuyEntryView {
  item_id: string;
  display_name_cs: string;
  buy_price_denar: number;
  buy_limit_per_day: number;
  buy_consumed_today: number;
}

// Op.SHOP_OPEN (93) — server → klient unicast. Snapshot merchant table.
// Klient zobrazí ShopPanel.
export interface ShopOpen {
  npc_id: string;
  npc_display_name_cs: string;
  table_id: string;
  table_type: MerchantTableType;
  sell_items: ShopSellEntryView[];
  buy_items: ShopBuyEntryView[];
  // Title pro UI (lokalizovaný). Default: "Obchod u <npc_name>".
  title: DialogText;
}

// Reuse: server posílá ShopOpen i jako "updated" snapshot po každém
// SHOP_BUY / SHOP_SELL — klient pře-renderuje stock + buy_consumed.
// To zjednodušuje protokol vs. inkrementální patches a pro 1 hráče v
// obchodě je to levný overhead.

export type ShopRejectAction = 'buy' | 'sell' | 'open';
export type ShopRejectReason =
  | 'unknown_table'
  | 'unknown_item'
  | 'out_of_range'
  | 'not_for_sale'
  | 'not_buying'
  | 'out_of_stock'
  | 'inventory_full'
  | 'inventory_short'
  | 'insufficient_funds'
  | 'buy_limit_reached'
  | 'rate_limited'
  | 'invalid_quantity';

// Server → klient unicast když buy/sell selže. Klient mapuje na český toast.
// Sdílí pattern s JOB_TASK_REJECTED — žádný silent fail.
//
// Reusing opcode space: SHOP_REJECTED nepřidáváme jako separate opcode —
// pro symetrii s job board ho dodáváme přes existující SHOP_OPEN payload?
// Ne, lepší vlastní opcode. Vyhradíme 96 = SHOP_REJECTED (v Banking & shop
// rozsahu 90-99).
export interface ShopRejected {
  action: ShopRejectAction;
  reason: ShopRejectReason;
  item_id?: string;
  detail?: { need?: number; have?: number };
}
