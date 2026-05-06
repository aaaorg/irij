import { describe, expect, it } from 'vitest';
import { rollCraftFail, rollCraftedRarity } from './rarity.js';

describe('rollCraftedRarity', () => {
  it('T1 rolls common at 95% and rare at 5%', () => {
    expect(rollCraftedRarity(1, () => 0.0)).toBe('common');
    expect(rollCraftedRarity(1, () => 0.94)).toBe('common');
    expect(rollCraftedRarity(1, () => 0.96)).toBe('rare');
  });

  it('T2 rolls epic with 2% threshold', () => {
    // 0.85 → common edge, 0.85+0.13 = 0.98 → rare edge, 0.99 → epic
    expect(rollCraftedRarity(2, () => 0.0)).toBe('common');
    expect(rollCraftedRarity(2, () => 0.86)).toBe('rare');
    expect(rollCraftedRarity(2, () => 0.99)).toBe('epic');
  });

  it('T4 rolls common at 50% / rare at 35% / epic at 15%', () => {
    expect(rollCraftedRarity(4, () => 0.0)).toBe('common');
    expect(rollCraftedRarity(4, () => 0.49)).toBe('common');
    expect(rollCraftedRarity(4, () => 0.51)).toBe('rare');
    expect(rollCraftedRarity(4, () => 0.86)).toBe('epic');
  });

  it('unknown tier falls back to T1 distribution', () => {
    expect(rollCraftedRarity(99, () => 0.0)).toBe('common');
    expect(rollCraftedRarity(99, () => 0.99)).toBe('rare');
  });

  it('never rolls legendary from standard crafting', () => {
    for (const tier of [1, 2, 3, 4]) {
      for (const r of [0.0, 0.5, 0.999]) {
        const rolled = rollCraftedRarity(tier, () => r);
        expect(rolled).not.toBe('legendary');
      }
    }
  });
});

describe('rollCraftFail', () => {
  it('returns false for fail_chance 0', () => {
    expect(rollCraftFail(0, () => 0.5)).toBe(false);
    expect(rollCraftFail(0, () => 0.0)).toBe(false);
  });

  it('returns true for fail_chance 100', () => {
    expect(rollCraftFail(100, () => 0.5)).toBe(true);
    expect(rollCraftFail(100, () => 0.99)).toBe(true);
  });

  it('respects threshold for partial chances', () => {
    expect(rollCraftFail(5, () => 0.04)).toBe(true);
    expect(rollCraftFail(5, () => 0.06)).toBe(false);
    expect(rollCraftFail(50, () => 0.49)).toBe(true);
    expect(rollCraftFail(50, () => 0.51)).toBe(false);
  });
});
