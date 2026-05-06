// Quest + quest object catalog — statická data z server/data/quests/*.json a
// quest_objects.json, načtená jednou při startu modulu.
//
// Phase 11: jediný quest "synovec_kovar". Až bude víc questů, přidáme další
// importy + extend QUEST_CATALOG. Žádný hot-reload (Nakama runtime restart
// načte nové).

import type { QuestDefinition, QuestObjectDefinition } from 'irij-shared/types';

import questSynovecKovar from '../../data/quests/synovec_kovar.json';
import questObjectsData from '../../data/quest_objects.json';

const QUEST_CATALOG: { [questId: string]: QuestDefinition } = {};
for (const def of [questSynovecKovar] as QuestDefinition[]) {
  QUEST_CATALOG[def.id] = def;
}

const QUEST_OBJECT_CATALOG: { [objectId: string]: QuestObjectDefinition } = {};
for (const def of questObjectsData as QuestObjectDefinition[]) {
  QUEST_OBJECT_CATALOG[def.id] = def;
}

export function getQuestDef(questId: string): QuestDefinition | null {
  return QUEST_CATALOG[questId] ?? null;
}

export function getAllQuests(): QuestDefinition[] {
  return Object.keys(QUEST_CATALOG).map((id) => QUEST_CATALOG[id]!);
}

export function getQuestObjectDef(objectId: string): QuestObjectDefinition | null {
  return QUEST_OBJECT_CATALOG[objectId] ?? null;
}

export function getAllQuestObjects(): QuestObjectDefinition[] {
  return Object.keys(QUEST_OBJECT_CATALOG).map((id) => QUEST_OBJECT_CATALOG[id]!);
}
