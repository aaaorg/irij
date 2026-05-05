// Postava — viz docs/02a-data-model-postava.md

export type Gender = 'M' | 'F';

export interface Appearance {
  hair_id: number; // 0-11
  skin_tone_id: number; // 0-11
  outfit_id: number; // 0-11
}

export type AtributName = 'strength' | 'dexterity' | 'intelligence' | 'vitality';

export type SkillName =
  // Combat
  | 'melee'
  | 'ranged'
  | 'magic'
  | 'defense'
  // Gathering
  | 'mining'
  | 'woodcutting'
  | 'fishing'
  | 'herbalism'
  | 'hunting'
  // Crafting
  | 'smithing'
  | 'cooking'
  | 'tailoring'
  | 'alchemy'
  | 'carpentry'
  // Social
  | 'storytelling'
  | 'prayer'
  | 'thievery';

export type EquipmentSlot =
  | 'helmet'
  | 'cape'
  | 'amulet'
  | 'weapon'
  | 'body'
  | 'shield'
  | 'legs'
  | 'gloves'
  | 'boots'
  | 'ring'
  | 'holster';

export interface SkillRow {
  name: SkillName;
  xp: number;
  level: number;
}

export interface AtributRow {
  name: AtributName;
  xp: number;
  level: number;
}

export interface AtributSourceRow {
  atribut: AtributName;
  source_skill: SkillName;
  xp_contributed: number;
}

export interface InventorySlot {
  slot_index: number; // 0-23
  item_id: string | null;
  quantity: number;
  instance_id?: string;
}

export interface SatchelEntry {
  item_id: string; // must be material.*
  quantity: number;
}

export interface EquipmentEntry {
  slot: EquipmentSlot;
  item_id: string | null;
  quantity: number; // 1 except holster (= remaining charges)
  instance_id?: string;
}

export interface PlayerStatusEffect {
  effect_id: string;
  applied_at: string;
  expires_at: string;
  magnitude: number;
  source_meta?: Record<string, unknown>;
}

export interface Player {
  schema_version: number;
  id: string;
  username: string;
  display_name: string;
  gender: Gender;
  appearance: Appearance;
  created_at: string;
  last_login_at: string;
  total_xp: number;
  total_level: number;
  tutorial_completed: boolean;
  settings: Record<string, unknown>;
}

// Hot-path state split from Player — Phase 5 autosave writes only this blob.
// Player blob is write-once + explicit RPC only.
export interface PlayerState {
  schema_version: number;
  current_zone_id: string;
  current_position: { x: number; y: number };
  hp_current: number;
  hp_max: number;
  mana_current: number;
  death_debuff_expires_at: string | null;
  last_logout_at: string;
}
