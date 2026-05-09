// NPC + Dialog types — viz docs/02d-data-model-npc-mobi-questy.md

import type { Position } from './world.js';

// Lokalizovaný text. MVP zobrazuje jen `cs`, `en` field je připravený pro Phase 17 i18n.
export interface DialogText {
  cs: string;
  en?: string;
}

export interface NpcFlags {
  talkable?: boolean;
  merchant?: boolean;
  banker?: boolean;
  quest_giver?: boolean;
  master?: boolean;
  crafter?: boolean;
  attackable?: boolean;
  pickpocketable?: boolean;
}

export interface NpcDefinition {
  id: string;
  name_cs: string;
  display_name_cs: string;
  appearance_id: string;
  default_position: Position;
  flags: NpcFlags;
  dialog_id: string | null;
  village_id?: string;
  // Placeholder fields pro budoucí fáze; zatím nepoužité v engine.
  merchant_table_id?: string | null;
  pickpocket_loot_table_id?: string | null;
  pickpocket_difficulty?: number;
}

// Effect, který option spouští při vybrání. Phase 9 implementuje give_item +
// deduct_currency; ostatní jsou stub (audit log only) — Phase 10/11+.
export type DialogEffect =
  | { type: 'give_item'; item_id: string; quantity: number }
  | { type: 'take_item'; item_id: string; quantity: number }
  | { type: 'add_currency'; amount: number }
  | { type: 'deduct_currency'; amount: number }
  | { type: 'unlock_knowledge'; knowledge_id: string }
  | { type: 'change_reputation'; village_id: string; delta: number }
  | { type: 'start_quest'; quest_id: string }
  | { type: 'complete_quest_step'; quest_id: string; step_id: string }
  | { type: 'open_job_board'; village_id: string }
  | { type: 'open_shop'; merchant_table_id: string };

// Visibility podmínka — všechny conditions musí být splněny aby se option zobrazila.
// Phase 11 implementuje knowledge / reputation_min / quest_state gates proti
// PlayerQuestBlob. Pre-Phase-11 implementace vracela vždy `false` pokud bylo
// `show_if` nastavené (skryla zamčené options); po Phase 11 vrací true/false
// podle skutečného player state.
export interface DialogOptionVisibility {
  // Vyžaduje knowledge_id v PlayerQuestBlob.knowledge.
  knowledge?: string;
  // Per-village reputation threshold. Klíč je `village_id`, hodnota je min hodnota.
  // Např. `{ village_id: 'village.blatiny', value: 300 }`.
  reputation_min?: { village_id: string; value: number };
  // Quest state gate. `state` enum mapping:
  //   'not_started' — quest není v active ani completed mapě
  //   'active'      — quest je v active mapě
  //   'completed'   — quest je v completed mapě
  // `current_step_id` (volitelné): pokud je nastaveno a `state === 'active'`,
  //  vyžaduje exact match na PlayerQuestProgress.current_step_id.
  // `not_current_step_id` (volitelné): naopak — viditelné jen pokud current
  //  step JE NĚCO JINÉHO. Slouží pro generic "in progress" options, které
  //  nesmí kolidovat s final step option v root menu.
  quest_state?: {
    quest_id: string;
    state: 'not_started' | 'active' | 'completed';
    current_step_id?: string;
    not_current_step_id?: string;
  };
}

export interface DialogOption {
  id: string; // stable identifier per node, používaný v DIALOG_CHOOSE
  text: DialogText;
  next: string | null; // next node id, nebo null pro dialog close (= effekt 'exit')
  effects?: DialogEffect[];
  show_if?: DialogOptionVisibility;
}

export interface DialogNode {
  speaker_npc_id?: string; // override default NPC speaker (např. quest giver odkazuje na jiný NPC)
  text: DialogText;
  options: DialogOption[];
}

export interface DialogTree {
  id: string;
  root_node_id: string;
  nodes: { [nodeId: string]: DialogNode };
}
