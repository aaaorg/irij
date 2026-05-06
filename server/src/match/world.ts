import {
  AI_TICK_INTERVAL,
  COMBAT_TICK_INTERVAL,
  DEFAULT_HP,
  DEFAULT_SPAWN_POSITION,
  MOB_RESPAWN_CHECK_INTERVAL,
  MOVEMENT_SPEED_TPS_BASE,
  PLAYER_AUTOSAVE_INTERVAL,
  STORAGE_COLLECTIONS,
  TICK_HZ,
} from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type {
  EntityDespawned,
  EntitySpawned,
  WorldSnapshot,
  WorldSnapshotEntity,
} from 'irij-shared/messages';
import { asPlayer, asPlayerState } from 'irij-shared/types';
import type {
  AtributRow,
  AtributSourceRow,
  MobDefinition,
  LootTable,
  MobSpawnPoint,
  NpcDefinition,
  SkillRow,
} from 'irij-shared/types';
import { totalLevelOf, totalXpOf } from 'irij-shared/skills';

import mapJson from '../../../client/public/maps/test_50x50.tmj';
import mobsData from '../../data/mobs.json';
import lootTablesData from '../../data/loot_tables.json';
import mobSpawnsData from '../../data/mob_spawns.json';

import { log } from '../lib/log.js';
import { getAllNpcs } from '../lib/dialogs.js';
import { savePlayersState } from './autosave.js';
import { runAiTick, checkMobRespawns, advanceMobMovement } from './ai.js';
import { handleAttackRequest, runCombatTick, cleanupExpiredDrops } from './combat.js';
import {
  cleanupDialogSession,
  handleDialogChoose,
  handleDialogCloseRequest,
  handleInteractNpc,
} from './dialog.js';
import {
  cleanupInventoryRateLogs,
  handleEquipRequest,
  handleInteractObject,
  handleItemDropRequest,
  handleItemUseRequest,
  handleUnequipRequest,
} from './inventory.js';
import {
  addMobToChunk,
  addNpcToChunk,
  addPresenceToChunk,
  broadcastToChunkArea,
  chunkKeyOf,
  recipientsInRangeOfChunk,
  removePresenceFromChunk,
  type MobInstanceState,
  type NpcInstanceState,
  type PlayerPresenceState,
  type WorldMatchState,
} from './state.js';
import {
  advanceMovement,
  broadcastMoveRejected,
  computeCurrentPosition,
  handleMoveRequest,
} from './movement.js';
import { countWalkable, maskFromTiledMap } from './walkable.js';

export function matchInit(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _params: { [key: string]: any },
): { state: WorldMatchState; tickRate: number; label: string } {
  const walkable = maskFromTiledMap(mapJson);
  const total = walkable.width * walkable.height;
  const w = countWalkable(walkable);

  const mobDefinitions: { [id: string]: MobDefinition } = {};
  for (const m of mobsData as MobDefinition[]) {
    mobDefinitions[m.id] = m;
  }

  const lootTables: { [id: string]: LootTable } = {};
  for (const lt of lootTablesData as LootTable[]) {
    lootTables[lt.id] = lt;
  }

  const mobInstances: { [id: string]: MobInstanceState } = {};
  const mobsByChunk: { [ck: string]: { [id: string]: true } } = {};

  for (const spawn of mobSpawnsData as MobSpawnPoint[]) {
    const def = mobDefinitions[spawn.mob_id];
    if (!def) {
      log(logger, 'warn', 'Unknown mob_id in spawn', { spawnId: spawn.id, mobId: spawn.mob_id });
      continue;
    }
    const pos = spawn.spawn_position;
    const ck = chunkKeyOf(pos);
    const instance: MobInstanceState = {
      instanceId: spawn.id,
      mobId: spawn.mob_id,
      position: { ...pos },
      spawnPosition: { ...pos },
      hpCurrent: def.stats.hp_max,
      hpMax: def.stats.hp_max,
      aiState: 'idle',
      targetUserId: null,
      lastAttackTick: 0,
      lastChunk: ck,
      path: [],
      pathStartedAt: 0,
      pathConsumed: 0,
      deathTick: null,
      respawnAtTick: null,
      leashRadiusTiles: def.leash_radius_tiles,
      speedTps: def.stats.movement_speed_tps,
    };
    mobInstances[spawn.id] = instance;
    if (!mobsByChunk[ck]) mobsByChunk[ck] = {};
    mobsByChunk[ck] = { ...mobsByChunk[ck], [spawn.id]: true };
  }

  // Phase 9: NPCs — staticky placnuté instance per default_position.
  const npcDefinitions: { [npcId: string]: NpcDefinition } = {};
  const npcInstances: { [instanceId: string]: NpcInstanceState } = {};
  const npcsByChunk: { [ck: string]: { [id: string]: true } } = {};

  for (const def of getAllNpcs()) {
    npcDefinitions[def.id] = def;
    const instanceId = def.id; // stejný ID — pro MVP (1:1 def↔instance)
    const pos = def.default_position;
    const ck = chunkKeyOf(pos);
    npcInstances[instanceId] = {
      instanceId,
      npcId: def.id,
      position: { ...pos },
      lastChunk: ck,
    };
    if (!npcsByChunk[ck]) npcsByChunk[ck] = {};
    npcsByChunk[ck] = { ...npcsByChunk[ck], [instanceId]: true };
  }

  log(logger, 'info', 'World match init', {
    width: walkable.width,
    height: walkable.height,
    walkable: w,
    total,
    mobs: Object.keys(mobInstances).length,
    npcs: Object.keys(npcInstances).length,
  });

  const state: WorldMatchState = {
    tick: 0,
    walkable,
    presencesByUserId: {},
    presencesByChunk: {},
    moveRequestLog: {},
    attackRequestLog: {},
    interactRequestLog: {},
    mobDefinitions,
    lootTables,
    mobInstances,
    mobsByChunk,
    dropInstances: {},
    dropsByChunk: {},
    combatEngagements: {},
    npcDefinitions,
    npcInstances,
    npcsByChunk,
    dialogSessions: {},
  };
  return {
    state,
    tickRate: TICK_HZ,
    label: 'world.main',
  };
}

export function matchJoinAttempt(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  presence: nkruntime.Presence,
  _metadata: { [key: string]: any },
): { state: WorldMatchState; accept: boolean } {
  log(logger, 'debug', 'Join attempt', { userId: presence.userId });
  return { state, accept: true };
}

export function matchJoin(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  presences: nkruntime.Presence[],
): { state: WorldMatchState } {
  for (const presence of presences) {
    const userId = presence.userId;

    const reads = nk.storageRead([
      { collection: STORAGE_COLLECTIONS.PLAYER, key: userId, userId },
      { collection: STORAGE_COLLECTIONS.PLAYER_STATE, key: userId, userId },
      { collection: STORAGE_COLLECTIONS.PLAYER_SKILLS, key: userId, userId },
    ]);
    const playerObj = reads.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER);
    const stateObj = reads.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER_STATE);
    const skillsObj = reads.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER_SKILLS);
    if (!playerObj || !stateObj || !skillsObj) {
      log(logger, 'warn', 'matchJoin: blob missing, kicking', { userId });
      dispatcher.matchKick([presence]);
      continue;
    }

    const player = asPlayer(playerObj.value);
    const pState = asPlayerState(stateObj.value);
    if (!player || !pState) {
      log(logger, 'warn', 'matchJoin: blob narrowing failed, kicking', { userId });
      dispatcher.matchKick([presence]);
      continue;
    }

    const skillsBlob = skillsObj.value as {
      atributy?: AtributRow[];
      skilly?: SkillRow[];
      sources?: AtributSourceRow[];
    };
    const skilly: SkillRow[] = Array.isArray(skillsBlob.skilly) ? skillsBlob.skilly : [];
    const atributy: AtributRow[] = Array.isArray(skillsBlob.atributy) ? skillsBlob.atributy : [];
    const sources: AtributSourceRow[] = Array.isArray(skillsBlob.sources) ? skillsBlob.sources : [];

    const position = pState.current_position ?? { ...DEFAULT_SPAWN_POSITION };
    const displayName = player.display_name ?? userId.slice(0, 8);
    const hpCurrent = pState.hp_current ?? DEFAULT_HP;
    const hpMax = pState.hp_max ?? DEFAULT_HP;
    const lastChunk = chunkKeyOf(position);

    const ps: PlayerPresenceState = {
      presence,
      position,
      displayName,
      hpCurrent,
      hpMax,
      lastChunk,
      joinedAt: Date.now(),
      path: [],
      pathStartedAt: 0,
      pathConsumed: 0,
      clientSeq: 0,
      skilly,
      atributy,
      sources,
      totalLevel: totalLevelOf(skilly, atributy),
      totalXp: totalXpOf(skilly, atributy),
    };

    state.presencesByUserId[userId] = ps;
    addPresenceToChunk(state, userId, position);

    const visibleEntities: WorldSnapshotEntity[] = [];
    const recipientsInArea = recipientsInRangeOfChunk(state, lastChunk);
    for (const recipient of recipientsInArea) {
      if (recipient.userId === userId) continue;
      const other = state.presencesByUserId[recipient.userId];
      if (!other) continue;
      const inFlight = other.path && other.path.length > 0;
      const currentPosition = inFlight
        ? computeCurrentPosition(other, state.tick)
        : other.position;
      const entry: WorldSnapshotEntity = {
        id: other.presence.userId,
        type: 'player',
        position: currentPosition,
        hp_pct: other.hpMax > 0 ? other.hpCurrent / other.hpMax : 1,
        display_name: other.displayName,
      };
      if (inFlight) {
        const ticksElapsed = state.tick - other.pathStartedAt;
        const tilesShouldHaveMoved = Math.floor(
          (ticksElapsed * MOVEMENT_SPEED_TPS_BASE) / TICK_HZ,
        );
        const totalTilesInPath = other.pathConsumed + other.path.length;
        const effectiveAdvanced = Math.max(
          other.pathConsumed,
          Math.min(tilesShouldHaveMoved, totalTilesInPath),
        );
        const offsetWithinPath = effectiveAdvanced - other.pathConsumed;
        const remainingPath = other.path.slice(offsetWithinPath);
        if (remainingPath.length > 0) {
          entry.path = remainingPath;
          entry.speed_tps = MOVEMENT_SPEED_TPS_BASE;
          entry.started_at_tick = state.tick;
        }
      }
      visibleEntities.push(entry);
    }

    // Include alive mobs in snapshot
    for (const instanceId of Object.keys(state.mobInstances)) {
      const mob = state.mobInstances[instanceId];
      if (!mob || mob.aiState === 'dead') continue;
      const mobChunk = mob.lastChunk;
      const chunkDist = chunkDistFromKeys(lastChunk, mobChunk);
      if (chunkDist > 1) continue;

      const def = state.mobDefinitions[mob.mobId];
      const mobEntry: WorldSnapshotEntity = {
        id: mob.instanceId,
        type: 'mob',
        position: mob.position,
        hp_pct: mob.hpMax > 0 ? mob.hpCurrent / mob.hpMax : 1,
        mob_id: mob.mobId,
        display_name_cs: def?.name_cs,
        level: def?.level,
      };
      if (mob.path.length > 0) {
        mobEntry.path = mob.path;
        mobEntry.speed_tps = mob.speedTps;
        mobEntry.started_at_tick = mob.pathStartedAt;
      }
      visibleEntities.push(mobEntry);
    }

    // Include NPCs in snapshot (3×3 chunk area)
    for (const instanceId of Object.keys(state.npcInstances)) {
      const npc = state.npcInstances[instanceId];
      if (!npc) continue;
      if (chunkDistFromKeys(lastChunk, npc.lastChunk) > 1) continue;
      const def = state.npcDefinitions[npc.npcId];
      visibleEntities.push({
        id: npc.instanceId,
        type: 'npc',
        position: npc.position,
        npc_id: npc.npcId,
        display_name_cs: def?.display_name_cs,
      });
    }

    // Include ground drops in snapshot
    for (const dropId of Object.keys(state.dropInstances)) {
      const drop = state.dropInstances[dropId];
      if (!drop) continue;
      const dropChunk = drop.lastChunk;
      const chunkDist = chunkDistFromKeys(lastChunk, dropChunk);
      if (chunkDist > 1) continue;

      visibleEntities.push({
        id: drop.dropId,
        type: 'drop',
        position: drop.position,
        items: drop.items,
      });
    }

    const snapshot: WorldSnapshot = {
      tick: state.tick,
      entities: visibleEntities,
    };
    dispatcher.broadcastMessage(Op.WORLD_SNAPSHOT, JSON.stringify(snapshot), [presence]);

    const spawnPayload: EntitySpawned = {
      entity_id: userId,
      type: 'player',
      position,
      display_name: displayName,
      hp_pct: hpMax > 0 ? hpCurrent / hpMax : 1,
    };
    broadcastToChunkArea(dispatcher, state, lastChunk, Op.ENTITY_SPAWNED, spawnPayload, userId);

    log(logger, 'info', 'matchJoin', {
      displayName,
      userId: userId.slice(0, 8),
      position,
      chunk: lastChunk,
      visibleOthers: visibleEntities.length,
    });
  }

  return { state };
}

export function matchLeave(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  presences: nkruntime.Presence[],
): { state: WorldMatchState } {
  const leavingUserIds = presences
    .map((p) => p.userId)
    .filter((id) => !!state.presencesByUserId[id]);
  if (leavingUserIds.length > 0) {
    savePlayersState(nk, logger, state, leavingUserIds, true);
  }

  for (const presence of presences) {
    const userId = presence.userId;
    const ps = state.presencesByUserId[userId];
    if (!ps) {
      log(logger, 'debug', 'matchLeave: not in state', { userId });
      continue;
    }

    const despawnPayload: EntityDespawned = { entity_id: userId };
    broadcastToChunkArea(
      dispatcher,
      state,
      ps.lastChunk,
      Op.ENTITY_DESPAWNED,
      despawnPayload,
      userId,
    );

    removePresenceFromChunk(state, userId, ps.position);
    delete state.presencesByUserId[userId];
    if (state.moveRequestLog[userId]) {
      const nextLog = { ...state.moveRequestLog };
      delete nextLog[userId];
      state.moveRequestLog = nextLog;
    }
    if (state.attackRequestLog[userId]) {
      const nextLog = { ...state.attackRequestLog };
      delete nextLog[userId];
      state.attackRequestLog = nextLog;
    }
    if (state.combatEngagements[userId] !== undefined) {
      const next = { ...state.combatEngagements };
      delete next[userId];
      state.combatEngagements = next;
    }
    cleanupInventoryRateLogs(state, userId);
    cleanupDialogSession(state, userId);

    // Release mob targeting this player
    for (const instanceId of Object.keys(state.mobInstances)) {
      const mob = state.mobInstances[instanceId];
      if (mob && mob.targetUserId === userId) {
        state.mobInstances = {
          ...state.mobInstances,
          [instanceId]: { ...mob, aiState: 'idle' as const, targetUserId: null },
        };
      }
    }

    log(logger, 'info', 'matchLeave', {
      displayName: ps.displayName,
      userId: userId.slice(0, 8),
    });
  }
  return { state };
}

export function matchLoop(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: WorldMatchState,
  messages: nkruntime.MatchMessage[],
): { state: WorldMatchState } {
  state.tick = tick;

  for (const msg of messages) {
    const raw = msg.data as unknown;
    let text: string;
    if (typeof raw === 'string') {
      text = raw;
    } else {
      const bytes = new Uint8Array(raw as ArrayBuffer);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
      text = s;
    }

    if (msg.opCode === Op.MOVE_REQUEST) {
      const result = handleMoveRequest(state, logger, nk, dispatcher, msg.sender, text, tick);
      if (!result.ok && result.reason) {
        broadcastMoveRejected(dispatcher, msg.sender, result.reason, result.clientSeq);
      }
    } else if (msg.opCode === Op.ATTACK_REQUEST) {
      handleAttackRequest(state, logger, dispatcher, msg.sender, text, tick);
    } else if (msg.opCode === Op.INTERACT_OBJECT) {
      handleInteractObject(state, logger, nk, dispatcher, msg.sender, text, tick);
    } else if (msg.opCode === Op.EQUIP_REQUEST) {
      handleEquipRequest(state, logger, nk, dispatcher, msg.sender, text, tick);
    } else if (msg.opCode === Op.UNEQUIP_REQUEST) {
      handleUnequipRequest(state, logger, nk, dispatcher, msg.sender, text, tick);
    } else if (msg.opCode === Op.ITEM_DROP_REQUEST) {
      handleItemDropRequest(state, logger, nk, dispatcher, msg.sender, text, tick);
    } else if (msg.opCode === Op.ITEM_USE_REQUEST) {
      handleItemUseRequest(state, logger, nk, dispatcher, msg.sender, text, tick);
    } else if (msg.opCode === Op.INTERACT_NPC) {
      handleInteractNpc(state, logger, nk, dispatcher, msg.sender, text, tick);
    } else if (msg.opCode === Op.DIALOG_CHOOSE) {
      handleDialogChoose(state, logger, nk, dispatcher, msg.sender, text, tick);
    } else if (msg.opCode === Op.DIALOG_CLOSE) {
      handleDialogCloseRequest(state, logger, nk, dispatcher, msg.sender, text, tick);
    }
  }

  advanceMovement(state, dispatcher, tick);
  advanceMobMovement(state, dispatcher, tick);

  if (tick > 0 && tick % AI_TICK_INTERVAL === 0) {
    runAiTick(state, logger, dispatcher, tick);
  }

  if (tick > 0 && tick % COMBAT_TICK_INTERVAL === 0) {
    runCombatTick(state, logger, nk, dispatcher, tick);
  }

  if (tick > 0 && tick % MOB_RESPAWN_CHECK_INTERVAL === 0) {
    checkMobRespawns(state, dispatcher, tick);
  }

  if (tick > 0 && tick % PLAYER_AUTOSAVE_INTERVAL === 0) {
    const userIds = Object.keys(state.presencesByUserId);
    if (userIds.length > 0) {
      savePlayersState(nk, logger, state, userIds, false);
    }
  }

  if (tick > 0 && tick % (PLAYER_AUTOSAVE_INTERVAL * 2) === 0) {
    cleanupExpiredDrops(state, dispatcher, tick);
  }

  return { state };
}

export function matchTerminate(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  _graceSeconds: number,
): { state: WorldMatchState } {
  const userIds = Object.keys(state.presencesByUserId);
  log(logger, 'info', 'Match terminating', { presenceCount: userIds.length });

  if (userIds.length > 0) {
    savePlayersState(nk, logger, state, userIds, true);
  }

  for (const userId of userIds) {
    const ps = state.presencesByUserId[userId];
    if (!ps) continue;
    const despawnPayload: EntityDespawned = { entity_id: userId };
    broadcastToChunkArea(
      dispatcher,
      state,
      ps.lastChunk,
      Op.ENTITY_DESPAWNED,
      despawnPayload,
      userId,
    );
  }

  return { state };
}

export function matchSignal(
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  _data: string,
): { state: WorldMatchState; data?: string } {
  return { state };
}

function chunkDistFromKeys(a: string, b: string): number {
  const [ax, ay] = a.split(',').map(Number) as [number, number];
  const [bx, by] = b.split(',').map(Number) as [number, number];
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
