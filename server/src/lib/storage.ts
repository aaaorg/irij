// OCC (Optimistic Concurrency Control) storage helpers — viz ADR-004 OCC pattern.
// Nakama Storage Engine supports CAS via `version` field on read/write.

type StorageValue = { [key: string]: any };

export interface VersionedValue<T> {
  value: T;
  version: string;
}

export function readWithVersion<T>(
  nk: nkruntime.Nakama,
  collection: string,
  key: string,
  userId: string,
): VersionedValue<T> | null {
  const objects = nk.storageRead([{ collection, key, userId }]);
  const obj = objects.find((o) => o.collection === collection && o.key === key);
  if (!obj) return null;
  return { value: obj.value as T, version: obj.version ?? '' };
}

export function writeWithVersion(
  nk: nkruntime.Nakama,
  collection: string,
  key: string,
  userId: string,
  value: StorageValue,
  version: string,
  permissionRead: nkruntime.ReadPermissionValues = 1,
  permissionWrite: nkruntime.WritePermissionValues = 0,
): string {
  const acks = nk.storageWrite([
    { collection, key, userId, value, version, permissionRead, permissionWrite },
  ]);
  return acks[0]?.version ?? '';
}

// Retry helper for OCC conflicts. `fn` receives current value+version, returns
// mutated value. On version conflict (storageRejectedVersion), re-reads and
// re-applies up to `maxRetries` times.
export function withOCCRetry<T extends StorageValue>(
  nk: nkruntime.Nakama,
  collection: string,
  key: string,
  userId: string,
  fn: (current: T, version: string) => T,
  maxRetries: number = 3,
  permissionRead: nkruntime.ReadPermissionValues = 1,
  permissionWrite: nkruntime.WritePermissionValues = 0,
): VersionedValue<T> {
  let attempt = 0;
  while (true) {
    const read = readWithVersion<T>(nk, collection, key, userId);
    if (!read) {
      throw new Error(`OCC retry: object not found (${collection}/${key}/${userId})`);
    }

    const mutated = fn(read.value, read.version);

    try {
      const newVersion = writeWithVersion(
        nk,
        collection,
        key,
        userId,
        mutated,
        read.version,
        permissionRead,
        permissionWrite,
      );
      return { value: mutated, version: newVersion };
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries || !isVersionConflict(err)) {
        throw err;
      }
    }
  }
}

function isVersionConflict(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('version') || msg.includes('storage rejected');
  }
  return false;
}
