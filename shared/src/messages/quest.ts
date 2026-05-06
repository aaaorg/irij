// Quest match-data messages — viz docs/03-message-katalog.md sekce Quest.
// Wire format: JSON. Opcodes (QUEST_PROGRESS=60, QUEST_COMPLETED=61) v opcodes.ts.

import type { DialogText, QuestObjectiveDefinition, QuestStepDefinition } from '../types/index.js';

// Op.QUEST_PROGRESS (60) — server → klient unicast.
// Posíláno při startu questu (fresh state) i při každém objective progress
// updatu. `event` rozlišuje "started" (klient může animovat scroll/sound)
// od "advanced" (jen update progress baru). Klient používá payload jako
// canonical state pro ten quest — žádný delta merge.
export interface QuestProgress {
  event: 'started' | 'advanced';
  quest_id: string;
  title: DialogText;
  description: DialogText;
  current_step_id: string | null;
  step: QuestStepDefinition | null; // aktuální krok (definice + objective)
  step_progress: Record<string, number>;
}

// Op.QUEST_COMPLETED (61) — server → klient unicast.
// Posíláno po dokončení posledního kroku. Klient přesune quest z aktivních
// do deníku, zobrazí celebration + reward summary.
export interface QuestCompleted {
  quest_id: string;
  title: DialogText;
  rewards: {
    xp?: Record<string, number>;
    items?: Array<{ item_id: string; quantity: number }>;
    currency_denar?: number;
    knowledge?: string[];
    reputation?: Record<string, number>;
  };
}
