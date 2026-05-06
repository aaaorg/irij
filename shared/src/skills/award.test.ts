import { describe, it, expect } from 'vitest';
import { ATRIBUT_NAMES, SKILL_NAMES } from '../constants/index.js';
import type { AtributRow, AtributSourceRow, SkillRow } from '../types/player.js';
import { distributeXpAward, SOFTCAP_LEVEL, SOFTCAP_OVERFLOW_FACTOR, totalLevelOf, totalXpOf } from './award.js';
import { xpForLevel } from './xp.js';

function freshSkilly(): SkillRow[] {
  return SKILL_NAMES.map((name) => ({ name, xp: 0, level: 1 }));
}
function freshAtributy(): AtributRow[] {
  return ATRIBUT_NAMES.map((name) => ({ name, xp: 0, level: 1 }));
}

describe('distributeXpAward', () => {
  it('credits skill XP and updates level', () => {
    const result = distributeXpAward({ melee: 200 }, freshSkilly(), freshAtributy(), []);
    const melee = result.skilly.find((s) => s.name === 'melee')!;
    expect(melee.xp).toBe(200);
    expect(melee.level).toBeGreaterThanOrEqual(2);
    expect(result.gains).toHaveLength(1);
    expect(result.gains[0]?.type).toBe('skill');
  });

  it('credits atribut XP under cap with full factor', () => {
    const result = distributeXpAward(
      { melee: 35, vitality: 10 },
      freshSkilly(),
      freshAtributy(),
      [],
    );
    const vitality = result.atributy.find((a) => a.name === 'vitality')!;
    expect(vitality.xp).toBe(10);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      atribut: 'vitality',
      source_skill: 'melee',
      xp_contributed: 10,
    });
  });

  it('applies diminishing returns past softcap', () => {
    const cap = xpForLevel(SOFTCAP_LEVEL);
    const sources: AtributSourceRow[] = [
      { atribut: 'vitality', source_skill: 'melee', xp_contributed: cap + 1 },
    ];
    const result = distributeXpAward({ melee: 10, vitality: 100 }, freshSkilly(), freshAtributy(), sources);
    const vit = result.atributy.find((a) => a.name === 'vitality')!;
    expect(vit.xp).toBe(Math.floor(100 * SOFTCAP_OVERFLOW_FACTOR));
    expect(result.sources[0]?.xp_contributed).toBe(cap + 1 + Math.floor(100 * SOFTCAP_OVERFLOW_FACTOR));
  });

  it('returns level_up entries when level increases', () => {
    const result = distributeXpAward({ melee: 200 }, freshSkilly(), freshAtributy(), []);
    expect(result.level_ups.length).toBeGreaterThan(0);
    expect(result.level_ups[0]?.type).toBe('skill');
    expect(result.level_ups[0]?.name).toBe('melee');
    expect(result.total_level_delta).toBeGreaterThan(0);
  });

  it('ignores zero or negative awards', () => {
    const result = distributeXpAward({ melee: 0, vitality: -5 }, freshSkilly(), freshAtributy(), []);
    expect(result.gains).toHaveLength(0);
    expect(result.total_xp_delta).toBe(0);
  });

  it('ignores unknown skill names without crashing', () => {
    const result = distributeXpAward({ unknown_skill: 50 }, freshSkilly(), freshAtributy(), []);
    expect(result.gains).toHaveLength(0);
  });

  it('handles atribut-only award with no source skill (no diminishing tracking)', () => {
    const result = distributeXpAward({ vitality: 50 }, freshSkilly(), freshAtributy(), []);
    const vit = result.atributy.find((a) => a.name === 'vitality')!;
    expect(vit.xp).toBe(50);
    expect(result.sources).toHaveLength(0);
  });

  it('does not mutate the input rows', () => {
    const skilly = freshSkilly();
    const atributy = freshAtributy();
    const sources: AtributSourceRow[] = [];
    distributeXpAward({ melee: 100, vitality: 5 }, skilly, atributy, sources);
    expect(skilly.find((s) => s.name === 'melee')?.xp).toBe(0);
    expect(atributy.find((a) => a.name === 'vitality')?.xp).toBe(0);
    expect(sources).toHaveLength(0);
  });

  it('total_xp_delta sums all gained XP after diminishing', () => {
    const result = distributeXpAward({ melee: 35, vitality: 10 }, freshSkilly(), freshAtributy(), []);
    expect(result.total_xp_delta).toBe(35 + 10);
  });
});

describe('totalLevelOf / totalXpOf', () => {
  it('sums levels and XP across skilly + atributy', () => {
    const skilly: SkillRow[] = [
      { name: 'melee', xp: 200, level: 3 },
      { name: 'mining', xp: 0, level: 1 },
    ];
    const atributy: AtributRow[] = [{ name: 'strength', xp: 50, level: 2 }];
    expect(totalLevelOf(skilly, atributy)).toBe(3 + 1 + 2);
    expect(totalXpOf(skilly, atributy)).toBe(200 + 0 + 50);
  });
});
