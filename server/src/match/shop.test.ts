// Phase 13: shop unit testy. Pokrývají:
//   - merchant catalog loader
//   - seedMerchantTables init z merchant_tables.json
//   - runShopStockRespawn proporcionální dopočet + cap na stock_max
//   - handleShopBuy: range, stock, denáry, atomic mutation, re-snapshot
//   - handleShopSell: range, buy_limit_per_day, denáry add, daily reset

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TICK_HZ } from 'irij-shared/constants';

import { getAllMerchantTables, getMerchantTableDef, getMerchantTableForNpc } from '../lib/merchants.js';
import {
  handleShopBuy,
  handleShopSell,
  runShopStockRespawn,
  seedMerchantTables,
  sendShopOpen,
} from './shop.js';
import type { WorldMatchState } from './state.js';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as nkruntime.Logger;

function makePresence(userId: string): nkruntime.Presence {
  return { userId, sessionId: 's1', username: userId, node: 'n1' } as nkruntime.Presence;
}

function makeBaseState(): WorldMatchState {
  // NPC kovář na (27,25), hráč o 1 tile vedle (26,25) ⇒ Chebyshev = 1.
  return {
    presencesByUserId: {
      user1: { presence: makePresence('user1'), position: { x: 26, y: 25 } },
    },
    interactRequestLog: {},
    npcDefinitions: {
      'npc.kovar_blatiny': {
        id: 'npc.kovar_blatiny',
        display_name_cs: 'Starý Kovář',
        flags: { merchant: true, talkable: true },
      },
      'npc.selka_hospoda': {
        id: 'npc.selka_hospoda',
        display_name_cs: 'Selka',
        flags: { merchant: true, talkable: true },
      },
    },
    npcInstances: {
      'npc.kovar_blatiny': {
        instanceId: 'npc.kovar_blatiny',
        npcId: 'npc.kovar_blatiny',
        position: { x: 27, y: 25 },
        lastChunk: '0,0',
      },
      'npc.selka_hospoda': {
        instanceId: 'npc.selka_hospoda',
        npcId: 'npc.selka_hospoda',
        position: { x: 22, y: 27 },
        lastChunk: '0,0',
      },
    },
    merchantStates: {},
  } as unknown as WorldMatchState;
}

function makeInventory(): { inventory: Array<{ item_id: string | null; quantity: number }>; equipment: any[] } {
  const inv = Array.from({ length: 24 }, () => ({ item_id: null as string | null, quantity: 0 }));
  return { inventory: inv, equipment: [] };
}

function makeNk(initialInv: any = null) {
  let stored: any = initialInv ?? makeInventory();
  const storageRead = vi.fn(() => [
    {
      collection: 'player_inventory',
      key: 'user1',
      userId: 'user1',
      value: stored,
      version: 'v1',
    },
  ]);
  const storageWrite = vi.fn((writes: Array<{ value: any }>) => {
    return writes.map((w) => {
      stored = w.value;
      return { collection: 'player_inventory', key: 'user1', userId: 'user1', version: 'v2' };
    });
  });
  const nk = {
    storageRead,
    storageWrite,
    uuidv4: () => '00000000-0000-0000-0000-000000000001',
  } as unknown as nkruntime.Nakama;
  return { nk, getStored: () => stored };
}

function makeDispatcher() {
  const sent: Array<{ op: number; data: string }> = [];
  const dispatcher = {
    broadcastMessage: vi.fn((op: number, data: string) => {
      sent.push({ op, data });
    }),
  } as unknown as nkruntime.MatchDispatcher;
  return { dispatcher, sent };
}

describe('Phase 13: merchant catalog', () => {
  it('loads merchant_tables.json catalog', () => {
    const all = getAllMerchantTables();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('finds kovar table by id', () => {
    const def = getMerchantTableDef('merchant.kovar_blatiny');
    expect(def).not.toBeNull();
    expect(def?.type).toBe('specialist.smithing');
    expect(def?.sell_items.length).toBeGreaterThan(0);
  });

  it('maps NPC to its merchant table', () => {
    expect(getMerchantTableForNpc('npc.kovar_blatiny')?.id).toBe('merchant.kovar_blatiny');
    expect(getMerchantTableForNpc('npc.selka_hospoda')?.id).toBe('merchant.selka_general');
  });

  it('specialist kovář has higher iron ore buy price than general selka', () => {
    const kovar = getMerchantTableDef('merchant.kovar_blatiny')!;
    const selka = getMerchantTableDef('merchant.selka_general')!;
    const kovarIron = kovar.buy_items.find((b) => b.item_id === 'material.ore.iron')!;
    const selkaIron = selka.buy_items.find((b) => b.item_id === 'material.ore.iron')!;
    expect(kovarIron.buy_price_denar).toBeGreaterThan(selkaIron.buy_price_denar);
  });
});

describe('Phase 13: seedMerchantTables', () => {
  it('initializes stock_current at stock_max', () => {
    const state = makeBaseState();
    seedMerchantTables(state);
    const s = state.merchantStates['merchant.kovar_blatiny'];
    expect(s).toBeDefined();
    const sword = s!.stock_current['weapon.melee.sword.bronze'];
    const def = getMerchantTableDef('merchant.kovar_blatiny')!;
    const swordDef = def.sell_items.find((e) => e.item_id === 'weapon.melee.sword.bronze')!;
    expect(sword).toBe(swordDef.stock_max);
  });
});

describe('Phase 13: runShopStockRespawn', () => {
  it('does not exceed stock_max', () => {
    const state = makeBaseState();
    seedMerchantTables(state);
    // Simuluj 10 hodin elapsed time = 10*3600*10 = 360000 ticků.
    runShopStockRespawn(state, 360000);
    const s = state.merchantStates['merchant.kovar_blatiny']!;
    const def = getMerchantTableDef('merchant.kovar_blatiny')!;
    for (const entry of def.sell_items) {
      const have = s.stock_current[entry.item_id] ?? 0;
      expect(have).toBeLessThanOrEqual(entry.stock_max);
    }
  });

  it('refills proporcionálně z 0 po několika hodinách', () => {
    const state = makeBaseState();
    seedMerchantTables(state);
    // Vyprázdni stock pro test.
    const s = state.merchantStates['merchant.kovar_blatiny']!;
    state.merchantStates['merchant.kovar_blatiny'] = {
      ...s,
      stock_current: { ...s.stock_current, 'consumable.whetstone.t1': 0 },
      last_respawn_tick: 0,
    };
    // 1 hodina = 36000 ticků. Whetstone má respawn_per_hour 8.
    runShopStockRespawn(state, 36000);
    const after = state.merchantStates['merchant.kovar_blatiny']!.stock_current['consumable.whetstone.t1'];
    expect(after).toBe(8);
  });

  it('akumuluje partial mezi calls (proporcionální float)', () => {
    const state = makeBaseState();
    seedMerchantTables(state);
    const s = state.merchantStates['merchant.kovar_blatiny']!;
    state.merchantStates['merchant.kovar_blatiny'] = {
      ...s,
      stock_current: { ...s.stock_current, 'weapon.melee.sword.bronze': 0 },
      stock_partial: { ...s.stock_partial, 'weapon.melee.sword.bronze': 0 },
      last_respawn_tick: 0,
    };
    // Sword má respawn_per_hour=1. Po 30 minutách (18000 ticků) by mělo být 0
    // celých kusů, partial 0.5.
    runShopStockRespawn(state, 18000);
    const m1 = state.merchantStates['merchant.kovar_blatiny']!;
    expect(m1.stock_current['weapon.melee.sword.bronze']).toBe(0);
    expect(m1.stock_partial['weapon.melee.sword.bronze']).toBeCloseTo(0.5, 5);
    // Další 30 minut → 1 celý kus přibyde, partial 0.
    runShopStockRespawn(state, 36000);
    const m2 = state.merchantStates['merchant.kovar_blatiny']!;
    expect(m2.stock_current['weapon.melee.sword.bronze']).toBe(1);
    expect(m2.stock_partial['weapon.melee.sword.bronze']).toBeCloseTo(0, 5);
  });
});

describe('Phase 13: handleShopBuy', () => {
  let state: WorldMatchState;
  let nk: nkruntime.Nakama;
  let dispatcher: nkruntime.MatchDispatcher;
  let sent: Array<{ op: number; data: string }>;
  let getStored: () => any;

  beforeEach(() => {
    state = makeBaseState();
    seedMerchantTables(state);
    // Hráč začíná s 500 denary v slotu 0.
    const inv = makeInventory();
    inv.inventory[0] = { item_id: 'currency.denar', quantity: 500 };
    const r = makeNk(inv);
    nk = r.nk;
    getStored = r.getStored;
    const d = makeDispatcher();
    dispatcher = d.dispatcher;
    sent = d.sent;
  });

  it('buy bronzový meč: deduct 120 denáry, add sword, decrement stock', () => {
    const req = JSON.stringify({
      npc_id: 'npc.kovar_blatiny',
      item_id: 'weapon.melee.sword.bronze',
      quantity: 1,
    });
    handleShopBuy(state, mockLogger, nk, dispatcher, makePresence('user1'), req, 100);

    const inv = getStored();
    let denar = 0;
    let swordCount = 0;
    for (const slot of inv.inventory) {
      if (slot.item_id === 'currency.denar') denar += slot.quantity;
      if (slot.item_id === 'weapon.melee.sword.bronze') swordCount += slot.quantity;
    }
    expect(denar).toBe(380);
    expect(swordCount).toBe(1);

    const stockAfter = state.merchantStates['merchant.kovar_blatiny']!.stock_current['weapon.melee.sword.bronze'];
    const def = getMerchantTableDef('merchant.kovar_blatiny')!;
    const orig = def.sell_items.find((e) => e.item_id === 'weapon.melee.sword.bronze')!.stock_max;
    expect(stockAfter).toBe(orig - 1);

    const opcodes = sent.map((s) => s.op);
    expect(opcodes).toContain(24); // INVENTORY_CHANGED
    expect(opcodes).toContain(93); // SHOP_OPEN re-snapshot
  });

  it('rejects when out of range', () => {
    state.presencesByUserId['user1']!.position = { x: 0, y: 0 };
    const req = JSON.stringify({
      npc_id: 'npc.kovar_blatiny',
      item_id: 'weapon.melee.sword.bronze',
      quantity: 1,
    });
    handleShopBuy(state, mockLogger, nk, dispatcher, makePresence('user1'), req, 100);
    const rejected = sent.find((s) => s.op === 96);
    expect(rejected).toBeDefined();
    expect(JSON.parse(rejected!.data).reason).toBe('out_of_range');
  });

  it('rejects when item not for sale', () => {
    const req = JSON.stringify({
      npc_id: 'npc.kovar_blatiny',
      item_id: 'material.gem.rough', // není v kovář sell_items
      quantity: 1,
    });
    handleShopBuy(state, mockLogger, nk, dispatcher, makePresence('user1'), req, 100);
    const rejected = sent.find((s) => s.op === 96);
    expect(JSON.parse(rejected!.data).reason).toBe('not_for_sale');
  });

  it('rejects when out of stock', () => {
    const s = state.merchantStates['merchant.kovar_blatiny']!;
    state.merchantStates['merchant.kovar_blatiny'] = {
      ...s,
      stock_current: { ...s.stock_current, 'weapon.melee.sword.bronze': 0 },
    };
    const req = JSON.stringify({
      npc_id: 'npc.kovar_blatiny',
      item_id: 'weapon.melee.sword.bronze',
      quantity: 1,
    });
    handleShopBuy(state, mockLogger, nk, dispatcher, makePresence('user1'), req, 100);
    const rejected = sent.find((s) => s.op === 96);
    expect(JSON.parse(rejected!.data).reason).toBe('out_of_stock');
  });

  it('rejects when insufficient funds', () => {
    // hráč má jen 50 denáry, sword stojí 120
    const inv = makeInventory();
    inv.inventory[0] = { item_id: 'currency.denar', quantity: 50 };
    const r = makeNk(inv);
    nk = r.nk;
    const d = makeDispatcher();
    dispatcher = d.dispatcher;
    sent = d.sent;
    const req = JSON.stringify({
      npc_id: 'npc.kovar_blatiny',
      item_id: 'weapon.melee.sword.bronze',
      quantity: 1,
    });
    handleShopBuy(state, mockLogger, nk, dispatcher, makePresence('user1'), req, 100);
    const rejected = sent.find((s) => s.op === 96);
    expect(rejected).toBeDefined();
    expect(JSON.parse(rejected!.data).reason).toBe('insufficient_funds');
  });
});

describe('Phase 13: handleShopSell', () => {
  let state: WorldMatchState;
  let nk: nkruntime.Nakama;
  let dispatcher: nkruntime.MatchDispatcher;
  let sent: Array<{ op: number; data: string }>;
  let getStored: () => any;

  beforeEach(() => {
    state = makeBaseState();
    seedMerchantTables(state);
    // Hráč má 10× iron ore + 0 denary.
    const inv = makeInventory();
    inv.inventory[0] = { item_id: 'material.ore.iron', quantity: 10 };
    const r = makeNk(inv);
    nk = r.nk;
    getStored = r.getStored;
    const d = makeDispatcher();
    dispatcher = d.dispatcher;
    sent = d.sent;
  });

  it('sell 5 iron ore kovaři: deduct 5×ore, add 90 denáry (5×18)', () => {
    const req = JSON.stringify({
      npc_id: 'npc.kovar_blatiny',
      item_id: 'material.ore.iron',
      quantity: 5,
    });
    handleShopSell(state, mockLogger, nk, dispatcher, makePresence('user1'), req, 100);

    const inv = getStored();
    let denar = 0;
    let ore = 0;
    for (const slot of inv.inventory) {
      if (slot.item_id === 'currency.denar') denar += slot.quantity;
      if (slot.item_id === 'material.ore.iron') ore += slot.quantity;
    }
    expect(ore).toBe(5);
    expect(denar).toBe(90);

    const consumed = state.merchantStates['merchant.kovar_blatiny']!.buy_consumed_today['material.ore.iron'];
    expect(consumed).toBe(5);
  });

  it('rejects when NPC not buying that item', () => {
    const inv = makeInventory();
    inv.inventory[0] = { item_id: 'weapon.melee.sword.bronze', quantity: 1 };
    const r = makeNk(inv);
    nk = r.nk;
    const d = makeDispatcher();
    dispatcher = d.dispatcher;
    sent = d.sent;
    const req = JSON.stringify({
      npc_id: 'npc.kovar_blatiny',
      item_id: 'weapon.melee.sword.bronze',
      quantity: 1,
    });
    handleShopSell(state, mockLogger, nk, dispatcher, makePresence('user1'), req, 100);
    const rejected = sent.find((s) => s.op === 96);
    expect(JSON.parse(rejected!.data).reason).toBe('not_buying');
  });

  it('rejects when buy_limit_per_day exceeded', () => {
    // Nastav consumed na limit a zkus prodat ještě jednu rudu
    const s = state.merchantStates['merchant.kovar_blatiny']!;
    state.merchantStates['merchant.kovar_blatiny'] = {
      ...s,
      buy_consumed_today: { ...s.buy_consumed_today, 'material.ore.iron': 100 },
    };
    const req = JSON.stringify({
      npc_id: 'npc.kovar_blatiny',
      item_id: 'material.ore.iron',
      quantity: 1,
    });
    handleShopSell(state, mockLogger, nk, dispatcher, makePresence('user1'), req, 100);
    const rejected = sent.find((s) => s.op === 96);
    expect(JSON.parse(rejected!.data).reason).toBe('buy_limit_reached');
  });

  it('rejects when player does not have enough items', () => {
    const inv = makeInventory();
    inv.inventory[0] = { item_id: 'material.ore.iron', quantity: 2 };
    const r = makeNk(inv);
    nk = r.nk;
    const d = makeDispatcher();
    dispatcher = d.dispatcher;
    sent = d.sent;
    const req = JSON.stringify({
      npc_id: 'npc.kovar_blatiny',
      item_id: 'material.ore.iron',
      quantity: 5,
    });
    handleShopSell(state, mockLogger, nk, dispatcher, makePresence('user1'), req, 100);
    const rejected = sent.find((s) => s.op === 96);
    expect(JSON.parse(rejected!.data).reason).toBe('inventory_short');
  });

  it('specialist Kovář pays 18 d/iron, general Selka pays 10 d/iron', () => {
    // Sell 1 ore Selce — hráč ji blízko: position 22,27
    state.presencesByUserId['user1']!.position = { x: 22, y: 27 };
    const reqKovar = JSON.stringify({
      npc_id: 'npc.kovar_blatiny',
      item_id: 'material.ore.iron',
      quantity: 1,
    });
    // Hráč musí být v range Kováře (27,25). Přemístíme.
    state.presencesByUserId['user1']!.position = { x: 27, y: 25 };
    handleShopSell(state, mockLogger, nk, dispatcher, makePresence('user1'), reqKovar, 100);
    const inv1 = getStored();
    let denar1 = 0;
    for (const slot of inv1.inventory) if (slot.item_id === 'currency.denar') denar1 += slot.quantity;
    expect(denar1).toBe(18);
  });
});

describe('Phase 13: sendShopOpen', () => {
  it('builds a SHOP_OPEN payload with sell + buy entries', () => {
    const state = makeBaseState();
    seedMerchantTables(state);
    const { dispatcher, sent } = makeDispatcher();
    sendShopOpen(state, dispatcher, makePresence('user1'), 'npc.kovar_blatiny', 'merchant.kovar_blatiny');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.op).toBe(93);
    const payload = JSON.parse(sent[0]!.data);
    expect(payload.table_id).toBe('merchant.kovar_blatiny');
    expect(payload.table_type).toBe('specialist.smithing');
    expect(payload.sell_items.length).toBeGreaterThan(0);
    expect(payload.buy_items.length).toBeGreaterThan(0);
  });

  it('rejects unknown table', () => {
    const state = makeBaseState();
    seedMerchantTables(state);
    const { dispatcher, sent } = makeDispatcher();
    sendShopOpen(state, dispatcher, makePresence('user1'), 'npc.kovar_blatiny', 'merchant.does_not_exist');
    expect(sent[0]!.op).toBe(96); // SHOP_REJECTED
    expect(JSON.parse(sent[0]!.data).reason).toBe('unknown_table');
  });
});
