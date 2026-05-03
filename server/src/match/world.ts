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
  logger.info(
    `World match init: ${walkable.width}×${walkable.height} tiles, walkable ${w}/${total}`,
  );
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
      // 4b: žádný aktivní path při join (hráč se spawnuje statický).
      path: [],
      pathStartedAt: 0,
      pathConsumed: 0,
      clientSeq: 0,
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
      // Per ADR-019: pokud je entity uprostřed pohybu, vlož current position
      // (ne stale ps.position) + zbytek path + speed_tps + recomputed start tick
      // tak, aby joiner zrekonstruoval TweenChain z perspektivy "current sub-path"
      // a viděl entity v plynulém pohybu, ne stojící na starém tile dokud se
      // znovu nehne.
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
        // Slice path od aktuální mid-path pozice až po konec původního path.
        // Server tracká `path` jako "zbytek od posledního advance" (po
        // matchLoop popnutí), ale computeCurrentPosition může zahrnovat ještě
        // nepopnuté kroky (tilesAdvanced > pathConsumed). Slice odpovídajícího
        // suffixu:
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
          // Z perspektivy joinera: path začíná NYNÍ (state.tick) z currentPosition.
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
    if (state.moveRequestLog[userId]) {
      const nextLog = { ...state.moveRequestLog };
      delete nextLog[userId];
      state.moveRequestLog = nextLog;
    }

    logger.info(`matchLeave: ${ps.displayName} (${userId.slice(0, 8)}) — cleanup ok`);
  }
  return { state };
}

export function matchLoop(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: WorldMatchState,
  messages: nkruntime.MatchMessage[],
): { state: WorldMatchState } {
  state.tick = tick;

  // 1) Zpracuj příchozí zprávy. V 4b jen Op.MOVE_REQUEST; další opcodes (combat
  //    request, attack, gather, ...) přijdou v Phase 6+.
  for (const msg of messages) {
    if (msg.opCode === Op.MOVE_REQUEST) {
      // nakama-common typuje msg.data jako ArrayBuffer, ale Goja runtime ji
      // skutečně doručuje jako string (klient posílá JSON.stringify(...)).
      // Held-nose double-cast přes unknown — pokud by někdy začal chodit
      // ArrayBuffer, defenzivně dekódujeme.
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
      const result = handleMoveRequest(state, logger, dispatcher, msg.sender, text, tick);
      if (!result.ok && result.reason) {
        broadcastMoveRejected(dispatcher, msg.sender, result.reason, result.clientSeq);
      }
    }
    // Ostatní opcodes ignoruje 4b — server logger.debug by zaplevelilo log.
  }

  // 2) Advance server-side position state (chunk index, ps.position) podle
  //    aktivních paths. ENTITY_MOVED se v tomto loopu NEbroadcastuje — per
  //    ADR-019 to dělá handleMoveRequest jednou s celou path; klient lokálně
  //    lerpuje. Combat tick (Phase 6), AI tick (Phase 6), autosave (Phase 5)
  //    přijdou jako counters proti master 10 Hz tick.
  advanceMovement(state, dispatcher, tick);

  return { state };
}

export function matchTerminate(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  _graceSeconds: number,
): { state: WorldMatchState } {
  const userIds = Object.keys(state.presencesByUserId);
  logger.info(`Match terminating; ${userIds.length} presences in state — broadcasting despawns`);

  // Phase 5 doplní autosave Player blobu do Storage před despawnem (current_position,
  // last_logout_at, atd.). Pro 4b jen oznámíme klientům despawn, aby si vyčistili
  // sprite cache místo "duch" zůstávajícího v okolí.
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
