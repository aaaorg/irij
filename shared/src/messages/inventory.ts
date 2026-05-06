import type { EquipmentSlot } from '../types/player.js';

// Op.INTERACT_OBJECT (31) — klient → server.
// Pickup: object_id = dropId, action = 'pickup'.
export interface InteractObjectRequest {
  object_id: string;
  action: 'pickup' | 'open' | 'examine';
}

export interface ItemDropRequest {
  slot_index: number;
  quantity?: number;
}

export interface ItemUseRequest {
  slot_index: number;
  action: 'consume' | 'examine' | 'drop';
}

export interface EquipRequest {
  source_slot_index: number;
  target_equipment_slot: EquipmentSlot;
}

export interface UnequipRequest {
  source_equipment_slot: EquipmentSlot;
}

export interface InventoryChanged {
  changes: Array<{
    slot_index: number;
    item_id?: string | null;
    quantity?: number;
  }>;
}

export interface EquipmentChanged {
  player_id: string;
  slot: EquipmentSlot;
  item_id: string | null;
}

export interface HolsterAutopull {
  from_inventory_slot: number;
  to_holster: 'holster';
  item_id: string;
  quantity: number;
}
