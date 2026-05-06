// Phase 10: rarity rolling pro běžný (non-upgrade) crafting per docs/02b sekce
// "Tier × Rarity mapping pro crafting". Cap = epic; legendary se neroluje
// běžným craftem (vyžaduje samostatný upgrade recept).

import type { Rarity } from '../types/item.js';

// Per-tier distribuce (T1 → T4) v %.
// Sum musí být 100. Skill bonus na vyšší rarity ladíme post-MVP.
const TIER_DISTRIBUTION: { [tier: number]: { common: number; rare: number; epic: number } } = {
  1: { common: 95, rare: 5, epic: 0 },
  2: { common: 85, rare: 13, epic: 2 },
  3: { common: 70, rare: 25, epic: 5 },
  4: { common: 50, rare: 35, epic: 15 },
};

// Vrátí rarity pro daný tier. `rng` je [0, 1). Default Math.random pro production,
// override pro testy (deterministic).
export function rollCraftedRarity(tier: number, rng: () => number = Math.random): Rarity {
  const dist = TIER_DISTRIBUTION[tier] ?? TIER_DISTRIBUTION[1]!;
  const r = rng() * 100;
  if (r < dist.common) return 'common';
  if (r < dist.common + dist.rare) return 'rare';
  return 'epic';
}

// Vrátí true pokud crafting selže (inputy ztraceny, output není). `rng` deterministic
// pro testy.
export function rollCraftFail(failChancePct: number, rng: () => number = Math.random): boolean {
  if (failChancePct <= 0) return false;
  if (failChancePct >= 100) return true;
  return rng() * 100 < failChancePct;
}
