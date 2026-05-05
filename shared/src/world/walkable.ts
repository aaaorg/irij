// Shared walkable tile classification — single source of truth for server + client.
// Server uses in maskFromTiledMap; client can use for UX click filtering (Phase 18+).

import { NON_WALKABLE_TILE_GIDS } from '../constants/index.js';

export function isWalkableGid(gid: number): boolean {
  return gid !== 0 && !NON_WALKABLE_TILE_GIDS.has(gid);
}
