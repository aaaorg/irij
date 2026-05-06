import { describe, it, expect, vi } from 'vitest';

// ── Testovatelné utility z inventory.ts ──────────────────────────────────────
// Pro izolované testy extrahujeme addItemsToInventory jako pure utility.
// Skutečné handlery vyžadují Nakama runtime mock — testujeme logiku odděleně.

import type { InventorySlot, PlayerInventoryBlob, EquipmentEntry } from 'irij-shared/types';
import { INVENTORY_SLOTS, EQUIPMENT_SLOTS } from 'irij-shared/constants';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEmptyInventory(): PlayerInventoryBlob {
  const inventory: InventorySlot[] = Array.from({ length: INVENTORY_SLOTS }, (_, i) => ({
    slot_index: i,
    item_id: null,
    quantity: 0,
  }));
  const equipment: EquipmentEntry[] = EQUIPMENT_SLOTS.map((slot) => ({
    slot,
    item_id: null,
    quantity: 0,
  }));
  return { inventory, satchel: [], equipment };
}

function addItemsToInventory(
  blob: PlayerInventoryBlob,
  items: Array<{ item_id: string; quantity: number }>,
  itemDefs: Record<string, { stackable: boolean; max_stack: number; destroyable?: boolean }>,
): { blob: PlayerInventoryBlob; overflowed: Array<{ item_id: string; quantity: number }> } {
  const inventory = blob.inventory.map((s) => ({ ...s }));
  const overflowed: Array<{ item_id: string; quantity: number }> = [];

  for (const incoming of items) {
    let remaining = incoming.quantity;
    const def = itemDefs[incoming.item_id];

    if (def?.stackable) {
      for (const slot of inventory) {
        if (remaining <= 0) break;
        if (slot.item_id !== incoming.item_id) continue;
        const space = def.max_stack - slot.quantity;
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
        const maxStack = def?.stackable ? def.max_stack : 1;
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('addItemsToInventory', () => {
  const defs = {
    'material.bone': { stackable: true, max_stack: 100 },
    'weapon.melee.dagger.bronze': { stackable: false, max_stack: 1, destroyable: true },
    'consumable.food.raw_meat': { stackable: true, max_stack: 20 },
  };

  it('adds single non-stackable item to first free slot', () => {
    const blob = makeEmptyInventory();
    const { blob: updated, overflowed } = addItemsToInventory(blob, [{ item_id: 'weapon.melee.dagger.bronze', quantity: 1 }], defs);
    expect(overflowed).toHaveLength(0);
    expect(updated.inventory[0]?.item_id).toBe('weapon.melee.dagger.bronze');
    expect(updated.inventory[0]?.quantity).toBe(1);
  });

  it('stacks stackable items into existing slot', () => {
    const blob = makeEmptyInventory();
    blob.inventory[0] = { slot_index: 0, item_id: 'material.bone', quantity: 5 };
    const { blob: updated } = addItemsToInventory(blob, [{ item_id: 'material.bone', quantity: 3 }], defs);
    expect(updated.inventory[0]?.quantity).toBe(8);
  });

  it('splits stack across slots when existing slot is full', () => {
    const blob = makeEmptyInventory();
    blob.inventory[0] = { slot_index: 0, item_id: 'material.bone', quantity: 99 };
    const { blob: updated, overflowed } = addItemsToInventory(blob, [{ item_id: 'material.bone', quantity: 5 }], defs);
    expect(overflowed).toHaveLength(0);
    // 1 in first slot (fills 99→100), rest in second slot.
    expect(updated.inventory[0]?.quantity).toBe(100);
    expect(updated.inventory[1]?.quantity).toBe(4);
  });

  it('reports overflow when inventory is full', () => {
    const blob = makeEmptyInventory();
    // Fill all 24 slots with non-empty.
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      blob.inventory[i] = { slot_index: i, item_id: 'weapon.melee.dagger.bronze', quantity: 1 };
    }
    const { overflowed } = addItemsToInventory(blob, [{ item_id: 'material.bone', quantity: 5 }], defs);
    expect(overflowed).toHaveLength(1);
    expect(overflowed[0]?.quantity).toBe(5);
  });

  it('adds multiple items in one call', () => {
    const blob = makeEmptyInventory();
    const items = [
      { item_id: 'material.bone', quantity: 2 },
      { item_id: 'weapon.melee.dagger.bronze', quantity: 1 },
      { item_id: 'consumable.food.raw_meat', quantity: 3 },
    ];
    const { blob: updated, overflowed } = addItemsToInventory(blob, items, defs);
    expect(overflowed).toHaveLength(0);
    const boneSlot = updated.inventory.find((s) => s.item_id === 'material.bone');
    expect(boneSlot?.quantity).toBe(2);
    const daggerSlot = updated.inventory.find((s) => s.item_id === 'weapon.melee.dagger.bronze');
    expect(daggerSlot?.quantity).toBe(1);
  });

  it('does not modify original blob (immutability)', () => {
    const blob = makeEmptyInventory();
    const original0 = blob.inventory[0];
    addItemsToInventory(blob, [{ item_id: 'material.bone', quantity: 1 }], defs);
    // Original slot unchanged.
    expect(blob.inventory[0]).toBe(original0);
    expect(blob.inventory[0]?.item_id).toBeNull();
  });
});

// ── categoryToEquipSlot ──────────────────────────────────────────────────────

import { categoryToEquipSlot, getItemDef, getWeaponClass, isTwoHanded, getFoodHpRestore } from '../lib/items.js';

describe('categoryToEquipSlot', () => {
  it('maps melee weapon to weapon slot', () => {
    expect(categoryToEquipSlot('weapon.melee.sword')).toBe('weapon');
    expect(categoryToEquipSlot('weapon.melee.dagger')).toBe('weapon');
  });

  it('maps armor categories to correct slots', () => {
    expect(categoryToEquipSlot('armor.head')).toBe('helmet');
    expect(categoryToEquipSlot('armor.body')).toBe('body');
    expect(categoryToEquipSlot('armor.legs')).toBe('legs');
    expect(categoryToEquipSlot('armor.hands')).toBe('gloves');
    expect(categoryToEquipSlot('armor.feet')).toBe('boots');
    expect(categoryToEquipSlot('armor.cape')).toBe('cape');
  });

  it('maps holster consumables to holster', () => {
    expect(categoryToEquipSlot('consumable.whetstone')).toBe('holster');
    expect(categoryToEquipSlot('consumable.arrow')).toBe('holster');
    expect(categoryToEquipSlot('consumable.rune')).toBe('holster');
  });

  it('returns null for non-equipable categories', () => {
    expect(categoryToEquipSlot('material')).toBeNull();
    expect(categoryToEquipSlot('consumable.food')).toBeNull();
    expect(categoryToEquipSlot('currency')).toBeNull();
  });
});

// ── items.json catalog ───────────────────────────────────────────────────────

describe('item catalog', () => {
  it('getItemDef returns correct def for known item', () => {
    const def = getItemDef('weapon.melee.dagger.bronze');
    expect(def).not.toBeNull();
    expect(def?.name_cs).toBe('Bronzová dýka');
    expect(def?.stackable).toBe(false);
  });

  it('getItemDef returns null for unknown item', () => {
    expect(getItemDef('does.not.exist')).toBeNull();
  });

  it('getWeaponClass returns melee for melee weapon', () => {
    const def = getItemDef('weapon.melee.sword.bronze');
    expect(def).not.toBeNull();
    expect(getWeaponClass(def!)).toBe('melee');
  });

  it('isTwoHanded returns false for single-handed bronze sword', () => {
    const def = getItemDef('weapon.melee.sword.bronze');
    expect(def).not.toBeNull();
    expect(isTwoHanded(def!)).toBe(false);
  });

  it('getFoodHpRestore returns correct value for bread', () => {
    const def = getItemDef('consumable.food.bread');
    expect(def).not.toBeNull();
    expect(getFoodHpRestore(def!)).toBe(8);
  });

  it('getFoodHpRestore returns correct value for raw meat', () => {
    const def = getItemDef('consumable.food.raw_meat');
    expect(def).not.toBeNull();
    expect(getFoodHpRestore(def!)).toBe(3);
  });

  it('all loot table items exist in catalog', () => {
    const lootItemIds = [
      'material.hide.wolf',
      'material.bone',
      'consumable.food.raw_meat',
      'weapon.melee.dagger.bronze',
      'material.hide.rat',
    ];
    for (const id of lootItemIds) {
      expect(getItemDef(id)).not.toBeNull();
    }
  });

  it('items have required fields', () => {
    const def = getItemDef('armor.body.leather');
    expect(def).not.toBeNull();
    expect(typeof def?.id).toBe('string');
    expect(typeof def?.name_cs).toBe('string');
    expect(typeof def?.weight_kg).toBe('number');
    expect(typeof def?.value_denar).toBe('number');
  });
});
