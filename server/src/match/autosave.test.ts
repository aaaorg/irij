import { describe, expect, it, vi } from 'vitest';
import { savePlayersState } from './autosave.js';
import type { PlayerPresenceState, WorldMatchState } from './state.js';

function makePresence(userId: string): nkruntime.Presence {
  return { userId, sessionId: 's1', username: userId, node: 'n1' } as nkruntime.Presence;
}

function makePs(
  userId: string,
  pos: { x: number; y: number },
  overrides?: Partial<PlayerPresenceState>,
): PlayerPresenceState {
  return {
    presence: makePresence(userId),
    position: pos,
    displayName: userId,
    hpCurrent: 8,
    hpMax: 10,
    lastChunk: '0,0',
    joinedAt: Date.now(),
    path: [],
    pathStartedAt: 0,
    pathConsumed: 0,
    clientSeq: 0,
    ...overrides,
  };
}

function makeState(presences: Record<string, PlayerPresenceState>): WorldMatchState {
  return {
    tick: 300,
    walkable: { width: 50, height: 50, chunks: {} },
    presencesByUserId: presences,
    presencesByChunk: {},
    moveRequestLog: {},
  };
}

function storageObj(
  userId: string,
  value: Record<string, unknown>,
): nkruntime.StorageObject {
  return {
    collection: 'player_state',
    key: userId,
    userId,
    value,
    version: 'v1',
    permissionRead: 1,
    permissionWrite: 0,
    createTime: 0,
    updateTime: 0,
  } as nkruntime.StorageObject;
}

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as nkruntime.Logger;

function existingBlob(userId: string) {
  return storageObj(userId, {
    schema_version: 1,
    current_zone_id: 'blatiny',
    current_position: { x: 25, y: 25 },
    hp_current: 10,
    hp_max: 10,
    mana_current: 0,
    death_debuff_expires_at: null,
    last_logout_at: '2026-01-01T00:00:00.000Z',
  });
}

describe('savePlayersState', () => {
  it('saves current position and HP for standing player', () => {
    const ps = makePs('u1', { x: 30, y: 15 });
    const state = makeState({ u1: ps });
    const nk = {
      storageRead: vi.fn().mockReturnValue([existingBlob('u1')]),
      storageWrite: vi.fn(),
    } as unknown as nkruntime.Nakama;

    savePlayersState(nk, mockLogger, state, ['u1'], false);

    expect(nk.storageWrite).toHaveBeenCalledTimes(1);
    const writes = (nk.storageWrite as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(writes).toHaveLength(1);
    const written = writes[0].value;
    expect(written.current_position).toEqual({ x: 30, y: 15 });
    expect(written.hp_current).toBe(8);
    expect(written.hp_max).toBe(10);
    expect(written.schema_version).toBe(1);
    expect(written.current_zone_id).toBe('blatiny');
    expect(written.last_logout_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('sets last_logout_at when logout=true', () => {
    const ps = makePs('u1', { x: 10, y: 20 });
    const state = makeState({ u1: ps });
    const nk = {
      storageRead: vi.fn().mockReturnValue([existingBlob('u1')]),
      storageWrite: vi.fn(),
    } as unknown as nkruntime.Nakama;

    savePlayersState(nk, mockLogger, state, ['u1'], true);

    const writes = (nk.storageWrite as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const written = writes[0].value;
    expect(written.last_logout_at).not.toBe('2026-01-01T00:00:00.000Z');
    expect(new Date(written.last_logout_at).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('saves computed mid-path position', () => {
    const ps = makePs('u1', { x: 10, y: 10 }, {
      path: [{ x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 }],
      pathStartedAt: 290,
      pathConsumed: 0,
    });
    const state = makeState({ u1: ps });
    state.tick = 300;

    const nk = {
      storageRead: vi.fn().mockReturnValue([existingBlob('u1')]),
      storageWrite: vi.fn(),
    } as unknown as nkruntime.Nakama;

    savePlayersState(nk, mockLogger, state, ['u1'], false);

    const writes = (nk.storageWrite as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const written = writes[0].value;
    // 10 ticks elapsed × 3 tps / 10 Hz = 3 tiles. pathConsumed=0, so index 2 = path[2] = (13,10)
    expect(written.current_position).toEqual({ x: 13, y: 10 });
  });

  it('batches multiple players into single read + write', () => {
    const ps1 = makePs('u1', { x: 5, y: 5 });
    const ps2 = makePs('u2', { x: 40, y: 40 });
    const state = makeState({ u1: ps1, u2: ps2 });

    const nk = {
      storageRead: vi.fn().mockReturnValue([existingBlob('u1'), existingBlob('u2')]),
      storageWrite: vi.fn(),
    } as unknown as nkruntime.Nakama;

    savePlayersState(nk, mockLogger, state, ['u1', 'u2'], false);

    expect(nk.storageRead).toHaveBeenCalledTimes(1);
    const readKeys = (nk.storageRead as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(readKeys).toHaveLength(2);

    expect(nk.storageWrite).toHaveBeenCalledTimes(1);
    const writes = (nk.storageWrite as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(writes).toHaveLength(2);
    expect(writes[0].value.current_position).toEqual({ x: 5, y: 5 });
    expect(writes[1].value.current_position).toEqual({ x: 40, y: 40 });
  });

  it('skips user if presence not in state', () => {
    const state = makeState({});
    const nk = {
      storageRead: vi.fn(),
      storageWrite: vi.fn(),
    } as unknown as nkruntime.Nakama;

    savePlayersState(nk, mockLogger, state, ['u_missing'], false);

    expect(nk.storageRead).not.toHaveBeenCalled();
    expect(nk.storageWrite).not.toHaveBeenCalled();
  });

  it('skips user if storage blob missing', () => {
    const ps = makePs('u1', { x: 10, y: 10 });
    const state = makeState({ u1: ps });
    const nk = {
      storageRead: vi.fn().mockReturnValue([]),
      storageWrite: vi.fn(),
    } as unknown as nkruntime.Nakama;

    savePlayersState(nk, mockLogger, state, ['u1'], false);

    expect(nk.storageWrite).not.toHaveBeenCalled();
  });

  it('handles storage read failure gracefully', () => {
    const ps = makePs('u1', { x: 10, y: 10 });
    const state = makeState({ u1: ps });
    const nk = {
      storageRead: vi.fn().mockImplementation(() => {
        throw new Error('db connection lost');
      }),
      storageWrite: vi.fn(),
    } as unknown as nkruntime.Nakama;

    expect(() => savePlayersState(nk, mockLogger, state, ['u1'], false)).not.toThrow();
    expect(nk.storageWrite).not.toHaveBeenCalled();
  });

  it('handles storage write failure gracefully', () => {
    const ps = makePs('u1', { x: 10, y: 10 });
    const state = makeState({ u1: ps });
    const nk = {
      storageRead: vi.fn().mockReturnValue([existingBlob('u1')]),
      storageWrite: vi.fn().mockImplementation(() => {
        throw new Error('db connection lost');
      }),
    } as unknown as nkruntime.Nakama;

    expect(() => savePlayersState(nk, mockLogger, state, ['u1'], false)).not.toThrow();
  });

  it('does nothing for empty userIds', () => {
    const state = makeState({});
    const nk = {
      storageRead: vi.fn(),
      storageWrite: vi.fn(),
    } as unknown as nkruntime.Nakama;

    savePlayersState(nk, mockLogger, state, [], false);

    expect(nk.storageRead).not.toHaveBeenCalled();
    expect(nk.storageWrite).not.toHaveBeenCalled();
  });

  it('preserves untracked fields from existing blob', () => {
    const ps = makePs('u1', { x: 30, y: 15 });
    const state = makeState({ u1: ps });
    const blob = existingBlob('u1');
    (blob.value as Record<string, unknown>).mana_current = 5;
    (blob.value as Record<string, unknown>).death_debuff_expires_at = '2026-05-05T12:00:00Z';

    const nk = {
      storageRead: vi.fn().mockReturnValue([blob]),
      storageWrite: vi.fn(),
    } as unknown as nkruntime.Nakama;

    savePlayersState(nk, mockLogger, state, ['u1'], false);

    const writes = (nk.storageWrite as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const written = writes[0].value;
    expect(written.mana_current).toBe(5);
    expect(written.death_debuff_expires_at).toBe('2026-05-05T12:00:00Z');
  });
});
