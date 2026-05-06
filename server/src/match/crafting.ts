// Phase 10: Crafting server handlers — CRAFT_REQUEST + tick-driven cycle progress.
// Volá se z matchLoop pro opcode 80 (CRAFT_REQUEST) + advanceCraftSessions
// každý tick.

import { STORAGE_COLLECTIONS, TICK_MS } from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type {
  CraftCompleted,
  CraftProgress,
  CraftRequest,
  InventoryChanged,
} from 'irij-shared/messages';
import { rollCraftFail, rollCraftedRarity } from 'irij-shared/skills';
import { asPlayerInventory } from 'irij-shared/types';
import type { PlayerInventoryBlob, Rarity, Recipe } from 'irij-shared/types';
import { int, obj, parse, str } from 'irij-shared';

import { logAudit } from '../lib/audit.js';
import { getItemDef } from '../lib/items.js';
import { log } from '../lib/log.js';
import { getCraftStationDef, getRecipe } from '../lib/recipes.js';
import { withOCCRetry } from '../lib/storage.js';
import { checkRateLimit, RATE_LIMIT_WINDOW_MS } from './movement.js';
import {
  type CraftSessionState,
  type WorldMatchState,
} from './state.js';
import { awardXp } from './xp.js';
import { cancelGatherSession } from './gathering.js';

const CRAFT_RATE_LIMIT_MAX = 5;
const STATION_RANGE_TILES = 2;
const PROGRESS_TICK_INTERVAL = 5; // 500ms
const MAX_CRAFT_BATCH = 50;

const CraftRequestSchema = obj({
  recipe_id: str().min(1).max(64),
  quantity: int().min(1).max(MAX_CRAFT_BATCH),
});

export function parseCraftRequest(raw: unknown): CraftRequest | null {
  const r = parse(CraftRequestSchema, raw);
  if (!r.ok) return null;
  return r.value as CraftRequest;
}

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ── Inventory helpers ────────────────────────────────────────────────────────

function inventoryHasItems(blob: PlayerInventoryBlob, itemId: string, quantity: number): boolean {
  let total = 0;
  for (const slot of blob.inventory) {
    if (slot.item_id === itemId) total += slot.quantity;
    if (total >= quantity) return true;
  }
  return total >= quantity;
}

function inventoryHasTool(blob: PlayerInventoryBlob, toolId: string): boolean {
  for (const slot of blob.inventory) {
    if (slot.item_id === toolId) return true;
  }
  for (const eq of blob.equipment) {
    if (eq.item_id === toolId) return true;
  }
  return false;
}

function inventoryHasFreeSpace(blob: PlayerInventoryBlob, itemId: string, quantity: number): boolean {
  const def = getItemDef(itemId);
  if (!def) return false;
  let needed = quantity;

  if (def.stackable) {
    for (const slot of blob.inventory) {
      if (needed <= 0) break;
      if (slot.item_id !== itemId) continue;
      const space = (def.max_stack ?? 1) - slot.quantity;
      if (space > 0) needed -= Math.min(space, needed);
    }
  }

  if (needed > 0) {
    for (const slot of blob.inventory) {
      if (needed <= 0) break;
      if (slot.item_id !== null) continue;
      const max = def.stackable ? (def.max_stack ?? 1) : 1;
      needed -= Math.min(max, needed);
    }
  }
  return needed <= 0;
}

function deductItems(blob: PlayerInventoryBlob, itemId: string, quantity: number): PlayerInventoryBlob {
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
  return { ...blob, inventory };
}

function addItem(blob: PlayerInventoryBlob, itemId: string, quantity: number): PlayerInventoryBlob {
  const def = getItemDef(itemId);
  if (!def) return blob;
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

  return { ...blob, inventory };
}

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

// ── Station proximity check ──────────────────────────────────────────────────

function findInRangeStation(
  state: WorldMatchState,
  pos: { x: number; y: number },
  stationType: string,
): boolean {
  for (const stationId of Object.keys(state.craftStations)) {
    const st = state.craftStations[stationId];
    if (!st || st.station_type !== stationType) continue;
    if (chebyshev(pos, st.position) <= STATION_RANGE_TILES) return true;
  }
  return false;
}

// ── Validation helper for cycle start (and in-flight) ────────────────────────

interface ValidationResult {
  ok: boolean;
  reason?: NonNullable<CraftCompleted['reason']>;
}

function validateCraftPrerequisites(
  state: WorldMatchState,
  blob: PlayerInventoryBlob,
  ps: { position: { x: number; y: number }; skilly: { name: string; level: number }[] },
  recipe: Recipe,
): ValidationResult {
  // Skill level.
  const required = recipe.primary_skill;
  const skillRow = ps.skilly.find((s) => s.name === required.name);
  if (!skillRow || skillRow.level < required.level) {
    return { ok: false, reason: 'level_too_low' };
  }
  // Tool.
  if (recipe.tool_required && !inventoryHasTool(blob, recipe.tool_required)) {
    return { ok: false, reason: 'tool_missing' };
  }
  // Station proximity.
  if (recipe.station_required && !findInRangeStation(state, ps.position, recipe.station_required)) {
    return { ok: false, reason: 'station_missing' };
  }
  // Inputs.
  if (recipe.inputs) {
    for (const inp of recipe.inputs) {
      if (!inventoryHasItems(blob, inp.item_id, inp.quantity)) {
        return { ok: false, reason: 'inputs_missing' };
      }
    }
  }
  // Output capacity.
  if (recipe.output) {
    if (!inventoryHasFreeSpace(blob, recipe.output.item_id, recipe.output.quantity)) {
      return { ok: false, reason: 'inventory_full' };
    }
  }
  return { ok: true };
}

// ── CRAFT_REQUEST handler ────────────────────────────────────────────────────

export function handleCraftRequest(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
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
  const req = parseCraftRequest(parsed);
  if (!req) return;

  // Rate limit.
  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, CRAFT_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) return;

  const recipe = getRecipe(req.recipe_id);
  if (!recipe) {
    sendCraftCompleted(dispatcher, presence, req.recipe_id, false, 'unknown_recipe', 0, true);
    return;
  }

  // Read inventory once for prerequisite validation.
  const reads = nk.storageRead([
    { collection: STORAGE_COLLECTIONS.PLAYER_INVENTORY, key: userId, userId },
  ]);
  const blob = reads[0]?.value ? asPlayerInventory(reads[0].value) : null;
  if (!blob) {
    sendCraftCompleted(dispatcher, presence, recipe.id, false, 'inputs_missing', 0, true);
    return;
  }

  const v = validateCraftPrerequisites(state, blob, ps, recipe);
  if (!v.ok) {
    sendCraftCompleted(dispatcher, presence, recipe.id, false, v.reason, 0, true);
    return;
  }

  // Cancel concurrent sessions.
  cancelCraftSession(state, dispatcher, userId, 'cancelled');
  cancelGatherSession(state, dispatcher, userId, 'cancelled');

  const cycles = Math.min(req.quantity, MAX_CRAFT_BATCH);
  const cycleCompleteTick = tick + Math.ceil(recipe.crafting_time_ms / TICK_MS);
  const session: CraftSessionState = {
    userId,
    recipeId: recipe.id,
    remainingCycles: cycles,
    cycleStartTick: tick,
    cycleCompleteTick,
    lastProgressTick: tick,
    startedAtPosition: { ...ps.position },
  };
  state.craftSessions = { ...state.craftSessions, [userId]: session };

  // Initial progress.
  sendCraftProgress(dispatcher, presence, recipe.id, 0, recipe.crafting_time_ms, cycles);

  log(logger, 'debug', 'craft started', {
    userId: userId.slice(0, 8),
    recipeId: recipe.id,
    cycles,
  });
}

// ── Tick-driven advance ──────────────────────────────────────────────────────

export function advanceCraftSessions(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  for (const userId of Object.keys(state.craftSessions)) {
    const session = state.craftSessions[userId];
    if (!session) continue;
    const ps = state.presencesByUserId[userId];
    if (!ps) {
      removeCraftSession(state, userId);
      continue;
    }

    const recipe = getRecipe(session.recipeId);
    if (!recipe) {
      cancelCraftSession(state, dispatcher, userId, 'unknown_recipe');
      continue;
    }

    // Station proximity re-check (player may have walked away).
    if (recipe.station_required && !findInRangeStation(state, ps.position, recipe.station_required)) {
      cancelCraftSession(state, dispatcher, userId, 'too_far');
      continue;
    }

    if (tick >= session.cycleCompleteTick) {
      completeCraftCycle(state, logger, nk, dispatcher, userId, session, recipe, tick);
      continue;
    }

    if (tick - session.lastProgressTick >= PROGRESS_TICK_INTERVAL) {
      const elapsed = (tick - session.cycleStartTick) * TICK_MS;
      const pct = Math.min(1, elapsed / recipe.crafting_time_ms);
      const eta = Math.max(0, recipe.crafting_time_ms - elapsed);
      sendCraftProgress(dispatcher, ps.presence, recipe.id, pct, eta, session.remainingCycles);
      state.craftSessions = {
        ...state.craftSessions,
        [userId]: { ...session, lastProgressTick: tick },
      };
    }
  }
}

function completeCraftCycle(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  userId: string,
  session: CraftSessionState,
  recipe: Recipe,
  tick: number,
): void {
  const ps = state.presencesByUserId[userId];
  if (!ps) {
    removeCraftSession(state, userId);
    return;
  }

  // Re-validate before consuming inputs.
  const reads = nk.storageRead([
    { collection: STORAGE_COLLECTIONS.PLAYER_INVENTORY, key: userId, userId },
  ]);
  const blob = reads[0]?.value ? asPlayerInventory(reads[0].value) : null;
  if (!blob) {
    cancelCraftSession(state, dispatcher, userId, 'inputs_missing');
    return;
  }

  const v = validateCraftPrerequisites(state, blob, ps, recipe);
  if (!v.ok) {
    cancelCraftSession(state, dispatcher, userId, v.reason ?? 'cancelled');
    return;
  }

  // Consume inputs + roll output via OCC.
  const fail = rollCraftFail(recipe.fail_chance_pct);
  let output: { item_id: string; quantity: number; rarity: Rarity } | null = null;
  if (!fail && recipe.output) {
    const outItem = recipe.output.item_id;
    const outQty = recipe.output.quantity;
    const def = getItemDef(outItem);
    let rarity: Rarity = 'common';
    if (def && (recipe.type ?? 'standard') === 'standard') {
      rarity = rollCraftedRarity(def.tier);
    } else if (recipe.output.rarity_override) {
      rarity = recipe.output.rarity_override;
    }
    output = { item_id: outItem, quantity: outQty, rarity };
  }

  let inventoryChanges: InventoryChanged['changes'] = [];
  try {
    withOCCRetry<PlayerInventoryBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      userId,
      userId,
      (current) => {
        let updated = asPlayerInventory(current) ?? (current as PlayerInventoryBlob);
        const before = updated.inventory.map((s) => ({ ...s }));

        // Re-check inputs (race protection).
        if (recipe.inputs) {
          for (const inp of recipe.inputs) {
            if (!inventoryHasItems(updated, inp.item_id, inp.quantity)) {
              return updated;
            }
          }
          for (const inp of recipe.inputs) {
            updated = deductItems(updated, inp.item_id, inp.quantity);
          }
        }

        if (output && !fail) {
          updated = addItem(updated, output.item_id, output.quantity);
        }

        inventoryChanges = buildInventoryChanges(before, updated.inventory);
        return updated;
      },
    );
  } catch (err) {
    log(logger, 'error', 'craft OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    cancelCraftSession(state, dispatcher, userId, 'cancelled');
    return;
  }

  if (inventoryChanges.length > 0) {
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify({ changes: inventoryChanges }), [ps.presence]);
  }

  // XP award (only on success).
  if (!fail && recipe.xp_award && Object.keys(recipe.xp_award).length > 0) {
    awardXp(state, logger, nk, dispatcher, userId, recipe.xp_award, 'craft', recipe.id);
  }

  logAudit(nk, fail ? 'craft_failed' : 'craft_completed', {
    userId,
    payload: { recipeId: recipe.id, output: output ?? null, fail },
  });

  log(logger, 'info', 'craft cycle done', {
    userId: userId.slice(0, 8),
    recipeId: recipe.id,
    fail,
    rarity: output?.rarity,
  });

  const remainingAfter = session.remainingCycles - 1;
  const batchDone = remainingAfter <= 0;

  const completed: CraftCompleted = {
    recipe_id: recipe.id,
    success: !fail,
    fail,
    reason: 'completed',
    remaining_cycles: remainingAfter,
    batch_done: batchDone,
  };
  if (output && !fail) completed.output = output;
  dispatcher.broadcastMessage(Op.CRAFT_COMPLETED, JSON.stringify(completed), [ps.presence]);

  if (batchDone) {
    removeCraftSession(state, userId);
  } else {
    // Start next cycle.
    const nextComplete = tick + Math.ceil(recipe.crafting_time_ms / TICK_MS);
    state.craftSessions = {
      ...state.craftSessions,
      [userId]: {
        ...session,
        remainingCycles: remainingAfter,
        cycleStartTick: tick,
        cycleCompleteTick: nextComplete,
        lastProgressTick: tick,
      },
    };
    // Initial progress for next cycle.
    sendCraftProgress(dispatcher, ps.presence, recipe.id, 0, recipe.crafting_time_ms, remainingAfter);
  }
}

// ── Session lifecycle ────────────────────────────────────────────────────────

export function cancelCraftSession(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  userId: string,
  reason: NonNullable<CraftCompleted['reason']>,
): void {
  const session = state.craftSessions[userId];
  if (!session) return;
  const ps = state.presencesByUserId[userId];
  if (ps) {
    sendCraftCompleted(dispatcher, ps.presence, session.recipeId, false, reason, session.remainingCycles, true);
  }
  removeCraftSession(state, userId);
}

function removeCraftSession(state: WorldMatchState, userId: string): void {
  if (!state.craftSessions[userId]) return;
  const next = { ...state.craftSessions };
  delete next[userId];
  state.craftSessions = next;
}

export function cleanupCraftSession(state: WorldMatchState, userId: string): void {
  removeCraftSession(state, userId);
}

function sendCraftProgress(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  recipeId: string,
  pct: number,
  etaMs: number,
  remainingCycles: number,
): void {
  const payload: CraftProgress = {
    recipe_id: recipeId,
    progress_pct: pct,
    eta_ms: etaMs,
    remaining_cycles: remainingCycles,
  };
  dispatcher.broadcastMessage(Op.CRAFT_PROGRESS, JSON.stringify(payload), [presence]);
}

function sendCraftCompleted(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  recipeId: string,
  success: boolean,
  reason: NonNullable<CraftCompleted['reason']> | undefined,
  remainingCycles: number,
  batchDone: boolean,
): void {
  const payload: CraftCompleted = {
    recipe_id: recipeId,
    success,
    fail: !success,
    remaining_cycles: remainingCycles,
    batch_done: batchDone,
  };
  if (reason) payload.reason = reason;
  dispatcher.broadcastMessage(Op.CRAFT_COMPLETED, JSON.stringify(payload), [presence]);
}

// (Pro reference: getCraftStationDef je v lib/recipes.ts; používá ho world.ts při init.)
void getCraftStationDef;
