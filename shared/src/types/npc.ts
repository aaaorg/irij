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
  | { type: 'complete_quest_step'; quest_id: string; step_id: string };

// Visibility podmínka — všechny musí být splněny aby se option zobrazila.
// MVP supportuje jen `always_available` flag. Knowledge/quest/reputation gates
// jsou data-shape definované, ale enforce-uje se vždy true (Phase 11+ doplní).
export interface DialogOptionVisibility {
  knowledge?: string; // unlock id required (Phase 11+)
  reputation_min?: number; // village reputation threshold (Phase 11+)
  quest_state?: { quest_id: string; state: 'not_started' | 'active' | 'completed' };
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
