// Movement handler — zpracování Op.MOVE_REQUEST a path-based broadcast model.
// Viz docs/03-message-katalog.md sekce Movement + Rate limiting + Constraints
// + docs/04-tech-adr.md ADR-019 (path-based broadcast).

import {
  MAX_PATH_LENGTH_TILES,
  MOVEMENT_SPEED_TPS_BASE,
  NEAREST_WALKABLE_BFS_RADIUS,
  TICK_HZ,
} from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type { EntityMoved, MoveRejectReason, MoveRejected, MoveRequest } from 'irij-shared/messages';
import type { Position } from 'irij-shared/types';
import { int, num, obj, parse } from 'irij-shared';

import { logAudit } from '../lib/audit.js';
import { log } from '../lib/log.js';
import { findPath } from './pathfinding.js';
import {
  broadcastToChunkArea,
  chunkKeyOf,
  updatePresenceLocation,
  type PlayerPresenceState,
  type WorldMatchState,
} from './state.js';
import { isInBounds, isWalkable, nearestWalkable } from './walkable.js';

export const RATE_LIMIT_WINDOW_MS = 1000;
export const RATE_LIMIT_MAX_REQUESTS = 10;

const MoveRequestSchema = obj({
  target: obj({
    x: num(),
    y: num(),
  }),
  client_seq: num(),
});

export function checkRateLimit(
  log: number[],
  nowMs: number,
  windowMs: number,
  maxRequests: number,
): { allowed: boolean; updatedLog: number[] } {
  const cutoff = nowMs - windowMs;
  const trimmed = log.filter((t) => t > cutoff);
  if (trimmed.length >= maxRequests) {
    return { allowed: false, updatedLog: trimmed };
  }
  trimmed.push(nowMs);
  return { allowed: true, updatedLog: trimmed };
}

export function parseMoveRequest(raw: unknown): MoveRequest | null {
  const result = parse(MoveRequestSchema, raw);
  if (!result.ok) return null;
  const v = result.value;
  if (!Number.isFinite(v.target.x) || !Number.isFinite(v.target.y)) return null;
  if (!Number.isFinite(v.client_seq)) return null;
  return {
    target: { x: Math.floor(v.target.x), y: Math.floor(v.target.y) },
    client_seq: v.client_seq,
  };
}

export interface MoveHandlerResult {
  ok: boolean;
  reason?: MoveRejectReason;
  clientSeq: number;
}

export function computeCurrentPosition(
  ps: PlayerPresenceState,
  currentTick: number,
): Position {
  if (!ps.path || ps.path.length === 0) {
    return { x: ps.position.x, y: ps.position.y };
  }
  const ticksElapsed = currentTick - ps.pathStartedAt;
  const tilesShouldHaveMoved = Math.floor(
    (ticksElapsed * MOVEMENT_SPEED_TPS_BASE) / TICK_HZ,
  );
  const totalTilesInPath = ps.pathConsumed + ps.path.length;
  const effectiveAdvanced = Math.max(
    ps.pathConsumed,
    Math.min(tilesShouldHaveMoved, totalTilesInPath),
  );
  if (effectiveAdvanced <= ps.pathConsumed) {
    return { x: ps.position.x, y: ps.position.y };
  }
  const idx = effectiveAdvanced - ps.pathConsumed - 1;
  const tile = ps.path[idx];
  if (!tile) return { x: ps.position.x, y: ps.position.y };
  return { x: tile.x, y: tile.y };
}

export function handleMoveRequest(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  tick: number,
): MoveHandlerResult {
  const userId = presence.userId;
  const ps = state.presencesByUserId[userId];
  if (!ps) {
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
  const prevLog = state.moveRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
  state.moveRequestLog = { ...state.moveRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) {
    return { ok: false, reason: 'rate_limited', clientSeq: req.client_seq };
  }

  // 3) Stunned — TODO Phase 6 (combat status effects).

  // 4) In-bounds
  if (!isInBounds(state.walkable, req.target.x, req.target.y)) {
    log(logger, 'info', 'move rejected', {
      userId: userId.slice(0, 8),
      reason: 'out_of_bounds',
      target: req.target,
    });
    logAudit(nk, 'move_rejected', {
      userId,
      payload: { reason: 'out_of_bounds', target: req.target },
    });
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
      log(logger, 'info', 'move rejected', {
        userId: userId.slice(0, 8),
        reason: 'no_path',
        target: req.target,
      });
      return { ok: false, reason: 'no_path', clientSeq: req.client_seq };
    }
    effectiveTarget = snap;
  }

  // 6) A* pathfind from current mid-path position.
  const fromPos: Position = computeCurrentPosition(ps, tick);
  const path = findPath(state.walkable, fromPos, effectiveTarget, {
    maxPathLength: MAX_PATH_LENGTH_TILES,
  });
  if (path === null) {
    log(logger, 'info', 'move rejected', {
      userId: userId.slice(0, 8),
      reason: 'too_far',
      from: fromPos,
      target: effectiveTarget,
    });
    logAudit(nk, 'move_rejected', {
      userId,
      payload: { reason: 'too_far', from: fromPos, target: effectiveTarget },
    });
    return { ok: false, reason: 'too_far', clientSeq: req.client_seq };
  }
  if (path.length === 0) {
    state.presencesByUserId = {
      ...state.presencesByUserId,
      [userId]: {
        ...ps,
        position: fromPos,
        path: [],
        pathStartedAt: 0,
        pathConsumed: 0,
        clientSeq: req.client_seq,
      },
    };
    return { ok: true, clientSeq: req.client_seq };
  }

  // 7) Update server-side state + chunk index via transactional helper.
  updatePresenceLocation(state, userId, fromPos);

  const newChunk = chunkKeyOf(fromPos);
  state.presencesByUserId = {
    ...state.presencesByUserId,
    [userId]: {
      ...ps,
      position: fromPos,
      path,
      pathStartedAt: tick,
      pathConsumed: 0,
      clientSeq: req.client_seq,
      lastChunk: newChunk,
    },
  };

  // 8) Broadcast ENTITY_MOVED jednou do 3×3 chunkového okolí.
  const movedPayload: EntityMoved = {
    entity_id: userId,
    from: fromPos,
    path,
    speed_tps: MOVEMENT_SPEED_TPS_BASE,
    started_at_tick: tick,
  };
  broadcastToChunkArea(dispatcher, state, newChunk, Op.ENTITY_MOVED, movedPayload);

  log(logger, 'debug', 'move accepted', {
    userId: userId.slice(0, 8),
    from: fromPos,
    to: effectiveTarget,
    steps: path.length,
  });

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

export function advanceMovement(
  state: WorldMatchState,
  _dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  const userIds = Object.keys(state.presencesByUserId);
  for (const userId of userIds) {
    const ps = state.presencesByUserId[userId];
    if (!ps) continue;
    if (!ps.path || ps.path.length === 0) continue;

    const ticksElapsed = tick - ps.pathStartedAt;
    const tilesShouldHaveMoved = Math.floor((ticksElapsed * MOVEMENT_SPEED_TPS_BASE) / TICK_HZ);
    const totalTilesInPath = ps.pathConsumed + ps.path.length;
    const newConsumed = Math.min(tilesShouldHaveMoved, totalTilesInPath);

    if (newConsumed <= ps.pathConsumed) continue;

    const stepsToTake = newConsumed - ps.pathConsumed;
    const remaining = ps.path.slice(stepsToTake);
    const lastStep = ps.path[stepsToTake - 1];
    if (!lastStep) continue;
    const newPos: Position = { x: lastStep.x, y: lastStep.y };

    // Transactionally update chunk index.
    updatePresenceLocation(state, userId, newPos);

    const finished = remaining.length === 0;
    const newChunk = chunkKeyOf(newPos);
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
  }
}
