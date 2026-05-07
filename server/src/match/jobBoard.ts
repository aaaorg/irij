// Phase 12: Job board — shared pool procedurálně generovaných tasků.
//
// Match state drží `jobBoardTasks` a `jobBoardTasksByVillage`. Při matchInit
// se vygeneruje initial pool z templatů. Generační tick (JOB_BOARD_GENERATION_INTERVAL
// = 30 min) doplňuje pool a zvyšuje priority bonus pro staré tasky bez takers.
//
// Hráč po dialog effectu `open_job_board` dostane unicast JOB_BOARD_OPEN
// snapshot. Take/submit/abandon flow s OCC retries na PLAYER_QUESTS blob.
//
// Per docs/02e sekce 5: shared pool s `max_concurrent_takers`, fulfilled_count
// vs fulfilled_max, aging mechanika.

import { JOB_BOARD_GENERATION_INTERVAL, STORAGE_COLLECTIONS, TICK_HZ } from 'irij-shared/constants';
import { Op } from 'irij-shared/messages';
import type {
  InventoryChanged,
  JobBoardOpen,
  JobBoardOpenRequest,
  JobBoardTaskView,
  JobBoardUpdated,
  JobTaskAbandonRequest,
  JobTaskCompleted,
  JobTaskProgress,
  JobTaskRejectAction,
  JobTaskRejectReason,
  JobTaskRejected,
  JobTaskSubmitRequest,
  JobTaskTakenRequest,
} from 'irij-shared/messages';
import { asPlayerInventory } from 'irij-shared/types';
import type {
  CompletedJobEntry,
  JobBoardObjectiveDefinition,
  JobBoardTask,
  JobBoardTaskTemplate,
  PlayerInventoryBlob,
  PlayerJobBoardEntry,
  PlayerQuestBlob,
} from 'irij-shared/types';
import { obj, parse, str } from 'irij-shared';

import { logAudit } from '../lib/audit.js';
import {
  getAllJobBoardTemplates,
  getJobBoardTemplate,
  getJobBoardTemplatesForVillage,
} from '../lib/jobBoardTemplates.js';
import { getItemDef } from '../lib/items.js';
import { log } from '../lib/log.js';
import { withOCCRetry } from '../lib/storage.js';
import { checkRateLimit, RATE_LIMIT_WINDOW_MS } from './movement.js';
import { getQuestBlob } from './quest.js';
import type { WorldMatchState } from './state.js';
import { awardXp } from './xp.js';

// ── Constants ────────────────────────────────────────────────────────────────

// Max počet aktivních tasků na boardu per village. Pokud je pool plný,
// generátor netvoří nové. Hodnota volena pro Blatiny (1 vesnice MVP).
const POOL_TARGET_SIZE = 5;

// Max stáří tasku ticky — když je `current_takers === 0` a stáří > tohoto, expirne.
// 7 dní @ 10 Hz = 6_048_000. Pro MVP testing zkrácené na 60 min (36000),
// post-MVP zvedneme na docs hodnotu.
const TASK_EXPIRY_TICKS = 60 * 60 * TICK_HZ; // 36000 ticků = 60 min

// Aging thresholds — viz docs/02e sekce 5 "Task aging".
// Po 24h s 0 takers → 1.2×, 48h → 1.5×, 5 dní → 2.0×. MVP zkrácené proporcionálně:
const AGING_THRESHOLDS: Array<{ minTicksWithoutTaker: number; multiplier: number }> = [
  { minTicksWithoutTaker: 5 * 60 * TICK_HZ, multiplier: 1.2 }, // 5 min
  { minTicksWithoutTaker: 15 * 60 * TICK_HZ, multiplier: 1.5 }, // 15 min
  { minTicksWithoutTaker: 30 * 60 * TICK_HZ, multiplier: 2.0 }, // 30 min
];

const JOB_BOARD_RATE_LIMIT_MAX = 5; // shared interactRequestLog bucket
const NPC_RANGE_TILES = 2;

// ── Schema validators ────────────────────────────────────────────────────────

const JobBoardOpenRequestSchema = obj({ village_id: str().min(1).max(64) });
const TaskIdRequestSchema = obj({ task_id: str().min(1).max(64) });

export function parseJobBoardOpenRequest(raw: unknown): JobBoardOpenRequest | null {
  const r = parse(JobBoardOpenRequestSchema, raw);
  return r.ok ? (r.value as JobBoardOpenRequest) : null;
}

export function parseJobTaskIdRequest(
  raw: unknown,
): { task_id: string } | null {
  const r = parse(TaskIdRequestSchema, raw);
  return r.ok ? (r.value as { task_id: string }) : null;
}

// ── Generator ───────────────────────────────────────────────────────────────

// Vyber template váženě podle `weight`. Vrátí null pokud žádný template není.
export function pickTemplateWeighted(
  templates: JobBoardTaskTemplate[],
  rng: () => number = Math.random,
): JobBoardTaskTemplate | null {
  if (templates.length === 0) return null;
  const totalWeight = templates.reduce((sum, t) => sum + Math.max(0, t.weight), 0);
  if (totalWeight <= 0) return templates[0] ?? null;
  let roll = rng() * totalWeight;
  for (const t of templates) {
    roll -= Math.max(0, t.weight);
    if (roll <= 0) return t;
  }
  return templates[templates.length - 1] ?? null;
}

export function makeTaskFromTemplate(
  state: WorldMatchState,
  template: JobBoardTaskTemplate,
  tick: number,
): JobBoardTask {
  state.jobBoardCounter += 1;
  const taskId = `task.${tick}.${state.jobBoardCounter}`;
  return {
    task_id: taskId,
    template_id: template.template_id,
    village_id: template.village_id,
    issuer_npc_id: template.issuer_npc_id,
    deliver_to_npc_id: template.deliver_to_npc_id,
    title: template.title,
    description: template.description,
    objective: { ...template.objective },
    reward: { ...template.reward },
    max_concurrent_takers: template.max_concurrent_takers,
    current_takers: 0,
    fulfilled_count: 0,
    fulfilled_max: template.fulfilled_max,
    issued_at_tick: tick,
    priority_bonus_multiplier: 1.0,
    taker_user_ids: [],
  };
}

// Generuje initial pool. Volá se v matchInit. Posune jobBoardCounter.
export function seedInitialJobBoard(
  state: WorldMatchState,
  tick: number,
  rng: () => number = Math.random,
): void {
  const villages = new Set<string>();
  for (const t of getAllJobBoardTemplates()) villages.add(t.village_id);

  for (const villageId of villages) {
    const templates = getJobBoardTemplatesForVillage(villageId);
    // Pro každý template nasaď 1 task na startu, aby každý druh byl vidět.
    // Pokud je templatů víc než POOL_TARGET_SIZE, váženě random sub-select.
    const initial = templates.length <= POOL_TARGET_SIZE
      ? templates
      : pickN(templates, POOL_TARGET_SIZE, rng);
    for (const tpl of initial) {
      const task = makeTaskFromTemplate(state, tpl, tick);
      addTaskToState(state, task);
    }
  }
}

function pickN<T>(arr: T[], n: number, rng: () => number): T[] {
  const copy = [...arr];
  const result: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    result.push(copy[idx]!);
    copy.splice(idx, 1);
  }
  return result;
}

function addTaskToState(state: WorldMatchState, task: JobBoardTask): void {
  state.jobBoardTasks = { ...state.jobBoardTasks, [task.task_id]: task };
  const bucket = { ...(state.jobBoardTasksByVillage[task.village_id] ?? {}) };
  bucket[task.task_id] = true;
  state.jobBoardTasksByVillage = {
    ...state.jobBoardTasksByVillage,
    [task.village_id]: bucket,
  };
}

function removeTaskFromState(state: WorldMatchState, taskId: string): void {
  const task = state.jobBoardTasks[taskId];
  if (!task) return;
  const nextTasks = { ...state.jobBoardTasks };
  delete nextTasks[taskId];
  state.jobBoardTasks = nextTasks;
  const bucket = { ...(state.jobBoardTasksByVillage[task.village_id] ?? {}) };
  delete bucket[taskId];
  if (Object.keys(bucket).length === 0) {
    const next = { ...state.jobBoardTasksByVillage };
    delete next[task.village_id];
    state.jobBoardTasksByVillage = next;
  } else {
    state.jobBoardTasksByVillage = {
      ...state.jobBoardTasksByVillage,
      [task.village_id]: bucket,
    };
  }
}

// Pure helper — která multiplier kategorie je relevantní pro daný věk?
export function priorityForAge(ticksWithoutTaker: number): number {
  let multiplier = 1.0;
  for (const t of AGING_THRESHOLDS) {
    if (ticksWithoutTaker >= t.minTicksWithoutTaker) multiplier = t.multiplier;
  }
  return multiplier;
}

// Periodický tick — bumpne aging multiplier + expirne staré tasky bez takers
// + doplní pool. Volá se z matchLoop každých JOB_BOARD_GENERATION_INTERVAL ticků.
export function runJobBoardGenerationTick(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  rng: () => number = Math.random,
): void {
  const added: JobBoardTask[] = [];
  const removed: string[] = [];
  const changed: JobBoardTask[] = [];

  // Group by village pro pool-size check.
  const byVillage: { [villageId: string]: JobBoardTask[] } = {};
  for (const taskId of Object.keys(state.jobBoardTasks)) {
    const task = state.jobBoardTasks[taskId];
    if (!task) continue;
    if (!byVillage[task.village_id]) byVillage[task.village_id] = [];
    byVillage[task.village_id]!.push(task);
  }

  // Expire + age existing tasks. Pozor: aktuální logika expiruje jen tasky
  // bez takerů (current_takers === 0). Hráči s aktivním tasken ho drží naživu.
  for (const taskId of Object.keys(state.jobBoardTasks)) {
    const task = state.jobBoardTasks[taskId];
    if (!task) continue;
    if (task.taker_user_ids.length === 0) {
      const age = tick - task.issued_at_tick;
      if (age >= TASK_EXPIRY_TICKS) {
        removed.push(taskId);
        removeTaskFromState(state, taskId);
        continue;
      }
      const newMult = priorityForAge(age);
      if (newMult !== task.priority_bonus_multiplier) {
        const next = { ...task, priority_bonus_multiplier: newMult };
        state.jobBoardTasks = { ...state.jobBoardTasks, [taskId]: next };
        changed.push(next);
      }
    }
  }

  // Refill pool per village.
  const villageIds = Array.from(
    new Set([
      ...Object.keys(byVillage),
      ...getAllJobBoardTemplates().map((t) => t.village_id),
    ]),
  );
  for (const villageId of villageIds) {
    const current = (byVillage[villageId] ?? []).filter(
      (t) => !removed.includes(t.task_id),
    ).length;
    const need = POOL_TARGET_SIZE - current;
    if (need <= 0) continue;
    const templates = getJobBoardTemplatesForVillage(villageId);
    if (templates.length === 0) continue;
    for (let i = 0; i < need; i++) {
      const tpl = pickTemplateWeighted(templates, rng);
      if (!tpl) break;
      const task = makeTaskFromTemplate(state, tpl, tick);
      addTaskToState(state, task);
      added.push(task);
    }
  }

  if (added.length === 0 && removed.length === 0 && changed.length === 0) return;

  // Broadcast JOB_BOARD_UPDATED — MVP all recipients in match. Per docs target
  // by villager scope, ale stačí all dokud máme jednu vesnici.
  for (const villageId of villageIds) {
    const villageAdded = added.filter((t) => t.village_id === villageId);
    const villageChanged = changed.filter((t) => t.village_id === villageId);
    const villageRemovedIds = removed; // task IDs jsou globally unique; klient bere podle id
    if (
      villageAdded.length === 0 &&
      villageChanged.length === 0 &&
      villageRemovedIds.length === 0
    ) {
      continue;
    }
    const payload: JobBoardUpdated = {
      village_id: villageId,
      added: villageAdded.map((t) => projectTaskView(t, null, null)),
      removed: villageRemovedIds,
      changed: villageChanged.map((t) => projectTaskView(t, null, null)),
    };
    dispatcher.broadcastMessage(Op.JOB_BOARD_UPDATED, JSON.stringify(payload));
  }
}

// ── Per-task projection ─────────────────────────────────────────────────────

export function projectTaskView(
  task: JobBoardTask,
  selfUserId: string | null,
  blob: PlayerQuestBlob | null,
): JobBoardTaskView {
  const entry = blob && selfUserId ? blob.jobs[task.task_id] : undefined;
  const takenBySelf = !!entry;
  const selfProgress = entry?.progress;
  const submittable = takenBySelf
    ? isObjectiveSatisfied(task.objective, selfProgress ?? {})
    : false;
  return {
    task_id: task.task_id,
    template_id: task.template_id,
    village_id: task.village_id,
    type: task.objective.type,
    issuer_npc_id: task.issuer_npc_id,
    deliver_to_npc_id: task.deliver_to_npc_id,
    title: task.title,
    description: task.description,
    objective: task.objective,
    reward: task.reward,
    max_concurrent_takers: task.max_concurrent_takers,
    current_takers: task.current_takers,
    fulfilled_count: task.fulfilled_count,
    fulfilled_max: task.fulfilled_max,
    priority_bonus_multiplier: task.priority_bonus_multiplier,
    taken_by_self: takenBySelf,
    self_progress: selfProgress,
    self_submittable: submittable,
  };
}

export function progressKeyFor(objective: JobBoardObjectiveDefinition): string {
  return `${objective.type}:${objective.target}`;
}

export function isObjectiveSatisfied(
  objective: JobBoardObjectiveDefinition,
  progress: Record<string, number>,
): boolean {
  const key = progressKeyFor(objective);
  const have = progress[key] ?? 0;
  return have >= objective.count;
}

// ── Reject helper (žádný silent fail) ───────────────────────────────────────

export function sendJobTaskRejected(
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  action: JobTaskRejectAction,
  reason: JobTaskRejectReason,
  taskId?: string,
  detail?: JobTaskRejected['detail'],
): void {
  const payload: JobTaskRejected = { action, reason };
  if (taskId) payload.task_id = taskId;
  if (detail) payload.detail = detail;
  dispatcher.broadcastMessage(Op.JOB_TASK_REJECTED, JSON.stringify(payload), [presence]);
}

// Helper pro stavbu JOB_TASK_PROGRESS s title/description/objective z task
// definice — klient ho potřebuje aby zobrazil entry ve QuestPanelu i bez
// otevřeného boardu (po reconnect / po take akci).
function buildProgressPayload(
  task: JobBoardTask,
  progress: Record<string, number>,
  event: JobTaskProgress['event'] = 'progress',
): JobTaskProgress {
  return {
    task_id: task.task_id,
    template_id: task.template_id,
    title: task.title,
    description: task.description,
    objective: task.objective,
    progress,
    submittable: isObjectiveSatisfied(task.objective, progress),
    event,
  };
}

// ── Persistence helpers (PlayerQuestBlob mirror) ────────────────────────────

function persistJobsBlob(
  state: WorldMatchState,
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  userId: string,
  next: PlayerQuestBlob,
): void {
  try {
    // `next` už obsahuje aktuální in-memory snapshot mirror (mutace zde + případně
    // souběžné z quest.ts skrze stejný state.playerQuestBlobs reference). Match
    // state je single source of truth pro PLAYER_QUESTS uvnitř session — OCC
    // serializuje jen souběžné storage writes z různých match instancí, které
    // v MVP nemáme. Přesto necháme withOCCRetry pro safety + version tracking.
    const result = withOCCRetry<PlayerQuestBlob>(
      nk,
      STORAGE_COLLECTIONS.PLAYER_QUESTS,
      userId,
      userId,
      () => next,
    );
    state.playerQuestBlobs = { ...state.playerQuestBlobs, [userId]: next };
    state.playerQuestVersions = {
      ...state.playerQuestVersions,
      [userId]: result.version,
    };
  } catch (err) {
    log(logger, 'error', 'persistJobsBlob failed', {
      userId: userId.slice(0, 8),
      err: String(err),
    });
    state.playerQuestBlobs = { ...state.playerQuestBlobs, [userId]: next };
  }
}

// ── Open board ──────────────────────────────────────────────────────────────

export function sendJobBoardOpen(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  villageId: string,
  issuerNpcId: string,
): void {
  const blob = getQuestBlob(state, presence.userId);
  const taskIds = state.jobBoardTasksByVillage[villageId] ?? {};
  const tasks: JobBoardTaskView[] = [];
  for (const taskId of Object.keys(taskIds)) {
    const task = state.jobBoardTasks[taskId];
    if (!task) continue;
    tasks.push(projectTaskView(task, presence.userId, blob));
  }
  // Sort: aktivní hráče first, pak by priority desc, then issued_at_tick asc.
  tasks.sort((a, b) => {
    if (a.taken_by_self !== b.taken_by_self) return a.taken_by_self ? -1 : 1;
    if (a.priority_bonus_multiplier !== b.priority_bonus_multiplier) {
      return b.priority_bonus_multiplier - a.priority_bonus_multiplier;
    }
    return a.task_id.localeCompare(b.task_id);
  });
  const payload: JobBoardOpen = {
    village_id: villageId,
    issuer_npc_id: issuerNpcId,
    tasks,
  };
  dispatcher.broadcastMessage(Op.JOB_BOARD_OPEN, JSON.stringify(payload), [presence]);
}

// Op.JOB_BOARD_OPEN_REQUEST handler — klient ručně requestuje view (např. po
// reconnectu, nebo z UI tlačítka). Vyžaduje range k issuer NPC v daném village.
export function handleJobBoardOpenRequest(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
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
  const req = parseJobBoardOpenRequest(parsed);
  if (!req) return;

  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, JOB_BOARD_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) {
    sendJobTaskRejected(dispatcher, presence, 'open', 'rate_limited');
    return;
  }

  // Najdi nějakého issuer NPC v range pro tuto village.
  const issuerNpc = findIssuerNpcInRange(state, ps.position, req.village_id);
  if (!issuerNpc) {
    log(logger, 'debug', 'JOB_BOARD_OPEN_REQUEST: no issuer NPC in range', {
      userId: userId.slice(0, 8),
      villageId: req.village_id,
    });
    sendJobTaskRejected(dispatcher, presence, 'open', 'no_issuer_in_range');
    return;
  }

  sendJobBoardOpen(state, dispatcher, presence, req.village_id, issuerNpc);
}

function findIssuerNpcInRange(
  state: WorldMatchState,
  playerPos: { x: number; y: number },
  villageId: string,
): string | null {
  for (const taskId of Object.keys(state.jobBoardTasks)) {
    const task = state.jobBoardTasks[taskId];
    if (!task || task.village_id !== villageId) continue;
    const npc = state.npcInstances[task.issuer_npc_id];
    if (!npc) continue;
    const dx = Math.abs(npc.position.x - playerPos.x);
    const dy = Math.abs(npc.position.y - playerPos.y);
    if (Math.max(dx, dy) <= NPC_RANGE_TILES) return npc.npcId;
  }
  return null;
}

// ── Take ────────────────────────────────────────────────────────────────────

export function handleJobTaskTaken(
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
  const req = parseJobTaskIdRequest(parsed) as JobTaskTakenRequest | null;
  if (!req) return;

  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, JOB_BOARD_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) {
    sendJobTaskRejected(dispatcher, presence, 'take', 'rate_limited', req.task_id);
    return;
  }

  const task = state.jobBoardTasks[req.task_id];
  if (!task) {
    log(logger, 'info', 'JOB_TASK_TAKEN: unknown task', {
      userId: userId.slice(0, 8),
      taskId: req.task_id,
    });
    sendJobTaskRejected(dispatcher, presence, 'take', 'unknown_task', req.task_id);
    return;
  }
  if (task.taker_user_ids.includes(userId)) {
    sendJobTaskRejected(dispatcher, presence, 'take', 'already_taken', req.task_id);
    return;
  }
  if (task.current_takers >= task.max_concurrent_takers) {
    sendJobTaskRejected(dispatcher, presence, 'take', 'task_full', req.task_id);
    return;
  }

  // Range check k issuer NPC.
  const issuerNpc = state.npcInstances[task.issuer_npc_id];
  if (!issuerNpc) {
    sendJobTaskRejected(dispatcher, presence, 'take', 'no_issuer_in_range', req.task_id);
    return;
  }
  const dx = Math.abs(issuerNpc.position.x - ps.position.x);
  const dy = Math.abs(issuerNpc.position.y - ps.position.y);
  if (Math.max(dx, dy) > NPC_RANGE_TILES) {
    log(logger, 'info', 'JOB_TASK_TAKEN: out of range', {
      userId: userId.slice(0, 8),
      playerPos: ps.position,
      npcPos: issuerNpc.position,
    });
    sendJobTaskRejected(dispatcher, presence, 'take', 'out_of_range', req.task_id);
    return;
  }

  // Update task state.
  const updatedTask: JobBoardTask = {
    ...task,
    current_takers: task.current_takers + 1,
    taker_user_ids: [...task.taker_user_ids, userId],
  };
  state.jobBoardTasks = { ...state.jobBoardTasks, [req.task_id]: updatedTask };

  // Update player blob.
  const blob = getQuestBlob(state, userId);
  const entry: PlayerJobBoardEntry = {
    task_id: task.task_id,
    template_id: task.template_id,
    village_id: task.village_id,
    taken_at_tick: tick,
    state: 'active',
    progress: {},
  };
  const nextBlob: PlayerQuestBlob = {
    ...blob,
    jobs: { ...blob.jobs, [task.task_id]: entry },
  };
  persistJobsBlob(state, nk, logger, userId, nextBlob);

  logAudit(nk, 'job_task_taken', {
    userId,
    payload: { task_id: task.task_id, template_id: task.template_id },
  });
  log(logger, 'info', 'JOB_TASK_TAKEN: accepted', {
    userId: userId.slice(0, 8),
    taskId: task.task_id,
    templateId: task.template_id,
  });

  // Unicast progress s plným task metadatem — klient může entry zobrazit
  // ve QuestPanelu i bez otevřeného boardu.
  const progressMsg = buildProgressPayload(updatedTask, entry.progress, 'taken');
  dispatcher.broadcastMessage(Op.JOB_TASK_PROGRESS, JSON.stringify(progressMsg), [presence]);

  // Broadcast updated state pro ostatní pozorovatele.
  const updatePayload: JobBoardUpdated = {
    village_id: task.village_id,
    added: [],
    removed: [],
    changed: [projectTaskView(updatedTask, null, null)],
  };
  dispatcher.broadcastMessage(Op.JOB_BOARD_UPDATED, JSON.stringify(updatePayload));
}

// ── Submit ──────────────────────────────────────────────────────────────────

export function handleJobTaskSubmit(
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
  const req = parseJobTaskIdRequest(parsed) as JobTaskSubmitRequest | null;
  if (!req) return;

  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, JOB_BOARD_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) {
    sendJobTaskRejected(dispatcher, presence, 'submit', 'rate_limited', req.task_id);
    return;
  }

  const task = state.jobBoardTasks[req.task_id];
  if (!task) {
    sendJobTaskRejected(dispatcher, presence, 'submit', 'unknown_task', req.task_id);
    return;
  }

  const blob = getQuestBlob(state, userId);
  const entry = blob.jobs[req.task_id];
  if (!entry) {
    sendJobTaskRejected(dispatcher, presence, 'submit', 'not_taken', req.task_id);
    return;
  }

  // Range to deliver_to NPC.
  const deliverNpc = state.npcInstances[task.deliver_to_npc_id];
  if (!deliverNpc) {
    sendJobTaskRejected(dispatcher, presence, 'submit', 'no_issuer_in_range', req.task_id);
    return;
  }
  const dx = Math.abs(deliverNpc.position.x - ps.position.x);
  const dy = Math.abs(deliverNpc.position.y - ps.position.y);
  if (Math.max(dx, dy) > NPC_RANGE_TILES) {
    sendJobTaskRejected(dispatcher, presence, 'submit', 'out_of_range', req.task_id);
    return;
  }

  // For deliver_item: re-validate inventory at submit time + deduct.
  if (task.objective.type === 'deliver_item') {
    const itemId = task.objective.target;
    const need = task.objective.count;
    const have = countInventoryItem(nk, userId, itemId);
    if (have < need) {
      sendJobTaskRejected(dispatcher, presence, 'submit', 'inventory_short', req.task_id, {
        item_id: itemId,
        need,
        have,
      });
      return;
    }
    const ok = tryDeductDeliveryItems(
      state,
      logger,
      nk,
      dispatcher,
      presence,
      task.objective.target,
      task.objective.count,
    );
    if (!ok) {
      sendJobTaskRejected(dispatcher, presence, 'submit', 'inventory_short', req.task_id, {
        item_id: itemId,
        need,
      });
      return;
    }
  } else {
    // kill_mob — must have satisfied progress.
    if (!isObjectiveSatisfied(task.objective, entry.progress)) {
      sendJobTaskRejected(dispatcher, presence, 'submit', 'objective_not_met', req.task_id);
      return;
    }
  }

  // Apply rewards (mutuje blob mirror přes persistJobsBlob).
  applyJobReward(state, logger, nk, dispatcher, presence, task);

  // Re-fetch blob — applyJobReward (reputation) ho mohl updatnout.
  const updatedBlob = getQuestBlob(state, userId);

  // Move entry from active → completed.
  const completedAt = new Date().toISOString();
  const completedEntry: CompletedJobEntry = {
    task_id: task.task_id,
    template_id: task.template_id,
    completed_at: completedAt,
  };
  const nextJobs = { ...updatedBlob.jobs };
  delete nextJobs[task.task_id];
  const nextBlob: PlayerQuestBlob = {
    ...updatedBlob,
    jobs: nextJobs,
    jobs_completed: { ...updatedBlob.jobs_completed, [task.task_id]: completedEntry },
  };
  persistJobsBlob(state, nk, logger, userId, nextBlob);

  // Update task state — fulfilled_count++, remove from takers, expire if hit fulfilled_max.
  const updatedTakers = task.taker_user_ids.filter((id) => id !== userId);
  const updatedTask: JobBoardTask = {
    ...task,
    fulfilled_count: task.fulfilled_count + 1,
    current_takers: Math.max(0, task.current_takers - 1),
    taker_user_ids: updatedTakers,
  };
  let removedTaskIds: string[] = [];
  let changedTasks: JobBoardTask[] = [];
  if (updatedTask.fulfilled_count >= updatedTask.fulfilled_max) {
    removeTaskFromState(state, task.task_id);
    removedTaskIds = [task.task_id];
  } else {
    state.jobBoardTasks = { ...state.jobBoardTasks, [task.task_id]: updatedTask };
    changedTasks = [updatedTask];
  }

  logAudit(nk, 'job_task_completed', {
    userId,
    payload: { task_id: task.task_id, template_id: task.template_id },
  });

  // Notify player.
  const completedPayload: JobTaskCompleted = {
    task_id: task.task_id,
    template_id: task.template_id,
    title: task.title,
    reward: task.reward,
  };
  dispatcher.broadcastMessage(Op.JOB_TASK_COMPLETED, JSON.stringify(completedPayload), [presence]);

  // Broadcast board update.
  const updatePayload: JobBoardUpdated = {
    village_id: task.village_id,
    added: [],
    removed: removedTaskIds,
    changed: changedTasks.map((t) => projectTaskView(t, null, null)),
  };
  if (
    updatePayload.removed.length > 0 ||
    updatePayload.changed.length > 0
  ) {
    dispatcher.broadcastMessage(Op.JOB_BOARD_UPDATED, JSON.stringify(updatePayload));
  }
}

// ── Abandon ─────────────────────────────────────────────────────────────────

export function handleJobTaskAbandon(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  rawData: string,
  _tick: number,
): void {
  const userId = presence.userId;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }
  const req = parseJobTaskIdRequest(parsed) as JobTaskAbandonRequest | null;
  if (!req) return;

  const nowMs = Date.now();
  const prevLog = state.interactRequestLog[userId] ?? [];
  const rl = checkRateLimit(prevLog, nowMs, RATE_LIMIT_WINDOW_MS, JOB_BOARD_RATE_LIMIT_MAX);
  state.interactRequestLog = { ...state.interactRequestLog, [userId]: rl.updatedLog };
  if (!rl.allowed) {
    sendJobTaskRejected(dispatcher, presence, 'abandon', 'rate_limited', req.task_id);
    return;
  }

  const blob = getQuestBlob(state, userId);
  if (!blob.jobs[req.task_id]) {
    sendJobTaskRejected(dispatcher, presence, 'abandon', 'not_taken', req.task_id);
    return;
  }

  const nextJobs = { ...blob.jobs };
  delete nextJobs[req.task_id];
  const nextBlob: PlayerQuestBlob = { ...blob, jobs: nextJobs };
  persistJobsBlob(state, nk, logger, userId, nextBlob);

  const task = state.jobBoardTasks[req.task_id];
  if (task && task.taker_user_ids.includes(userId)) {
    const updatedTask: JobBoardTask = {
      ...task,
      current_takers: Math.max(0, task.current_takers - 1),
      taker_user_ids: task.taker_user_ids.filter((id) => id !== userId),
    };
    state.jobBoardTasks = { ...state.jobBoardTasks, [req.task_id]: updatedTask };

    // Unicast confirm — klient odebere entry z UI.
    const abandonPayload = buildProgressPayload(updatedTask, {}, 'abandoned');
    dispatcher.broadcastMessage(
      Op.JOB_TASK_PROGRESS,
      JSON.stringify(abandonPayload),
      [presence],
    );

    // Broadcast updated stav ostatním pozorovatelům.
    const updatePayload: JobBoardUpdated = {
      village_id: task.village_id,
      added: [],
      removed: [],
      changed: [projectTaskView(updatedTask, null, null)],
    };
    dispatcher.broadcastMessage(Op.JOB_BOARD_UPDATED, JSON.stringify(updatePayload));
  }

  logAudit(nk, 'job_task_abandoned', {
    userId,
    payload: { task_id: req.task_id },
  });
  log(logger, 'info', 'JOB_TASK_ABANDON: accepted', {
    userId: userId.slice(0, 8),
    taskId: req.task_id,
  });
}

// ── kill_mob progress hook (volá se z combat.handleMobDeath) ────────────────

// Iteruje aktivní jobs hráče — pokud je objective kill_mob s matching mob_id,
// inkrementuje progress. Pokud hit count → submittable=true (klient zobrazí
// "Vyzvednout odměnu" v UI).
export function progressJobObjectivesKillMob(
  state: WorldMatchState,
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  mobId: string,
): void {
  const userId = presence.userId;
  const blob = getQuestBlob(state, userId);
  const jobIds = Object.keys(blob.jobs);
  if (jobIds.length === 0) return;

  let nextJobs = { ...blob.jobs };
  let mutated = false;
  const progressEvents: JobTaskProgress[] = [];

  for (const taskId of jobIds) {
    const entry = nextJobs[taskId];
    if (!entry) continue;
    const task = state.jobBoardTasks[taskId];
    if (!task) continue;
    if (task.objective.type !== 'kill_mob') continue;
    if (task.objective.target !== mobId) continue;

    const key = progressKeyFor(task.objective);
    const have = (entry.progress[key] ?? 0) + 1;
    const cap = Math.min(have, task.objective.count); // cap progress at count
    const newProgress = { ...entry.progress, [key]: cap };
    nextJobs[taskId] = { ...entry, progress: newProgress };
    mutated = true;
    progressEvents.push(buildProgressPayload(task, newProgress, 'progress'));
  }

  if (!mutated) return;

  const nextBlob: PlayerQuestBlob = { ...blob, jobs: nextJobs };
  persistJobsBlob(state, nk, logger, userId, nextBlob);

  for (const evt of progressEvents) {
    dispatcher.broadcastMessage(Op.JOB_TASK_PROGRESS, JSON.stringify(evt), [presence]);
  }
}

// ── Reward + inventory helpers ──────────────────────────────────────────────

// Count itemy v inventory blobu — read-only, slouží pro pre-flight check
// před `tryDeductDeliveryItems`. Vrací 0 při chybě (kdyby blob nebyl k dispozici).
function countInventoryItem(
  nk: nkruntime.Nakama,
  userId: string,
  itemId: string,
): number {
  try {
    const reads = nk.storageRead([
      { collection: STORAGE_COLLECTIONS.PLAYER_INVENTORY, key: userId, userId },
    ]);
    const obj = reads[0];
    if (!obj || !obj.value || typeof obj.value !== 'object') return 0;
    // Použij narrowing helper, ale fallback na raw value když narrowing selže
    // (platí stejný pattern jako v inventory.ts / quest.ts pro starší bloby).
    const blob = asPlayerInventory(obj.value) ?? (obj.value as PlayerInventoryBlob);
    if (!Array.isArray(blob.inventory)) return 0;
    let total = 0;
    for (const slot of blob.inventory) {
      if (slot && slot.item_id === itemId) total += slot.quantity;
    }
    return total;
  } catch {
    return 0;
  }
}

function tryDeductDeliveryItems(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  itemId: string,
  quantity: number,
): boolean {
  void state;
  const userId = presence.userId;
  let success = false;
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

        // Count total available.
        let available = 0;
        for (const slot of inventory) {
          if (slot.item_id === itemId) available += slot.quantity;
        }
        if (available < quantity) {
          // Vrátíme blob unchanged → OCC commit s no-op write.
          success = false;
          return blob;
        }

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
        success = true;

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
    log(logger, 'error', 'tryDeductDeliveryItems OCC failed', {
      userId: userId.slice(0, 8),
      err: String(err),
    });
    return false;
  }

  if (success && changes.length > 0) {
    const msg: InventoryChanged = { changes };
    dispatcher.broadcastMessage(Op.INVENTORY_CHANGED, JSON.stringify(msg), [presence]);
  }
  return success;
}

function applyJobReward(
  state: WorldMatchState,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  task: JobBoardTask,
): void {
  const userId = presence.userId;

  // Currency (denáry) → inventory přes OCC.
  if (task.reward.currency_denar > 0) {
    addItemToInventory(logger, nk, dispatcher, presence, 'currency.denar', task.reward.currency_denar);
  }

  // XP → distribute via existing awardXp.
  if (task.reward.xp && Object.keys(task.reward.xp).length > 0) {
    awardXp(state, logger, nk, dispatcher, userId, task.reward.xp, 'job', task.template_id);
  }

  // Reputation → patch quest blob (změny už persisted v handleJobTaskSubmit
  // přes persistJobsBlob, ale reputaci musíme provést jinak — voláme z
  // handleJobTaskSubmit jako separate krok). MVP: in-blob update v rámci
  // submit flow.
  if (task.reward.reputation && Object.keys(task.reward.reputation).length > 0) {
    const blob = getQuestBlob(state, userId);
    const nextRep = { ...blob.reputation };
    for (const villageId of Object.keys(task.reward.reputation)) {
      const delta = task.reward.reputation[villageId] ?? 0;
      const cur = nextRep[villageId] ?? 100;
      nextRep[villageId] = Math.min(1000, Math.max(-99999, cur + delta));
    }
    const nextBlob: PlayerQuestBlob = { ...blob, reputation: nextRep };
    persistJobsBlob(state, nk, logger, userId, nextBlob);
  }
}

function addItemToInventory(
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
  if (!def) return;

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
        if (remaining > 0) {
          log(logger, 'warn', 'job reward inventory full, dropping remainder', {
            itemId,
            dropped: remaining,
          });
        }

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
    log(logger, 'error', 'job reward addItem OCC failed', {
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

// ── matchJoin snapshot helper ───────────────────────────────────────────────

// Pošle aktivní jobs hráče jako sérii JOB_TASK_PROGRESS zpráv (klient pak
// re-buildne svůj UI mirror). Volá se v matchJoin po loadPlayerQuestBlob a
// `cleanupOrphanJobs`. Plný task metadata (title/description/objective) jsou
// v payloadu — klient nepotřebuje board open pro správný název v QuestPanelu.
export function sendActiveJobsSnapshot(
  state: WorldMatchState,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  blob: PlayerQuestBlob,
): void {
  for (const taskId of Object.keys(blob.jobs)) {
    const entry = blob.jobs[taskId];
    if (!entry) continue;
    const task = state.jobBoardTasks[taskId];
    if (!task) continue;
    const msg = buildProgressPayload(task, entry.progress, 'snapshot');
    dispatcher.broadcastMessage(Op.JOB_TASK_PROGRESS, JSON.stringify(msg), [presence]);
  }
}

// Phase 12: orphan cleanup — projde blob.jobs, vyčistí entries jejichž task už
// neexistuje (server restart fresh pool, fulfilled_max expirace). Pro každý
// orphan pošle klientu JOB_TASK_PROGRESS s event='expired' (klient odebere
// z UI s toastem) a perzistuje vyčištěný blob. Vrací aktualizovaný blob —
// volající ho použije pro následný snapshot.
export function cleanupOrphanJobs(
  state: WorldMatchState,
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  dispatcher: nkruntime.MatchDispatcher,
  presence: nkruntime.Presence,
  blob: PlayerQuestBlob,
): PlayerQuestBlob {
  const orphanIds: string[] = [];
  for (const taskId of Object.keys(blob.jobs)) {
    if (!state.jobBoardTasks[taskId]) orphanIds.push(taskId);
  }
  if (orphanIds.length === 0) return blob;

  const nextJobs = { ...blob.jobs };
  for (const id of orphanIds) {
    const entry = nextJobs[id];
    delete nextJobs[id];
    if (!entry) continue;
    // Klient odebere entry z UI. Title nemáme (task už neexistuje), klient
    // použije template_id jako fallback v toastu.
    const expiredMsg: JobTaskProgress = {
      task_id: id,
      template_id: entry.template_id,
      progress: entry.progress,
      submittable: false,
      event: 'expired',
    };
    dispatcher.broadcastMessage(Op.JOB_TASK_PROGRESS, JSON.stringify(expiredMsg), [presence]);
  }

  const nextBlob: PlayerQuestBlob = { ...blob, jobs: nextJobs };
  persistJobsBlob(state, nk, logger, presence.userId, nextBlob);
  log(logger, 'info', 'cleanupOrphanJobs', {
    userId: presence.userId.slice(0, 8),
    cleaned: orphanIds.length,
  });
  return nextBlob;
}
