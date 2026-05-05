// Svět — viz docs/02c-data-model-svet.md

import { CHUNK_SIZE_TILES } from '../constants/index.js';

export interface Position {
  x: number;
  y: number;
}

export interface ChunkId {
  cx: number;
  cy: number;
}

// Tiled JSON export (.tmj) — minimální typ pokrývající pole, která server
// a klient potřebují (walkable mask, orientation check). Plný Tiled schema
// má desítky dalších polí; přidávej sem jen to, co effectivně čteš.
export interface TiledTileLayer {
  name: string;
  type: string;
  width: number;
  height: number;
  data: number[];
}

export interface TiledTilesetRef {
  firstgid: number;
  source: string;
}

export interface TiledMap {
  orientation: string;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledTileLayer[];
  tilesets: TiledTilesetRef[];
}

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
