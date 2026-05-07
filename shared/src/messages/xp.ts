// XP / level-up — viz docs/00-action-plan.md Phase 8.
// XP_AWARDED je per-kill detail (kolik XP přitéklo do každého skillu/atributu po
// diminishing returns). LEVEL_UP je samostatný event pro celebration UI;
// posílá se 1× per level-up, ne agregát.

export interface XpGain {
  type: 'skill' | 'atribut';
  name: string;
  amount: number; // gained po diminishing
  base_amount: number; // surový amount před diminishing (==amount pro skill)
  level_before: number;
  level_after: number;
}

// Op.XP_AWARDED (76) — server → killer (unicast).
export interface XpAwarded {
  source: 'mob_kill' | 'gather' | 'craft' | 'quest' | 'job' | 'other';
  source_id?: string; // např. mob.instanceId nebo recipe_id
  gains: XpGain[];
  total_xp_delta: number;
  total_level_delta: number;
}

// Op.LEVEL_UP (77) — server → owner (unicast).
export interface LevelUp {
  type: 'skill' | 'atribut';
  name: string;
  new_level: number;
  total_level: number;
}
