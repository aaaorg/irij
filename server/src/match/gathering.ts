// Phase 10: Gathering server handlers — GATHER_RESOURCE + tick-driven progress.
// Volá se z matchLoop pro opcode 32 (GATHER_RESOURCE) + advanceGatherSessions
// každý tick.

import { STORAGE_COLLECTIONS, TICK_MS } from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type {
  EntityDespawned,
  EntitySpawned,
  GatherCompleted,
  GatherProgress,
  GatherResourceRequest,
  InventoryChanged,
} from 'irij-shared/messages';
import { asPlayerInventory } from 'irij-shared/types';
import type { PlayerInventoryBlob, ResourceNodeDefinition } from 'irij-shared/types';
import { obj, parse, str } from 'irij-shared';

import { logAudit } from '../lib/audit.js';
import { getItemDef } from '../lib/items.js';
import { log } from '../lib/log.js';
import { getResourceNodeDef } from '../lib/recipes.js';
import { withOCCRetry } from '../lib/storage.js';
import { checkRateLimit, RATE_LIMIT_WINDOW_MS } from './movement.js';
import {
  broadcastToChunkArea,
  type GatherSessionState,
  type ResourceNodeInstanceState,
  type WorldMatchState,
} from './state.js';
import { awardXp } from './xp.js';
import { cancelCraftSession } from './crafting.js';

// Rate limit: max 5 gather requests per second.
const GATHER_RATE_LIMIT_MAX = 5;
const GATHER_RANGE_TILES = 2;
const PROGRESS_TICK_INTERVAL = 5; // 500ms

const GatherRequestSchema = obj({
  resource_node_id: str().min(1).max(64),
});

export function parseGatherRequest(raw: unknown): GatherResourceRequest | null {
  const r = parse(GatherRequestSchema, raw);
  if (!r.ok) return null;
  return r.value as GatherResourceRequest;
}

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ── Helper: check player has compatible tool in inventory or equipped ────────

function playerHasGatheringTool(
  blob: PlayerInventoryBlob,
  toolType: string,
): boolean {
  // Check inventory.
  for (const slot of blob.inventory) {
    if (!slot.item_id) continue;
    const def = getItemDef(slot.item_id);
    if (!def || def.category !== 'tool') continue;
    const sp = def.specialized as { tool_type?: unknown } | undefined;
    if (sp?.tool_type === toolType) return true;
  }
  // Check equipment.
  for (const eq of blob.equipment) {
    if (!eq.item_id) continue;
    const def = getItemDef(eq.item_id);
    if (!def || def.category !== 'tool') continue;
    const sp = def.specialized as { tool_type?: unknown } | undefined;
    if (sp?.tool_type === toolType) return true;
  }
  return false;
}

// ── Inventory addition helper (subset of inventory.ts logic) ──────────────────

function addItemToInventory(
  blob: PlayerInventoryBlob,
  itemId: string,
  quantity: number,
): { blob: PlayerInventoryBlob; overflowed: number } {
  const def = getItemDef(itemId);
  if (!def) return { blob, overflowed: quantity };
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

  return { blob: { ...blob, inventory }, overflowed: remaining };
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

// ── GATHER_RESOURCE handler ──────────────────────────────────────────────────

export function handleGatherResource(
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
  const req = parseGatherRequest(parsed);
  if (!req) return;

  // Rate limit (uses interactRequestLog bucket).
  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, GATHER_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) return;

  const node = state.resourceNodes[req.resource_node_id];
  if (!node) {
    sendGatherCompleted(dispatcher, presence, req.resource_node_id, false, 'no_node');
    return;
  }
  const def = getResourceNodeDef(node.defId);
  if (!def) {
    sendGatherCompleted(dispatcher, presence, node.nodeId, false, 'no_node');
    return;
  }

  if (chebyshev(ps.position, node.position) > GATHER_RANGE_TILES) {
    sendGatherCompleted(dispatcher, presence, node.nodeId, false, 'too_far');
    return;
  }

  if (node.state !== 'available') {
    sendGatherCompleted(dispatcher, presence, node.nodeId, false, 'depleted');
    return;
  }

  // Skill level check.
  if (def.skill_level_required > 1) {
    const skillRow = ps.skilly.find((s) => s.name === def.skill_name);
    if (!skillRow || skillRow.level < def.skill_level_required) {
      sendGatherCompleted(dispatcher, presence, node.nodeId, false, 'level_too_low');
      return;
    }
  }

  // Tool check (read inventory).
  if (def.tool_type_required) {
    const reads = nk.storageRead([
      { collection: STORAGE_COLLECTIONS.PLAYER_INVENTORY, key: userId, userId },
    ]);
    const blob = reads[0]?.value ? asPlayerInventory(reads[0].value) : null;
    if (!blob || !playerHasGatheringTool(blob, def.tool_type_required)) {
      sendGatherCompleted(dispatcher, presence, node.nodeId, false, 'tool_missing');
      return;
    }
  }

  // Cancel any existing session (gather or craft).
  cancelGatherSession(state, dispatcher, userId, 'cancelled');
  cancelCraftSession(state, dispatcher, userId, 'cancelled');

  // Start session.
  const completeAtTick = tick + Math.ceil(def.gather_time_ms / TICK_MS);
  const session: GatherSessionState = {
    userId,
    nodeId: node.nodeId,
    startedAtTick: tick,
    completeAtTick,
    lastProgressTick: tick,
    position: { ...ps.position },
  };
  state.gatherSessions = { ...state.gatherSessions, [userId]: session };

  // Send initial progress=0.
  sendGatherProgress(dispatcher, presence, node.nodeId, 0, def.gather_time_ms);

  log(logger, 'debug', 'gather started', {
    userId: userId.slice(0, 8),
    nodeId: node.nodeId,
    eta: def.gather_time_ms,
  });
}

// ── Tick-driven advance ──────────────────────────────────────────────────────

export function advanceGatherSessions(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  for (const userId of Object.keys(state.gatherSessions)) {
    const session = state.gatherSessions[userId];
    if (!session) continue;
    const ps = state.presencesByUserId[userId];
    if (!ps) {
      removeGatherSession(state, userId);
      continue;
    }

    const node = state.resourceNodes[session.nodeId];
    if (!node) {
      cancelGatherSession(state, dispatcher, userId, 'no_node');
      continue;
    }

    // Range re-check.
    if (chebyshev(ps.position, node.position) > GATHER_RANGE_TILES) {
      cancelGatherSession(state, dispatcher, userId, 'too_far');
      continue;
    }

    if (tick >= session.completeAtTick) {
      completeGather(state, logger, nk, dispatcher, userId, node, tick);
      continue;
    }

    if (tick - session.lastProgressTick >= PROGRESS_TICK_INTERVAL) {
      const def = getResourceNodeDef(node.defId);
      const total = def ? def.gather_time_ms : 1000;
      const elapsed = (tick - session.startedAtTick) * TICK_MS;
      const pct = Math.min(1, elapsed / total);
      const eta = Math.max(0, total - elapsed);
      sendGatherProgress(dispatcher, ps.presence, node.nodeId, pct, eta);
      state.gatherSessions = {
        ...state.gatherSessions,
        [userId]: { ...session, lastProgressTick: tick },
      };
    }
  }
}

function completeGather(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  userId: string,
  node: ResourceNodeInstanceState,
  tick: number,
): void {
  const ps = state.presencesByUserId[userId];
  if (!ps) {
    removeGatherSession(state, userId);
    return;
  }

  const def = getResourceNodeDef(node.defId);
  if (!def) {
    cancelGatherSession(state, dispatcher, userId, 'no_node');
    return;
  }

  const itemId = def.resource_id;
  const yieldQty = def.yield_quantity;
  let inventoryChanges: InventoryChanged['changes'] = [];
  let added = 0;

  try {
    withOCCRetry<PlayerInventoryBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      userId,
      userId,
      (current) => {
        const blob = asPlayerInventory(current) ?? (current as PlayerInventoryBlob);
        if (!inventoryHasFreeSpace(blob, itemId, yieldQty)) {
          return blob;
        }
        const before = blob.inventory.map((s) => ({ ...s }));
        const { blob: updated } = addItemToInventory(blob, itemId, yieldQty);
        added = yieldQty;
        inventoryChanges = buildInventoryChanges(before, updated.inventory);
        return updated;
      },
    );
  } catch (err) {
    log(logger, 'error', 'gather OCC failed', { userId: userId.slice(0, 8), err: String(err) });
    cancelGatherSession(state, dispatcher, userId, 'cancelled');
    return;
  }

  if (added === 0) {
    cancelGatherSession(state, dispatcher, userId, 'inventory_full');
    return;
  }

  // Award items + XP. Mark node depleted, schedule respawn.
  if (inventoryChanges.length > 0) {
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify({ changes: inventoryChanges }), [ps.presence]);
  }

  // Mark depleted, schedule respawn.
  const respawnSec =
    def.respawn_min_s + Math.floor(Math.random() * Math.max(1, def.respawn_max_s - def.respawn_min_s));
  const respawnAtTick = tick + respawnSec * 10; // TICK_HZ=10
  state.resourceNodes = {
    ...state.resourceNodes,
    [node.nodeId]: { ...node, state: 'depleted', respawnAtTick },
  };

  // Despawn from clients (keeps entity tracking simple — re-spawn sends new
  // ENTITY_SPAWNED).
  const despawn: EntityDespawned = { entity_id: node.nodeId };
  broadcastToChunkArea(dispatcher, state, node.lastChunk, Op.ENTITY_DESPAWNED, despawn);

  // GATHER_COMPLETED with items.
  const payload: GatherCompleted = {
    node_id: node.nodeId,
    success: true,
    reason: 'completed',
    items_received: [{ item_id: itemId, quantity: yieldQty }],
  };
  dispatcher.broadcastMessage(Op.GATHER_COMPLETED, JSON.stringify(payload), [ps.presence]);

  // XP award.
  if (def.xp_award && Object.keys(def.xp_award).length > 0) {
    awardXp(state, logger, nk, dispatcher, userId, def.xp_award, 'gather', node.nodeId);
  }

  logAudit(nk, 'resource_gathered', {
    userId,
    payload: { nodeId: node.nodeId, items: [{ item_id: itemId, quantity: yieldQty }] },
  });

  log(logger, 'info', 'gather completed', {
    userId: userId.slice(0, 8),
    nodeId: node.nodeId,
    item: itemId,
    qty: yieldQty,
  });

  removeGatherSession(state, userId);
}

// ── Respawn check (called periodically from matchLoop) ───────────────────────

export function checkResourceNodeRespawns(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
): void {
  for (const nodeId of Object.keys(state.resourceNodes)) {
    const node = state.resourceNodes[nodeId];
    if (!node || node.state !== 'depleted') continue;
    if (node.respawnAtTick === null || tick < node.respawnAtTick) continue;

    const def = getResourceNodeDef(node.defId);
    state.resourceNodes = {
      ...state.resourceNodes,
      [nodeId]: { ...node, state: 'available', respawnAtTick: null },
    };

    const spawnPayload: EntitySpawned = {
      entity_id: nodeId,
      type: 'resource_node',
      position: node.position,
      resource_node_id: node.defId,
      resource_kind: def?.type,
      resource_state: 'available',
      display_name_cs: resourceNodeDisplayName(def),
    };
    broadcastToChunkArea(dispatcher, state, node.lastChunk, Op.ENTITY_SPAWNED, spawnPayload);
  }
}

export function resourceNodeDisplayName(def: ResourceNodeDefinition | null): string {
  if (!def) return 'Surovinový bod';
  switch (def.type) {
    case 'ore_node':
      if (def.resource_id.includes('stone')) return 'Kamenný blok';
      if (def.resource_id.includes('copper')) return 'Měděná žíla';
      if (def.resource_id.includes('iron')) return 'Železná žíla';
      return 'Rudný blok';
    case 'tree':
      return 'Strom';
    case 'fish_spot':
      return 'Rybný spot';
    case 'herb':
      return 'Bylina';
    default:
      return 'Surovinový bod';
  }
}

// ── Session lifecycle ────────────────────────────────────────────────────────

export function cancelGatherSession(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  userId: string,
  reason: NonNullable<GatherCompleted['reason']>,
): void {
  const session = state.gatherSessions[userId];
  if (!session) return;
  const ps = state.presencesByUserId[userId];
  if (ps) {
    sendGatherCompleted(dispatcher, ps.presence, session.nodeId, false, reason);
  }
  removeGatherSession(state, userId);
}

function removeGatherSession(state: WorldMatchState, userId: string): void {
  if (!state.gatherSessions[userId]) return;
  const next = { ...state.gatherSessions };
  delete next[userId];
  state.gatherSessions = next;
}

export function cleanupGatherSession(state: WorldMatchState, userId: string): void {
  removeGatherSession(state, userId);
}

function sendGatherProgress(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  nodeId: string,
  pct: number,
  etaMs: number,
): void {
  const payload: GatherProgress = { node_id: nodeId, progress_pct: pct, eta_ms: etaMs };
  dispatcher.broadcastMessage(Op.GATHER_PROGRESS, JSON.stringify(payload), [presence]);
}

function sendGatherCompleted(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  nodeId: string,
  success: boolean,
  reason?: NonNullable<GatherCompleted['reason']>,
): void {
  const payload: GatherCompleted = { node_id: nodeId, success };
  if (reason) payload.reason = reason;
  dispatcher.broadcastMessage(Op.GATHER_COMPLETED, JSON.stringify(payload), [presence]);
}

