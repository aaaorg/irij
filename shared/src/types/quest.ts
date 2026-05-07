// Quest types — viz docs/02d-data-model-npc-mobi-questy.md sekce 4 Questy.
//
// Phase 11: implementuje state machine, prerequisites, lineární kroky, rewards.
// Branching, fail states, repeatables jsou parking lot (post-MVP).

import type { Position } from './world.js';
import type { DialogText } from './npc.js';
import type { CompletedJobEntry, PlayerJobBoardEntry } from './jobBoard.js';

// Objective types — viz docs/02d sekce "Objective types (MVP)".
// MVP implementuje 3 typy potřebné pro "Synovec Starého Kováře":
// talk_to_npc, kill_mob, interact_with_object.
export type QuestObjectiveDefinition =
  | { type: 'talk_to_npc'; target: string; dialog_node?: string }
  | { type: 'kill_mob'; target: string; count: number }
  | { type: 'interact_with_object'; target: string };

export interface QuestStepDefinition {
  id: string;
  description: DialogText; // popis kroku v UI
  objective: QuestObjectiveDefinition;
}

export interface QuestRewardDefinition {
  xp?: Record<string, number>; // skill/atribut → XP (jde do existujícího awardXp)
  items?: Array<{ item_id: string; quantity: number }>;
  currency_denar?: number;
  knowledge?: string[];
  reputation?: Record<string, number>; // village_id → delta
}

export interface QuestPrerequisites {
  knowledge?: string[];
  completed_quests?: string[];
  min_reputation?: Record<string, number>;
  min_total_level?: number;
}

export interface QuestDefinition {
  id: string;
  title: DialogText;
  description: DialogText;
  category: 'main' | 'side' | 'hidden';
  village_id?: string;
  level_recommendation?: number;
  prerequisites: QuestPrerequisites;
  steps: QuestStepDefinition[];
  rewards: QuestRewardDefinition;
  lockout_after_complete: boolean;
}

// Statická definice quest objektu — entitka na mapě, se kterou hráč interaguje
// pro splnění interact_with_object objective. Server ji načte z
// quest_objects.json a spawne v matchInit (analog NPC).
export interface QuestObjectDefinition {
  id: string; // např. "object.bloody_amulet"
  display_name_cs: string;
  display_name_en?: string;
  position: Position;
  // Po interakci je objekt destroynut (despawnnut) z mapy — singleton trigger.
  // MVP design: pokud je quest dokončený, objekt se nerespawnnuje. Pro repeat
  // questy by se musel přidat respawn condition (post-MVP).
  consume_on_interact: boolean;
}

// Per-quest runtime stav ve hráčově blobu.
export interface PlayerQuestProgress {
  quest_id: string;
  state: 'active' | 'completed' | 'failed';
  current_step_id: string | null;
  step_progress: Record<string, number>; // např. {"hastrman_killed": 1}
  started_at: string; // ISO timestamp
  completed_at?: string;
}

// Storage blob pro PLAYER_QUESTS collection. Key = userId.
// Drží aktivní + dokončené questy + per-player knowledge unlocks +
// per-village reputaci. Phase 11 minimální shape; extending in Phase 12+.
export interface PlayerQuestBlob {
  schema_version: number;
  active: Record<string, PlayerQuestProgress>;
  completed: Record<string, { quest_id: string; completed_at: string }>;
  knowledge: string[]; // unique knowledge_id list
  reputation: Record<string, number>; // village_id → value (default 100)
  // Phase 12: job board entries — sdílí blob (= jedna OCC retry zóna).
  // Optional pro backward compat s pre-Phase-12 blob, narrowing helper
  // doplní empty mapy.
  jobs: Record<string, PlayerJobBoardEntry>;
  jobs_completed: Record<string, CompletedJobEntry>;
}

export function asPlayerQuestBlob(value: unknown): PlayerQuestBlob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.schema_version !== 'number') return null;
  if (!v.active || typeof v.active !== 'object') return null;
  if (!v.completed || typeof v.completed !== 'object') return null;
  if (!Array.isArray(v.knowledge)) return null;
  if (!v.reputation || typeof v.reputation !== 'object') return null;
  // Phase 12 backward compat: doplň jobs / jobs_completed pro starší bloby.
  const jobs =
    v.jobs && typeof v.jobs === 'object' && !Array.isArray(v.jobs)
      ? (v.jobs as PlayerQuestBlob['jobs'])
      : {};
  const jobsCompleted =
    v.jobs_completed && typeof v.jobs_completed === 'object' && !Array.isArray(v.jobs_completed)
      ? (v.jobs_completed as PlayerQuestBlob['jobs_completed'])
      : {};
  return {
    schema_version: v.schema_version,
    active: v.active as PlayerQuestBlob['active'],
    completed: v.completed as PlayerQuestBlob['completed'],
    knowledge: v.knowledge as string[],
    reputation: v.reputation as Record<string, number>,
    jobs,
    jobs_completed: jobsCompleted,
  };
}

export function emptyQuestBlob(): PlayerQuestBlob {
  return {
    schema_version: 1,
    active: {},
    completed: {},
    knowledge: [],
    reputation: {},
    jobs: {},
    jobs_completed: {},
  };
}
