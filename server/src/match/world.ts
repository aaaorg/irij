// World match handler — viz docs/04-tech-adr.md ADR-005, ADR-007
// Single match for MVP, chunk-cluster ready (kód strukturován per chunk).
//
// Handlery jsou top-level pojmenované funkce. Nakama Goja runtime extrahuje match
// handler identifikátory přes shorthand property references (`{ matchInit }`)
// v `initializer.registerMatch(...)` druhém argumentu — function literals
// (method shorthand v object literal) Nakama odmítne s "function literal found:
// javascript functions cannot be inlined".

import { TICK_HZ } from 'irij-shared/constants';

interface WorldMatchState {
  tick: number;
  // TODO: chunks: Map<ChunkKey, ChunkState>
  // TODO: presences: Map<UserId, PlayerPresenceState>
}

export function matchInit(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _params: { [key: string]: any },
): { state: WorldMatchState; tickRate: number; label: string } {
  logger.info('World match init');
  return {
    state: { tick: 0 },
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
  logger.info(`Join attempt by ${presence.userId}`);
  return { state, accept: true };
}

export function matchJoin(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  presences: nkruntime.Presence[],
): { state: WorldMatchState } {
  for (const p of presences) {
    logger.info(`Joined: ${p.userId}`);
  }
  return { state };
}

export function matchLeave(
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: WorldMatchState,
  presences: nkruntime.Presence[],
): { state: WorldMatchState } {
  for (const p of presences) {
    logger.info(`Left: ${p.userId}`);
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
  // TODO: process incoming messages, run combat tick, broadcast updates
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
  logger.info('Match terminating');
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
