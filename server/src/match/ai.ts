import { TICK_HZ } from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type { EntityMoved, EntitySpawned } from 'irij-shared/messages';
import type { Position } from 'irij-shared/types';

import { log } from '../lib/log.js';
import { chebyshevDistance, isMeleeAdjacent } from './combat.js';
import { findPath } from './pathfinding.js';
import { isWalkable, isInBounds } from './walkable.js';
import {
  addMobToChunk,
  broadcastToChunkArea,
  chunkKeyOf,
  moveMobBetweenChunks,
  removeMobFromChunk,
  type MobInstanceState,
  type WorldMatchState,
} from './state.js';

export function runAiTick(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  for (const instanceId of Object.keys(state.mobInstances)) {
    const mob = state.mobInstances[instanceId];
    if (!mob) continue;

    switch (mob.aiState) {
      case 'idle':
        tickIdle(state, dispatcher, mob, tick);
        break;
      case 'chase':
        tickChase(state, logger, dispatcher, mob, tick);
        break;
      case 'attack':
        tickAttack(state, mob);
        break;
      case 'leash_return':
        tickLeashReturn(state, dispatcher, mob, tick);
        break;
      case 'dead':
        break;
    }
  }
}

export function checkMobRespawns(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  for (const instanceId of Object.keys(state.mobInstances)) {
    const mob = state.mobInstances[instanceId];
    if (!mob || mob.aiState !== 'dead' || mob.respawnAtTick === null) continue;
    if (tick < mob.respawnAtTick) continue;

    const def = state.mobDefinitions[mob.mobId];
    if (!def) continue;

    removeMobFromChunk(state, instanceId, mob.position);

    const newChunk = chunkKeyOf(mob.spawnPosition);
    const respawned: MobInstanceState = {
      ...mob,
      position: { ...mob.spawnPosition },
      hpCurrent: def.stats.hp_max,
      hpMax: def.stats.hp_max,
      aiState: 'idle',
      targetUserId: null,
      lastAttackTick: 0,
      lastChunk: newChunk,
      path: [],
      pathStartedAt: 0,
      pathConsumed: 0,
      deathTick: null,
      respawnAtTick: null,
    };

    state.mobInstances = { ...state.mobInstances, [instanceId]: respawned };
    addMobToChunk(state, instanceId, mob.spawnPosition);

    const spawnPayload: EntitySpawned = {
      entity_id: instanceId,
      type: 'mob',
      position: mob.spawnPosition,
      mob_id: mob.mobId,
      display_name_cs: def.name_cs,
      level: def.level,
      hp_pct: 1,
    };
    broadcastToChunkArea(dispatcher, state, newChunk, Op.ENTITY_SPAWNED, spawnPayload);
  }
}

export function advanceMobMovement(
  state: WorldMatchState,
  _dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  for (const instanceId of Object.keys(state.mobInstances)) {
    const mob = state.mobInstances[instanceId];
    if (!mob || mob.path.length === 0) continue;

    const ticksElapsed = tick - mob.pathStartedAt;
    const tilesShouldHaveMoved = Math.floor((ticksElapsed * mob.speedTps) / TICK_HZ);
    const totalTilesInPath = mob.pathConsumed + mob.path.length;
    const newConsumed = Math.min(tilesShouldHaveMoved, totalTilesInPath);

    if (newConsumed <= mob.pathConsumed) continue;

    const stepsToTake = newConsumed - mob.pathConsumed;
    const remaining = mob.path.slice(stepsToTake);
    const lastStep = mob.path[stepsToTake - 1];
    if (!lastStep) continue;

    const newPos: Position = { x: lastStep.x, y: lastStep.y };
    moveMobBetweenChunks(state, instanceId, mob.position, newPos);

    const finished = remaining.length === 0;
    state.mobInstances = {
      ...state.mobInstances,
      [instanceId]: {
        ...mob,
        position: newPos,
        path: remaining,
        pathConsumed: finished ? 0 : newConsumed,
        pathStartedAt: finished ? 0 : mob.pathStartedAt,
        lastChunk: chunkKeyOf(newPos),
      },
    };
  }
}

function broadcastMobStop(
  dispatcher: nkruntime.MatchDispatcher,
  state: WorldMatchState,
  mob: MobInstanceState,
): void {
  const payload: EntityMoved = {
    entity_id: mob.instanceId,
    from: mob.position,
    path: [],
    speed_tps: mob.speedTps || 2,
    started_at_tick: 0,
  };
  broadcastToChunkArea(dispatcher, state, mob.lastChunk, Op.ENTITY_MOVED, payload);
}

function tickIdle(
  state: WorldMatchState,
  _dispatcher: nkruntime.MatchDispatcher,
  mob: MobInstanceState,
  _tick: number,
): void {
  const def = state.mobDefinitions[mob.mobId];
  if (!def || def.ai_behavior === 'passive') return;

  const nearest = findNearestPlayer(state, mob, def.aggro_radius_tiles);
  if (!nearest) return;

  state.mobInstances = {
    ...state.mobInstances,
    [mob.instanceId]: {
      ...mob,
      aiState: 'chase' as const,
      targetUserId: nearest,
    },
  };
}

function tickChase(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  mob: MobInstanceState,
  tick: number,
): void {
  const target = mob.targetUserId ? state.presencesByUserId[mob.targetUserId] : null;
  if (!target) {
    broadcastMobStop(dispatcher, state, mob);
    state.mobInstances = {
      ...state.mobInstances,
      [mob.instanceId]: { ...mob, aiState: 'idle' as const, targetUserId: null, path: [] },
    };
    return;
  }

  const distFromSpawn = chebyshevDistance(mob.position, mob.spawnPosition);
  if (distFromSpawn > mob.leashRadiusTiles) {
    broadcastMobStop(dispatcher, state, mob);
    state.mobInstances = {
      ...state.mobInstances,
      [mob.instanceId]: {
        ...mob,
        aiState: 'leash_return' as const,
        targetUserId: null,
        path: [],
      },
    };
    return;
  }

  const def = state.mobDefinitions[mob.mobId];

  if (isMeleeAdjacent(mob.position, target.position)) {
    broadcastMobStop(dispatcher, state, mob);
    state.mobInstances = {
      ...state.mobInstances,
      [mob.instanceId]: { ...mob, aiState: 'attack' as const, path: [] },
    };
    return;
  }

  // Re-path if: no path, OR target moved far from end of current path
  let needRepath = mob.path.length === 0;
  if (!needRepath && mob.path.length > 0) {
    const pathEnd = mob.path[mob.path.length - 1];
    if (pathEnd) {
      const endToTarget = chebyshevDistance(pathEnd, target.position);
      if (endToTarget > 3) needRepath = true;
    }
  }
  if (!needRepath) return;

  const chaseTarget = findAdjacentToTarget(state, mob.position, target.position);
  if (!chaseTarget) return; // no walkable cardinal tile found — wait for target to move
  const path = findPath(state.walkable, mob.position, chaseTarget, { maxPathLength: 16 });
  if (!path || path.length === 0) return;

  const speedTps = def?.stats.movement_speed_tps ?? 2;
  state.mobInstances = {
    ...state.mobInstances,
    [mob.instanceId]: {
      ...mob,
      path,
      pathStartedAt: tick,
      pathConsumed: 0,
      speedTps: speedTps,
    },
  };

  const movedPayload: EntityMoved = {
    entity_id: mob.instanceId,
    from: mob.position,
    path,
    speed_tps: speedTps,
    started_at_tick: tick,
  };
  broadcastToChunkArea(dispatcher, state, mob.lastChunk, Op.ENTITY_MOVED, movedPayload);
}

function tickAttack(
  state: WorldMatchState,
  mob: MobInstanceState,
): void {
  const target = mob.targetUserId ? state.presencesByUserId[mob.targetUserId] : null;
  if (!target) {
    state.mobInstances = {
      ...state.mobInstances,
      [mob.instanceId]: { ...mob, aiState: 'idle' as const, targetUserId: null },
    };
    return;
  }

  if (!isMeleeAdjacent(mob.position, target.position)) {
    state.mobInstances = {
      ...state.mobInstances,
      [mob.instanceId]: { ...mob, aiState: 'chase' as const },
    };
  }
}

function tickLeashReturn(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  mob: MobInstanceState,
  tick: number,
): void {
  if (mob.position.x === mob.spawnPosition.x && mob.position.y === mob.spawnPosition.y) {
    const def = state.mobDefinitions[mob.mobId];
    state.mobInstances = {
      ...state.mobInstances,
      [mob.instanceId]: {
        ...mob,
        aiState: 'idle' as const,
        hpCurrent: def?.stats.hp_max ?? mob.hpMax,
      },
    };
    return;
  }

  // Re-aggro if a player entered aggro radius while mob has enough leash room
  // to actually reach them (buffer of aggro_radius prevents edge-of-leash loop)
  const def = state.mobDefinitions[mob.mobId];
  if (def) {
    const distFromSpawn = chebyshevDistance(mob.position, mob.spawnPosition);
    if (distFromSpawn + def.aggro_radius_tiles <= mob.leashRadiusTiles) {
      const nearest = findNearestPlayer(state, mob, def.aggro_radius_tiles);
      if (nearest) {
        broadcastMobStop(dispatcher, state, mob);
        state.mobInstances = {
          ...state.mobInstances,
          [mob.instanceId]: {
            ...mob,
            aiState: 'chase' as const,
            targetUserId: nearest,
            path: [],
          },
        };
        return;
      }
    }
  }

  if (mob.path.length > 0) return;

  const path = findPath(state.walkable, mob.position, mob.spawnPosition, { maxPathLength: 32 });
  if (!path || path.length === 0) {
    state.mobInstances = {
      ...state.mobInstances,
      [mob.instanceId]: {
        ...mob,
        position: { ...mob.spawnPosition },
        aiState: 'idle' as const,
        hpCurrent: state.mobDefinitions[mob.mobId]?.stats.hp_max ?? mob.hpMax,
        lastChunk: chunkKeyOf(mob.spawnPosition),
      },
    };
    return;
  }

  const mobDef = state.mobDefinitions[mob.mobId];
  const speedTps = mobDef?.stats.movement_speed_tps ?? 2;
  state.mobInstances = {
    ...state.mobInstances,
    [mob.instanceId]: {
      ...mob,
      path,
      pathStartedAt: tick,
      pathConsumed: 0,
      speedTps: speedTps,
    },
  };

  const movedPayload: EntityMoved = {
    entity_id: mob.instanceId,
    from: mob.position,
    path,
    speed_tps: speedTps,
    started_at_tick: tick,
  };
  broadcastToChunkArea(dispatcher, state, mob.lastChunk, Op.ENTITY_MOVED, movedPayload);
}

function findNearestPlayer(
  state: WorldMatchState,
  mob: MobInstanceState,
  aggroRadius: number,
): string | null {
  let nearest: string | null = null;
  let nearestDist = Infinity;

  for (const chunkKey of Object.keys(state.presencesByChunk)) {
    if (chebyshevDistance(
      parseCk(mob.lastChunk),
      parseCk(chunkKey),
    ) > 2) continue;

    const bucket = state.presencesByChunk[chunkKey];
    if (!bucket) continue;

    for (const userId of Object.keys(bucket)) {
      const ps = state.presencesByUserId[userId];
      if (!ps) continue;
      const dist = chebyshevDistance(mob.position, ps.position);
      if (dist <= aggroRadius && dist < nearestDist) {
        nearestDist = dist;
        nearest = userId;
      }
    }
  }

  return nearest;
}

function parseCk(ck: string): Position {
  const parts = ck.split(',');
  return { x: Number(parts[0]) ?? 0, y: Number(parts[1]) ?? 0 };
}

const CARDINAL_OFFSETS: readonly Position[] = [
  { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 },
];

function findAdjacentToTarget(
  state: WorldMatchState,
  mobPos: Position,
  targetPos: Position,
): Position | null {
  let bestTile: Position | null = null;
  let bestDist = Infinity;

  for (const off of CARDINAL_OFFSETS) {
    const tx = targetPos.x + off.x;
    const ty = targetPos.y + off.y;
    if (!isInBounds(state.walkable, tx, ty)) continue;
    if (!isWalkable(state.walkable, tx, ty)) continue;
    const dist = chebyshevDistance(mobPos, { x: tx, y: ty });
    if (dist < bestDist) {
      bestDist = dist;
      bestTile = { x: tx, y: ty };
    }
  }
  return bestTile;
}
