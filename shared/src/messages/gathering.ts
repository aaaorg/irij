// Phase 10: gathering + crafting messages — viz docs/03 sekce Interakce + Crafting.
// Wire format: JSON. Opcodes (GATHER_RESOURCE=32, GATHER_PROGRESS=33, GATHER_COMPLETED=34,
// CRAFT_REQUEST=80, CRAFT_PROGRESS=81, CRAFT_COMPLETED=82) v opcodes.ts.

import type { Rarity } from '../types/item.js';

// Op.GATHER_RESOURCE (32) — klient → server.
export interface GatherResourceRequest {
  resource_node_id: string;
}

// Op.GATHER_PROGRESS (33) — server → klient (unicast).
// Posílá se každých ~500 ms během gather animace.
export interface GatherProgress {
  node_id: string;
  progress_pct: number; // 0..1
  eta_ms: number;
}

// Op.GATHER_COMPLETED (34) — server → klient (unicast).
// Po dokončení; node se markne depleted, klient updatuje UI a inventář.
export interface GatherCompleted {
  node_id: string;
  success: boolean;
  reason?: 'completed' | 'cancelled' | 'too_far' | 'tool_missing' | 'level_too_low' | 'depleted' | 'inventory_full' | 'no_node';
  items_received?: Array<{ item_id: string; quantity: number }>;
}

// Op.CRAFT_REQUEST (80) — klient → server.
export interface CraftRequest {
  recipe_id: string;
  quantity: number; // 1..N (server cap napr. 50)
}

// Op.CRAFT_PROGRESS (81) — server → klient (unicast).
export interface CraftProgress {
  recipe_id: string;
  progress_pct: number; // current cycle 0..1
  eta_ms: number; // current cycle ETA
  remaining_cycles: number; // kolik cyklů zbývá v batch (včetně aktuálního)
}

// Op.CRAFT_COMPLETED (82) — server → klient (unicast).
// Posílá se po každém cyklu (úspěšném nebo neúspěšném). `batch_done` = true znamená,
// že server-side batch skončil (nepokračuje další cyklus).
export interface CraftCompleted {
  recipe_id: string;
  success: boolean;
  fail: boolean; // true = recept selhal (inputy ztraceny, output není)
  reason?: 'completed' | 'cancelled' | 'too_far' | 'inputs_missing' | 'tool_missing' | 'station_missing' | 'level_too_low' | 'inventory_full' | 'unknown_recipe';
  output?: { item_id: string; quantity: number; rarity: Rarity };
  remaining_cycles: number;
  batch_done: boolean;
}
