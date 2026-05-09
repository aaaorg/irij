// Phase 13: merchant table catalog — statická data z merchant_tables.json,
// načtená jednou při startu modulu. Goja-safe: žádné Map/Set.

import type { MerchantTableDefinition } from 'irij-shared/types';
import rawMerchantData from '../../data/merchant_tables.json';

const CATALOG: { [tableId: string]: MerchantTableDefinition } = {};
const BY_NPC: { [npcId: string]: string } = {};

for (const def of rawMerchantData as MerchantTableDefinition[]) {
  CATALOG[def.id] = def;
  BY_NPC[def.owner_npc_id] = def.id;
}

export function getMerchantTableDef(tableId: string): MerchantTableDefinition | null {
  return CATALOG[tableId] ?? null;
}

export function getMerchantTableForNpc(npcId: string): MerchantTableDefinition | null {
  const id = BY_NPC[npcId];
  if (!id) return null;
  return CATALOG[id] ?? null;
}

export function getAllMerchantTables(): MerchantTableDefinition[] {
  return Object.keys(CATALOG)
    .map((k) => CATALOG[k])
    .filter((v): v is MerchantTableDefinition => !!v);
}
