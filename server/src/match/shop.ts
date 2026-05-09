// Phase 13: NPC merchant — shop handlers.
//
// Server posílá SHOP_OPEN unicast po dialog effectu `open_shop` (server je
// iniciátor — klient nikdy neposílá SHOP_OPEN_REQUEST v MVP). Hráč pak posílá
// SHOP_BUY / SHOP_SELL; server validuje range, stock, denáry, daily limit
// a atomicky aplikuje přes OCC retry na PLAYER_INVENTORY.
//
// Stock respawn: každých SHOP_STOCK_RESPAWN_INTERVAL master ticků (15 min)
// se proporcionálně dopočítá `respawn_per_hour` na všech tabulkách. Buy
// limity se resetují každý den 00:00 UTC (lazy: při handleru, pokud
// buy_limit_reset_date != today, vyčistíme).
//
// Per docs/02e sekce 1: pevné ceny, omezený stock, specialist vs general.
// MVP: žádný `general` magic — buy_items je explicitní whitelist v každé
// tabulce. Specialist Kovář má lepší ceny (18 d za iron ore vs 10 d u Selky).

import { SHOP_STOCK_RESPAWN_INTERVAL, STORAGE_COLLECTIONS, TICK_HZ } from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type {
  InventoryChanged,
  ShopBuyRequest,
  ShopBuyEntryView,
  ShopOpen,
  ShopRejectAction,
  ShopRejectReason,
  ShopRejected,
  ShopSellEntryView,
  ShopSellRequest,
} from 'irij-shared/messages';
import { asPlayerInventory } from 'irij-shared/types';
import type {
  MerchantTableDefinition,
  MerchantTableState,
  PlayerInventoryBlob,
} from 'irij-shared/types';
import { int, obj, parse, str } from 'irij-shared';

import { logAudit } from '../lib/audit.js';
import { getItemDef } from '../lib/items.js';
import { log } from '../lib/log.js';
import {
  getAllMerchantTables,
  getMerchantTableDef,
  getMerchantTableForNpc,
} from '../lib/merchants.js';
import { withOCCRetry } from '../lib/storage.js';
import { checkRateLimit, RATE_LIMIT_WINDOW_MS } from './movement.js';
import type { WorldMatchState } from './state.js';

// ── Constants ────────────────────────────────────────────────────────────────

const SHOP_RATE_LIMIT_MAX = 5;
const NPC_RANGE_TILES = 2;
const MAX_TX_QUANTITY = 1000; // anti-grief — žádný 2^31 buy crash

// ── Schema validators ────────────────────────────────────────────────────────

const ShopBuyRequestSchema = obj({
  npc_id: str().min(1).max(64),
  item_id: str().min(1).max(64),
  quantity: int().min(1).max(MAX_TX_QUANTITY),
});

const ShopSellRequestSchema = obj({
  npc_id: str().min(1).max(64),
  item_id: str().min(1).max(64),
  quantity: int().min(1).max(MAX_TX_QUANTITY),
});

export function parseShopBuyRequest(raw: unknown): ShopBuyRequest | null {
  const r = parse(ShopBuyRequestSchema, raw);
  return r.ok ? (r.value as ShopBuyRequest) : null;
}

export function parseShopSellRequest(raw: unknown): ShopSellRequest | null {
  const r = parse(ShopSellRequestSchema, raw);
  return r.ok ? (r.value as ShopSellRequest) : null;
}

// ── State init ──────────────────────────────────────────────────────────────

function todayUtc(): string {
  const d = new Date();
  // YYYY-MM-DD UTC
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function seedMerchantTables(state: WorldMatchState): void {
  const merchantStates: { [tableId: string]: MerchantTableState } = {};
  for (const def of getAllMerchantTables()) {
    const stockCurrent: { [itemId: string]: number } = {};
    const stockPartial: { [itemId: string]: number } = {};
    for (const entry of def.sell_items) {
      stockCurrent[entry.item_id] = entry.stock_max;
      stockPartial[entry.item_id] = 0;
    }
    merchantStates[def.id] = {
      table_id: def.id,
      stock_current: stockCurrent,
      stock_partial: stockPartial,
      buy_consumed_today: {},
      buy_limit_reset_date: todayUtc(),
      last_respawn_tick: 0,
    };
  }
  state.merchantStates = merchantStates;
}

// ── Reject helper ───────────────────────────────────────────────────────────

export function sendShopRejected(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  action: ShopRejectAction,
  reason: ShopRejectReason,
  itemId?: string,
  detail?: ShopRejected['detail'],
): void {
  const payload: ShopRejected = { action, reason };
  if (itemId) payload.item_id = itemId;
  if (detail) payload.detail = detail;
  dispatcher.broadcastMessage(Op.SHOP_REJECTED, JSON.stringify(payload), [presence]);
}

// ── Stock respawn ───────────────────────────────────────────────────────────

// Volá se z matchLoop každých SHOP_STOCK_RESPAWN_INTERVAL ticků.
// Pure-ish: mutuje state.merchantStates přes spread, nedělá žádný I/O.
export function runShopStockRespawn(state: WorldMatchState, tick: number): void {
  const next: { [tableId: string]: MerchantTableState } = { ...state.merchantStates };
  let mutated = false;

  for (const tableId of Object.keys(next)) {
    const def = getMerchantTableDef(tableId);
    if (!def) continue;
    const cur = next[tableId];
    if (!cur) continue;

    const ticksElapsed = tick - cur.last_respawn_tick;
    if (ticksElapsed <= 0) continue;
    const hoursElapsed = ticksElapsed / (TICK_HZ * 3600);

    const stockCurrent = { ...cur.stock_current };
    const stockPartial = { ...cur.stock_partial };

    for (const entry of def.sell_items) {
      const have = stockCurrent[entry.item_id] ?? 0;
      if (have >= entry.stock_max) continue;
      const partial = (stockPartial[entry.item_id] ?? 0) + entry.respawn_per_hour * hoursElapsed;
      const wholeAdded = Math.floor(partial);
      const remainder = partial - wholeAdded;
      const newHave = Math.min(entry.stock_max, have + wholeAdded);
      stockCurrent[entry.item_id] = newHave;
      stockPartial[entry.item_id] = newHave >= entry.stock_max ? 0 : remainder;
    }

    next[tableId] = {
      ...cur,
      stock_current: stockCurrent,
      stock_partial: stockPartial,
      last_respawn_tick: tick,
    };
    mutated = true;
  }

  if (mutated) state.merchantStates = next;
}

// Buy limit reset — lazy, called z handleru. Pokud datum se liší od dnešního,
// vyčistí buy_consumed_today a updatuje reset date.
function ensureBuyLimitReset(state: WorldMatchState, tableId: string): void {
  const cur = state.merchantStates[tableId];
  if (!cur) return;
  const today = todayUtc();
  if (cur.buy_limit_reset_date === today) return;
  state.merchantStates = {
    ...state.merchantStates,
    [tableId]: {
      ...cur,
      buy_consumed_today: {},
      buy_limit_reset_date: today,
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function npcInRange(
  state: WorldMatchState,
  userId: string,
  npcInstanceId: string,
): { ok: true; npcDefId: string; npcDisplayName: string } | { ok: false } {
  const ps = state.presencesByUserId[userId];
  if (!ps) return { ok: false };
  const npc = state.npcInstances[npcInstanceId];
  if (!npc) return { ok: false };
  if (chebyshev(ps.position, npc.position) > NPC_RANGE_TILES) return { ok: false };
  const def = state.npcDefinitions[npc.npcId];
  if (!def) return { ok: false };
  return { ok: true, npcDefId: def.id, npcDisplayName: def.display_name_cs };
}

function buildShopOpenPayload(
  state: WorldMatchState,
  npcInstanceId: string,
  npcDisplayName: string,
  def: MerchantTableDefinition,
): ShopOpen {
  const cur = state.merchantStates[def.id];
  const sellItems: ShopSellEntryView[] = [];
  for (const entry of def.sell_items) {
    const itemDef = getItemDef(entry.item_id);
    sellItems.push({
      item_id: entry.item_id,
      display_name_cs: itemDef?.name_cs ?? entry.item_id,
      sell_price_denar: entry.sell_price_denar,
      stock_current: cur?.stock_current[entry.item_id] ?? 0,
      stock_max: entry.stock_max,
    });
  }
  const buyItems: ShopBuyEntryView[] = [];
  for (const entry of def.buy_items) {
    const itemDef = getItemDef(entry.item_id);
    buyItems.push({
      item_id: entry.item_id,
      display_name_cs: itemDef?.name_cs ?? entry.item_id,
      buy_price_denar: entry.buy_price_denar,
      buy_limit_per_day: entry.buy_limit_per_day,
      buy_consumed_today: cur?.buy_consumed_today[entry.item_id] ?? 0,
    });
  }
  return {
    npc_id: npcInstanceId,
    npc_display_name_cs: npcDisplayName,
    table_id: def.id,
    table_type: def.type,
    sell_items: sellItems,
    buy_items: buyItems,
    title: {
      cs: `Obchod — ${npcDisplayName}`,
      en: `Shop — ${npcDisplayName}`,
    },
  };
}

// ── Open (volá se z dialog effectu open_shop) ───────────────────────────────

export function sendShopOpen(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  npcInstanceId: string,
  merchantTableId: string,
): void {
  const def = getMerchantTableDef(merchantTableId);
  if (!def) {
    sendShopRejected(dispatcher, presence, 'open', 'unknown_table');
    return;
  }
  ensureBuyLimitReset(state, merchantTableId);
  const npc = state.npcInstances[npcInstanceId];
  const displayName = npc
    ? state.npcDefinitions[npc.npcId]?.display_name_cs ?? npcInstanceId
    : npcInstanceId;
  const payload = buildShopOpenPayload(state, npcInstanceId, displayName, def);
  dispatcher.broadcastMessage(Op.SHOP_OPEN, JSON.stringify(payload), [presence]);
}

// ── BUY (Op 94) ──────────────────────────────────────────────────────────────

export function handleShopBuy(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  _tick: number,
): void {
  const userId = presence.userId;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }
  const req = parseShopBuyRequest(parsed);
  if (!req) return;

  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, SHOP_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) {
    sendShopRejected(dispatcher, presence, 'buy', 'rate_limited', req.item_id);
    return;
  }

  const range = npcInRange(state, userId, req.npc_id);
  if (!range.ok) {
    sendShopRejected(dispatcher, presence, 'buy', 'out_of_range', req.item_id);
    return;
  }

  const tableDef = getMerchantTableForNpc(range.npcDefId);
  if (!tableDef) {
    sendShopRejected(dispatcher, presence, 'buy', 'unknown_table', req.item_id);
    return;
  }
  const sellEntry = tableDef.sell_items.find((e) => e.item_id === req.item_id);
  if (!sellEntry) {
    sendShopRejected(dispatcher, presence, 'buy', 'not_for_sale', req.item_id);
    return;
  }

  const itemDef = getItemDef(req.item_id);
  if (!itemDef) {
    sendShopRejected(dispatcher, presence, 'buy', 'unknown_item', req.item_id);
    return;
  }

  const tableState = state.merchantStates[tableDef.id];
  if (!tableState) {
    sendShopRejected(dispatcher, presence, 'buy', 'unknown_table', req.item_id);
    return;
  }
  const haveStock = tableState.stock_current[req.item_id] ?? 0;
  if (haveStock < req.quantity) {
    sendShopRejected(dispatcher, presence, 'buy', 'out_of_stock', req.item_id, {
      need: req.quantity,
      have: haveStock,
    });
    return;
  }

  const totalCost = sellEntry.sell_price_denar * req.quantity;

  // Atomic OCC: spočti currency, místo, deduct denáry, přidej item.
  let purchased = false;
  let inventoryChanges: InventoryChanged['changes'] = [];

  try {
    withOCCRetry<PlayerInventoryBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      userId,
      userId,
      (current) => {
        const blob = asPlayerInventory(current) ?? (current as PlayerInventoryBlob);
        const before = blob.inventory.map((s) => ({ ...s }));
        const inventory = blob.inventory.map((s) => ({ ...s }));

        // 1) zjistíme dostupné denáry
        let denarHave = 0;
        for (const slot of inventory) {
          if (slot.item_id === 'currency.denar') denarHave += slot.quantity;
        }
        if (denarHave < totalCost) {
          purchased = false;
          return blob;
        }

        // 2) ověříme, že přidáme item — simulujeme add a sledujeme remaining
        const maxStack = itemDef.stackable ? itemDef.max_stack ?? 1 : 1;
        let remaining = req.quantity;
        if (itemDef.stackable) {
          for (const slot of inventory) {
            if (remaining <= 0) break;
            if (slot.item_id !== req.item_id) continue;
            const space = maxStack - slot.quantity;
            if (space <= 0) continue;
            const take = Math.min(space, remaining);
            slot.quantity += take;
            remaining -= take;
          }
        }
        if (remaining > 0) {
          for (const slot of inventory) {
            if (remaining <= 0) break;
            if (slot.item_id !== null) continue;
            const take = Math.min(maxStack, remaining);
            slot.item_id = req.item_id;
            slot.quantity = take;
            remaining -= take;
          }
        }
        if (remaining > 0) {
          // Inventory full — odmítneme transakci (žádný drop on ground při buy).
          purchased = false;
          return blob;
        }

        // 3) deduct denáry
        let toDeduct = totalCost;
        for (const slot of inventory) {
          if (toDeduct <= 0) break;
          if (slot.item_id !== 'currency.denar') continue;
          const take = Math.min(slot.quantity, toDeduct);
          slot.quantity -= take;
          toDeduct -= take;
          if (slot.quantity <= 0) {
            slot.item_id = null;
            slot.quantity = 0;
          }
        }
        if (toDeduct > 0) {
          purchased = false;
          return blob;
        }

        purchased = true;
        // changes diff
        for (let i = 0; i < inventory.length; i++) {
          const a = inventory[i];
          const b = before[i];
          if (!a || !b) continue;
          if (a.item_id !== b.item_id || a.quantity !== b.quantity) {
            inventoryChanges.push({ slot_index: i, item_id: a.item_id, quantity: a.quantity });
          }
        }
        return { ...blob, inventory };
      },
    );
  } catch (err) {
    log(logger, 'error', 'shop buy OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    sendShopRejected(dispatcher, presence, 'buy', 'inventory_full', req.item_id);
    return;
  }

  if (!purchased) {
    // Ztrátový důvod — nevíme přesně (insufficient_funds vs full inventory).
    // Detekce: re-fetch a porovnání. Pro UX stačí jeden rejection — spočti
    // primární důvod.
    const reason: ShopRejectReason = inferBuyFailReason(nk, userId, itemDef, req.quantity, totalCost);
    sendShopRejected(dispatcher, presence, 'buy', reason, req.item_id);
    return;
  }

  // Update stock.
  const updatedStock = { ...tableState.stock_current };
  updatedStock[req.item_id] = haveStock - req.quantity;
  state.merchantStates = {
    ...state.merchantStates,
    [tableDef.id]: { ...tableState, stock_current: updatedStock },
  };

  if (inventoryChanges.length > 0) {
    const msg: InventoryChanged = { changes: inventoryChanges };
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify(msg), [presence]);
  }

  logAudit(nk, 'shop_buy', {
    userId,
    payload: {
      table_id: tableDef.id,
      item_id: req.item_id,
      quantity: req.quantity,
      total_cost: totalCost,
    },
  });

  log(logger, 'info', 'shop buy ok', {
    userId: userId.slice(0, 8),
    tableId: tableDef.id,
    itemId: req.item_id,
    quantity: req.quantity,
    cost: totalCost,
  });

  // Re-send shop open snapshot — klient pře-renderuje stock + buy limit.
  sendShopOpen(state, dispatcher, presence, req.npc_id, tableDef.id);
}

function inferBuyFailReason(
  nk: nkruntime.Nakama,
  userId: string,
  itemDef: { stackable?: boolean; max_stack?: number; id: string },
  quantity: number,
  totalCost: number,
): ShopRejectReason {
  try {
    const reads = nk.storageRead([
      { collection: STORAGE_COLLECTIONS.PLAYER_INVENTORY, key: userId, userId },
    ]);
    const obj = reads[0];
    if (!obj || !obj.value) return 'insufficient_funds';
    const blob = asPlayerInventory(obj.value) ?? (obj.value as PlayerInventoryBlob);
    let denar = 0;
    for (const slot of blob.inventory) {
      if (slot.item_id === 'currency.denar') denar += slot.quantity;
    }
    if (denar < totalCost) return 'insufficient_funds';

    const maxStack = itemDef.stackable ? itemDef.max_stack ?? 1 : 1;
    let canAdd = 0;
    for (const slot of blob.inventory) {
      if (slot.item_id === null) canAdd += maxStack;
      else if (itemDef.stackable && slot.item_id === itemDef.id) {
        canAdd += Math.max(0, maxStack - slot.quantity);
      }
    }
    if (canAdd < quantity) return 'inventory_full';
    return 'insufficient_funds';
  } catch {
    return 'insufficient_funds';
  }
}

// ── SELL (Op 95) ─────────────────────────────────────────────────────────────

export function handleShopSell(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  _tick: number,
): void {
  const userId = presence.userId;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }
  const req = parseShopSellRequest(parsed);
  if (!req) return;

  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, SHOP_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) {
    sendShopRejected(dispatcher, presence, 'sell', 'rate_limited', req.item_id);
    return;
  }

  const range = npcInRange(state, userId, req.npc_id);
  if (!range.ok) {
    sendShopRejected(dispatcher, presence, 'sell', 'out_of_range', req.item_id);
    return;
  }

  const tableDef = getMerchantTableForNpc(range.npcDefId);
  if (!tableDef) {
    sendShopRejected(dispatcher, presence, 'sell', 'unknown_table', req.item_id);
    return;
  }
  const buyEntry = tableDef.buy_items.find((e) => e.item_id === req.item_id);
  if (!buyEntry) {
    sendShopRejected(dispatcher, presence, 'sell', 'not_buying', req.item_id);
    return;
  }

  const itemDef = getItemDef(req.item_id);
  if (!itemDef) {
    sendShopRejected(dispatcher, presence, 'sell', 'unknown_item', req.item_id);
    return;
  }

  ensureBuyLimitReset(state, tableDef.id);
  const tableState = state.merchantStates[tableDef.id];
  if (!tableState) {
    sendShopRejected(dispatcher, presence, 'sell', 'unknown_table', req.item_id);
    return;
  }

  const consumed = tableState.buy_consumed_today[req.item_id] ?? 0;
  if (consumed + req.quantity > buyEntry.buy_limit_per_day) {
    sendShopRejected(dispatcher, presence, 'sell', 'buy_limit_reached', req.item_id, {
      need: req.quantity,
      have: Math.max(0, buyEntry.buy_limit_per_day - consumed),
    });
    return;
  }

  const totalGain = buyEntry.buy_price_denar * req.quantity;

  // Atomic OCC: deduct item, add denáry.
  let success = false;
  let inventoryChanges: InventoryChanged['changes'] = [];

  try {
    withOCCRetry<PlayerInventoryBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      userId,
      userId,
      (current) => {
        const blob = asPlayerInventory(current) ?? (current as PlayerInventoryBlob);
        const before = blob.inventory.map((s) => ({ ...s }));
        const inventory = blob.inventory.map((s) => ({ ...s }));

        // 1) check available
        let available = 0;
        for (const slot of inventory) {
          if (slot.item_id === req.item_id) available += slot.quantity;
        }
        if (available < req.quantity) {
          success = false;
          return blob;
        }

        // 2) deduct item
        let remaining = req.quantity;
        for (const slot of inventory) {
          if (remaining <= 0) break;
          if (slot.item_id !== req.item_id) continue;
          const take = Math.min(slot.quantity, remaining);
          slot.quantity -= take;
          remaining -= take;
          if (slot.quantity <= 0) {
            slot.item_id = null;
            slot.quantity = 0;
          }
        }

        // 3) add denáry (currency.denar je stackable do 1M)
        const denarDef = getItemDef('currency.denar');
        const maxDenarStack = denarDef?.max_stack ?? 1_000_000;
        let toAdd = totalGain;
        for (const slot of inventory) {
          if (toAdd <= 0) break;
          if (slot.item_id !== 'currency.denar') continue;
          const space = maxDenarStack - slot.quantity;
          if (space <= 0) continue;
          const take = Math.min(space, toAdd);
          slot.quantity += take;
          toAdd -= take;
        }
        if (toAdd > 0) {
          for (const slot of inventory) {
            if (toAdd <= 0) break;
            if (slot.item_id !== null) continue;
            const take = Math.min(maxDenarStack, toAdd);
            slot.item_id = 'currency.denar';
            slot.quantity = take;
            toAdd -= take;
          }
        }
        if (toAdd > 0) {
          // Žádné místo na denáry. Odmítnout transakci.
          success = false;
          return blob;
        }

        success = true;
        for (let i = 0; i < inventory.length; i++) {
          const a = inventory[i];
          const b = before[i];
          if (!a || !b) continue;
          if (a.item_id !== b.item_id || a.quantity !== b.quantity) {
            inventoryChanges.push({ slot_index: i, item_id: a.item_id, quantity: a.quantity });
          }
        }
        return { ...blob, inventory };
      },
    );
  } catch (err) {
    log(logger, 'error', 'shop sell OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    sendShopRejected(dispatcher, presence, 'sell', 'inventory_short', req.item_id);
    return;
  }

  if (!success) {
    // Re-check pro správný důvod.
    const reason: ShopRejectReason = inferSellFailReason(nk, userId, req.item_id, req.quantity);
    sendShopRejected(dispatcher, presence, 'sell', reason, req.item_id);
    return;
  }

  // Update buy_consumed_today.
  const updatedConsumed = { ...tableState.buy_consumed_today };
  updatedConsumed[req.item_id] = consumed + req.quantity;
  state.merchantStates = {
    ...state.merchantStates,
    [tableDef.id]: { ...tableState, buy_consumed_today: updatedConsumed },
  };

  if (inventoryChanges.length > 0) {
    const msg: InventoryChanged = { changes: inventoryChanges };
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify(msg), [presence]);
  }

  logAudit(nk, 'shop_sell', {
    userId,
    payload: {
      table_id: tableDef.id,
      item_id: req.item_id,
      quantity: req.quantity,
      total_gain: totalGain,
    },
  });

  log(logger, 'info', 'shop sell ok', {
    userId: userId.slice(0, 8),
    tableId: tableDef.id,
    itemId: req.item_id,
    quantity: req.quantity,
    gain: totalGain,
  });

  // Re-send shop snapshot with updated buy_consumed_today.
  sendShopOpen(state, dispatcher, presence, req.npc_id, tableDef.id);
}

function inferSellFailReason(
  nk: nkruntime.Nakama,
  userId: string,
  itemId: string,
  quantity: number,
): ShopRejectReason {
  try {
    const reads = nk.storageRead([
      { collection: STORAGE_COLLECTIONS.PLAYER_INVENTORY, key: userId, userId },
    ]);
    const obj = reads[0];
    if (!obj || !obj.value) return 'inventory_short';
    const blob = asPlayerInventory(obj.value) ?? (obj.value as PlayerInventoryBlob);
    let total = 0;
    for (const slot of blob.inventory) {
      if (slot.item_id === itemId) total += slot.quantity;
    }
    if (total < quantity) return 'inventory_short';
    return 'inventory_full'; // místo se nedalo vrátit denáry
  } catch {
    return 'inventory_short';
  }
}
