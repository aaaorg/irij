// Phase 9: NPC interaction + dialog engine.
// Handlery jsou volány z matchLoop pro opcodes 30 (INTERACT_NPC), 111 (DIALOG_CHOOSE),
// 112 (DIALOG_CLOSE).
//
// Server-authoritative dialog state. Klient nezná dialog tree — server posílá
// vždy jen aktuální node + filtrovaný seznam options. Per-player session
// chrání proti DIALOG_CHOOSE bez předchozího INTERACT_NPC.

import { STORAGE_COLLECTIONS } from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type {
  DialogChooseRequest,
  DialogClose,
  DialogOpen,
  DialogOptionPayload,
  InteractNpcRequest,
  InventoryChanged,
} from 'irij-shared/messages';
import { asPlayerInventory } from 'irij-shared/types';
import type {
  DialogEffect,
  DialogNode,
  DialogOption,
  DialogTree,
  PlayerInventoryBlob,
} from 'irij-shared/types';
import { obj, oneOf, parse, str } from 'irij-shared';

import { logAudit } from '../lib/audit.js';
import { getDialogTree, getNpcDef } from '../lib/dialogs.js';
import { getItemDef } from '../lib/items.js';
import { log } from '../lib/log.js';
import { withOCCRetry } from '../lib/storage.js';
import { sendJobBoardOpen } from './jobBoard.js';
import { sendShopOpen } from './shop.js';
import { checkRateLimit, RATE_LIMIT_WINDOW_MS } from './movement.js';
import {
  changeReputation,
  checkOptionVisibility,
  getQuestBlob,
  progressObjective,
  sendQuestProgress,
  tryStartQuest,
  unlockKnowledge,
} from './quest.js';
import { getQuestDef } from '../lib/quests.js';
import type {
  DialogSessionState,
  NpcInstanceState,
  PlayerPresenceState,
  WorldMatchState,
} from './state.js';

// Rate limit per docs/03 sekce Rate limiting: INTERACT_NPC max 5/s.
const INTERACT_NPC_RATE_LIMIT_MAX = 5;
// DIALOG_CHOOSE: liberální 10/s — odpovídá rychlému clickování po tree.
const DIALOG_CHOOSE_RATE_LIMIT_MAX = 10;

const NPC_INTERACT_RANGE_TILES = 2;

// ── Schema validators ────────────────────────────────────────────────────────

const InteractNpcSchema = obj({
  npc_id: str().min(1).max(64),
  action: oneOf<'talk' | 'shop' | 'bank' | 'worker' | 'pickpocket'>(
    'talk',
    'shop',
    'bank',
    'worker',
    'pickpocket',
  ),
});

const DialogChooseSchema = obj({
  dialog_id: str().min(1).max(64),
  node_id: str().min(1).max(64),
  option_id: str().min(1).max(64),
});

export function parseInteractNpcRequest(raw: unknown): InteractNpcRequest | null {
  const r = parse(InteractNpcSchema, raw);
  if (!r.ok) return null;
  return r.value as InteractNpcRequest;
}

export function parseDialogChooseRequest(raw: unknown): DialogChooseRequest | null {
  const r = parse(DialogChooseSchema, raw);
  if (!r.ok) return null;
  return r.value as DialogChooseRequest;
}

// ── Distance helpers ────────────────────────────────────────────────────────

function chebyshevDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ── Option visibility filter ────────────────────────────────────────────────
// Phase 11: knowledge / quest_state / reputation gates jsou plně implementované
// proti PlayerQuestBlob (mirror v match state). Pokud option nemá `show_if`,
// je vždy viditelná. Pre-Phase-11 implementace vracela vždy `false` pokud
// `show_if` bylo nastavené (silná hide); Phase 11 evaluuje skutečný stav.

export function isOptionVisible(
  option: DialogOption,
  state: WorldMatchState,
  userId: string,
): boolean {
  if (!option.show_if) return true;
  const blob = getQuestBlob(state, userId);
  return checkOptionVisibility(blob, option.show_if);
}

function buildOptionPayloads(
  node: DialogNode,
  state: WorldMatchState,
  userId: string,
): DialogOptionPayload[] {
  const out: DialogOptionPayload[] = [];
  for (const option of node.options) {
    if (!isOptionVisible(option, state, userId)) continue;
    out.push({
      id: option.id,
      text: option.text,
      available: true,
    });
  }
  return out;
}

// ── INTERACT_NPC (Op 30) ────────────────────────────────────────────────────

export function handleInteractNpc(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  tick: number,
): void {
  const userId = presence.userId;
  const ps = state.presencesByUserId[userId];
  if (!ps) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }

  const req = parseInteractNpcRequest(parsed);
  if (!req) return;

  // Rate limit.
  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, INTERACT_NPC_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) return;

  // Find NPC instance — npc_id zde je instanceId (server side ID).
  const npc = state.npcInstances[req.npc_id];
  if (!npc) {
    log(logger, 'debug', 'INTERACT_NPC: instance not found', {
      userId: userId.slice(0, 8),
      npcId: req.npc_id,
    });
    return;
  }

  const def = state.npcDefinitions[npc.npcId];
  if (!def) return;

  // Range check (Chebyshev ≤ 2).
  if (chebyshevDistance(ps.position, npc.position) > NPC_INTERACT_RANGE_TILES) {
    log(logger, 'debug', 'INTERACT_NPC: too far', {
      userId: userId.slice(0, 8),
      dist: chebyshevDistance(ps.position, npc.position),
    });
    return;
  }

  if (req.action !== 'talk') {
    // Phase 13/14 implement shop/bank. MVP only talk.
    log(logger, 'debug', 'INTERACT_NPC: action not implemented', {
      action: req.action,
    });
    return;
  }

  // Validate flag.
  if (!def.flags.talkable) {
    log(logger, 'debug', 'INTERACT_NPC: not talkable', { npcId: def.id });
    return;
  }

  if (!def.dialog_id) return;
  const tree = getDialogTree(def.dialog_id);
  if (!tree) {
    log(logger, 'warn', 'INTERACT_NPC: dialog tree missing', {
      npcId: def.id,
      dialogId: def.dialog_id,
    });
    return;
  }

  // Open dialog at root node, store session.
  const session: DialogSessionState = {
    dialogId: tree.id,
    npcInstanceId: npc.instanceId,
    currentNodeId: tree.root_node_id,
    openedAtTick: tick,
  };
  state.dialogSessions = { ...state.dialogSessions, [userId]: session };

  sendDialogNode(state, dispatcher, presence, tree, tree.root_node_id, npc, def.display_name_cs);

  log(logger, 'info', 'dialog opened', {
    userId: userId.slice(0, 8),
    npcId: def.id,
    dialogId: tree.id,
  });
}

function sendDialogNode(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  tree: DialogTree,
  nodeId: string,
  npc: NpcInstanceState,
  speakerDisplayName: string,
): void {
  const node = tree.nodes[nodeId];
  if (!node) return;

  const payload: DialogOpen = {
    dialog_id: tree.id,
    node_id: nodeId,
    npc_id: npc.instanceId,
    speaker_npc_id: node.speaker_npc_id ?? npc.npcId,
    speaker_display_name_cs: speakerDisplayName,
    text: node.text,
    options: buildOptionPayloads(node, state, presence.userId),
  };
  dispatcher.broadcastMessage(Op.DIALOG_OPEN, JSON.stringify(payload), [presence]);
}

// ── DIALOG_CHOOSE (Op 111) ──────────────────────────────────────────────────

export function handleDialogChoose(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  _tick: number,
): void {
  const userId = presence.userId;
  const ps = state.presencesByUserId[userId];
  if (!ps) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }

  const req = parseDialogChooseRequest(parsed);
  if (!req) return;

  // Rate limit (separate from INTERACT_NPC, shares interactRequestLog by design
  // — the bucket is per-user rate of *all* interaction-class actions; cap is
  // generous enough for fast clicking).
  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, DIALOG_CHOOSE_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) return;

  const session = state.dialogSessions[userId];
  if (!session) {
    sendDialogClose(dispatcher, presence, undefined, 'no_session');
    return;
  }

  if (session.dialogId !== req.dialog_id || session.currentNodeId !== req.node_id) {
    // Stale request (e.g. server already advanced to another node).
    sendDialogClose(dispatcher, presence, session.dialogId, 'invalid_option');
    closeSession(state, userId);
    return;
  }

  const npc = state.npcInstances[session.npcInstanceId];
  if (!npc) {
    sendDialogClose(dispatcher, presence, session.dialogId, 'out_of_range');
    closeSession(state, userId);
    return;
  }

  // Re-check range (player could have walked away mid-dialog).
  if (chebyshevDistance(ps.position, npc.position) > NPC_INTERACT_RANGE_TILES) {
    sendDialogClose(dispatcher, presence, session.dialogId, 'out_of_range');
    closeSession(state, userId);
    return;
  }

  const def = state.npcDefinitions[npc.npcId];
  const tree = getDialogTree(session.dialogId);
  if (!def || !tree) {
    sendDialogClose(dispatcher, presence, session.dialogId, 'invalid_option');
    closeSession(state, userId);
    return;
  }

  const node = tree.nodes[session.currentNodeId];
  if (!node) {
    sendDialogClose(dispatcher, presence, session.dialogId, 'invalid_option');
    closeSession(state, userId);
    return;
  }

  const option = node.options.find((o) => o.id === req.option_id);
  if (!option || !isOptionVisible(option, state, userId)) {
    sendDialogClose(dispatcher, presence, session.dialogId, 'invalid_option');
    closeSession(state, userId);
    return;
  }

  // Apply effects.
  if (option.effects && option.effects.length > 0) {
    for (const effect of option.effects) {
      applyDialogEffect(state, logger, nk, dispatcher, presence, npc.instanceId, effect);
    }
  }

  // Advance to next node, or close.
  if (option.next === null) {
    sendDialogClose(dispatcher, presence, session.dialogId, 'completed');
    closeSession(state, userId);
    return;
  }

  // Update session + send next node.
  state.dialogSessions = {
    ...state.dialogSessions,
    [userId]: { ...session, currentNodeId: option.next },
  };
  sendDialogNode(state, dispatcher, presence, tree, option.next, npc, def.display_name_cs);
}

// ── DIALOG_CLOSE (Op 112) — klient → server ─────────────────────────────────

export function handleDialogCloseRequest(
  state: WorldMatchState,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  _rawData: string,
  _tick: number,
): void {
  closeSession(state, presence.userId);
}

// ── Effect application ──────────────────────────────────────────────────────

function applyDialogEffect(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  npcInstanceId: string,
  effect: DialogEffect,
): void {
  const userId = presence.userId;
  switch (effect.type) {
    case 'give_item':
      applyGiveItem(logger, nk, dispatcher, presence, effect.item_id, effect.quantity);
      logAudit(nk, 'dialog_give_item', {
        userId,
        payload: { item_id: effect.item_id, quantity: effect.quantity },
      });
      break;
    case 'deduct_currency':
      applyDeductCurrency(logger, nk, dispatcher, presence, effect.amount);
      logAudit(nk, 'dialog_deduct_currency', {
        userId,
        payload: { amount: effect.amount },
      });
      break;
    case 'add_currency':
      applyGiveItem(logger, nk, dispatcher, presence, 'currency.denar', effect.amount);
      logAudit(nk, 'dialog_add_currency', {
        userId,
        payload: { amount: effect.amount },
      });
      break;
    case 'take_item':
      applyDeductItem(logger, nk, dispatcher, presence, effect.item_id, effect.quantity);
      logAudit(nk, 'dialog_take_item', {
        userId,
        payload: { item_id: effect.item_id, quantity: effect.quantity },
      });
      break;
    case 'unlock_knowledge': {
      const added = unlockKnowledge(state, nk, logger, userId, effect.knowledge_id);
      log(logger, 'info', 'dialog unlock_knowledge', {
        userId: userId.slice(0, 8),
        knowledgeId: effect.knowledge_id,
        added,
      });
      break;
    }
    case 'change_reputation': {
      const newValue = changeReputation(
        state,
        nk,
        logger,
        userId,
        effect.village_id,
        effect.delta,
      );
      log(logger, 'info', 'dialog change_reputation', {
        userId: userId.slice(0, 8),
        villageId: effect.village_id,
        delta: effect.delta,
        newValue,
      });
      break;
    }
    case 'start_quest': {
      const result = tryStartQuest(state, nk, logger, userId, effect.quest_id);
      if (result.ok) {
        const firstStep = result.def.steps[0] ?? null;
        sendQuestProgress(dispatcher, presence, result.def, result.progress, firstStep, 'started');
      } else {
        log(logger, 'debug', 'start_quest rejected', {
          userId: userId.slice(0, 8),
          questId: effect.quest_id,
          reason: result.reason,
        });
      }
      break;
    }
    case 'open_job_board': {
      // Resolve NPC the player is talking to as the issuer (MVP: NPC instance ID
      // === NPC def ID).
      const npc = state.npcInstances[npcInstanceId];
      const issuerNpcId = npc ? npc.npcId : npcInstanceId;
      sendJobBoardOpen(state, dispatcher, presence, effect.village_id, issuerNpcId);
      logAudit(nk, 'dialog_open_job_board', {
        userId,
        payload: { village_id: effect.village_id, npc_id: issuerNpcId },
      });
      break;
    }
    case 'open_shop': {
      sendShopOpen(state, dispatcher, presence, npcInstanceId, effect.merchant_table_id);
      logAudit(nk, 'dialog_open_shop', {
        userId,
        payload: { merchant_table_id: effect.merchant_table_id, npc_id: npcInstanceId },
      });
      break;
    }
    case 'complete_quest_step': {
      // Resolve which NPC the player is talking to (npcInstanceId === def.id v MVP).
      const npc = state.npcInstances[npcInstanceId];
      const npcDefId = npc ? npc.npcId : npcInstanceId;
      // Validate step's objective is talk_to_npc to this NPC; quest engine
      // guards mismatches.
      const def = getQuestDef(effect.quest_id);
      if (!def) break;
      progressObjective(state, nk, logger, dispatcher, presence, {
        type: 'talk_to_npc',
        npc_id: npcDefId,
        quest_id: effect.quest_id,
        step_id: effect.step_id,
      });
      break;
    }
    default: {
      const _exhaustive: never = effect;
      void _exhaustive;
      break;
    }
  }
}

// ── Inventory mutation helpers (subset of inventory.ts logic) ───────────────

function buildInventoryChanges(
  before: PlayerInventoryBlob['inventory'],
  after: PlayerInventoryBlob['inventory'],
): InventoryChanged['changes'] {
  const changes: InventoryChanged['changes'] = [];
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    const b = before[i];
    if (!a || !b) continue;
    if (a.item_id !== b.item_id || a.quantity !== b.quantity) {
      changes.push({ slot_index: i, item_id: a.item_id, quantity: a.quantity });
    }
  }
  return changes;
}

function applyGiveItem(
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  itemId: string,
  quantity: number,
): void {
  const userId = presence.userId;
  if (quantity <= 0) return;
  const def = getItemDef(itemId);
  if (!def) {
    log(logger, 'warn', 'give_item: unknown item', { itemId });
    return;
  }

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
        let remaining = quantity;

        if (def.stackable) {
          for (const slot of inventory) {
            if (remaining <= 0) break;
            if (slot.item_id !== itemId) continue;
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
            const max = def.stackable ? (def.max_stack ?? 1) : 1;
            const take = Math.min(max, remaining);
            slot.item_id = itemId;
            slot.quantity = take;
            remaining -= take;
          }
        }

        // Pokud zbylo (inventář full), drop the rest. Phase 9: jen log.
        if (remaining > 0) {
          log(logger, 'warn', 'give_item: inventory full, dropping remainder', {
            itemId,
            dropped: remaining,
          });
        }

        changes = buildInventoryChanges(before, inventory);
        return { ...blob, inventory };
      },
    );
  } catch (err) {
    log(logger, 'error', 'give_item OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    return;
  }

  if (changes.length > 0) {
    const msg: InventoryChanged = { changes };
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify(msg), [presence]);
  }
}

function applyDeductItem(
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  itemId: string,
  quantity: number,
): void {
  const userId = presence.userId;
  if (quantity <= 0) return;
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
        let remaining = quantity;

        for (const slot of inventory) {
          if (remaining <= 0) break;
          if (slot.item_id !== itemId) continue;
          const take = Math.min(slot.quantity, remaining);
          slot.quantity -= take;
          remaining -= take;
          if (slot.quantity <= 0) {
            slot.item_id = null;
            slot.quantity = 0;
          }
        }

        changes = buildInventoryChanges(before, inventory);
        return { ...blob, inventory };
      },
    );
  } catch (err) {
    log(logger, 'error', 'take_item OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    return;
  }

  if (changes.length > 0) {
    const msg: InventoryChanged = { changes };
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify(msg), [presence]);
  }
}

function applyDeductCurrency(
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  amount: number,
): void {
  applyDeductItem(logger, nk, dispatcher, presence, 'currency.denar', amount);
}

// ── Session bookkeeping ─────────────────────────────────────────────────────

function sendDialogClose(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  dialogId: string | undefined,
  reason: NonNullable<DialogClose['reason']>,
): void {
  const payload: DialogClose = { reason };
  if (dialogId) payload.dialog_id = dialogId;
  dispatcher.broadcastMessage(Op.DIALOG_CLOSE, JSON.stringify(payload), [presence]);
}

function closeSession(state: WorldMatchState, userId: string): void {
  if (!state.dialogSessions[userId]) return;
  const next = { ...state.dialogSessions };
  delete next[userId];
  state.dialogSessions = next;
}

export function cleanupDialogSession(state: WorldMatchState, userId: string): void {
  closeSession(state, userId);
}
