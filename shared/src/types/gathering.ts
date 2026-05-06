// Phase 10: Gathering & crafting — viz docs/02b sekce Crafting + 02c sekce Resource a mob spawn timery.

import type { Position } from './world.js';

// Resource node static definition (server/data/resource_nodes.json).
export interface ResourceNodeDefinition {
  id: string;
  type: 'ore_node' | 'tree' | 'fish_spot' | 'herb';
  tier: number;
  resource_id: string;
  yield_quantity: number;
  tool_type_required: 'pickaxe' | 'axe' | 'fishing_rod' | 'knife' | null;
  skill_name: string;
  skill_level_required: number;
  gather_time_ms: number;
  xp_award: Record<string, number>;
  position: Position;
  respawn_min_s: number;
  respawn_max_s: number;
}

// Crafting station static definition (server/data/craft_stations.json).
export interface CraftStationDefinition {
  id: string;
  station_type: 'smith_forge' | 'cooking_fire' | 'tailoring_table' | 'alchemy_table' | 'carpentry_bench' | 'temple_altar';
  name_cs: string;
  position: Position;
}
