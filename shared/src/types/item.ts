// Itemy — viz docs/02b-data-model-itemy.md

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type WeaponClass = 'melee' | 'ranged' | 'magic';

export interface ItemBase {
  id: string;
  category: string; // dot-separated, e.g. "weapon.melee.sword"
  tier: number;
  rarity: Rarity;
  name_cs: string;
  name_en?: string;
  description_cs: string;
  weight_kg: number;
  stackable: boolean;
  max_stack: number;
  icon: string;
  value_denar: number;
  level_req?: Partial<Record<string, number>>;
  tradeable: boolean;
  destroyable: boolean;
  specialized?: Record<string, unknown>;
}

export interface WeaponSpecialized {
  damage_min: number;
  damage_max: number;
  attack_speed_ticks: number;
  weapon_class: WeaponClass;
  two_handed: boolean;
  range_tiles: number;
}

export interface ArmorSpecialized {
  slot: 'head' | 'body' | 'legs' | 'hands' | 'feet' | 'cape';
  defense_melee: number;
  defense_ranged: number;
  defense_magic: number;
  movement_penalty_pct: number;
}

export interface ConsumableWhetstoneSpecialized {
  weapon_class_required: 'melee';
  damage_bonus_pct: number;
  charges_per_unit: number;
}

export interface ConsumableArrowSpecialized {
  weapon_class_required: 'ranged';
  damage_flat_bonus: number;
}

export interface ConsumableRuneSpecialized {
  weapon_class_required: 'magic';
  spell_tier_unlocked: number;
}

export interface Recipe {
  id: string;
  type?: 'standard' | 'upgrade';
  output: { item_id: string; quantity: number; rarity_override?: Rarity };
  inputs?: Array<{ item_id: string; quantity: number }>;
  input_item?: { item_id: string; min_rarity: Rarity; consumed: boolean };
  extra_inputs?: Array<{ item_id: string; quantity: number }>;
  primary_skill: { name: string; level: number };
  secondary_skills?: Array<{ name: string; level: number }>;
  station_required?: string;
  tool_required?: string;
  crafting_time_ms: number;
  unlock_required?: string;
  fail_chance_pct: number;
  xp_award: Record<string, number>;
}
