// Item catalog — statická data z items.json, načtená jednou při startu modulu.
// Goja-safe: žádné Map/Set — plain Record pro vyhledávání.

import type { ItemBase } from 'irij-shared/types';
import rawItemsData from '../../data/items.json';

const CATALOG: { [itemId: string]: ItemBase } = {};

for (const item of rawItemsData as ItemBase[]) {
  CATALOG[item.id] = item;
}

export function getItemDef(itemId: string): ItemBase | null {
  return CATALOG[itemId] ?? null;
}

// Mapování kategorie itemu na equipment slot.
// Vrátí slot, do kterého item patří, nebo null pokud item není equipovatelný.
export function categoryToEquipSlot(
  category: string,
): 'helmet' | 'cape' | 'amulet' | 'weapon' | 'body' | 'shield' | 'legs' | 'gloves' | 'boots' | 'ring' | 'holster' | null {
  if (category.startsWith('weapon.melee.') || category.startsWith('weapon.ranged.') || category.startsWith('weapon.magic.')) {
    return 'weapon';
  }
  if (category === 'weapon.shield') return 'shield';
  if (category.startsWith('armor.head')) return 'helmet';
  if (category.startsWith('armor.body')) return 'body';
  if (category.startsWith('armor.legs')) return 'legs';
  if (category.startsWith('armor.hands')) return 'gloves';
  if (category.startsWith('armor.feet')) return 'boots';
  if (category.startsWith('armor.cape')) return 'cape';
  if (category === 'consumable.whetstone' || category.startsWith('consumable.whetstone')) return 'holster';
  if (category === 'consumable.arrow' || category.startsWith('consumable.arrow')) return 'holster';
  if (category === 'consumable.rune' || category.startsWith('consumable.rune')) return 'holster';
  return null;
}

// Vrátí weapon_class z specialized pole itemu, pokud je to zbraň.
export function getWeaponClass(item: ItemBase): 'melee' | 'ranged' | 'magic' | null {
  const s = item.specialized as { weapon_class?: unknown } | undefined;
  const wc = s?.weapon_class;
  if (wc === 'melee' || wc === 'ranged' || wc === 'magic') return wc;
  return null;
}

// Vrátí holster weapon_class_required z consumable, pokud je to holster item.
export function getHolsterRequired(item: ItemBase): 'melee' | 'ranged' | 'magic' | null {
  const s = item.specialized as { weapon_class_required?: unknown } | undefined;
  const req = s?.weapon_class_required;
  if (req === 'melee' || req === 'ranged' || req === 'magic') return req;
  return null;
}

export function isTwoHanded(item: ItemBase): boolean {
  const s = item.specialized as { two_handed?: unknown } | undefined;
  return s?.two_handed === true;
}

export function getFoodHpRestore(item: ItemBase): number {
  const s = item.specialized as { hp_restore?: unknown } | undefined;
  const hp = s?.hp_restore;
  return typeof hp === 'number' ? hp : 0;
}
