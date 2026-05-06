// XP distribution + diminishing returns — viz docs/02a-data-model-postava.md
// sekce PlayerAtribut + PlayerAtributSource. Pure function, žádný Nakama API.
//
// Vstupní `xp_award` z mob/recipe/akce je flat dict { name → amount } kde name
// může být buď SkillName nebo AtributName. Klasifikace runtime přes
// ATRIBUT_NAMES množinu. "Source skill" pro atribut diminishing = první
// nalezený skill v xp_award (kill = melee/ranged/magic atd.).
//
// Diminishing returns (per skills.md hard threshold variant):
//   - každý zdroj atributu má cap = xpForLevel(SOFTCAP_LEVEL)
//   - pod capem dostává 100 % of base, nad capem SOFTCAP_OVERFLOW_FACTOR
//   - tracked v `sources: AtributSourceRow[]`

import { ATRIBUT_NAMES, LEVEL_CAP } from '../constants/index.js';
import type { AtributName, AtributRow, AtributSourceRow, SkillName, SkillRow } from '../types/player.js';
import { levelForXp, xpForLevel } from './xp.js';

export const SOFTCAP_LEVEL = 60;
export const SOFTCAP_OVERFLOW_FACTOR = 0.2;

const ATRIBUT_NAME_SET: ReadonlySet<string> = new Set(ATRIBUT_NAMES);

export function isAtributName(name: string): name is AtributName {
  return ATRIBUT_NAME_SET.has(name);
}

export interface XpGainEntry {
  type: 'skill' | 'atribut';
  name: string;
  amount: number; // gained after diminishing
  base_amount: number; // before diminishing (==amount for skill)
  level_before: number;
  level_after: number;
}

export interface XpDistributionResult {
  skilly: SkillRow[];
  atributy: AtributRow[];
  sources: AtributSourceRow[];
  gains: XpGainEntry[];
  level_ups: Array<{ type: 'skill' | 'atribut'; name: string; new_level: number }>;
  total_xp_delta: number;
  total_level_delta: number;
}

export function distributeXpAward(
  xpAward: Record<string, number>,
  skilly: readonly SkillRow[],
  atributy: readonly AtributRow[],
  sources: readonly AtributSourceRow[],
): XpDistributionResult {
  // Identify primary source skill (first non-atribut name with positive amount).
  let sourceSkill: SkillName | null = null;
  for (const name of Object.keys(xpAward)) {
    const amount = xpAward[name] ?? 0;
    if (amount > 0 && !isAtributName(name)) {
      sourceSkill = name as SkillName;
      break;
    }
  }

  const skillBy = new Map<string, SkillRow>(skilly.map((s) => [s.name, { ...s }]));
  const atrBy = new Map<string, AtributRow>(atributy.map((a) => [a.name, { ...a }]));
  const srcBy = new Map<string, AtributSourceRow>(
    sources.map((s) => [`${s.atribut}|${s.source_skill}`, { ...s }]),
  );

  const gains: XpGainEntry[] = [];
  const levelUps: Array<{ type: 'skill' | 'atribut'; name: string; new_level: number }> = [];
  let totalXpDelta = 0;
  let totalLevelDelta = 0;

  for (const name of Object.keys(xpAward)) {
    const baseAmount = xpAward[name] ?? 0;
    if (baseAmount <= 0) continue;

    if (isAtributName(name)) {
      const row = atrBy.get(name);
      if (!row) continue;

      // Diminishing returns lookup (atribut, source_skill).
      let factor = 1;
      let srcKey: string | null = null;
      if (sourceSkill) {
        srcKey = `${name}|${sourceSkill}`;
        const src = srcBy.get(srcKey);
        const contributed = src?.xp_contributed ?? 0;
        if (contributed >= xpForLevel(SOFTCAP_LEVEL)) {
          factor = SOFTCAP_OVERFLOW_FACTOR;
        }
      }
      const gained = Math.floor(baseAmount * factor);
      if (gained <= 0) continue;

      const levelBefore = row.level;
      const newXp = row.xp + gained;
      const newLevel = levelForXp(newXp);
      row.xp = newXp;
      row.level = newLevel;
      atrBy.set(name, row);

      if (srcKey && sourceSkill) {
        const existing = srcBy.get(srcKey);
        srcBy.set(srcKey, {
          atribut: name,
          source_skill: sourceSkill,
          xp_contributed: (existing?.xp_contributed ?? 0) + gained,
        });
      }

      gains.push({
        type: 'atribut',
        name,
        amount: gained,
        base_amount: baseAmount,
        level_before: levelBefore,
        level_after: newLevel,
      });
      totalXpDelta += gained;
      if (newLevel > levelBefore) {
        levelUps.push({ type: 'atribut', name, new_level: newLevel });
        totalLevelDelta += newLevel - levelBefore;
      }
    } else {
      const row = skillBy.get(name);
      if (!row) continue;

      const levelBefore = row.level;
      const newXp = row.xp + baseAmount;
      const newLevel = levelForXp(newXp);
      row.xp = newXp;
      row.level = newLevel;
      skillBy.set(name, row);

      gains.push({
        type: 'skill',
        name,
        amount: baseAmount,
        base_amount: baseAmount,
        level_before: levelBefore,
        level_after: newLevel,
      });
      totalXpDelta += baseAmount;
      if (newLevel > levelBefore) {
        levelUps.push({ type: 'skill', name, new_level: newLevel });
        totalLevelDelta += newLevel - levelBefore;
      }
    }
  }

  return {
    skilly: Array.from(skillBy.values()) as SkillRow[],
    atributy: Array.from(atrBy.values()) as AtributRow[],
    sources: Array.from(srcBy.values()),
    gains,
    level_ups: levelUps,
    total_xp_delta: totalXpDelta,
    total_level_delta: totalLevelDelta,
  };
}

export function totalLevelOf(skilly: readonly SkillRow[], atributy: readonly AtributRow[]): number {
  let sum = 0;
  for (const s of skilly) sum += s.level;
  for (const a of atributy) sum += a.level;
  return Math.min(sum, 21 * LEVEL_CAP);
}

export function totalXpOf(skilly: readonly SkillRow[], atributy: readonly AtributRow[]): number {
  let sum = 0;
  for (const s of skilly) sum += s.xp;
  for (const a of atributy) sum += a.xp;
  return sum;
}
