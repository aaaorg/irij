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
import type { Player } from 'irij-shared/types';

// Mapa je bundlnutá do server modulu přes esbuild .tmj loader (build.js).
// Single source of truth — klient i server čtou stejný soubor, žádný drift.
import mapJson from '../../../client/public/maps/test_50x50.tmj';
import {
  addPresenceToChunk,
  broadcastToChunkArea,
  chunkKeyOf,
  recipientsInRangeOfChunk,
  removePresenceFromChunk,
  type PlayerPresenceState,
  type WorldMatchState,
} from './state.js';
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
  logger.info(
    `World match init: ${walkable.width}×${walkable.height} tiles, walkable ${w}/${total}`,
  );
  const state: WorldMatchState = {
    tick: 0,
    walkable,
    presencesByUserId: {},
    presencesByChunk: {},
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
  // 4a: accept all — auth check je presumed validní z find_or_create_match RPC flow.
  // 4b/post-MVP: anti-double-join (stejný userId již v matchi → reject), capacity cap.
  logger.debug(`Join attempt by ${presence.userId}`);
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

    // Načti Player blob — postava musí existovat (Phase 2 character creation).
    // Pokud neexistuje, kickuj — match není místo, kde postavu vytváříme.
    const reads = nk.storageRead([
      { collection: STORAGE_COLLECTIONS.PLAYER, key: userId, userId },
    ]);
    const playerObj = reads.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER);
    if (!playerObj) {
      logger.warn(
        `matchJoin: Player blob missing for ${userId} — kicking. Klient by měl projít přes CharacterCreationScene před joinMatch.`,
      );
      dispatcher.matchKick([presence]);
      continue;
    }

    const player = playerObj.value as Player;
    const position = player.current_position ?? { ...DEFAULT_SPAWN_POSITION };
    const displayName = player.display_name ?? userId.slice(0, 8);
    const hpCurrent = player.hp_current ?? DEFAULT_HP;
    const hpMax = DEFAULT_HP; // TODO Phase 8: derive from vitality level
    const lastChunk = chunkKeyOf(position);

    const ps: PlayerPresenceState = {
      presence,
      position,
      displayName,
      hpCurrent,
      hpMax,
      lastChunk,
      joinedAt: Date.now(),
    };

    state.presencesByUserId[userId] = ps;
    addPresenceToChunk(state, userId, position);

    // 1) Joiner-only WORLD_SNAPSHOT — všechny entity v jeho 3×3 chunkovém okolí
    //    KROMĚ self (joiner už ví, kde je sám). V 4a jsou to jen ostatní hráči
    //    (mobi/drops přijdou v Phase 6+).
    const visibleEntities: WorldSnapshotEntity[] = [];
    const recipientsInArea = recipientsInRangeOfChunk(state, lastChunk);
    for (const recipient of recipientsInArea) {
      if (recipient.userId === userId) continue;
      const other = state.presencesByUserId[recipient.userId];
      if (!other) continue;
      visibleEntities.push({
        id: other.presence.userId,
        type: 'player',
        position: other.position,
        hp_pct: other.hpMax > 0 ? other.hpCurrent / other.hpMax : 1,
        display_name: other.displayName,
      });
    }
    const snapshot: WorldSnapshot = {
      tick: state.tick,
      entities: visibleEntities,
    };
    dispatcher.broadcastMessage(Op.WORLD_SNAPSHOT, JSON.stringify(snapshot), [presence]);

    // 2) Broadcast ENTITY_SPAWNED ostatním ve 3×3 okolí (joiner sám v snapshotu už je).
    const spawnPayload: EntitySpawned = {
      entity_id: userId,
      type: 'player',
      position,
      display_name: displayName,
      hp_pct: hpMax > 0 ? hpCurrent / hpMax : 1,
    };
    broadcastToChunkArea(dispatcher, state, lastChunk, Op.ENTITY_SPAWNED, spawnPayload, userId);

    logger.info(
      `matchJoin: ${displayName} (${userId.slice(0, 8)}) at (${position.x},${position.y}) chunk=${lastChunk}; visible others=${visibleEntities.length}`,
    );
  }

  return { state };
}

export function matchLeave(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  presences: nkruntime.Presence[],
): { state: WorldMatchState } {
  // Phase 4a: cleanup in-memory state + ENTITY_DESPAWNED broadcast.
  // Player blob autosave přijde v Phase 5 (PLAYER_AUTOSAVE_INTERVAL + final flush
  // tady). Bez autosave teď current_position v DB zůstane na hodnotě, kterou tam
  // vepsal profileCreateCharacter — to je pro 4a OK, hráč se vždycky spawnuje na
  // crossroads (25,25). Movement = 4b, persistence = 5.
  for (const presence of presences) {
    const userId = presence.userId;
    const ps = state.presencesByUserId[userId];
    if (!ps) {
      logger.debug(`matchLeave: ${userId} not in state, skipping`);
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

    logger.info(`matchLeave: ${ps.displayName} (${userId.slice(0, 8)}) — cleanup ok`);
  }
  return { state };
}

export function matchLoop(
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  _messages: nkruntime.MatchMessage[],
): { state: WorldMatchState } {
  state.tick++;
  // TODO Phase 4b: process MOVE_REQUEST messages (validate + A* pathfind on
  // state.walkable), advance paths tile-by-tile, broadcast ENTITY_MOVED to
  // 3×3 chunkové okolí. Combat tick (Phase 6), AI tick (Phase 6), autosave
  // (Phase 5) přijdou jako counters proti master 10 Hz tick.
  return { state };
}

export function matchTerminate(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  _graceSeconds: number,
): { state: WorldMatchState } {
  logger.info(`Match terminating; ${Object.keys(state.presencesByUserId).length} presences in state`);
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
