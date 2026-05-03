import type { Position } from '../types/world.js';

export interface MoveRequest {
  target: Position;
  client_seq: number;
}

// Op.ENTITY_MOVED (2) — server → klienti v 3×3 chunkovém okolí. **Path-based
// broadcast** per ADR-019 (RuneScape/Tibia tradice): server posílá zprávu
// **jednou** po validaci MOVE_REQUEST s celou pathou; klient drží wall-clock
// baseline (Date.now()) a ve scene update() callback každý frame deterministic-ky
// recomputuje sprite pozici. Self-correcting proti hidden-tab drift. Mid-path
// změna cíle = re-broadcast s aktuální `from` jako začátkem nového path.
//
//   - `from`: aktuální server position v okamžiku broadcast (start path).
//   - `path`: sekvence tilů od `from` (NEZAHRNUJE `from`, prvý prvek = první step).
//   - `speed_tps`: tiles per second (= MOVEMENT_SPEED_TPS_BASE pro MVP).
//   - `started_at_tick`: server tick kdy path začal — klient může vypočítat
//     skutečnou pozici v daný moment pro late-join sync.
export interface EntityMoved {
  entity_id: string;
  from: Position;
  path: Position[];
  speed_tps: number;
  started_at_tick: number;
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

// WORLD_SNAPSHOT entity entry — joiner-only broadcast v matchJoin. Pokud entity
// je uprostřed pohybu (server má aktivní path), include `path` (zbytek od current
// position), `speed_tps`, `started_at_tick` — klient z toho zrekonstruuje
// in-flight movement state, takže joiner vidí ostatní v plynulém pohybu, ne
// stojící na current tile dokud se nehnou znovu (per ADR-019).
export interface WorldSnapshotEntity {
  id: string;
  type: 'player' | 'mob' | 'npc' | 'drop';
  position: Position;
  hp_pct?: number;
  display_name?: string;
  // Path-in-flight data, present jen když entity je uprostřed pohybu.
  path?: Position[];
  speed_tps?: number;
  started_at_tick?: number;
}

export interface WorldSnapshot {
  tick: number;
  entities: WorldSnapshotEntity[];
}
