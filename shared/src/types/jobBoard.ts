// Job board types — viz docs/02e-data-model-ekonomika.md sekce 5.
//
// Phase 12: shared pool s `max_concurrent_takers`, procedurálně generovaný
// z templatů, aging mechanika. Player drží `PlayerJobBoardEntry` per active
// task v PlayerQuestBlob (společný blob s questy = jedna OCC retry zóna).
//
// MVP scope:
//   - Objective types: `kill_mob` a `deliver_item` (escort/repair = parking lot)
//   - Single village (Blatiny)
//   - Žádný economic_state model — random výběr templatů s weight

import type { DialogText } from './npc.js';

// Discriminated objective. `count` znamená:
//   - kill_mob: kolik mobů zabít
//   - deliver_item: kolik kusů itemu odevzdat
export type JobBoardObjectiveDefinition =
  | { type: 'kill_mob'; target: string; count: number }
  | { type: 'deliver_item'; target: string; count: number };

export interface JobBoardReward {
  currency_denar: number;
  xp?: Record<string, number>;
  reputation?: Record<string, number>;
}

// Static template z `job_board_templates.json` — instance se generují za
// runtime kopírováním + UUID assigning.
export interface JobBoardTaskTemplate {
  template_id: string;
  village_id: string;
  issuer_npc_id: string;
  deliver_to_npc_id: string;
  title: DialogText;
  description: DialogText;
  objective: JobBoardObjectiveDefinition;
  reward: JobBoardReward;
  max_concurrent_takers: number;
  fulfilled_max: number;
  // Váha pro náhodný výběr při generaci. Default 1.
  weight: number;
}

// Runtime instance task v match state. Sdílená mezi všemi hráči ve vesnici.
// MVP: uloženo jen v match state — server restart = fresh pool.
export interface JobBoardTask {
  task_id: string;
  template_id: string;
  village_id: string;
  issuer_npc_id: string;
  deliver_to_npc_id: string;
  title: DialogText;
  description: DialogText;
  objective: JobBoardObjectiveDefinition;
  reward: JobBoardReward;
  max_concurrent_takers: number;
  current_takers: number;
  fulfilled_count: number;
  fulfilled_max: number;
  issued_at_tick: number;
  // Bumpne se z 1.0 na 1.5 / 2.0 / 3.0 podle stáří bez takers.
  priority_bonus_multiplier: number;
  // Seznam userId, kteří task aktuálně mají v `active` stavu.
  // Slouží pro current_takers + UI ("máš to vzaté").
  taker_user_ids: string[];
}

// Per-hráč entry pro jeden task ve stavu `active` nebo `completed`.
// Persistovaný v PlayerQuestBlob.jobs / jobs_completed.
export interface PlayerJobBoardEntry {
  task_id: string;
  template_id: string;
  village_id: string;
  taken_at_tick: number;
  // MVP: v active blobu nikdy 'completed'/'abandoned' — entry se přesouvá do
  // jobs_completed nebo se rovnou maže.
  state: 'active';
  progress: Record<string, number>; // např. { 'kill_mob:mob.giant_rat': 2 }
}

export interface CompletedJobEntry {
  task_id: string;
  template_id: string;
  completed_at: string; // ISO timestamp
}
