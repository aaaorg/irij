// Movement handler — zpracování Op.MOVE_REQUEST a tile-by-tile advance v matchLoop.
// Viz docs/03-message-katalog.md sekce Movement + Rate limiting + Constraints.
//
// Pipeline handleMoveRequest:
//   1. Parse + validate payload shape → 'malformed'
//   2. Per-userId rate limit (sliding 1s window, 10/s) → 'rate_limited'
//   3. Stunned check (4b stub, Phase 6 implementuje) → 'stunned'
//   4. In-bounds check (target floored to int) → 'out_of_bounds'
//   5. Walkable check + nearestWalkable BFS fallback (radius 8) → 'no_path'
//   6. A* pathfind from presence.position to effective target → 'too_far'
//   7. Uložit path + pathStartedAt do presence (spread + reassign per Goja rule)
//
// Position advance v matchLoop (advanceMovement):
//   - Pro každého presence s path.length > 0:
//     - tilesAdvanced = floor((tick - pathStartedAt) * MOVEMENT_SPEED_TPS_BASE / TICK_HZ)
//     - newConsumed = min(tilesAdvanced, path.length)
//     - Pop (newConsumed - pathConsumed) tilů z hlavy path; nová position = poslední pop
//     - Pokud chunk se změnil → updatuj presencesByChunk
//     - Broadcast ENTITY_MOVED do 3×3 chunkového okolí
//     - Pokud path skončil → clear path + pathStartedAt + pathConsumed
//
// Goja constraint: nikdy nemutuj presence object přes referenci. Vždy
//   state.presencesByUserId[userId] = { ...state.presencesByUserId[userId], ... };
// Stejně pro state.moveRequestLog.

import {
  MAX_PATH_LENGTH_TILES,
  MOVEMENT_SPEED_TPS_BASE,
  NEAREST_WALKABLE_BFS_RADIUS,
  TICK_HZ,
} from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type { EntityMoved, MoveRejectReason, MoveRejected, MoveRequest } from 'irij-shared/messages';
import type { Position } from 'irij-shared/types';

import { findPath } from './pathfinding.js';
import {
  broadcastToChunkArea,
  chunkKeyOf,
  movePresenceBetweenChunks,
  type WorldMatchState,
} from './state.js';
import { isInBounds, isWalkable, nearestWalkable } from './walkable.js';

const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

// Validate raw decoded JSON proti MoveRequest shape. Vrací parsed nebo null.
function parseMoveRequest(raw: unknown): MoveRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const target = obj.target;
  const clientSeq = obj.client_seq;
  if (!target || typeof target !== 'object') return null;
  const t = target as Record<string, unknown>;
  if (typeof t.x !== 'number' || typeof t.y !== 'number') return null;
  if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) return null;
  if (typeof clientSeq !== 'number' || !Number.isFinite(clientSeq)) return null;
  return {
    target: { x: Math.floor(t.x), y: Math.floor(t.y) },
    client_seq: clientSeq,
  };
}

export interface MoveHandlerResult {
  ok: boolean;
  reason?: MoveRejectReason;
  clientSeq: number;
}

export function handleMoveRequest(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  presence: nkruntime.Presence,
  rawData: string,
  tick: number,
): MoveHandlerResult {
  const userId = presence.userId;
  const ps = state.presencesByUserId[userId];
  if (!ps) {
    // Hráč není v presence indexu — race s leave, ignore.
    return { ok: false, reason: 'malformed', clientSeq: 0 };
  }

  // 1) Parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return { ok: false, reason: 'malformed', clientSeq: 0 };
  }
  const req = parseMoveRequest(parsed);
  if (!req) {
    return { ok: false, reason: 'malformed', clientSeq: 0 };
  }

  // 2) Rate limit (sliding window 1s, max 10).
  const nowMs = Date.now();
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
  const prevLog = state.moveRequestLog[userId] ?? [];
  const trimmed = prevLog.filter((t) => t > cutoff);
  if (trimmed.length >= RATE_LIMIT_MAX_REQUESTS) {
    // Save trimmed back so window stays current; reject.
    state.moveRequestLog = { ...state.moveRequestLog, [userId]: trimmed };
    return { ok: false, reason: 'rate_limited', clientSeq: req.client_seq };
  }
  trimmed.push(nowMs);
  state.moveRequestLog = { ...state.moveRequestLog, [userId]: trimmed };

  // 3) Stunned — TODO Phase 6 (combat status effects).

  // 4) In-bounds — Math.floor v parseMoveRequest, ale stále ověř.
  if (!isInBounds(state.walkable, req.target.x, req.target.y)) {
    logger.info(
      `move rejected userId=${userId.slice(0, 8)} reason=out_of_bounds target=(${req.target.x},${req.target.y})`,
    );
    return { ok: false, reason: 'out_of_bounds', clientSeq: req.client_seq };
  }

  // 5) Walkable check + BFS fallback
  let effectiveTarget: Position = req.target;
  if (!isWalkable(state.walkable, req.target.x, req.target.y)) {
    const snap = nearestWalkable(
      state.walkable,
      req.target.x,
      req.target.y,
      NEAREST_WALKABLE_BFS_RADIUS,
    );
    if (!snap) {
      logger.info(
        `move rejected userId=${userId.slice(0, 8)} reason=no_path target=(${req.target.x},${req.target.y})`,
      );
      return { ok: false, reason: 'no_path', clientSeq: req.client_seq };
    }
    effectiveTarget = snap;
  }

  // 6) A* pathfind
  const path = findPath(state.walkable, ps.position, effectiveTarget, {
    maxPathLength: MAX_PATH_LENGTH_TILES,
  });
  if (path === null) {
    logger.info(
      `move rejected userId=${userId.slice(0, 8)} reason=too_far from=(${ps.position.x},${ps.position.y}) target=(${effectiveTarget.x},${effectiveTarget.y})`,
    );
    return { ok: false, reason: 'too_far', clientSeq: req.client_seq };
  }

  // 7) Uložit path do presence — spread + reassign (Goja nested mutation gotcha).
  state.presencesByUserId = {
    ...state.presencesByUserId,
    [userId]: {
      ...ps,
      path,
      pathStartedAt: tick,
      pathConsumed: 0,
      clientSeq: req.client_seq,
    },
  };

  logger.debug(
    `move accepted userId=${userId.slice(0, 8)} from=(${ps.position.x},${ps.position.y}) to=(${effectiveTarget.x},${effectiveTarget.y}) steps=${path.length}`,
  );

  return { ok: true, clientSeq: req.client_seq };
}

export function broadcastMoveRejected(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  reason: MoveRejectReason,
  clientSeq: number,
): void {
  const payload: MoveRejected = { reason, client_seq: clientSeq };
  dispatcher.broadcastMessage(Op.MOVE_REJECTED, JSON.stringify(payload), [presence]);
}

// advanceMovement — volá se z matchLoop každý tick. Pro každý presence s aktivním
// path spočte, kolik tilů se mělo posunout (na základě MOVEMENT_SPEED_TPS_BASE),
// popne odpovídající počet z hlavy path, broadcastne ENTITY_MOVED na každý tile
// boundary do 3×3 chunkového okolí. Nechá float position serveru jako integer —
// klient interpoluje mezi přijatými pozicemi (smooth lerp).
export function advanceMovement(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  const userIds = Object.keys(state.presencesByUserId);
  for (const userId of userIds) {
    const ps = state.presencesByUserId[userId];
    if (!ps) continue;
    if (!ps.path || ps.path.length === 0) continue;

    // Speed: MOVEMENT_SPEED_TPS_BASE tilů/s × TICK_HZ ticků/s → tiles per tick.
    // 3 / 10 = 0.3 tile/tick, tj. 1 tile každé ~3.33 ticky.
    const ticksElapsed = tick - ps.pathStartedAt;
    const tilesShouldHaveMoved = Math.floor((ticksElapsed * MOVEMENT_SPEED_TPS_BASE) / TICK_HZ);
    const totalTilesInPath = ps.pathConsumed + ps.path.length;
    const newConsumed = Math.min(tilesShouldHaveMoved, totalTilesInPath);

    if (newConsumed <= ps.pathConsumed) continue; // ještě nepřekročili tile boundary

    const stepsToTake = newConsumed - ps.pathConsumed;
    const fromPos: Position = { x: ps.position.x, y: ps.position.y };

    // Pop `stepsToTake` from front of path. Nová pozice = poslední z popnutých.
    const remaining = ps.path.slice(stepsToTake);
    const lastStep = ps.path[stepsToTake - 1];
    if (!lastStep) continue; // defenzivní, nemělo by se stát
    const newPos: Position = { x: lastStep.x, y: lastStep.y };

    // Update chunk index pokud jsme přešli mezi chunkami.
    const oldChunk = ps.lastChunk;
    const newChunk = chunkKeyOf(newPos);
    if (oldChunk !== newChunk) {
      movePresenceBetweenChunks(state, userId, fromPos, newPos);
    }

    // Spread + reassign whole presence entry (Goja nested mutation rule).
    // Pokud path skončil, vyčisti pathStartedAt + pathConsumed na 0 aby další
    // request měl čistý baseline. Při path.length>0 udržujeme akumulované hodnoty.
    const finished = remaining.length === 0;
    state.presencesByUserId = {
      ...state.presencesByUserId,
      [userId]: {
        ...ps,
        position: newPos,
        path: remaining,
        pathConsumed: finished ? 0 : newConsumed,
        pathStartedAt: finished ? 0 : ps.pathStartedAt,
        lastChunk: newChunk,
      },
    };

    // Broadcast ENTITY_MOVED do 3×3 chunkového okolí. Posíláme z newChunk
    // (ne oldChunk), aby noví příjemci v cílovém chunku dostali update i kdyby
    // hráč právě překročil chunk boundary z mimo-jejich-okolí.
    const movedPayload: EntityMoved = {
      entity_id: userId,
      from: fromPos,
      to: newPos,
      speed_tps: MOVEMENT_SPEED_TPS_BASE,
      server_tick: tick,
    };
    broadcastToChunkArea(dispatcher, state, newChunk, Op.ENTITY_MOVED, movedPayload);
  }
}
