// World match state + chunk index helpers — viz docs/04-tech-adr.md ADR-005, ADR-007.
//
// Per ADR-005: kód musí být strukturovaný jako kdyby chunky byly samostatné matche.
// Žádný globální iterace nad celým světem — vždy spatial lookup přes chunkový index.
// Per ADR-007: 3×3 chunkové broadcast scope (Chebyshev distance ≤ BROADCAST_CHUNK_RADIUS).
//
// **Goja constraint:** Nakama JS runtime mezi handler voláními Export()-uje
// state do Go `map[string]interface{}` a rekonstruuje fresh Goja objekty přes
// `stateObject.Set(k, v)` (viz runtime_javascript_match_core.go). Důsledek:
//   1. `Map` a `Set` instance se stripnou na plain objects — proto
//      `Record<string, X>` místo `Map<string, X>` a `Record<string, true>`
//      (object-as-set) místo `Set<string>`.
//   2. **Mutace nested objektů přes referenci se ZTRATÍ** mezi handler calls.
//      Vždy spread + reassign celého top-level fieldu:
//          state.x = { ...state.x, foo: bar };
//      ne:
//          state.x.foo = bar;  // ztratí se na další callback
//      To platí i pro presence state, paths, chunk buckets — vše níže to
//      respektuje.

import { BROADCAST_CHUNK_RADIUS, CHUNK_SIZE_TILES } from 'irij-shared/constants';
import type { Position } from 'irij-shared/types';
import type {
  AiState,
  AtributRow,
  AtributSourceRow,
  CraftStationDefinition,
  LootTable,
  MobDefinition,
  NpcDefinition,
  PlayerQuestBlob,
  QuestObjectDefinition,
  ResourceNodeDefinition,
  SkillRow,
} from 'irij-shared/types';
import type { WalkableMask } from './walkable.js';

export interface PlayerPresenceState {
  presence: nkruntime.Presence;
  position: Position;
  displayName: string;
  hpCurrent: number;
  hpMax: number;
  lastChunk: string; // chunkKey kde se hráč naposledy nacházel (pro chunk-crossing diff)
  joinedAt: number; // ms timestamp pro debug / autosave delta v Phase 5
  // 4b movement state. `path` je pole zbývajících tile coords k projít — index 0 je
  // nejbližší další tile, end je finální target. Když path.length===0, hráč stojí.
  // `pathStartedAt` je server tick, kdy začal aktuální path advance (pro speed math).
  // `pathConsumed` je počet tile boundaries překročených od pathStartedAt (pro
  // diff "kolik nových tilů popnout v tomto loopu"). `clientSeq` echo posledního
  // přijatého MOVE_REQUEST pro reconciliation v 4c.
  path: Position[];
  pathStartedAt: number;
  pathConsumed: number;
  clientSeq: number;
  // Phase 8: skills + atributy mirror loaded at matchJoin from PLAYER_SKILLS
  // storage; write-through na každý XP gain. `sources` tracks per-(atribut,
  // source_skill) cumulative XP for diminishing returns.
  skilly: SkillRow[];
  atributy: AtributRow[];
  sources: AtributSourceRow[];
  totalLevel: number;
  totalXp: number;
}

export interface MobInstanceState {
  instanceId: string;
  mobId: string;
  position: Position;
  spawnPosition: Position;
  hpCurrent: number;
  hpMax: number;
  aiState: AiState;
  targetUserId: string | null;
  lastAttackTick: number;
  lastChunk: string;
  path: Position[];
  pathStartedAt: number;
  pathConsumed: number;
  deathTick: number | null;
  respawnAtTick: number | null;
  leashRadiusTiles: number;
  speedTps: number;
}

export interface DropInstanceState {
  dropId: string;
  position: Position;
  items: Array<{ item_id: string; quantity: number }>;
  droppedAtTick: number;
  lastChunk: string;
}

// Phase 9: NPC instance — staticky placed v matchInit. Bez wandering / patrol pro
// MVP, default_position se použije přímo. Chunk index pro snapshot scoping.
export interface NpcInstanceState {
  instanceId: string;
  npcId: string;
  position: Position;
  lastChunk: string;
}

// Per-player aktivní dialog session. Slouží jako anti-cheat token pro
// DIALOG_CHOOSE — bez aktivní session server option drop-uje. Auto-expirace
// není potřeba (klient pošle DIALOG_CLOSE; v matchLeave smažeme).
export interface DialogSessionState {
  dialogId: string;
  npcInstanceId: string; // kterého NPC se dialog týká (pro range re-check)
  currentNodeId: string;
  openedAtTick: number;
}

// Phase 10: resource node runtime instance — držíme stav (available/depleted +
// respawn timer) odděleně od static definice. Definici servery načítá z
// data/resource_nodes.json a kopíruje sem.
export interface ResourceNodeInstanceState {
  nodeId: string;
  defId: string; // === nodeId pro 1:1 mapping (MVP)
  position: Position;
  state: 'available' | 'depleted';
  respawnAtTick: number | null;
  lastChunk: string;
}

// Per-player aktivní gather session. Hráč může mít max 1 — start nového
// cancel-uje předchozí.
export interface GatherSessionState {
  userId: string;
  nodeId: string;
  startedAtTick: number;
  completeAtTick: number;
  lastProgressTick: number;
  position: Position; // pozice hráče v okamžiku start, pro range re-check
}

// Phase 11: quest object instance (statický spawn z quest_objects.json,
// despawnnut po interakci pokud `consume_on_interact: true`).
export interface QuestObjectInstanceState {
  instanceId: string;
  defId: string;
  position: Position;
  lastChunk: string;
  consumed: boolean;
}

// Per-player aktivní crafting session. Quantity = kolik cyklů ještě zbývá
// (včetně aktuálního).
export interface CraftSessionState {
  userId: string;
  recipeId: string;
  remainingCycles: number;
  cycleStartTick: number;
  cycleCompleteTick: number;
  lastProgressTick: number;
  startedAtPosition: Position;
}

export interface WorldMatchState {
  tick: number;
  walkable: WalkableMask;
  presencesByUserId: { [userId: string]: PlayerPresenceState };
  presencesByChunk: { [chunkKey: string]: { [userId: string]: true } };
  moveRequestLog: { [userId: string]: number[] };
  attackRequestLog: { [userId: string]: number[] };
  interactRequestLog: { [userId: string]: number[] };
  // Phase 6: mob & combat state
  mobDefinitions: { [mobId: string]: MobDefinition };
  lootTables: { [tableId: string]: LootTable };
  mobInstances: { [instanceId: string]: MobInstanceState };
  mobsByChunk: { [chunkKey: string]: { [instanceId: string]: true } };
  dropInstances: { [dropId: string]: DropInstanceState };
  dropsByChunk: { [chunkKey: string]: { [dropId: string]: true } };
  combatEngagements: { [userId: string]: string | null };
  // Phase 9: NPCs + dialog sessions
  npcDefinitions: { [npcId: string]: NpcDefinition };
  npcInstances: { [instanceId: string]: NpcInstanceState };
  npcsByChunk: { [chunkKey: string]: { [instanceId: string]: true } };
  dialogSessions: { [userId: string]: DialogSessionState };
  // Phase 10: resource nodes + craft stations + per-player gather/craft sessions
  resourceNodeDefinitions: { [defId: string]: ResourceNodeDefinition };
  resourceNodes: { [nodeId: string]: ResourceNodeInstanceState };
  resourceNodesByChunk: { [chunkKey: string]: { [nodeId: string]: true } };
  craftStations: { [stationId: string]: CraftStationDefinition };
  craftStationsByChunk: { [chunkKey: string]: { [stationId: string]: true } };
  gatherSessions: { [userId: string]: GatherSessionState };
  craftSessions: { [userId: string]: CraftSessionState };
  // Phase 11: quest objects + per-player quest blob mirror
  questObjectDefinitions: { [defId: string]: QuestObjectDefinition };
  questObjectInstances: { [instanceId: string]: QuestObjectInstanceState };
  questObjectsByChunk: { [chunkKey: string]: { [instanceId: string]: true } };
  // Mirror PlayerQuestBlob načtený v matchJoin. Mutace go přes write-through
  // do PLAYER_QUESTS storage. Per-player versionString cached pro CAS.
  playerQuestBlobs: { [userId: string]: PlayerQuestBlob };
  playerQuestVersions: { [userId: string]: string };
}

export function chunkKeyOf(pos: Position): string {
  const cx = Math.floor(pos.x / CHUNK_SIZE_TILES);
  const cy = Math.floor(pos.y / CHUNK_SIZE_TILES);
  return `${cx},${cy}`;
}

// Chebyshev (king-move) distance v chunk-space. 3×3 okolí = vše s distance ≤ 1.
export function chunkDistance(a: string, b: string): number {
  const [ax, ay] = a.split(',').map(Number) as [number, number];
  const [bx, by] = b.split(',').map(Number) as [number, number];
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// Goja quirk: nested object mutations via `bucket[key] = value` aren't always
// flushed back to state if `bucket` was read by reference. Bezpečné je vždy
// re-assignovat celý bucket na `state.presencesByChunk[chunkKey]`. Stejný
// pattern ve všech mutacích nested objects v match state.

export function addPresenceToChunk(
  state: WorldMatchState,
  userId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const bucket = { ...(state.presencesByChunk[key] ?? {}) };
  bucket[userId] = true;
  state.presencesByChunk[key] = bucket;
}

export function removePresenceFromChunk(
  state: WorldMatchState,
  userId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const existing = state.presencesByChunk[key];
  if (!existing) return;
  const bucket = { ...existing };
  delete bucket[userId];
  if (Object.keys(bucket).length === 0) {
    delete state.presencesByChunk[key];
  } else {
    state.presencesByChunk[key] = bucket;
  }
}

// Použito v 4b při tile-by-tile advance: pokud nový tile spadá do jiného chunku,
// updatuj index. Pokud je oldPos === newPos chunk, no-op.
export function movePresenceBetweenChunks(
  state: WorldMatchState,
  userId: string,
  oldPos: Position,
  newPos: Position,
): void {
  const oldKey = chunkKeyOf(oldPos);
  const newKey = chunkKeyOf(newPos);
  if (oldKey === newKey) return;
  removePresenceFromChunk(state, userId, oldPos);
  addPresenceToChunk(state, userId, newPos);
}

// D5: Transactionally-safe presence location update. Reassigns both
// presencesByUserId and presencesByChunk in a single pass — avoids Goja
// invariant break from two separate spread-reassigns.
export function updatePresenceLocation(
  state: WorldMatchState,
  userId: string,
  newPos: Position,
): void {
  const ps = state.presencesByUserId[userId];
  if (!ps) return;
  const oldChunk = chunkKeyOf(ps.position);
  const newChunk = chunkKeyOf(newPos);
  if (oldChunk !== newChunk) {
    removePresenceFromChunk(state, userId, ps.position);
    addPresenceToChunk(state, userId, newPos);
  }
}

// Vrací Presence[] všech hráčů, kteří jsou ve fromChunk nebo v jeho 3×3 okolí
// (Chebyshev ≤ radius). Žádný globální scan — iterujeme jen presencesByChunk
// keys, což je O(active chunks), ne O(total players).
export function recipientsInRangeOfChunk(
  state: WorldMatchState,
  fromChunk: string,
  radius: number = BROADCAST_CHUNK_RADIUS,
): nkruntime.Presence[] {
  const result: nkruntime.Presence[] = [];
  for (const chunkKey of Object.keys(state.presencesByChunk)) {
    if (chunkDistance(fromChunk, chunkKey) > radius) continue;
    const bucket = state.presencesByChunk[chunkKey];
    if (!bucket) continue;
    for (const userId of Object.keys(bucket)) {
      const ps = state.presencesByUserId[userId];
      if (ps) result.push(ps.presence);
    }
  }
  return result;
}

// === Mob chunk index helpers ============================================

export function addMobToChunk(
  state: WorldMatchState,
  instanceId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const bucket = { ...(state.mobsByChunk[key] ?? {}) };
  bucket[instanceId] = true;
  state.mobsByChunk[key] = bucket;
}

export function removeMobFromChunk(
  state: WorldMatchState,
  instanceId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const existing = state.mobsByChunk[key];
  if (!existing) return;
  const bucket = { ...existing };
  delete bucket[instanceId];
  if (Object.keys(bucket).length === 0) {
    delete state.mobsByChunk[key];
  } else {
    state.mobsByChunk[key] = bucket;
  }
}

export function moveMobBetweenChunks(
  state: WorldMatchState,
  instanceId: string,
  oldPos: Position,
  newPos: Position,
): void {
  const oldKey = chunkKeyOf(oldPos);
  const newKey = chunkKeyOf(newPos);
  if (oldKey === newKey) return;
  removeMobFromChunk(state, instanceId, oldPos);
  addMobToChunk(state, instanceId, newPos);
}

// === Drop chunk index helpers ===========================================

export function addDropToChunk(
  state: WorldMatchState,
  dropId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const bucket = { ...(state.dropsByChunk[key] ?? {}) };
  bucket[dropId] = true;
  state.dropsByChunk[key] = bucket;
}

export function removeDropFromChunk(
  state: WorldMatchState,
  dropId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const existing = state.dropsByChunk[key];
  if (!existing) return;
  const bucket = { ...existing };
  delete bucket[dropId];
  if (Object.keys(bucket).length === 0) {
    delete state.dropsByChunk[key];
  } else {
    state.dropsByChunk[key] = bucket;
  }
}

// === Mob query helpers ==================================================

export function getMobsInChunkArea(
  state: WorldMatchState,
  fromChunk: string,
  radius: number = BROADCAST_CHUNK_RADIUS,
): MobInstanceState[] {
  const result: MobInstanceState[] = [];
  for (const chunkKey of Object.keys(state.mobsByChunk)) {
    if (chunkDistance(fromChunk, chunkKey) > radius) continue;
    const bucket = state.mobsByChunk[chunkKey];
    if (!bucket) continue;
    for (const instanceId of Object.keys(bucket)) {
      const mob = state.mobInstances[instanceId];
      if (mob) result.push(mob);
    }
  }
  return result;
}

// === NPC chunk index helpers ===========================================

export function addNpcToChunk(
  state: WorldMatchState,
  instanceId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const bucket = { ...(state.npcsByChunk[key] ?? {}) };
  bucket[instanceId] = true;
  state.npcsByChunk[key] = bucket;
}

export function getNpcsInChunkArea(
  state: WorldMatchState,
  fromChunk: string,
  radius: number = BROADCAST_CHUNK_RADIUS,
): NpcInstanceState[] {
  const result: NpcInstanceState[] = [];
  for (const chunkKey of Object.keys(state.npcsByChunk)) {
    if (chunkDistance(fromChunk, chunkKey) > radius) continue;
    const bucket = state.npcsByChunk[chunkKey];
    if (!bucket) continue;
    for (const instanceId of Object.keys(bucket)) {
      const npc = state.npcInstances[instanceId];
      if (npc) result.push(npc);
    }
  }
  return result;
}

// === Quest object chunk index helpers (Phase 11) =============================

export function addQuestObjectToChunk(
  state: WorldMatchState,
  instanceId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const bucket = { ...(state.questObjectsByChunk[key] ?? {}) };
  bucket[instanceId] = true;
  state.questObjectsByChunk[key] = bucket;
}

export function removeQuestObjectFromChunk(
  state: WorldMatchState,
  instanceId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const existing = state.questObjectsByChunk[key];
  if (!existing) return;
  const bucket = { ...existing };
  delete bucket[instanceId];
  if (Object.keys(bucket).length === 0) {
    delete state.questObjectsByChunk[key];
  } else {
    state.questObjectsByChunk[key] = bucket;
  }
}

export function getQuestObjectsInChunkArea(
  state: WorldMatchState,
  fromChunk: string,
  radius: number = BROADCAST_CHUNK_RADIUS,
): QuestObjectInstanceState[] {
  const result: QuestObjectInstanceState[] = [];
  for (const chunkKey of Object.keys(state.questObjectsByChunk)) {
    if (chunkDistance(fromChunk, chunkKey) > radius) continue;
    const bucket = state.questObjectsByChunk[chunkKey];
    if (!bucket) continue;
    for (const id of Object.keys(bucket)) {
      const instance = state.questObjectInstances[id];
      if (instance && !instance.consumed) result.push(instance);
    }
  }
  return result;
}

// === Resource node + craft station chunk index helpers (Phase 10) ============

export function addResourceNodeToChunk(
  state: WorldMatchState,
  nodeId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const bucket = { ...(state.resourceNodesByChunk[key] ?? {}) };
  bucket[nodeId] = true;
  state.resourceNodesByChunk[key] = bucket;
}

export function getResourceNodesInChunkArea(
  state: WorldMatchState,
  fromChunk: string,
  radius: number = BROADCAST_CHUNK_RADIUS,
): ResourceNodeInstanceState[] {
  const result: ResourceNodeInstanceState[] = [];
  for (const chunkKey of Object.keys(state.resourceNodesByChunk)) {
    if (chunkDistance(fromChunk, chunkKey) > radius) continue;
    const bucket = state.resourceNodesByChunk[chunkKey];
    if (!bucket) continue;
    for (const nodeId of Object.keys(bucket)) {
      const node = state.resourceNodes[nodeId];
      if (node) result.push(node);
    }
  }
  return result;
}

export function addCraftStationToChunk(
  state: WorldMatchState,
  stationId: string,
  pos: Position,
): void {
  const key = chunkKeyOf(pos);
  const bucket = { ...(state.craftStationsByChunk[key] ?? {}) };
  bucket[stationId] = true;
  state.craftStationsByChunk[key] = bucket;
}

export function getCraftStationsInChunkArea(
  state: WorldMatchState,
  fromChunk: string,
  radius: number = BROADCAST_CHUNK_RADIUS,
): CraftStationDefinition[] {
  const result: CraftStationDefinition[] = [];
  for (const chunkKey of Object.keys(state.craftStationsByChunk)) {
    if (chunkDistance(fromChunk, chunkKey) > radius) continue;
    const bucket = state.craftStationsByChunk[chunkKey];
    if (!bucket) continue;
    for (const stationId of Object.keys(bucket)) {
      const st = state.craftStations[stationId];
      if (st) result.push(st);
    }
  }
  return result;
}

// Wrapper pro spawn/despawn/move broadcasts. Pokud excludeUserId je nastaveno,
// příjemci s tímto userId budou odfiltrováni (např. self-exclude při ENTITY_SPAWNED
// — joiner dostane joiner-only WORLD_SNAPSHOT místo).
export function broadcastToChunkArea(
  dispatcher: nkruntime.MatchDispatcher,
  state: WorldMatchState,
  fromChunk: string,
  opcode: number,
  payload: unknown,
  excludeUserId?: string,
): void {
  const recipients = recipientsInRangeOfChunk(state, fromChunk);
  const filtered = excludeUserId
    ? recipients.filter((p) => p.userId !== excludeUserId)
    : recipients;
  if (filtered.length === 0) return;
  dispatcher.broadcastMessage(opcode, JSON.stringify(payload), filtered);
}
