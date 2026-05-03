// Svět — viz docs/02c-data-model-svet.md

export interface Position {
  x: number;
  y: number;
}

export interface ChunkId {
  cx: number;
  cy: number;
}

export const CHUNK_SIZE_TILES = 64;

export function chunkOf(pos: Position): ChunkId {
  return {
    cx: Math.floor(pos.x / CHUNK_SIZE_TILES),
    cy: Math.floor(pos.y / CHUNK_SIZE_TILES),
  };
}

export interface ResourceNode {
  id: string;
  type: 'ore_node' | 'tree' | 'fish_spot' | 'herb';
  tier: number;
  resource_id: string;
  position: Position;
  respawn_min_s: number;
  respawn_max_s: number;
  state: 'available' | 'depleted';
  next_respawn_at?: string;
}

export interface MobSpawn {
  id: string;
  mob_id: string;
  spawn_position: Position;
  leash_radius_tiles: number;
  respawn_min_s: number;
  respawn_max_s: number;
  scheduled?: {
    interval_min_s: number;
    interval_max_s: number;
    broadcast_on_spawn: boolean;
  };
}

export interface WorldInstance {
  id: string;
  name_cs: string;
  type: 'shared' | 'per_party';
  map_data_ref: string;
  size_tiles: [number, number];
  exit_to: { zone: string; position: Position };
}
