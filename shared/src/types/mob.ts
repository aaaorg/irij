// Mob definitions + runtime state types — viz docs/02d-data-model-npc-mobi-questy.md

import type { Position } from './world.js';

export type AiBehavior = 'passive' | 'defensive' | 'aggressive_basic' | 'aggressive_patrol';
export type AiState = 'idle' | 'chase' | 'attack' | 'leash_return' | 'dead';

export interface MobStats {
  hp_max: number;
  damage_min: number;
  damage_max: number;
  attack_speed_ticks: number;
  defense_melee: number;
  defense_ranged: number;
  defense_magic: number;
  weapon_class: 'melee' | 'ranged' | 'magic';
  movement_speed_tps: number;
  range_tiles: number;
}

export interface MobDefinition {
  id: string;
  name_cs: string;
  name_en?: string;
  appearance_id: string;
  level: number;
  stats: MobStats;
  ai_behavior: AiBehavior;
  loot_table_id: string;
  xp_award: Record<string, number>;
  aggro_radius_tiles: number;
  leash_radius_tiles: number;
  level_aggro_threshold: number;
  respawn_min_s: number;
  respawn_max_s: number;
}

export interface LootTableEntry {
  item_id: string;
  quantity: [number, number];
  chance_pct: number;
}

export interface LootTable {
  id: string;
  rolls: LootTableEntry[];
}

export interface MobSpawnPoint {
  id: string;
  mob_id: string;
  spawn_position: Position;
}
