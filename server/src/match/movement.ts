// Movement handler — zpracování Op.MOVE_REQUEST a path-based broadcast model.
// Viz docs/03-message-katalog.md sekce Movement + Rate limiting + Constraints
// + docs/04-tech-adr.md ADR-019 (path-based broadcast).
//
// Pipeline handleMoveRequest:
//   1. Parse + validate payload shape → 'malformed'
//   2. Per-userId rate limit (sliding 1s window, 10/s) → 'rate_limited'
//   3. Stunned check (4b stub, Phase 6 implementuje) → 'stunned'
//   4. In-bounds check (target floored to int) → 'out_of_bounds'
//   5. Walkable check + nearestWalkable BFS fallback (radius 8) → 'no_path'
//   6. A* pathfind from CURRENT position to effective target → 'too_far'
//      (current = ps.position pokud presence stojí; jinak computeCurrentPosition
//       z aktivního path — change-mid-path-cíle musí navázat na aktuální tile,
//       ne na starý path start).
//   7. Uložit nový path + pathStartedAt + position(=from) do presence (spread +
//      reassign per Goja rule), pathConsumed=0.
//   8. Broadcast ENTITY_MOVED **JEDNOU** s celou path do 3×3 chunkového okolí.
//
// Position advance v matchLoop (advanceMovement):
//   - Server stále tracká aktuální tile pro chunk index + pozdější autosave
//     (Phase 5) + anti-cheat dosah validaci (Phase 6+). Path advance logic
//     udržuje state v sync s tím, co klient lerpuje na základě jednoho
//     ENTITY_MOVED broadcast.
//   - Pro každého presence s path.length > 0:
//     - tilesAdvanced = floor((tick - pathStartedAt) * speed / TICK_HZ)
//     - Pokud tilesAdvanced > pathConsumed → newPos = path[tilesAdvanced - 1]
//     - Update chunk index, presence position
//     - Pokud pathConsumed dosáhl path.length → clear path state
//   - **ŽÁDNÝ broadcast z matchLoop** (změna oproti původnímu 4b: per-tile
//     ENTITY_MOVED odstraněn — klient lerpuje na základě jednorázové broadcast
//     z handleMoveRequest, per ADR-019).
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

import { logAudit } from '../lib/audit.js';
import { findPath } from './pathfinding.js';
import {
  broadcastToChunkArea,
  chunkKeyOf,
  movePresenceBetweenChunks,
  type PlayerPresenceState,
  type WorldMatchState,
} from './state.js';
import { isInBounds, isWalkable, nearestWalkable } from './walkable.js';

export const RATE_LIMIT_WINDOW_MS = 1000;
export const RATE_LIMIT_MAX_REQUESTS = 10;

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

// computeCurrentPosition: pokud presence má aktivní path, spočte tile, na kterém
// by měl právě být na základě (currentTick - pathStartedAt) * speed / TICK_HZ.
// Použito pro change-mid-path-cíle: nový path A* musí začít z aktuální mid-path
// pozice, ne ze starého ps.position (ten zaostává o "ještě neapplied" advance).
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
  // path[i] index i je tile co se dosáhne po (pathConsumed + i + 1) krocích.
  // Po `effectiveAdvanced` krocích je current = path[effectiveAdvanced - pathConsumed - 1].
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
  const prevLog = state.moveRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
  state.moveRequestLog = { ...state.moveRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) {
    return { ok: false, reason: 'rate_limited', clientSeq: req.client_seq };
  }

  // 3) Stunned — TODO Phase 6 (combat status effects).

  // 4) In-bounds — Math.floor v parseMoveRequest, ale stále ověř.
  if (!isInBounds(state.walkable, req.target.x, req.target.y)) {
    logger.info(
      `move rejected userId=${userId.slice(0, 8)} reason=out_of_bounds target=(${req.target.x},${req.target.y})`,
    );
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
      logger.info(
        `move rejected userId=${userId.slice(0, 8)} reason=no_path target=(${req.target.x},${req.target.y})`,
      );
      return { ok: false, reason: 'no_path', clientSeq: req.client_seq };
    }
    effectiveTarget = snap;
  }

  // 6) A* pathfind. Pokud presence už má aktivní path (klikla znovu mid-path),
  //    začni z **aktuální** pozice po lerpu, ne z původního path startu —
  //    jinak by se klient teleportoval zpět při change-cíle.
  const fromPos: Position = computeCurrentPosition(ps, tick);
  const path = findPath(state.walkable, fromPos, effectiveTarget, {
    maxPathLength: MAX_PATH_LENGTH_TILES,
  });
  if (path === null) {
    logger.info(
      `move rejected userId=${userId.slice(0, 8)} reason=too_far from=(${fromPos.x},${fromPos.y}) target=(${effectiveTarget.x},${effectiveTarget.y})`,
    );
    logAudit(nk, 'move_rejected', {
      userId,
      payload: { reason: 'too_far', from: fromPos, target: effectiveTarget },
    });
    return { ok: false, reason: 'too_far', clientSeq: req.client_seq };
  }
  if (path.length === 0) {
    // from === to po snap. Žádný pohyb, ale request je validní — neposílej
    // ENTITY_MOVED (klient nemá co lerpovat). Just ack přes ok=true.
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

  // 7) Update server-side state. Position se snape na current (mid-path
  //    catchup), nový path se uloží s pathStartedAt = tick, pathConsumed = 0.
  //    Goja rule: spread + reassign celou top-level mapu, nemutuj nested.
  // Pokud chunk se změnil oproti starému position (ps.position) → sync index.
  const oldChunk = ps.lastChunk;
  const newChunk = chunkKeyOf(fromPos);
  if (oldChunk !== newChunk) {
    movePresenceBetweenChunks(state, userId, ps.position, fromPos);
  }

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

  // 8) Broadcast ENTITY_MOVED **jednou** do 3×3 chunkového okolí. Klient
  //    lokálně buildí TweenChain z path a lerpuje plynule per-tile bez čekání
  //    na další server update (per ADR-019).
  const movedPayload: EntityMoved = {
    entity_id: userId,
    from: fromPos,
    path,
    speed_tps: MOVEMENT_SPEED_TPS_BASE,
    started_at_tick: tick,
  };
  broadcastToChunkArea(dispatcher, state, newChunk, Op.ENTITY_MOVED, movedPayload);

  logger.debug(
    `move accepted userId=${userId.slice(0, 8)} from=(${fromPos.x},${fromPos.y}) to=(${effectiveTarget.x},${effectiveTarget.y}) steps=${path.length}`,
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

// advanceMovement — volá se z matchLoop každý tick. Per ADR-019 udržuje
// **server-side state** (ps.position, chunk index) v sync s tím, co klient
// lerpuje. ENTITY_MOVED se broadcastuje JEN 1× při handleMoveRequest, ne tady.
//
// Server tracká integer tile coords pro:
//   - Chunk index (presencesByChunk) — broadcast scope determinaci
//   - Pozdější autosave (Phase 5: snapshotuje current_position do Player blobu)
//   - Anti-cheat dosah validaci (Phase 6+: server musí vědět, kde hráč JE,
//     ne kde byl při startu pathu)
//   - Late-join WORLD_SNAPSHOT (joiner musí dostat current position a zbytek
//     path pro plynulý lerp)
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
    // request měl čistý baseline.
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

    // ENTITY_MOVED se broadcastuje jen 1× per MOVE_REQUEST per ADR-019;
    // matchLoop udržuje server-side position state pro chunk index a pozdější
    // autosave (Phase 5), ale neposílá per-tile zprávy.
  }
}
