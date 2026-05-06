// Phase 11: quest engine — state machine, prerequisites, objective progression,
// completion, reward distribution. Volá se z dialog effects (start_quest /
// complete_quest_step), combat handler (kill_mob), inventory handler
// (interact_with_object). Persistence přes Nakama Storage Engine collection
// PLAYER_QUESTS, mirror v match state per-player blob.

import { REPUTATION_DEFAULT, STORAGE_COLLECTIONS } from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type {
  InventoryChanged,
  QuestCompleted,
  QuestProgress,
} from 'irij-shared/messages';
import {
  asPlayerInventory,
  asPlayerQuestBlob,
  emptyQuestBlob,
} from 'irij-shared/types';
import type {
  PlayerInventoryBlob,
  PlayerQuestBlob,
  PlayerQuestProgress,
  QuestDefinition,
  QuestObjectiveDefinition,
  QuestRewardDefinition,
  QuestStepDefinition,
} from 'irij-shared/types';

import { logAudit } from '../lib/audit.js';
import { getItemDef } from '../lib/items.js';
import { log } from '../lib/log.js';
import { getQuestDef } from '../lib/quests.js';
import { withOCCRetry } from '../lib/storage.js';
import type { WorldMatchState } from './state.js';
import { awardXp } from './xp.js';

const PERMISSION_OWNER_READ = 1 as nkruntime.ReadPermissionValues;
const PERMISSION_NO_WRITE = 0 as nkruntime.WritePermissionValues;

// ── Blob helpers ─────────────────────────────────────────────────────────────

// Vrátí blob z mirroru (loaded v matchJoin); pokud chybí, vrátí prázdný blob
// (= hráč ještě neměl žádnou quest aktivitu). Volajíci by měl persist po mutaci.
export function getQuestBlob(state: WorldMatchState, userId: string): PlayerQuestBlob {
  const blob = state.playerQuestBlobs[userId];
  if (blob) return blob;
  return emptyQuestBlob();
}

// Načte PLAYER_QUESTS blob pro hráče (lazy create při prvním pokusu o čtení).
// Volá se v matchJoin pro každého joining presence — výsledek se uloží do
// state.playerQuestBlobs.
export function loadPlayerQuestBlob(
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  userId: string,
): { blob: PlayerQuestBlob; version: string } {
  try {
    const reads = nk.storageRead([
      { collection: STORAGE_COLLECTIONS.PLAYER_QUESTS, key: userId, userId },
    ]);
    const obj = reads.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER_QUESTS);
    if (obj) {
      const blob = asPlayerQuestBlob(obj.value);
      if (blob) return { blob, version: obj.version ?? '' };
      log(logger, 'warn', 'PLAYER_QUESTS blob narrowing failed, resetting', {
        userId: userId.slice(0, 8),
      });
    }
  } catch (err) {
    log(logger, 'warn', 'loadPlayerQuestBlob failed', {
      userId: userId.slice(0, 8),
      err: String(err),
    });
  }

  // Lazy create — write empty blob and return.
  const fresh = emptyQuestBlob();
  try {
    const acks = nk.storageWrite([
      {
        collection: STORAGE_COLLECTIONS.PLAYER_QUESTS,
        key: userId,
        userId,
        value: fresh,
        permissionRead: PERMISSION_OWNER_READ,
        permissionWrite: PERMISSION_NO_WRITE,
      },
    ]);
    return { blob: fresh, version: acks[0]?.version ?? '' };
  } catch (err) {
    log(logger, 'error', 'loadPlayerQuestBlob: lazy create failed', {
      userId: userId.slice(0, 8),
      err: String(err),
    });
    return { blob: fresh, version: '' };
  }
}

// Persist blob via OCC. Aktualizuje cache verze v state. Pokud OCC selže
// po retries, log error — kaller pokračuje s in-memory mirror (write-through
// se může opravit při dalším pokusu nebo na matchLeave finalflushi).
function persistQuestBlob(
  state: WorldMatchState,
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  userId: string,
  next: PlayerQuestBlob,
): void {
  try {
    const result = withOCCRetry<PlayerQuestBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_QUESTS,
      userId,
      userId,
      () => next,
    );
    state.playerQuestBlobs = { ...state.playerQuestBlobs, [userId]: next };
    state.playerQuestVersions = { ...state.playerQuestVersions, [userId]: result.version };
  } catch (err) {
    log(logger, 'error', 'persistQuestBlob failed', {
      userId: userId.slice(0, 8),
      err: String(err),
    });
    // Mirror update i přes selhání write — další volání retryne.
    state.playerQuestBlobs = { ...state.playerQuestBlobs, [userId]: next };
  }
}

// ── Show_if visibility — Phase 11 implementace gate-checků ──────────────────

// Použito v dialog.ts isOptionVisible(). Vrací true pokud option vyhovuje
// všem `show_if` podmínkám relativně k blob hráče. Pokud `show_if` chybí,
// option je vždy viditelná (callsite to handlí dřív).
export function checkOptionVisibility(
  blob: PlayerQuestBlob,
  showIf: NonNullable<{
    knowledge?: string;
    reputation_min?: { village_id: string; value: number };
    quest_state?: {
      quest_id: string;
      state: 'not_started' | 'active' | 'completed';
      current_step_id?: string;
      not_current_step_id?: string;
    };
  }>,
): boolean {
  if (showIf.knowledge && !blob.knowledge.includes(showIf.knowledge)) {
    return false;
  }
  if (showIf.reputation_min) {
    const rep = blob.reputation[showIf.reputation_min.village_id] ?? REPUTATION_DEFAULT;
    if (rep < showIf.reputation_min.value) return false;
  }
  if (showIf.quest_state) {
    const q = showIf.quest_state;
    const isActive = !!blob.active[q.quest_id];
    const isCompleted = !!blob.completed[q.quest_id];
    if (q.state === 'not_started' && (isActive || isCompleted)) return false;
    if (q.state === 'active' && !isActive) return false;
    if (q.state === 'completed' && !isCompleted) return false;
    if (q.state === 'active' && (q.current_step_id || q.not_current_step_id)) {
      const progress = blob.active[q.quest_id];
      const cur = progress?.current_step_id ?? null;
      if (q.current_step_id && cur !== q.current_step_id) return false;
      if (q.not_current_step_id && cur === q.not_current_step_id) return false;
    }
  }
  return true;
}

// ── Prerequisites + start ───────────────────────────────────────────────────

export type QuestStartResult =
  | { ok: true; def: QuestDefinition; progress: PlayerQuestProgress }
  | {
      ok: false;
      reason:
        | 'unknown_quest'
        | 'already_active'
        | 'already_completed'
        | 'prereq_knowledge'
        | 'prereq_completed_quests'
        | 'prereq_reputation';
    };

export function tryStartQuest(
  state: WorldMatchState,
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  userId: string,
  questId: string,
): QuestStartResult {
  const def = getQuestDef(questId);
  if (!def) return { ok: false, reason: 'unknown_quest' };

  const blob = getQuestBlob(state, userId);
  if (blob.active[questId]) return { ok: false, reason: 'already_active' };
  if (blob.completed[questId] && def.lockout_after_complete) {
    return { ok: false, reason: 'already_completed' };
  }

  const prereq = def.prerequisites;
  if (prereq.knowledge?.length) {
    for (const k of prereq.knowledge) {
      if (!blob.knowledge.includes(k)) return { ok: false, reason: 'prereq_knowledge' };
    }
  }
  if (prereq.completed_quests?.length) {
    for (const q of prereq.completed_quests) {
      if (!blob.completed[q]) return { ok: false, reason: 'prereq_completed_quests' };
    }
  }
  if (prereq.min_reputation) {
    for (const villageId of Object.keys(prereq.min_reputation)) {
      const required = prereq.min_reputation[villageId] ?? 0;
      const have = blob.reputation[villageId] ?? REPUTATION_DEFAULT;
      if (have < required) return { ok: false, reason: 'prereq_reputation' };
    }
  }

  const firstStep = def.steps[0];
  if (!firstStep) return { ok: false, reason: 'unknown_quest' };

  const progress: PlayerQuestProgress = {
    quest_id: questId,
    state: 'active',
    current_step_id: firstStep.id,
    step_progress: {},
    started_at: new Date().toISOString(),
  };

  const next: PlayerQuestBlob = {
    ...blob,
    active: { ...blob.active, [questId]: progress },
  };
  persistQuestBlob(state, nk, logger, userId, next);

  logAudit(nk, 'quest_started', { userId, payload: { quest_id: questId } });
  log(logger, 'info', 'quest started', { userId: userId.slice(0, 8), questId });

  return { ok: true, def, progress };
}

// ── Objective progression ───────────────────────────────────────────────────

// Generic dispatcher pro objective events. Iteruje aktivní questy hráče,
// najde quest, jehož current_step_id má objective matching (type + target),
// a aplikuje progress delta. Po splnění advance na next step nebo complete.
export function progressObjective(
  state: WorldMatchState,
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  event:
    | { type: 'kill_mob'; mob_id: string }
    | { type: 'interact_with_object'; object_id: string }
    | { type: 'talk_to_npc'; npc_id: string; dialog_node?: string; quest_id?: string; step_id?: string },
): void {
  const userId = presence.userId;
  const blob = getQuestBlob(state, userId);
  if (Object.keys(blob.active).length === 0) return;

  for (const questId of Object.keys(blob.active)) {
    const progress = blob.active[questId];
    if (!progress || !progress.current_step_id) continue;
    const def = getQuestDef(questId);
    if (!def) continue;
    const step = def.steps.find((s) => s.id === progress.current_step_id);
    if (!step) continue;

    if (event.type === 'talk_to_npc' && (event.quest_id || event.step_id)) {
      // Explicit complete_quest_step from dialog effect — match by quest+step.
      if (event.quest_id !== questId || event.step_id !== step.id) continue;
      // Still validate the objective is talk_to_npc to the right NPC.
      if (
        step.objective.type === 'talk_to_npc' &&
        step.objective.target !== event.npc_id
      ) {
        continue;
      }
      advanceStep(state, nk, logger, dispatcher, presence, def, progress, step);
      return;
    }

    if (!objectiveMatches(step.objective, event)) continue;

    // Apply progress delta.
    const newProgress = { ...progress.step_progress };
    if (event.type === 'kill_mob') {
      const key = `${step.objective.type}:${step.objective.target}`;
      const have = (newProgress[key] ?? 0) + 1;
      newProgress[key] = have;
      const required = step.objective.type === 'kill_mob' ? step.objective.count : 1;
      const updated: PlayerQuestProgress = {
        ...progress,
        step_progress: newProgress,
      };
      const nextBlob: PlayerQuestBlob = {
        ...blob,
        active: { ...blob.active, [questId]: updated },
      };
      persistQuestBlob(state, nk, logger, userId, nextBlob);

      if (have >= required) {
        advanceStep(state, nk, logger, dispatcher, presence, def, updated, step);
      } else {
        sendQuestProgress(dispatcher, presence, def, updated, step, 'advanced');
      }
      return;
    }

    if (event.type === 'interact_with_object') {
      // Single-shot objective.
      advanceStep(state, nk, logger, dispatcher, presence, def, progress, step);
      return;
    }
  }
}

function objectiveMatches(
  objective: QuestObjectiveDefinition,
  event:
    | { type: 'kill_mob'; mob_id: string }
    | { type: 'interact_with_object'; object_id: string }
    | { type: 'talk_to_npc'; npc_id: string; dialog_node?: string },
): boolean {
  if (objective.type !== event.type) return false;
  if (objective.type === 'kill_mob' && event.type === 'kill_mob') {
    return objective.target === event.mob_id;
  }
  if (objective.type === 'interact_with_object' && event.type === 'interact_with_object') {
    return objective.target === event.object_id;
  }
  if (objective.type === 'talk_to_npc' && event.type === 'talk_to_npc') {
    return objective.target === event.npc_id;
  }
  return false;
}

function advanceStep(
  state: WorldMatchState,
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  def: QuestDefinition,
  progress: PlayerQuestProgress,
  completedStep: QuestStepDefinition,
): void {
  const userId = presence.userId;
  const stepIdx = def.steps.findIndex((s) => s.id === completedStep.id);
  const isFinal = stepIdx === def.steps.length - 1;

  if (isFinal) {
    completeQuest(state, nk, logger, dispatcher, presence, def, progress);
    return;
  }

  const nextStep = def.steps[stepIdx + 1];
  if (!nextStep) {
    completeQuest(state, nk, logger, dispatcher, presence, def, progress);
    return;
  }

  const updated: PlayerQuestProgress = {
    ...progress,
    current_step_id: nextStep.id,
    step_progress: {},
  };
  const blob = getQuestBlob(state, userId);
  const nextBlob: PlayerQuestBlob = {
    ...blob,
    active: { ...blob.active, [def.id]: updated },
  };
  persistQuestBlob(state, nk, logger, userId, nextBlob);

  log(logger, 'info', 'quest step advanced', {
    userId: userId.slice(0, 8),
    questId: def.id,
    from: completedStep.id,
    to: nextStep.id,
  });

  sendQuestProgress(dispatcher, presence, def, updated, nextStep, 'advanced');
}

// ── Completion + rewards ────────────────────────────────────────────────────

function completeQuest(
  state: WorldMatchState,
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  def: QuestDefinition,
  progress: PlayerQuestProgress,
): void {
  const userId = presence.userId;
  const completedAt = new Date().toISOString();

  // Apply non-XP rewards into blob (knowledge, reputation). Items + currency
  // jdou do PLAYER_INVENTORY blobu (separate OCC). XP přes existující awardXp.
  const blob = getQuestBlob(state, userId);
  const nextActive = { ...blob.active };
  delete nextActive[def.id];
  const nextCompleted = {
    ...blob.completed,
    [def.id]: { quest_id: def.id, completed_at: completedAt },
  };
  const nextKnowledge = [...blob.knowledge];
  for (const k of def.rewards.knowledge ?? []) {
    if (!nextKnowledge.includes(k)) nextKnowledge.push(k);
  }
  const nextReputation = { ...blob.reputation };
  for (const villageId of Object.keys(def.rewards.reputation ?? {})) {
    const delta = def.rewards.reputation?.[villageId] ?? 0;
    const cur = nextReputation[villageId] ?? REPUTATION_DEFAULT;
    nextReputation[villageId] = Math.min(1000, Math.max(-99999, cur + delta));
  }

  void progress; // pro audit; samotný progress objekt nepoužíváme dál

  const nextBlob: PlayerQuestBlob = {
    ...blob,
    active: nextActive,
    completed: nextCompleted,
    knowledge: nextKnowledge,
    reputation: nextReputation,
  };
  persistQuestBlob(state, nk, logger, userId, nextBlob);

  // Items + denáry → inventory.
  applyItemAndCurrencyRewards(nk, logger, dispatcher, presence, def.rewards);

  // XP přes existující awardXp (write-through na PLAYER_SKILLS, broadcast XP_AWARDED + LEVEL_UP).
  if (def.rewards.xp && Object.keys(def.rewards.xp).length > 0) {
    awardXp(state, logger, nk, dispatcher, userId, def.rewards.xp, 'quest', def.id);
  }

  // Broadcast QUEST_COMPLETED.
  const payload: QuestCompleted = {
    quest_id: def.id,
    title: def.title,
    rewards: {
      xp: def.rewards.xp,
      items: def.rewards.items,
      currency_denar: def.rewards.currency_denar,
      knowledge: def.rewards.knowledge,
      reputation: def.rewards.reputation,
    },
  };
  dispatcher.broadcastMessage(Op.QUEST_COMPLETED, JSON.stringify(payload), [presence]);

  logAudit(nk, 'quest_completed', {
    userId,
    payload: { quest_id: def.id, completed_at: completedAt },
  });
  log(logger, 'info', 'quest completed', {
    userId: userId.slice(0, 8),
    questId: def.id,
  });
}

function applyItemAndCurrencyRewards(
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rewards: QuestRewardDefinition,
): void {
  const userId = presence.userId;
  const items = [...(rewards.items ?? [])];
  if (rewards.currency_denar && rewards.currency_denar > 0) {
    items.push({ item_id: 'currency.denar', quantity: rewards.currency_denar });
  }
  if (items.length === 0) return;

  let changes: InventoryChanged['changes'] = [];
  try {
    withOCCRetry<PlayerInventoryBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      userId,
      userId,
      (current) => {
        const blob = asPlayerInventory(current) ?? (current as PlayerInventoryBlob);
        const before = blob.inventory.map((s) => ({ ...s }));
        const inventory = blob.inventory.map((s) => ({ ...s }));

        for (const reward of items) {
          let remaining = reward.quantity;
          const def = getItemDef(reward.item_id);
          if (def?.stackable) {
            for (const slot of inventory) {
              if (remaining <= 0) break;
              if (slot.item_id !== reward.item_id) continue;
              const space = (def.max_stack ?? 1) - slot.quantity;
              if (space <= 0) continue;
              const take = Math.min(space, remaining);
              slot.quantity += take;
              remaining -= take;
            }
          }
          if (remaining > 0) {
            for (const slot of inventory) {
              if (remaining <= 0) break;
              if (slot.item_id !== null) continue;
              const max = def?.stackable ? (def.max_stack ?? 1) : 1;
              const take = Math.min(max, remaining);
              slot.item_id = reward.item_id;
              slot.quantity = take;
              remaining -= take;
            }
          }
          if (remaining > 0) {
            log(logger, 'warn', 'quest reward inventory full, dropping remainder', {
              itemId: reward.item_id,
              dropped: remaining,
            });
          }
        }

        // Build delta changes.
        for (let i = 0; i < inventory.length; i++) {
          const a = inventory[i];
          const b = before[i];
          if (!a || !b) continue;
          if (a.item_id !== b.item_id || a.quantity !== b.quantity) {
            changes.push({ slot_index: i, item_id: a.item_id, quantity: a.quantity });
          }
        }
        return { ...blob, inventory };
      },
    );
  } catch (err) {
    log(logger, 'error', 'quest reward OCC failed', {
      userId: userId.slice(0, 8),
      err: String(err),
    });
    return;
  }

  if (changes.length > 0) {
    const msg: InventoryChanged = { changes };
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify(msg), [presence]);
  }
}

// ── Knowledge + reputation effects (volané z dialog effects) ────────────────

export function unlockKnowledge(
  state: WorldMatchState,
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  userId: string,
  knowledgeId: string,
): boolean {
  const blob = getQuestBlob(state, userId);
  if (blob.knowledge.includes(knowledgeId)) return false;
  const next: PlayerQuestBlob = {
    ...blob,
    knowledge: [...blob.knowledge, knowledgeId],
  };
  persistQuestBlob(state, nk, logger, userId, next);
  logAudit(nk, 'knowledge_unlocked', { userId, payload: { knowledge_id: knowledgeId } });
  return true;
}

export function changeReputation(
  state: WorldMatchState,
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  userId: string,
  villageId: string,
  delta: number,
): number {
  const blob = getQuestBlob(state, userId);
  const cur = blob.reputation[villageId] ?? REPUTATION_DEFAULT;
  const newValue = Math.min(1000, Math.max(-99999, cur + delta));
  const next: PlayerQuestBlob = {
    ...blob,
    reputation: { ...blob.reputation, [villageId]: newValue },
  };
  persistQuestBlob(state, nk, logger, userId, next);
  logAudit(nk, 'reputation_changed', {
    userId,
    payload: { village_id: villageId, delta, new_value: newValue },
  });
  return newValue;
}

// ── Send helpers ────────────────────────────────────────────────────────────

export function sendQuestProgress(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  def: QuestDefinition,
  progress: PlayerQuestProgress,
  step: QuestStepDefinition | null,
  event: 'started' | 'advanced',
): void {
  const payload: QuestProgress = {
    event,
    quest_id: def.id,
    title: def.title,
    description: def.description,
    current_step_id: progress.current_step_id,
    step,
    step_progress: progress.step_progress,
  };
  dispatcher.broadcastMessage(Op.QUEST_PROGRESS, JSON.stringify(payload), [presence]);
}

// Pošle všechny aktivní questy + (s lokalizovanými titles) v rámci join flow,
// aby klient měl initial state pro UI quest log. Volá se v matchJoin po
// loadPlayerQuestBlob.
export function sendActiveQuestsSnapshot(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  blob: PlayerQuestBlob,
): void {
  for (const questId of Object.keys(blob.active)) {
    const progress = blob.active[questId];
    if (!progress) continue;
    const def = getQuestDef(questId);
    if (!def) continue;
    const step = def.steps.find((s) => s.id === progress.current_step_id) ?? null;
    sendQuestProgress(dispatcher, presence, def, progress, step, 'advanced');
  }
}
