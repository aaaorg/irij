// Phase 7: Inventory & equipment server handlers.
// Handlers jsou volány z matchLoop pro opcodes 20-26 + INTERACT_OBJECT (31).
// Všechny mutace inventáře jdou přes withOCCRetry na STORAGE_COLLECTIONS.PLAYER_INVENTORY.

import {
  EQUIPMENT_SLOTS,
  INVENTORY_SLOTS,
  STORAGE_COLLECTIONS,
  TICK_HZ,
} from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type {
  EquipmentChanged,
  EquipRequest,
  HolsterAutopull,
  InteractObjectRequest,
  InventoryChanged,
  ItemDropRequest,
  ItemUseRequest,
  UnequipRequest,
} from 'irij-shared/messages';
import { asPlayerInventory } from 'irij-shared/types';
import type {
  EquipmentEntry,
  EquipmentSlot,
  InventorySlot,
  PlayerInventoryBlob,
} from 'irij-shared/types';
import { int, obj, optional, parse, str } from 'irij-shared';

import { withOCCRetry } from '../lib/storage.js';
import {
  categoryToEquipSlot,
  getHolsterRequired,
  getItemDef,
  getWeaponClass,
  isTwoHanded,
  getFoodHpRestore,
} from '../lib/items.js';
import { log } from '../lib/log.js';
import { logAudit } from '../lib/audit.js';
import { checkRateLimit, RATE_LIMIT_WINDOW_MS } from './movement.js';
import {
  addDropToChunk,
  broadcastToChunkArea,
  chunkKeyOf,
  removeDropFromChunk,
  type DropInstanceState,
  type WorldMatchState,
} from './state.js';

// Rate limit: max 20 interact (pickup) requests per second.
const INTERACT_RATE_LIMIT_MAX = 20;
// Rate limit: max 10 equip/unequip/use per second.
const INVENTORY_ACTION_RATE_LIMIT_MAX = 10;
const INVENTORY_ACTION_WINDOW_MS = 1000;

// ── Schema validators ────────────────────────────────────────────────────────

const InteractObjectSchema = obj({
  object_id: str(),
  action: str(),
});

const EquipRequestSchema = obj({
  source_slot_index: int().min(0).max(INVENTORY_SLOTS - 1),
  target_equipment_slot: str(),
});

const UnequipRequestSchema = obj({
  source_equipment_slot: str(),
});

const ItemDropRequestSchema = obj({
  slot_index: int().min(0).max(INVENTORY_SLOTS - 1),
  quantity: optional(int().min(1)),
});

const ItemUseRequestSchema = obj({
  slot_index: int().min(0).max(INVENTORY_SLOTS - 1),
  action: str(),
});

// ── Pickup helper ────────────────────────────────────────────────────────────

function chebyshevDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ── Inventory mutation helpers ───────────────────────────────────────────────

function addItemsToInventory(
  blob: PlayerInventoryBlob,
  items: Array<{ item_id: string; quantity: number }>,
): { blob: PlayerInventoryBlob; overflowed: Array<{ item_id: string; quantity: number }> } {
  const inventory = blob.inventory.map((s) => ({ ...s }));
  const overflowed: Array<{ item_id: string; quantity: number }> = [];

  for (const incoming of items) {
    let remaining = incoming.quantity;
    const def = getItemDef(incoming.item_id);

    if (def?.stackable) {
      // Try to stack into existing slots first.
      for (const slot of inventory) {
        if (remaining <= 0) break;
        if (slot.item_id !== incoming.item_id) continue;
        const maxStack = def.max_stack;
        const spaceInSlot = maxStack - slot.quantity;
        if (spaceInSlot <= 0) continue;
        const take = Math.min(spaceInSlot, remaining);
        slot.quantity += take;
        remaining -= take;
      }
    }

    if (remaining > 0) {
      // Find empty slot(s).
      for (const slot of inventory) {
        if (remaining <= 0) break;
        if (slot.item_id !== null) continue;
        const maxStack = def?.stackable ? (def.max_stack ?? 1) : 1;
        const take = Math.min(maxStack, remaining);
        slot.item_id = incoming.item_id;
        slot.quantity = take;
        remaining -= take;
      }
    }

    if (remaining > 0) {
      overflowed.push({ item_id: incoming.item_id, quantity: remaining });
    }
  }

  return { blob: { ...blob, inventory }, overflowed };
}

function buildInventoryChanges(
  before: InventorySlot[],
  after: InventorySlot[],
): InventoryChanged['changes'] {
  const changes: InventoryChanged['changes'] = [];
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    const b = before[i];
    if (!a || !b) continue;
    if (a.item_id !== b.item_id || a.quantity !== b.quantity) {
      changes.push({ slot_index: i, item_id: a.item_id, quantity: a.quantity });
    }
  }
  return changes;
}

// ── INTERACT_OBJECT (Op 31) — pickup drop entity ─────────────────────────────

export function handleInteractObject(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  tick: number,
): void {
  const userId = presence.userId;
  const ps = state.presencesByUserId[userId];
  if (!ps) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }

  const result = parse(InteractObjectSchema, parsed);
  if (!result.ok) return;
  const req = result.value as InteractObjectRequest;
  if (req.action !== 'pickup') return;

  // Rate limit.
  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, INTERACT_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) return;

  const drop = state.dropInstances[req.object_id];
  if (!drop) {
    log(logger, 'debug', 'pickup: drop not found', { userId: userId.slice(0, 8), dropId: req.object_id });
    return;
  }

  if (chebyshevDistance(ps.position, drop.position) > 2) {
    log(logger, 'debug', 'pickup: too far', { userId: userId.slice(0, 8), dist: chebyshevDistance(ps.position, drop.position) });
    return;
  }

  // Remove drop from state immediately (first-come-first-serve).
  removeDropFromChunk(state, drop.dropId, drop.position);
  const nextDrops = { ...state.dropInstances };
  delete nextDrops[drop.dropId];
  state.dropInstances = nextDrops;

  // Broadcast ENTITY_DESPAWNED to area.
  broadcastToChunkArea(dispatcher, state, drop.lastChunk, Op.ENTITY_DESPAWNED, {
    entity_id: drop.dropId,
  });

  // Add items to inventory via OCC.
  let inventoryChanges: InventoryChanged['changes'] = [];
  try {
    const result2 = withOCCRetry<PlayerInventoryBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      userId,
      userId,
      (current) => {
        const blob = asPlayerInventory(current) ?? current as PlayerInventoryBlob;
        const before = blob.inventory.map((s) => ({ ...s }));
        const { blob: updated } = addItemsToInventory(blob, drop.items);
        inventoryChanges = buildInventoryChanges(before, updated.inventory);
        return updated;
      },
    );
    void result2;
  } catch (err) {
    log(logger, 'error', 'pickup OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    return;
  }

  // Unicast INVENTORY_CHANGED to self.
  if (inventoryChanges.length > 0) {
    const msg: InventoryChanged = { changes: inventoryChanges };
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify(msg), [presence]);
  }

  logAudit(nk, 'item_picked_up', {
    userId,
    payload: { dropId: drop.dropId, items: drop.items },
  });

  log(logger, 'info', 'item picked up', {
    userId: userId.slice(0, 8),
    items: drop.items,
  });
}

// ── EQUIP_REQUEST (Op 22) ────────────────────────────────────────────────────

export function handleEquipRequest(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  _tick: number,
): void {
  const userId = presence.userId;
  const ps = state.presencesByUserId[userId];
  if (!ps) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }

  const res = parse(EquipRequestSchema, parsed);
  if (!res.ok) return;
  const req = res.value as EquipRequest;

  const targetSlot = req.target_equipment_slot as EquipmentSlot;
  if (!EQUIPMENT_SLOTS.includes(targetSlot as typeof EQUIPMENT_SLOTS[number])) return;

  let equipmentChanged: EquipmentChanged | null = null;
  let inventoryChanges: InventoryChanged['changes'] = [];
  let holsterAutopull: HolsterAutopull | null = null;

  try {
    withOCCRetry<PlayerInventoryBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      userId,
      userId,
      (current) => {
        const blob = asPlayerInventory(current) ?? current as PlayerInventoryBlob;
        const inventory = blob.inventory.map((s) => ({ ...s }));
        const equipment = blob.equipment.map((e) => ({ ...e }));

        const sourceSlot = inventory[req.source_slot_index];
        if (!sourceSlot || sourceSlot.item_id === null) return blob;

        const itemId = sourceSlot.item_id;
        const def = getItemDef(itemId);
        if (!def) return blob;

        // Validate category → slot mapping.
        const allowedSlot = categoryToEquipSlot(def.category);
        if (allowedSlot !== targetSlot) return blob;

        // 2H weapon: unequip shield.
        if (targetSlot === 'weapon' && isTwoHanded(def)) {
          const shieldIdx = equipment.findIndex((e) => e.slot === 'shield');
          if (shieldIdx >= 0) {
            const shield = equipment[shieldIdx]!;
            if (shield.item_id !== null) {
              const freeSlot = inventory.find((s) => s.item_id === null);
              if (!freeSlot) return blob; // Inventory full, refuse.
              freeSlot.item_id = shield.item_id;
              freeSlot.quantity = shield.quantity;
              shield.item_id = null;
              shield.quantity = 0;
            }
          }
        }

        // Shield: refuse if 2H weapon equipped.
        if (targetSlot === 'shield') {
          const weaponEntry = equipment.find((e) => e.slot === 'weapon');
          if (weaponEntry?.item_id) {
            const wDef = getItemDef(weaponEntry.item_id);
            if (wDef && isTwoHanded(wDef)) return blob;
          }
        }

        // Find existing equipment entry for this slot.
        const equipIdx = equipment.findIndex((e) => e.slot === targetSlot);
        if (equipIdx < 0) return blob;
        const existingEquip = equipment[equipIdx]!;

        // Swap: put current equipped item back to source inventory slot.
        const prevEquippedId = existingEquip.item_id;
        const prevEquippedQty = existingEquip.quantity;

        existingEquip.item_id = itemId;
        existingEquip.quantity = 1;

        sourceSlot.item_id = prevEquippedId;
        sourceSlot.quantity = prevEquippedId !== null ? prevEquippedQty : 0;

        const before = blob.inventory;
        inventoryChanges = buildInventoryChanges(before, inventory);
        equipmentChanged = { player_id: userId, slot: targetSlot, item_id: itemId };

        // Holster auto-pull: if equipping a weapon, look for compatible holster items.
        if (targetSlot === 'weapon') {
          const weaponClass = getWeaponClass(def);
          if (weaponClass !== null) {
            const holsterEntry = equipment.find((e) => e.slot === 'holster');
            if (holsterEntry && holsterEntry.item_id === null) {
              // Find compatible holster item in inventory.
              for (const invSlot of inventory) {
                if (invSlot.item_id === null || invSlot.item_id === itemId) continue;
                const holsterDef = getItemDef(invSlot.item_id);
                if (!holsterDef) continue;
                if (getHolsterRequired(holsterDef) !== weaponClass) continue;
                // Auto-pull: move one item to holster.
                holsterEntry.item_id = invSlot.item_id;
                holsterEntry.quantity = 1;
                invSlot.quantity -= 1;
                if (invSlot.quantity <= 0) invSlot.item_id = null;
                holsterAutopull = {
                  from_inventory_slot: invSlot.slot_index,
                  to_holster: 'holster',
                  item_id: holsterDef.id,
                  quantity: 1,
                };
                // Rebuild inventory changes to include holster pull.
                inventoryChanges = buildInventoryChanges(before, inventory);
                break;
              }
            }
          }
        }

        return { ...blob, inventory, equipment };
      },
    );
  } catch (err) {
    log(logger, 'error', 'equip OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    return;
  }

  if (!equipmentChanged) return;

  // Unicast INVENTORY_CHANGED.
  if (inventoryChanges.length > 0) {
    const msg: InventoryChanged = { changes: inventoryChanges };
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify(msg), [presence]);
  }

  // Broadcast EQUIPMENT_CHANGED to chunk area (other players see visual).
  broadcastToChunkArea(dispatcher, state, ps.lastChunk, Op.EQUIPMENT_CHANGED, equipmentChanged);

  // Unicast HOLSTER_AUTOPULL if triggered.
  if (holsterAutopull) {
    dispatcher.broadcastMessage(Op.HOLSTER_AUTOPULL, JSON.stringify(holsterAutopull), [presence]);
  }

  log(logger, 'info', 'equipped', {
    userId: userId.slice(0, 8),
    slot: targetSlot,
    item: (equipmentChanged as EquipmentChanged).item_id,
  });
}

// ── UNEQUIP_REQUEST (Op 23) ──────────────────────────────────────────────────

export function handleUnequipRequest(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  _tick: number,
): void {
  const userId = presence.userId;
  const ps = state.presencesByUserId[userId];
  if (!ps) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }

  const res = parse(UnequipRequestSchema, parsed);
  if (!res.ok) return;
  const req = res.value as UnequipRequest;

  const sourceSlot = req.source_equipment_slot as EquipmentSlot;
  if (!EQUIPMENT_SLOTS.includes(sourceSlot as typeof EQUIPMENT_SLOTS[number])) return;

  let equipmentChanged: EquipmentChanged | null = null;
  let inventoryChanges: InventoryChanged['changes'] = [];

  try {
    withOCCRetry<PlayerInventoryBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      userId,
      userId,
      (current) => {
        const blob = asPlayerInventory(current) ?? current as PlayerInventoryBlob;
        const inventory = blob.inventory.map((s) => ({ ...s }));
        const equipment = blob.equipment.map((e) => ({ ...e }));

        const equipIdx = equipment.findIndex((e) => e.slot === sourceSlot);
        if (equipIdx < 0) return blob;
        const equipEntry = equipment[equipIdx]!;
        if (equipEntry.item_id === null) return blob;

        // Find free inventory slot.
        const freeSlot = inventory.find((s) => s.item_id === null);
        if (!freeSlot) return blob; // Inventory full.

        const before = blob.inventory;
        freeSlot.item_id = equipEntry.item_id;
        freeSlot.quantity = equipEntry.quantity;
        equipEntry.item_id = null;
        equipEntry.quantity = 0;

        inventoryChanges = buildInventoryChanges(before, inventory);
        equipmentChanged = { player_id: userId, slot: sourceSlot, item_id: null };

        return { ...blob, inventory, equipment };
      },
    );
  } catch (err) {
    log(logger, 'error', 'unequip OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    return;
  }

  if (!equipmentChanged) return;

  if (inventoryChanges.length > 0) {
    const msg: InventoryChanged = { changes: inventoryChanges };
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify(msg), [presence]);
  }

  broadcastToChunkArea(dispatcher, state, ps.lastChunk, Op.EQUIPMENT_CHANGED, equipmentChanged);

  log(logger, 'info', 'unequipped', {
    userId: userId.slice(0, 8),
    slot: sourceSlot,
  });
}

// ── ITEM_DROP_REQUEST (Op 21) ────────────────────────────────────────────────

export function handleItemDropRequest(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  tick: number,
): void {
  const userId = presence.userId;
  const ps = state.presencesByUserId[userId];
  if (!ps) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }

  const res = parse(ItemDropRequestSchema, parsed);
  if (!res.ok) return;
  const req = res.value as ItemDropRequest;

  let droppedItem: { item_id: string; quantity: number } | null = null;
  let inventoryChanges: InventoryChanged['changes'] = [];

  try {
    withOCCRetry<PlayerInventoryBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      userId,
      userId,
      (current) => {
        const blob = asPlayerInventory(current) ?? current as PlayerInventoryBlob;
        const inventory = blob.inventory.map((s) => ({ ...s }));

        const slot = inventory[req.slot_index];
        if (!slot || slot.item_id === null) return blob;

        const def = getItemDef(slot.item_id);
        if (!def?.destroyable) return blob; // Quest items can't be dropped.

        const dropQty = req.quantity ?? slot.quantity;
        const actualQty = Math.min(dropQty, slot.quantity);
        if (actualQty <= 0) return blob;

        const before = blob.inventory;
        droppedItem = { item_id: slot.item_id, quantity: actualQty };

        slot.quantity -= actualQty;
        if (slot.quantity <= 0) {
          slot.item_id = null;
          slot.quantity = 0;
        }

        inventoryChanges = buildInventoryChanges(before, inventory);
        return { ...blob, inventory };
      },
    );
  } catch (err) {
    log(logger, 'error', 'item_drop OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    return;
  }

  if (!droppedItem) return;

  // Create drop entity at player position.
  const chunk = chunkKeyOf(ps.position);
  const dropId = `drop_player_${userId.slice(0, 8)}_${tick}`;
  const drop: DropInstanceState = {
    dropId,
    position: { ...ps.position },
    items: [droppedItem],
    droppedAtTick: tick,
    lastChunk: chunk,
  };
  state.dropInstances = { ...state.dropInstances, [dropId]: drop };
  addDropToChunk(state, dropId, ps.position);

  broadcastToChunkArea(dispatcher, state, chunk, Op.ENTITY_SPAWNED, {
    entity_id: dropId,
    type: 'drop',
    position: ps.position,
    items: [droppedItem],
  });

  if (inventoryChanges.length > 0) {
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify({ changes: inventoryChanges }), [presence]);
  }

  logAudit(nk, 'item_dropped', { userId, payload: { item: droppedItem } });
  log(logger, 'info', 'item dropped', { userId: userId.slice(0, 8), item: droppedItem });
}

// ── ITEM_USE_REQUEST (Op 20) ─────────────────────────────────────────────────

export function handleItemUseRequest(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  tick: number,
): void {
  const userId = presence.userId;
  const ps = state.presencesByUserId[userId];
  if (!ps) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }

  const res = parse(ItemUseRequestSchema, parsed);
  if (!res.ok) return;
  const req = res.value as ItemUseRequest;

  if (req.action === 'drop') {
    handleItemDropRequest(state, logger, nk, dispatcher, presence, JSON.stringify({ slot_index: req.slot_index }), tick);
    return;
  }

  if (req.action !== 'consume') return;

  let hpRestored = 0;
  let inventoryChanges: InventoryChanged['changes'] = [];

  try {
    withOCCRetry<PlayerInventoryBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      userId,
      userId,
      (current) => {
        const blob = asPlayerInventory(current) ?? current as PlayerInventoryBlob;
        const inventory = blob.inventory.map((s) => ({ ...s }));

        const slot = inventory[req.slot_index];
        if (!slot || slot.item_id === null) return blob;

        const def = getItemDef(slot.item_id);
        if (!def || !def.category.startsWith('consumable.food')) return blob;

        hpRestored = getFoodHpRestore(def);
        const before = blob.inventory;

        slot.quantity -= 1;
        if (slot.quantity <= 0) {
          slot.item_id = null;
          slot.quantity = 0;
        }

        inventoryChanges = buildInventoryChanges(before, inventory);
        return { ...blob, inventory };
      },
    );
  } catch (err) {
    log(logger, 'error', 'item_use OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    return;
  }

  if (hpRestored <= 0) return;

  // Apply HP restore to presence state.
  const currentHp = ps.hpCurrent;
  const newHp = Math.min(ps.hpMax, currentHp + hpRestored);
  state.presencesByUserId = {
    ...state.presencesByUserId,
    [userId]: { ...ps, hpCurrent: newHp },
  };

  if (inventoryChanges.length > 0) {
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify({ changes: inventoryChanges }), [presence]);
  }

  // Broadcast HP update via COMBAT_RESOLVED (re-uses existing client HP-bar logic).
  broadcastToChunkArea(dispatcher, state, ps.lastChunk, Op.COMBAT_RESOLVED, {
    attacker_id: userId,
    target_id: userId,
    damage: -hpRestored,
    hit_type: 'normal',
    remaining_hp: newHp,
  });

  log(logger, 'debug', 'food consumed', { userId: userId.slice(0, 8), hpRestored, newHp });
}

// ── Cleanup per-user rate log on leave ───────────────────────────────────────

export function cleanupInventoryRateLogs(state: WorldMatchState, userId: string): void {
  if (state.interactRequestLog[userId]) {
    const next = { ...state.interactRequestLog };
    delete next[userId];
    state.interactRequestLog = next;
  }
}
