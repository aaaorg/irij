// Dialog catalog — statická data z dialogs/*.json + npcs.json, načtená jednou
// při startu modulu. Všechno v paměti, žádné DB lookupy v hot path.

import type { DialogTree, NpcDefinition } from 'irij-shared/types';

import npcsData from '../../data/npcs.json';
import dialogKovar from '../../data/dialogs/kovar_blatiny.json';
import dialogSelka from '../../data/dialogs/selka.json';

const NPC_CATALOG: { [npcId: string]: NpcDefinition } = {};
for (const npc of npcsData as NpcDefinition[]) {
  NPC_CATALOG[npc.id] = npc;
}

const DIALOG_CATALOG: { [dialogId: string]: DialogTree } = {};
for (const tree of [dialogKovar, dialogSelka] as DialogTree[]) {
  DIALOG_CATALOG[tree.id] = tree;
}

export function getNpcDef(npcId: string): NpcDefinition | null {
  return NPC_CATALOG[npcId] ?? null;
}

export function getDialogTree(dialogId: string): DialogTree | null {
  return DIALOG_CATALOG[dialogId] ?? null;
}

export function getAllNpcs(): NpcDefinition[] {
  return Object.keys(NPC_CATALOG).map((id) => NPC_CATALOG[id]!);
}
