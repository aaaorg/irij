// World match handler — viz docs/04-tech-adr.md ADR-005, ADR-007
// Single match for MVP, chunk-cluster ready (kód strukturován per chunk).

import { TICK_HZ } from 'irij-shared/constants';

interface WorldMatchState {
  tick: number;
  // TODO: chunks: Map<ChunkKey, ChunkState>
  // TODO: presences: Map<UserId, PlayerPresenceState>
}

export const worldMatchHandler: nkruntime.MatchHandler<WorldMatchState> = {
  matchInit(_ctx, logger, _params) {
    logger.info('World match init');
    return {
      state: { tick: 0 },
      tickRate: TICK_HZ,
      label: 'world.main',
    };
  },

  matchJoinAttempt(_ctx, logger, _nk, _dispatcher, _tick, state, presence, _metadata) {
    logger.info(`Join attempt by ${presence.userId}`);
    return { state, accept: true };
  },

  matchJoin(_ctx, logger, _nk, _dispatcher, _tick, state, presences) {
    for (const p of presences) {
      logger.info(`Joined: ${p.userId}`);
    }
    return { state };
  },

  matchLeave(_ctx, logger, _nk, _dispatcher, _tick, state, presences) {
    for (const p of presences) {
      logger.info(`Left: ${p.userId}`);
    }
    return { state };
  },

  matchLoop(_ctx, _logger, _nk, _dispatcher, _tick, state, _messages) {
    state.tick++;
    // TODO: process incoming messages, run combat tick, broadcast updates
    return { state };
  },

  matchTerminate(_ctx, logger, _nk, _dispatcher, _tick, state, _graceSeconds) {
    logger.info('Match terminating');
    return { state };
  },

  matchSignal(_ctx, _logger, _nk, _dispatcher, _tick, state, _data) {
    return { state };
  },
};
