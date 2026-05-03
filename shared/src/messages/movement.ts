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

// Op.MOVE_REJECTED (4) — server → klient (jen sender) když MOVE_REQUEST nelze
// zpracovat. Důvody:
//   - 'malformed': payload nelze parsovat / chybí pole / wrong types
//   - 'rate_limited': hráč překročil 10 req/s rate limit
//   - 'stunned': hráč má status effect blokující movement (post-Phase 6)
//   - 'out_of_bounds': target.{x,y} mimo walkable mask dimenze
//   - 'no_path': target není walkable a v NEAREST_WALKABLE_BFS_RADIUS nikoho nenajde
//   - 'too_far': A* selže (žádná cesta nebo path > MAX_PATH_LENGTH_TILES)
export type MoveRejectReason =
  | 'malformed'
  | 'rate_limited'
  | 'stunned'
  | 'out_of_bounds'
  | 'no_path'
  | 'too_far';

export interface MoveRejected {
  reason: MoveRejectReason;
  client_seq: number; // echo z požadavku (0 pokud payload byl malformed)
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
