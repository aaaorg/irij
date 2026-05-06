import { describe, it, expect } from 'vitest';
import { LEVEL_CAP } from '../constants/index.js';
import { XP_CURVE_DEBUG, levelForXp, levelProgress, xpForLevel } from './xp.js';

describe('xp curve', () => {
  it('level 1 starts at 0 XP', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelForXp(0)).toBe(1);
  });

  it('curve is monotonically increasing', () => {
    for (let l = 2; l <= LEVEL_CAP; l++) {
      expect(xpForLevel(l)).toBeGreaterThan(xpForLevel(l - 1));
    }
  });

  it('lvl 99 is between 8M and 12M (target ≈ 10M per action plan)', () => {
    const xpAt99 = xpForLevel(LEVEL_CAP);
    expect(xpAt99).toBeGreaterThan(8_000_000);
    expect(xpAt99).toBeLessThan(12_000_000);
  });

  it('level 1→2 ≈ ~80–120 XP (action plan provisional 100)', () => {
    expect(xpForLevel(2)).toBeGreaterThan(50);
    expect(xpForLevel(2)).toBeLessThan(150);
  });

  it('levelForXp roundtrips through xpForLevel boundary', () => {
    for (let l = 1; l <= LEVEL_CAP; l++) {
      expect(levelForXp(xpForLevel(l))).toBe(l);
    }
  });

  it('levelForXp returns previous level just below threshold', () => {
    for (let l = 2; l <= LEVEL_CAP; l++) {
      expect(levelForXp(xpForLevel(l) - 1)).toBe(l - 1);
    }
  });

  it('levelForXp clamps to LEVEL_CAP for huge XP', () => {
    expect(levelForXp(999_999_999)).toBe(LEVEL_CAP);
  });

  it('XP_CURVE has length LEVEL_CAP + 1 (indices 0..LEVEL_CAP)', () => {
    expect(XP_CURVE_DEBUG.length).toBe(LEVEL_CAP + 1);
  });

  it('levelProgress mid-level is 0..1', () => {
    const xp = Math.floor((xpForLevel(5) + xpForLevel(6)) / 2);
    const p = levelProgress(xp);
    expect(p.level).toBe(5);
    expect(p.pct).toBeGreaterThan(0);
    expect(p.pct).toBeLessThan(1);
  });

  it('levelProgress at cap is pct=1', () => {
    const p = levelProgress(xpForLevel(LEVEL_CAP) + 100);
    expect(p.level).toBe(LEVEL_CAP);
    expect(p.pct).toBe(1);
  });
});
