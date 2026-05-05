import {
  ATTACK_RATE_LIMIT_MAX,
  COMBAT_TICK_INTERVAL,
  DEFAULT_HP,
  DEFAULT_SPAWN_POSITION,
  DROP_DESPAWN_TICKS,
  MELEE_RANGE_TILES,
  TICK_HZ,
} from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type {
  AttackRequest,
  CombatResolved,
  EntityDied,
  EntitySpawned,
  HitType,
} from 'irij-shared/messages';
import type { Position } from 'irij-shared/types';
import { int, obj, parse, str } from 'irij-shared';

import { log } from '../lib/log.js';
import { checkRateLimit, RATE_LIMIT_WINDOW_MS } from './movement.js';
import {
  addDropToChunk,
  broadcastToChunkArea,
  chunkKeyOf,
  removeDropFromChunk,
  updatePresenceLocation,
  type DropInstanceState,
  type MobInstanceState,
  type WorldMatchState,
} from './state.js';

const AttackRequestSchema = obj({
  target_id: str(),
  client_seq: int(),
});

export function parseAttackRequest(raw: unknown): AttackRequest | null {
  const result = parse(AttackRequestSchema, raw);
  if (!result.ok) return null;
  return { target_id: result.value.target_id, client_seq: result.value.client_seq };
}

export function chebyshevDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isMeleeAdjacent(a: Position, b: Position): boolean {
  return manhattanDistance(a, b) === 1;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function handleAttackRequest(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  tick: number,
): void {
  const userId = presence.userId;
  const ps = state.presencesByUserId[userId];
  if (!ps) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }
  const req = parseAttackRequest(parsed);
  if (!req) return;

  const nowMs = Date.now();
  const prevLog = state.attackRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, ATTACK_RATE_LIMIT_MAX);
  state.attackRequestLog = { ...state.attackRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) return;

  const mob = state.mobInstances[req.target_id];
  if (!mob || mob.aiState === 'dead') {
    log(logger, 'debug', 'attack rejected: target not found or dead', {
      userId: userId.slice(0, 8),
      targetId: req.target_id,
    });
    return;
  }

  if (!isMeleeAdjacent(ps.position, mob.position)) {
    log(logger, 'debug', 'attack rejected: not cardinal adjacent', {
      userId: userId.slice(0, 8),
      manhattan: manhattanDistance(ps.position, mob.position),
    });
    return;
  }

  state.combatEngagements = { ...state.combatEngagements, [userId]: req.target_id };

  if (mob.aiState === 'idle' || mob.aiState === 'leash_return') {
    state.mobInstances = {
      ...state.mobInstances,
      [mob.instanceId]: { ...mob, aiState: 'attack' as const, targetUserId: userId },
    };
  }
}

export function runCombatTick(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  resolvePlayerAttacks(state, logger, dispatcher, tick);
  resolveMobAttacks(state, logger, dispatcher, tick);
}

function resolvePlayerAttacks(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  for (const userId of Object.keys(state.combatEngagements)) {
    const targetId = state.combatEngagements[userId];
    if (!targetId) continue;

    const ps = state.presencesByUserId[userId];
    if (!ps) {
      state.combatEngagements = { ...state.combatEngagements, [userId]: null };
      continue;
    }

    const mob = state.mobInstances[targetId];
    if (!mob || mob.aiState === 'dead') {
      state.combatEngagements = { ...state.combatEngagements, [userId]: null };
      continue;
    }

    if (!isMeleeAdjacent(ps.position, mob.position)) {
      state.combatEngagements = { ...state.combatEngagements, [userId]: null };
      continue;
    }

    const def = state.mobDefinitions[mob.mobId];
    const defense = def?.stats.defense_melee ?? 0;
    const baseDamage = randomInt(0, 3);
    const hitRoll = randomInt(0, 99);
    let damage: number;
    let hitType: HitType;

    if (hitRoll < 5) {
      damage = 0;
      hitType = 'miss';
    } else if (hitRoll >= 95) {
      damage = Math.max(0, baseDamage * 2 - defense);
      hitType = 'critical';
    } else {
      damage = Math.max(0, baseDamage - defense);
      hitType = 'normal';
    }

    const newHp = Math.max(0, mob.hpCurrent - damage);

    const combatPayload: CombatResolved = {
      attacker_id: userId,
      target_id: targetId,
      damage,
      hit_type: hitType,
      remaining_hp: newHp,
    };
    broadcastToChunkArea(dispatcher, state, mob.lastChunk, Op.COMBAT_RESOLVED, combatPayload);

    if (newHp <= 0) {
      handleMobDeath(state, logger, dispatcher, mob, userId, tick);
      state.combatEngagements = { ...state.combatEngagements, [userId]: null };
    } else {
      state.mobInstances = {
        ...state.mobInstances,
        [targetId]: { ...mob, hpCurrent: newHp },
      };
    }
  }
}

function resolveMobAttacks(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  for (const instanceId of Object.keys(state.mobInstances)) {
    const mob = state.mobInstances[instanceId];
    if (!mob || mob.aiState !== 'attack' || !mob.targetUserId) continue;
    if (tick - mob.lastAttackTick < COMBAT_TICK_INTERVAL) continue;

    const target = state.presencesByUserId[mob.targetUserId];
    if (!target) {
      state.mobInstances = {
        ...state.mobInstances,
        [instanceId]: { ...mob, aiState: 'idle' as const, targetUserId: null },
      };
      continue;
    }

    const def = state.mobDefinitions[mob.mobId];
    if (!def) continue;

    if (!isMeleeAdjacent(mob.position, target.position)) continue;

    const baseDamage = randomInt(def.stats.damage_min, def.stats.damage_max);
    const hitRoll = randomInt(0, 99);
    let damage: number;
    let hitType: HitType;

    if (hitRoll < 10) {
      damage = 0;
      hitType = 'miss';
    } else if (hitRoll >= 95) {
      damage = baseDamage * 2;
      hitType = 'critical';
    } else {
      damage = baseDamage;
      hitType = 'normal';
    }

    const newHp = Math.max(0, target.hpCurrent - damage);
    state.presencesByUserId = {
      ...state.presencesByUserId,
      [mob.targetUserId]: { ...target, hpCurrent: newHp },
    };

    const combatPayload: CombatResolved = {
      attacker_id: instanceId,
      target_id: mob.targetUserId,
      damage,
      hit_type: hitType,
      remaining_hp: newHp,
    };
    broadcastToChunkArea(dispatcher, state, mob.lastChunk, Op.COMBAT_RESOLVED, combatPayload);

    state.mobInstances = {
      ...state.mobInstances,
      [instanceId]: { ...mob, lastAttackTick: tick },
    };

    if (newHp <= 0) {
      handlePlayerDeath(state, logger, dispatcher, mob.targetUserId, instanceId);
    }
  }
}

function handleMobDeath(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  mob: MobInstanceState,
  killerUserId: string,
  tick: number,
): void {
  const def = state.mobDefinitions[mob.mobId];
  if (!def) return;

  const respawnTicks = randomInt(def.respawn_min_s, def.respawn_max_s) * TICK_HZ;

  state.mobInstances = {
    ...state.mobInstances,
    [mob.instanceId]: {
      ...mob,
      hpCurrent: 0,
      aiState: 'dead' as const,
      targetUserId: null,
      path: [],
      pathStartedAt: 0,
      pathConsumed: 0,
      deathTick: tick,
      respawnAtTick: tick + respawnTicks,
    },
  };

  const drops = rollLoot(state, def.loot_table_id);
  const xpAwarded = Object.entries(def.xp_award).map(([skill, amount]) => ({
    skill,
    amount,
  }));

  if (drops.length > 0) {
    const dropId = `drop_${mob.instanceId}_${tick}`;
    const drop: DropInstanceState = {
      dropId,
      position: { ...mob.position },
      items: drops,
      droppedAtTick: tick,
      lastChunk: mob.lastChunk,
    };
    state.dropInstances = { ...state.dropInstances, [dropId]: drop };
    addDropToChunk(state, dropId, mob.position);

    const dropSpawn: EntitySpawned = {
      entity_id: dropId,
      type: 'drop',
      position: mob.position,
      items: drops,
    };
    broadcastToChunkArea(dispatcher, state, mob.lastChunk, Op.ENTITY_SPAWNED, dropSpawn);
  }

  const diedPayload: EntityDied = {
    entity_id: mob.instanceId,
    killer_id: killerUserId,
    drops: drops.length > 0 ? drops : null,
    xp_awarded: xpAwarded,
  };
  broadcastToChunkArea(dispatcher, state, mob.lastChunk, Op.ENTITY_DIED, diedPayload);

  log(logger, 'info', 'mob died', {
    mobId: mob.mobId,
    instanceId: mob.instanceId,
    killerUserId: killerUserId.slice(0, 8),
    drops: drops.length,
    respawnIn: `${Math.round(respawnTicks / TICK_HZ)}s`,
  });
}

function rollLoot(
  state: WorldMatchState,
  lootTableId: string,
): Array<{ item_id: string; quantity: number }> {
  const table = state.lootTables[lootTableId];
  if (!table) return [];

  const result: Array<{ item_id: string; quantity: number }> = [];
  for (const entry of table.rolls) {
    if (Math.random() * 100 < entry.chance_pct) {
      const qty = randomInt(entry.quantity[0], entry.quantity[1]);
      if (qty > 0) {
        result.push({ item_id: entry.item_id, quantity: qty });
      }
    }
  }
  return result;
}

function handlePlayerDeath(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  userId: string,
  killerEntityId: string,
): void {
  const ps = state.presencesByUserId[userId];
  if (!ps) return;

  log(logger, 'info', 'player died', {
    userId: userId.slice(0, 8),
    killedBy: killerEntityId,
  });

  const oldChunk = chunkKeyOf(ps.position);

  const diedPayload: EntityDied = {
    entity_id: userId,
    killer_id: killerEntityId,
    drops: null,
    xp_awarded: [],
  };
  broadcastToChunkArea(dispatcher, state, oldChunk, Op.ENTITY_DIED, diedPayload);

  const spawnPos: Position = { ...DEFAULT_SPAWN_POSITION };
  updatePresenceLocation(state, userId, spawnPos);

  state.presencesByUserId = {
    ...state.presencesByUserId,
    [userId]: {
      ...ps,
      position: spawnPos,
      hpCurrent: ps.hpMax,
      path: [],
      pathStartedAt: 0,
      pathConsumed: 0,
      lastChunk: chunkKeyOf(spawnPos),
    },
  };

  const spawnPayload: EntitySpawned = {
    entity_id: userId,
    type: 'player',
    position: spawnPos,
    display_name: ps.displayName,
    hp_pct: 1,
  };
  broadcastToChunkArea(dispatcher, state, chunkKeyOf(spawnPos), Op.ENTITY_SPAWNED, spawnPayload);

  for (const iid of Object.keys(state.mobInstances)) {
    const mob = state.mobInstances[iid];
    if (mob && mob.targetUserId === userId) {
      state.mobInstances = {
        ...state.mobInstances,
        [iid]: {
          ...mob,
          aiState: 'leash_return' as const,
          targetUserId: null,
          path: [],
          pathStartedAt: 0,
          pathConsumed: 0,
        },
      };
    }
  }

  state.combatEngagements = { ...state.combatEngagements, [userId]: null };
}

export function cleanupExpiredDrops(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  for (const dropId of Object.keys(state.dropInstances)) {
    const drop = state.dropInstances[dropId];
    if (!drop) continue;
    if (tick - drop.droppedAtTick >= DROP_DESPAWN_TICKS) {
      removeDropFromChunk(state, dropId, drop.position);
      const next = { ...state.dropInstances };
      delete next[dropId];
      state.dropInstances = next;
      broadcastToChunkArea(dispatcher, state, drop.lastChunk, Op.ENTITY_DESPAWNED, {
        entity_id: dropId,
      });
    }
  }
}
