import type { Position } from '../types/world.js';

export interface MoveRequest {
  target: Position;
  client_seq: number;
}

export interface EntityMoved {
  entity_id: string;
  from: Position;
  to: Position;
  speed_tps: number;
  server_tick: number;
}

export interface WorldSnapshotEntity {
  id: string;
  type: 'player' | 'mob' | 'npc' | 'drop';
  position: Position;
  hp_pct?: number;
  display_name?: string;
}

export interface WorldSnapshot {
  tick: number;
  entities: WorldSnapshotEntity[];
}
