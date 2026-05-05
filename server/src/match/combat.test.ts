import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MobDefinition, LootTable } from 'irij-shared/types';
import type { WorldMatchState, MobInstanceState, PlayerPresenceState } from './state.js';

import { parseAttackRequest, chebyshevDistance } from './combat.js';

function makeMobDef(overrides: Partial<MobDefinition> = {}): MobDefinition {
  return {
    id: 'mob.wolf',
    name_cs: 'Vlk',
    appearance_id: 'sprite.mob.wolf',
    level: 5,
    stats: {
      hp_max: 30,
      damage_min: 2,
      damage_max: 5,
      attack_speed_ticks: 6,
      defense_melee: 3,
      defense_ranged: 1,
      defense_magic: 0,
      weapon_class: 'melee',
      movement_speed_tps: 2.5,
      range_tiles: 1,
    },
    ai_behavior: 'aggressive_basic',
    loot_table_id: 'loot.wolf',
    xp_award: { melee: 35, vitality: 10 },
    aggro_radius_tiles: 5,
    leash_radius_tiles: 15,
    level_aggro_threshold: 10,
    respawn_min_s: 60,
    respawn_max_s: 180,
    ...overrides,
  };
}

describe('parseAttackRequest', () => {
  it('parses valid request', () => {
    const result = parseAttackRequest({ target_id: 'spawn.wolf_001', client_seq: 42 });
    expect(result).toEqual({ target_id: 'spawn.wolf_001', client_seq: 42 });
  });

  it('rejects null', () => {
    expect(parseAttackRequest(null)).toBeNull();
  });

  it('rejects missing target_id', () => {
    expect(parseAttackRequest({ client_seq: 1 })).toBeNull();
  });

  it('rejects non-string target_id', () => {
    expect(parseAttackRequest({ target_id: 123, client_seq: 1 })).toBeNull();
  });

  it('rejects missing client_seq', () => {
    expect(parseAttackRequest({ target_id: 'mob' })).toBeNull();
  });

  it('rejects float client_seq', () => {
    expect(parseAttackRequest({ target_id: 'mob', client_seq: 1.5 })).toBeNull();
  });
});

describe('chebyshevDistance', () => {
  it('returns 0 for same position', () => {
    expect(chebyshevDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('returns correct distance for adjacent', () => {
    expect(chebyshevDistance({ x: 5, y: 5 }, { x: 6, y: 5 })).toBe(1);
    expect(chebyshevDistance({ x: 5, y: 5 }, { x: 6, y: 6 })).toBe(1);
  });

  it('returns correct distance for diagonal', () => {
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(4);
  });

  it('handles negative coordinates', () => {
    expect(chebyshevDistance({ x: -2, y: -3 }, { x: 1, y: 1 })).toBe(4);
  });
});
