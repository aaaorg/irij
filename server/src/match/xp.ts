// Phase 8: server-side XP award + write-through na PLAYER_SKILLS storage.
// Volá se z combat handleru po mob death; pure logika je v
// `irij-shared/skills` (distributeXpAward), tady je glue na Nakama Storage
// + match state mutace + broadcast XP_AWARDED / LEVEL_UP.

import { STORAGE_COLLECTIONS } from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type { LevelUp, XpAwarded } from 'irij-shared/messages';
import { distributeXpAward, totalLevelOf, totalXpOf } from 'irij-shared/skills';

import { log } from '../lib/log.js';
import type { WorldMatchState } from './state.js';

const PERMISSION_OWNER_READ = 1 as nkruntime.ReadPermissionValues;
const PERMISSION_NO_WRITE = 0 as nkruntime.WritePermissionValues;

export function awardXp(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  userId: string,
  xpAward: Record<string, number>,
  source: XpAwarded['source'],
  sourceId?: string,
): void {
  const ps = state.presencesByUserId[userId];
  if (!ps) return;

  const result = distributeXpAward(xpAward, ps.skilly, ps.atributy, ps.sources);
  if (result.gains.length === 0) return;

  const newTotalLevel = totalLevelOf(result.skilly, result.atributy);
  const newTotalXp = totalXpOf(result.skilly, result.atributy);

  state.presencesByUserId = {
    ...state.presencesByUserId,
    [userId]: {
      ...ps,
      skilly: result.skilly,
      atributy: result.atributy,
      sources: result.sources,
      totalLevel: newTotalLevel,
      totalXp: newTotalXp,
    },
  };

  // Write-through: persist updated skill blob.
  try {
    nk.storageWrite([
      {
        collection: STORAGE_COLLECTIONS.PLAYER_SKILLS,
        key: userId,
        userId,
        value: { atributy: result.atributy, skilly: result.skilly, sources: result.sources },
        permissionRead: PERMISSION_OWNER_READ,
        permissionWrite: PERMISSION_NO_WRITE,
      },
    ]);
  } catch (err) {
    log(logger, 'error', 'awardXp: storageWrite failed', {
      userId: userId.slice(0, 8),
      error: String(err),
    });
  }

  const xpPayload: XpAwarded = {
    source,
    source_id: sourceId,
    gains: result.gains.map((g) => ({
      type: g.type,
      name: g.name,
      amount: g.amount,
      base_amount: g.base_amount,
      level_before: g.level_before,
      level_after: g.level_after,
    })),
    total_xp_delta: result.total_xp_delta,
    total_level_delta: result.total_level_delta,
  };
  dispatcher.broadcastMessage(Op.XP_AWARDED, JSON.stringify(xpPayload), [ps.presence]);

  for (const lu of result.level_ups) {
    const luPayload: LevelUp = {
      type: lu.type,
      name: lu.name,
      new_level: lu.new_level,
      total_level: newTotalLevel,
    };
    dispatcher.broadcastMessage(Op.LEVEL_UP, JSON.stringify(luPayload), [ps.presence]);
    log(logger, 'info', 'level up', {
      userId: userId.slice(0, 8),
      type: lu.type,
      name: lu.name,
      newLevel: lu.new_level,
    });
  }
}
