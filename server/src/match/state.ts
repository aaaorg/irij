// World match state + chunk index helpers — viz docs/04-tech-adr.md ADR-005, ADR-007.
//
// Per ADR-005: kód musí být strukturovaný jako kdyby chunky byly samostatné matche.
// Žádný globální iterace nad celým světem — vždy spatial lookup přes chunkový index.
// Per ADR-007: 3×3 chunkové broadcast scope (Chebyshev distance ≤ BROADCAST_CHUNK_RADIUS).
//
// **Goja constraint:** Nakama JS runtime mezi handler voláními Export()-uje
// state do Go `map[string]interface{}` a rekonstruuje fresh Goja objekty přes
// `stateObject.Set(k, v)` (viz runtime_javascript_match_core.go). Důsledek:
//   1. `Map` a `Set` instance se stripnou na plain objects — proto
//      `Record<string, X>` místo `Map<string, X>` a `Record<string, true>`
//      (object-as-set) místo `Set<string>`.
//   2. **Mutace nested objektů přes referenci se ZTRATÍ** mezi handler calls.
//      Vždy spread + reassign celého top-level fieldu:
//          state.x = { ...state.x, foo: bar };
//      ne:
//          state.x.foo = bar;  // ztratí se na další callback
//      To platí i pro presence state, paths, chunk buckets — vše níže to
//      respektuje.

import { BROADCAST_CHUNK_RADIUS, CHUNK_SIZE_TILES } from 'irij-shared/constants';
import type { Position } from 'irij-shared/types';
import type { WalkableMask } from './walkable.js';

export interface PlayerPresenceState {
  presence: nkruntime.Presence;
  position: Position;
  displayName: string;
  hpCurrent: number;
  hpMax: number;
  lastChunk: string; // chunkKey kde se hráč naposledy nacházel (pro chunk-crossing diff)
  joinedAt: number; // ms timestamp pro debug / autosave delta v Phase 5
  // 4b movement state. `path` je pole zbývajících tile coords k projít — index 0 je
  // nejbližší další tile, end je finální target. Když path.length===0, hráč stojí.
  // `pathStartedAt` je server tick, kdy začal aktuální path advance (pro speed math).
  // `pathConsumed` je počet tile boundaries překročených od pathStartedAt (pro
  // diff "kolik nových tilů popnout v tomto loopu"). `clientSeq` echo posledního
  // přijatého MOVE_REQUEST pro reconciliation v 4c.
  path: Position[];
  pathStartedAt: number;
  pathConsumed: number;
  clientSeq: number;
}

export interface WorldMatchState {
  tick: number;
  walkable: WalkableMask;
  // Plain object místo Map kvůli Goja state-serializaci mezi callbacks.
  presencesByUserId: { [userId: string]: PlayerPresenceState };
  // Plain object místo Map<string, Set<string>>; vnitřní set je Record<userId, true>.
  presencesByChunk: { [chunkKey: string]: { [userId: string]: true } };
  // 4b: per-userId timestampy posledních N MOVE_REQUESTů (ms epoch). Sliding window
  // pro rate limit 10/s. Trim probíhá při každém checku v handleMoveRequest.
  moveRequestLog: { [userId: string]: number[] };
}

export function chunkKeyOf(pos: Position): string {
  const cx = Math.floor(pos.x / CHUNK_SIZE_TILES);
  const cy = Math.floor(pos.y / CHUNK_SIZE_TILES);
  return `${cx},${cy}`;
}

// Chebyshev (king-move) distance v chunk-space. 3×3 okolí = vše s distance ≤ 1.
export function chunkDistance(a: string, b: string): number {
  const [ax, ay] = a.split(',').map(Number) as [number, number];
  const [bx, by] = b.split(',').map(Number) as [number, number];
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// Goja quirk: nested object mutations via `bucket[key] = value` aren't always
// flushed back to state if `bucket` was read by reference. Bezpečné je vždy
// re-assignovat celý bucket na `state.presencesByChunk[chunkKey]`. Stejný
// pattern ve všech mutacích nested objects v match state.

export function addPresenceToChunk(
  state: WorldMatchState,
  userId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const bucket = { ...(state.presencesByChunk[key] ?? {}) };
  bucket[userId] = true;
  state.presencesByChunk[key] = bucket;
}

export function removePresenceFromChunk(
  state: WorldMatchState,
  userId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const existing = state.presencesByChunk[key];
  if (!existing) return;
  const bucket = { ...existing };
  delete bucket[userId];
  if (Object.keys(bucket).length === 0) {
    delete state.presencesByChunk[key];
  } else {
    state.presencesByChunk[key] = bucket;
  }
}

// Použito v 4b při tile-by-tile advance: pokud nový tile spadá do jiného chunku,
// updatuj index. Pokud je oldPos === newPos chunk, no-op.
export function movePresenceBetweenChunks(
  state: WorldMatchState,
  userId: string,
  oldPos: Position,
  newPos: Position,
): void {
  const oldKey = chunkKeyOf(oldPos);
  const newKey = chunkKeyOf(newPos);
  if (oldKey === newKey) return;
  removePresenceFromChunk(state, userId, oldPos);
  addPresenceToChunk(state, userId, newPos);
}

// D5: Transactionally-safe presence location update. Reassigns both
// presencesByUserId and presencesByChunk in a single pass — avoids Goja
// invariant break from two separate spread-reassigns.
export function updatePresenceLocation(
  state: WorldMatchState,
  userId: string,
  newPos: Position,
): void {
  const ps = state.presencesByUserId[userId];
  if (!ps) return;
  const oldChunk = chunkKeyOf(ps.position);
  const newChunk = chunkKeyOf(newPos);
  if (oldChunk !== newChunk) {
    removePresenceFromChunk(state, userId, ps.position);
    addPresenceToChunk(state, userId, newPos);
  }
}

// Vrací Presence[] všech hráčů, kteří jsou ve fromChunk nebo v jeho 3×3 okolí
// (Chebyshev ≤ radius). Žádný globální scan — iterujeme jen presencesByChunk
// keys, což je O(active chunks), ne O(total players).
export function recipientsInRangeOfChunk(
  state: WorldMatchState,
  fromChunk: string,
  radius: number = BROADCAST_CHUNK_RADIUS,
): nkruntime.Presence[] {
  const result: nkruntime.Presence[] = [];
  for (const chunkKey of Object.keys(state.presencesByChunk)) {
    if (chunkDistance(fromChunk, chunkKey) > radius) continue;
    const bucket = state.presencesByChunk[chunkKey];
    if (!bucket) continue;
    for (const userId of Object.keys(bucket)) {
      const ps = state.presencesByUserId[userId];
      if (ps) result.push(ps.presence);
    }
  }
  return result;
}

// Wrapper pro spawn/despawn/move broadcasts. Pokud excludeUserId je nastaveno,
// příjemci s tímto userId budou odfiltrováni (např. self-exclude při ENTITY_SPAWNED
// — joiner dostane joiner-only WORLD_SNAPSHOT místo).
export function broadcastToChunkArea(
  dispatcher: nkruntime.MatchDispatcher,
  state: WorldMatchState,
  fromChunk: string,
  opcode: number,
  payload: unknown,
  excludeUserId?: string,
): void {
  const recipients = recipientsInRangeOfChunk(state, fromChunk);
  const filtered = excludeUserId
    ? recipients.filter((p) => p.userId !== excludeUserId)
    : recipients;
  if (filtered.length === 0) return;
  dispatcher.broadcastMessage(opcode, JSON.stringify(payload), filtered);
}
