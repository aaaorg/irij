// World match handler — viz docs/04-tech-adr.md ADR-005, ADR-007.
// Single match for MVP, chunk-cluster ready (kód strukturován per chunk).
//
// Handlery jsou top-level pojmenované funkce. Nakama Goja runtime extrahuje match
// handler identifikátory přes shorthand property references (`{ matchInit }`)
// v `initializer.registerMatch(...)` druhém argumentu — function literals
// (method shorthand v object literal) Nakama odmítne s "function literal found:
// javascript functions cannot be inlined".

import {
  DEFAULT_HP,
  DEFAULT_SPAWN_POSITION,
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

import mapJson from '../../../client/public/maps/test_50x50.tmj';
import { log } from '../lib/log.js';
import { savePlayersState } from './autosave.js';
import {
  addPresenceToChunk,
  broadcastToChunkArea,
  chunkKeyOf,
  recipientsInRangeOfChunk,
  removePresenceFromChunk,
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
  const walkable = maskFromTiledMap(mapJson as any);
  const total = walkable.width * walkable.height;
  const w = countWalkable(walkable);
  log(logger, 'info', 'World match init', {
    width: walkable.width,
    height: walkable.height,
    walkable: w,
    total,
  });
  const state: WorldMatchState = {
    tick: 0,
    walkable,
    presencesByUserId: {},
    presencesByChunk: {},
    moveRequestLog: {},
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
    ]);
    const playerObj = reads.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER);
    const stateObj = reads.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER_STATE);
    if (!playerObj || !stateObj) {
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
  // Final flush before removing presences — persist position + last_logout_at.
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
    if (msg.opCode === Op.MOVE_REQUEST) {
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
      const result = handleMoveRequest(state, logger, nk, dispatcher, msg.sender, text, tick);
      if (!result.ok && result.reason) {
        broadcastMoveRejected(dispatcher, msg.sender, result.reason, result.clientSeq);
      }
    }
  }

  advanceMovement(state, dispatcher, tick);

  // Phase 5: periodic autosave every PLAYER_AUTOSAVE_INTERVAL ticks (30 s).
  if (tick > 0 && tick % PLAYER_AUTOSAVE_INTERVAL === 0) {
    const userIds = Object.keys(state.presencesByUserId);
    if (userIds.length > 0) {
      savePlayersState(nk, logger, state, userIds, false);
    }
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
