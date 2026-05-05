// Phase 5 autosave — periodic + leave/terminate flush of PlayerState to Storage.
// Match state is the single source of truth during gameplay; Storage is persistence
// for cross-session restore. Unconditional write (no OCC version check) because
// the match handler is the authoritative writer for position/HP during a session.

import { STORAGE_COLLECTIONS } from 'irij-shared/constants';

import { log } from '../lib/log.js';
import { computeCurrentPosition } from './movement.js';
import type { PlayerPresenceState, WorldMatchState } from './state.js';

const PERMISSION_OWNER_READ = 1 as nkruntime.ReadPermissionValues;
const PERMISSION_NO_WRITE = 0 as nkruntime.WritePermissionValues;

export function savePlayersState(
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  state: WorldMatchState,
  userIds: string[],
  logout: boolean,
): void {
  if (userIds.length === 0) return;

  const validEntries: { userId: string; ps: PlayerPresenceState }[] = [];
  for (const userId of userIds) {
    const ps = state.presencesByUserId[userId];
    if (ps) validEntries.push({ userId, ps });
  }
  if (validEntries.length === 0) return;

  const readKeys = validEntries.map(({ userId }) => ({
    collection: STORAGE_COLLECTIONS.PLAYER_STATE,
    key: userId,
    userId,
  }));

  let blobs: nkruntime.StorageObject[];
  try {
    blobs = nk.storageRead(readKeys);
  } catch (err) {
    log(logger, 'error', 'autosave: batch read failed', { error: String(err) });
    return;
  }

  const blobByUser = new Map<string, Record<string, unknown>>();
  for (const obj of blobs) {
    blobByUser.set(obj.userId, obj.value as Record<string, unknown>);
  }

  const now = logout ? new Date().toISOString() : undefined;
  const writes: nkruntime.StorageWriteRequest[] = [];

  for (const { userId, ps } of validEntries) {
    const existing = blobByUser.get(userId);
    if (!existing) {
      log(logger, 'warn', 'autosave: blob missing', { userId: userId.slice(0, 8) });
      continue;
    }

    const currentPos = computeCurrentPosition(ps, state.tick);
    const updated: Record<string, unknown> = {
      ...existing,
      current_position: { x: currentPos.x, y: currentPos.y },
      hp_current: ps.hpCurrent,
      hp_max: ps.hpMax,
    };
    if (now) {
      updated.last_logout_at = now;
    }

    writes.push({
      collection: STORAGE_COLLECTIONS.PLAYER_STATE,
      key: userId,
      userId,
      value: updated,
      permissionRead: PERMISSION_OWNER_READ,
      permissionWrite: PERMISSION_NO_WRITE,
    });
  }

  if (writes.length === 0) return;

  try {
    nk.storageWrite(writes);
    log(logger, 'debug', 'autosave ok', { count: writes.length, logout });
  } catch (err) {
    log(logger, 'error', 'autosave: batch write failed', {
      error: String(err),
      count: writes.length,
    });
  }
}
