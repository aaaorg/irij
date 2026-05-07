// Job board match-data messages — viz docs/03-message-katalog.md sekce Job board.
// Wire format: JSON. Opcodes (62-69) v opcodes.ts.

import type {
  JobBoardObjectiveDefinition,
  JobBoardReward,
} from '../types/index.js';
import type { DialogText } from '../types/npc.js';

// ── Klient → server ─────────────────────────────────────────────────────────

// Op.JOB_BOARD_OPEN_REQUEST (66) — explicitní žádost klienta o otevření board
// view. V MVP ji posílá UI tlačítko "Hospodský board". Server odpoví
// JOB_BOARD_OPEN. Range checking: server neznámé volání ignoruje když hráč
// není v range issuer NPC. Alternativně dialog effect `open_job_board` sám
// otevře board (klient nemusí posílat tuto zprávu).
export interface JobBoardOpenRequest {
  village_id: string;
}

// Op.JOB_TASK_TAKEN (62) — klient → server. Hráč si bere existující task.
export interface JobTaskTakenRequest {
  task_id: string;
}

// Op.JOB_TASK_SUBMIT (68) — klient → server. Hráč chce dokončit / vyzvednout
// odměnu. Server validuje objective + (pro deliver_item) inventory + range
// k deliver_to_npc. Odpověď: JOB_TASK_COMPLETED nebo no-op.
export interface JobTaskSubmitRequest {
  task_id: string;
}

// Op.JOB_TASK_ABANDON (69) — klient → server. Vzdá se tasku, žádné odměny.
export interface JobTaskAbandonRequest {
  task_id: string;
}

// ── Server → klient ─────────────────────────────────────────────────────────

// View payload pro single task — obsahuje runtime stav (current_takers,
// priority bonus, fulfilled_count) + per-hráč state (taken_by_self, progress).
export interface JobBoardTaskView {
  task_id: string;
  template_id: string;
  village_id: string;
  type: 'kill_mob' | 'deliver_item';
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
  priority_bonus_multiplier: number;
  // Per-hráč: vzal jsem si task? Jaký je můj progress? Můžu submit?
  taken_by_self: boolean;
  self_progress?: Record<string, number>;
  self_submittable: boolean;
}

// Op.JOB_BOARD_OPEN (67) — server → klient unicast. Snapshot board pro daný
// village. Klient zobrazí panel.
export interface JobBoardOpen {
  village_id: string;
  issuer_npc_id: string; // NPC, kterého hráč oslovil — pro zobrazení v UI
  tasks: JobBoardTaskView[];
}

// Op.JOB_TASK_PROGRESS (63) — server → klient unicast. Posláno když se posune
// progress aktivního tasku (např. po kill mob), po úspěšném take, nebo v
// matchJoin pro snapshot aktivních jobs. Klient updatuje UI.
//
// Title/description/objective jsou optional pro backward compat, ale server
// je v Phase 12 vždy posílá — klient pak nemusí čekat na board open, aby
// věděl jak entry zobrazit ve QuestPanelu.
export interface JobTaskProgress {
  task_id: string;
  template_id: string;
  title?: DialogText;
  description?: DialogText;
  objective?: JobBoardObjectiveDefinition;
  progress: Record<string, number>;
  submittable: boolean;
  // Pokud je `event` nastaveno, klient může zvednout dedikovaný toast:
  //   'taken'    — server přijal take akci, zobrazit „Úkol přijat: <title>"
  //   'snapshot' — matchJoin re-sync, žádný toast
  //   'progress' — inkrement progress (např. kill_mob), default
  //   'abandoned'— server potvrdil abandon, klient odebere entry z UI
  //   'expired'  — task na boardu zmizel (refill expirace nebo fulfilled_max),
  //                klient odebere entry, zobrazí toast „Úkol vypršel"
  event?: 'taken' | 'snapshot' | 'progress' | 'abandoned' | 'expired';
}

// Op.JOB_TASK_COMPLETED (64) — server → klient unicast. Hráč úspěšně odevzdal,
// reward už vyplacený (přes XP_AWARDED + INVENTORY_CHANGED + reputation
// updaty). Klient přesune task do deníku.
export interface JobTaskCompleted {
  task_id: string;
  template_id: string;
  title: DialogText;
  reward: JobBoardReward;
}

// Op.JOB_BOARD_UPDATED (65) — server → klient broadcast (všem v match v MVP;
// post-MVP per-village). Notifikuje o změně board state — added (nový task),
// removed (expired / fulfilled_max), changed (current_takers / priority bonus).
// Klient používá pro reactive UI update pokud má panel otevřený.
export interface JobBoardUpdated {
  village_id: string;
  added: JobBoardTaskView[];
  removed: string[]; // task_ids
  changed: JobBoardTaskView[];
}

// Op.JOB_TASK_REJECTED (78) — server → klient unicast. Posláno když take/submit/
// abandon nebo open_request selhal. Klient zobrazí lokalizovaný toast podle
// reason. Žádný silent fail.
export type JobTaskRejectAction = 'take' | 'submit' | 'abandon' | 'open';
export type JobTaskRejectReason =
  | 'unknown_task'
  | 'task_full'
  | 'already_taken'
  | 'not_taken'
  | 'out_of_range'
  | 'inventory_short'
  | 'objective_not_met'
  | 'rate_limited'
  | 'no_issuer_in_range'
  | 'task_expired';

export interface JobTaskRejected {
  task_id?: string;
  action: JobTaskRejectAction;
  reason: JobTaskRejectReason;
  // Volitelný human-readable detail (např. počet itemů, které chybí).
  // Není to lokalizovaný text — to dělá klient. Detail je pro debug nebo
  // řetězení do české hlášky (např. „Chybí ti 3 ks pazourku").
  detail?: { item_id?: string; need?: number; have?: number };
}
