// World / system messages — viz docs/03-message-katalog.md sekce System & lifecycle.
// Wire format: JSON. Opcodes (ENTITY_SPAWNED=70, ENTITY_DESPAWNED=71) v opcodes.ts.

import type { Position } from '../types/world.js';

// Op.ENTITY_SPAWNED (70) — server → klient broadcast.
// Posíláno všem presencím v 3×3 chunkovém okolí spawn pointu (kromě self,
// joiner-only dostává WORLD_SNAPSHOT).
export interface EntitySpawned {
  entity_id: string; // userId pro player; mob/npc/drop ID pro ostatní typy
  type: 'player' | 'mob' | 'npc' | 'drop';
  position: Position;
  display_name?: string; // jen pro type='player' (HUD label)
  hp_pct?: number; // 0..1, jen pro entity s HP barem
  mob_id?: string; // jen pro type='mob' — klíč do mob definitions (pro sprite lookup)
  display_name_cs?: string; // jen pro type='mob' — lokalizovaný název
  level?: number; // jen pro type='mob' — pro HP bar label
  items?: Array<{ item_id: string; quantity: number }>; // jen pro type='drop'
  npc_id?: string; // jen pro type='npc' — klíč do NPC definitions
}

// Op.ENTITY_DESPAWNED (71) — server → klient broadcast.
// Hráč se odhlásil, mob umřel/leashnul mimo chunk, drop sebrán nebo expiroval.
export interface EntityDespawned {
  entity_id: string;
}

// rpc.world.find_or_create_match response — singleton match handshake (Phase 4a).
// Klient zavolá tento RPC po loginu, dostane matchId a pak udělá socket.joinMatch.
// Důvod: Nakama match je vytvářen na vyžádání (matchCreate), ne automaticky při
// startu serveru. matchList zjistí, jestli world.main už běží; pokud ne, vytvoří se.
export type FindOrCreateMatchResponse =
  | { ok: true; match_id: string }
  | { ok: false; error: string };
