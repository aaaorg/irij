// Quest types — viz docs/02d-data-model-npc-mobi-questy.md sekce 4 Questy.
//
// Phase 11: implementuje state machine, prerequisites, lineární kroky, rewards.
// Branching, fail states, repeatables jsou parking lot (post-MVP).

import type { Position } from './world.js';
import type { DialogText } from './npc.js';

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
}

export function asPlayerQuestBlob(value: unknown): PlayerQuestBlob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.schema_version !== 'number') return null;
  if (!v.active || typeof v.active !== 'object') return null;
  if (!v.completed || typeof v.completed !== 'object') return null;
  if (!Array.isArray(v.knowledge)) return null;
  if (!v.reputation || typeof v.reputation !== 'object') return null;
  return value as PlayerQuestBlob;
}

export function emptyQuestBlob(): PlayerQuestBlob {
  return {
    schema_version: 1,
    active: {},
    completed: {},
    knowledge: [],
    reputation: {},
  };
}
