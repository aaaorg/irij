// Dialog match-data messages — viz docs/03-message-katalog.md sekce Dialog.
// Wire format: JSON. Opcodes (INTERACT_NPC=30, DIALOG_OPEN=110, DIALOG_CHOOSE=111, DIALOG_CLOSE=112) v opcodes.ts.

import type { DialogText } from '../types/npc.js';

// Op.INTERACT_NPC (30) — klient → server.
// Hráč klikl na NPC. Server validuje dosah + NPC flag a (pro action='talk')
// odpoví DIALOG_OPEN. Action 'shop'/'bank'/'worker'/'pickpocket' jsou stub —
// Phase 9 implementuje jen 'talk'.
export interface InteractNpcRequest {
  npc_id: string;
  action: 'talk' | 'shop' | 'bank' | 'worker' | 'pickpocket';
}

// Server → klient — popisuje JEDNU option (filterovanou serverem podle
// knowledge/quest/reputation). `available` flag dovoluje server zobrazit
// "zamčené" volby (greyed out) místo úplného skrytí — MVP vždy true.
export interface DialogOptionPayload {
  id: string;
  text: DialogText;
  available: boolean;
}

// Op.DIALOG_OPEN (110) — server → klient (unicast).
// Posílá aktuální node hráči. Stejný opcode použitý pro initial open i pro
// transition na další node po DIALOG_CHOOSE.
export interface DialogOpen {
  dialog_id: string;
  node_id: string;
  npc_id: string; // NPC, se kterým hráč mluví (i kdyby speaker byl jiný)
  speaker_npc_id: string; // může se lišit od npc_id (např. flashback dialog)
  speaker_display_name_cs: string; // resolved display name pro UI label
  text: DialogText;
  options: DialogOptionPayload[];
}

// Op.DIALOG_CHOOSE (111) — klient → server.
// Hráč zvolil option. Server validuje session + available + aplikuje effects.
// Odpovídá: další DIALOG_OPEN nebo DIALOG_CLOSE.
export interface DialogChooseRequest {
  dialog_id: string;
  node_id: string;
  option_id: string;
}

// Op.DIALOG_CLOSE (112) — bidirectional.
// Klient → server: hráč zavřel UI (Esc / "Sbohem" option vede sem).
// Server → klient: dialog skončil (poslední node, error, NPC mimo dosah).
// `reason` na server-iniciovaném zavření vysvětluje proč; klient může zobrazit
// toast (typicky jen logguje).
export interface DialogClose {
  dialog_id?: string;
  reason?: 'completed' | 'cancelled' | 'out_of_range' | 'invalid_option' | 'no_session';
}
