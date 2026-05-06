// XP curve & level math — viz docs/02a sekce PlayerAtribut, docs/refs/skills.md.
//
// Provisional (Phase 8): RuneScape-Classic style exponential lookup, scaled tak,
// aby lvl 99 ≈ 10M XP (target z action planu). Sdílí se klient i server.
//
// Level 1 začíná na 0 XP. Diff(L) = floor((L + C * 2^(L/7)) / 4), C = 250.

import { LEVEL_CAP } from '../constants/index.js';

const XP_DIFFICULTY_CONSTANT = 250;

function buildCurve(): readonly number[] {
  const out: number[] = [0, 0]; // index 0 unused, index 1 = 0 XP
  let total = 0;
  for (let l = 1; l < LEVEL_CAP; l++) {
    const diff = Math.floor((l + XP_DIFFICULTY_CONSTANT * Math.pow(2, l / 7)) / 4);
    total += diff;
    out.push(total);
  }
  return out;
}

const XP_CURVE: readonly number[] = buildCurve();

// Vrátí XP threshold pro daný level (xp pro vstup do levelu). xpForLevel(1) === 0.
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level >= LEVEL_CAP) return XP_CURVE[LEVEL_CAP] ?? 0;
  return XP_CURVE[level] ?? 0;
}

// Vrátí level odpovídající kumulativnímu XP. Klamp [1, LEVEL_CAP].
export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;
  for (let l = LEVEL_CAP; l >= 1; l--) {
    if (xp >= (XP_CURVE[l] ?? 0)) return l;
  }
  return 1;
}

// Progres do dalšího levelu jako fraction 0..1 — pro XP bary v UI.
export function levelProgress(xp: number): { level: number; intoLevel: number; toNextLevel: number; pct: number } {
  const level = levelForXp(xp);
  const baseXp = xpForLevel(level);
  if (level >= LEVEL_CAP) {
    return { level, intoLevel: 0, toNextLevel: 0, pct: 1 };
  }
  const nextXp = xpForLevel(level + 1);
  const intoLevel = xp - baseXp;
  const toNextLevel = nextXp - baseXp;
  const pct = toNextLevel > 0 ? intoLevel / toNextLevel : 0;
  return { level, intoLevel, toNextLevel, pct };
}

export const XP_CURVE_DEBUG: readonly number[] = XP_CURVE;
