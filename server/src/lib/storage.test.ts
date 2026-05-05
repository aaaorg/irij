import { describe, expect, it, vi } from 'vitest';
import { readWithVersion, writeWithVersion, withOCCRetry } from './storage.js';

function makeMockNk(opts: {
  readResult?: nkruntime.StorageObject[];
  writeResult?: nkruntime.StorageWriteAck[];
  writeError?: Error;
  writeErrorOnAttempt?: number;
}) {
  let writeAttempt = 0;
  return {
    storageRead: vi.fn().mockReturnValue(opts.readResult ?? []),
    storageWrite: vi.fn().mockImplementation(() => {
      writeAttempt++;
      if (opts.writeError && (!opts.writeErrorOnAttempt || writeAttempt <= opts.writeErrorOnAttempt)) {
        throw opts.writeError;
      }
      return opts.writeResult ?? [{ version: 'v2', key: 'k', collection: 'c', userId: 'u' }];
    }),
  } as unknown as nkruntime.Nakama;
}

function storageObj(
  collection: string,
  key: string,
  value: Record<string, unknown>,
  version: string,
): nkruntime.StorageObject {
  return {
    collection,
    key,
    userId: 'user1',
    value,
    version,
    permissionRead: 1,
    permissionWrite: 0,
    createTime: 0,
    updateTime: 0,
  } as nkruntime.StorageObject;
}

describe('readWithVersion', () => {
  it('returns value and version from storage', () => {
    const nk = makeMockNk({
      readResult: [storageObj('player', 'user1', { name: 'test' }, 'v1')],
    });

    const result = readWithVersion<{ name: string }>(nk, 'player', 'user1', 'user1');
    expect(result).toEqual({ value: { name: 'test' }, version: 'v1' });
    expect(nk.storageRead).toHaveBeenCalledWith([
      { collection: 'player', key: 'user1', userId: 'user1' },
    ]);
  });

  it('returns null when object not found', () => {
    const nk = makeMockNk({ readResult: [] });
    const result = readWithVersion(nk, 'player', 'user1', 'user1');
    expect(result).toBeNull();
  });
});

describe('writeWithVersion', () => {
  it('writes with version and returns new version', () => {
    const nk = makeMockNk({
      writeResult: [{ version: 'v2', key: 'k', collection: 'c', userId: 'u' } as nkruntime.StorageWriteAck],
    });

    const newVersion = writeWithVersion(nk, 'player', 'user1', 'user1', { name: 'updated' }, 'v1');
    expect(newVersion).toBe('v2');
    expect(nk.storageWrite).toHaveBeenCalledWith([
      {
        collection: 'player',
        key: 'user1',
        userId: 'user1',
        value: { name: 'updated' },
        version: 'v1',
        permissionRead: 1,
        permissionWrite: 0,
      },
    ]);
  });
});

describe('withOCCRetry', () => {
  it('succeeds on first attempt without conflict', () => {
    const obj = storageObj('player', 'user1', { hp: 10 }, 'v1');
    const nk = makeMockNk({
      readResult: [obj],
      writeResult: [{ version: 'v2', key: 'user1', collection: 'player', userId: 'user1' } as nkruntime.StorageWriteAck],
    });

    const result = withOCCRetry<{ hp: number }>(
      nk, 'player', 'user1', 'user1',
      (current) => ({ ...current, hp: current.hp - 3 }),
    );

    expect(result.value).toEqual({ hp: 7 });
    expect(result.version).toBe('v2');
    expect(nk.storageRead).toHaveBeenCalledTimes(1);
    expect(nk.storageWrite).toHaveBeenCalledTimes(1);
  });

  it('retries on version conflict and succeeds', () => {
    const obj = storageObj('player', 'user1', { hp: 10 }, 'v1');
    const nk = makeMockNk({
      readResult: [obj],
      writeError: new Error('storage rejected version'),
      writeErrorOnAttempt: 1,
    });

    const result = withOCCRetry<{ hp: number }>(
      nk, 'player', 'user1', 'user1',
      (current) => ({ ...current, hp: current.hp - 1 }),
      3,
    );

    expect(result.value).toEqual({ hp: 9 });
    expect(nk.storageRead).toHaveBeenCalledTimes(2);
    expect(nk.storageWrite).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries on persistent conflict', () => {
    const obj = storageObj('player', 'user1', { hp: 10 }, 'v1');
    const nk = makeMockNk({
      readResult: [obj],
      writeError: new Error('storage rejected version'),
    });

    expect(() =>
      withOCCRetry<{ hp: number }>(
        nk, 'player', 'user1', 'user1',
        (current) => ({ ...current, hp: current.hp - 1 }),
        3,
      ),
    ).toThrow('storage rejected version');

    expect(nk.storageRead).toHaveBeenCalledTimes(3);
    expect(nk.storageWrite).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on non-version error', () => {
    const obj = storageObj('player', 'user1', { hp: 10 }, 'v1');
    const nk = makeMockNk({
      readResult: [obj],
      writeError: new Error('database connection lost'),
    });

    expect(() =>
      withOCCRetry<{ hp: number }>(
        nk, 'player', 'user1', 'user1',
        (current) => ({ ...current, hp: current.hp - 1 }),
        3,
      ),
    ).toThrow('database connection lost');

    expect(nk.storageRead).toHaveBeenCalledTimes(1);
    expect(nk.storageWrite).toHaveBeenCalledTimes(1);
  });

  it('throws when object not found', () => {
    const nk = makeMockNk({ readResult: [] });

    expect(() =>
      withOCCRetry<{ hp: number }>(
        nk, 'player', 'user1', 'user1',
        (current) => ({ ...current, hp: current.hp - 1 }),
      ),
    ).toThrow('OCC retry: object not found');
  });
});
