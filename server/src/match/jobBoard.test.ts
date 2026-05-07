// Phase 12 job board unit testy. Pokrývají:
//   - katalog templatů (loader, weight)
//   - pickTemplateWeighted
//   - priorityForAge thresholds
//   - makeTaskFromTemplate counter-based ID
//   - isObjectiveSatisfied
//   - take / submit / abandon flow s mock storage

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyQuestBlob } from 'irij-shared/types';
import type {
  JobBoardTask,
  JobBoardTaskTemplate,
  PlayerQuestBlob,
} from 'irij-shared/types';

import {
  getAllJobBoardTemplates,
  getJobBoardTemplate,
  getJobBoardTemplatesForVillage,
} from '../lib/jobBoardTemplates.js';
import {
  handleJobTaskAbandon,
  handleJobTaskSubmit,
  handleJobTaskTaken,
  isObjectiveSatisfied,
  makeTaskFromTemplate,
  pickTemplateWeighted,
  priorityForAge,
  progressJobObjectivesKillMob,
  projectTaskView,
  seedInitialJobBoard,
} from './jobBoard.js';
import type { WorldMatchState } from './state.js';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as nkruntime.Logger;

function makePresence(userId: string): nkruntime.Presence {
  return { userId, sessionId: 's1', username: userId, node: 'n1' } as nkruntime.Presence;
}

function makeBaseState(blob: PlayerQuestBlob = emptyQuestBlob()): WorldMatchState {
  return {
    presencesByUserId: {
      user1: {
        presence: makePresence('user1'),
        position: { x: 22, y: 27 }, // adjacent to selka NPC (22,27)
      },
    },
    interactRequestLog: {},
    npcInstances: {
      'npc.selka_hospoda': {
        instanceId: 'npc.selka_hospoda',
        npcId: 'npc.selka_hospoda',
        position: { x: 22, y: 27 },
        lastChunk: '0,0',
      },
    },
    playerQuestBlobs: { user1: blob },
    playerQuestVersions: { user1: 'v1' },
    jobBoardTasks: {},
    jobBoardTasksByVillage: {},
    jobBoardCounter: 0,
  } as unknown as WorldMatchState;
}

function makeNk(initialBlob: PlayerQuestBlob = emptyQuestBlob(), inventory: any = null) {
  let storedQuest: PlayerQuestBlob = initialBlob;
  let storedInv: any = inventory ?? {
    inventory: Array.from({ length: 24 }, () => ({ item_id: null, quantity: 0 })),
    equipment: [],
  };
  const storageRead = vi.fn((reqs: Array<{ collection: string; userId: string }>) => {
    return reqs.map((r) => {
      if (r.collection === 'player_quests') {
        return {
          collection: 'player_quests',
          key: 'user1',
          userId: 'user1',
          value: storedQuest,
          version: 'v1',
        };
      }
      return {
        collection: r.collection,
        key: r.userId,
        userId: r.userId,
        value: storedInv,
        version: 'v1',
      };
    });
  });
  const storageWrite = vi.fn((writes: Array<{ collection: string; value: any }>) => {
    return writes.map((w) => {
      if (w.collection === 'player_quests') storedQuest = w.value;
      else if (w.collection === 'player_inventory') storedInv = w.value;
      return { version: 'v2' };
    });
  });
  return {
    nk: { storageRead, storageWrite } as unknown as nkruntime.Nakama,
    getQuest: () => storedQuest,
    getInv: () => storedInv,
    setInv: (v: any) => {
      storedInv = v;
    },
  };
}

function makeDispatcher() {
  const sent: Array<{ op: number; data: string; presences?: nkruntime.Presence[] }> = [];
  return {
    dispatcher: {
      broadcastMessage: vi.fn(
        (op: number, data: string, presences?: nkruntime.Presence[]) => {
          sent.push({ op, data, presences });
        },
      ),
    } as unknown as nkruntime.MatchDispatcher,
    sent,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Catalog ────────────────────────────────────────────────────────────────

describe('job board template catalog', () => {
  it('loads templates from JSON', () => {
    const all = getAllJobBoardTemplates();
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all.every((t) => typeof t.template_id === 'string')).toBe(true);
    expect(all.every((t) => typeof t.weight === 'number' && t.weight > 0)).toBe(true);
  });

  it('groups templates by village', () => {
    const blatiny = getJobBoardTemplatesForVillage('village.blatiny');
    expect(blatiny.length).toBeGreaterThanOrEqual(5);
    expect(blatiny.every((t) => t.village_id === 'village.blatiny')).toBe(true);
  });

  it('looks up template by id', () => {
    const t = getJobBoardTemplate('blatiny.kill_rats');
    expect(t).not.toBeNull();
    expect(t?.objective.type).toBe('kill_mob');
  });
});

// ── Pure helpers ───────────────────────────────────────────────────────────

describe('priorityForAge', () => {
  it('returns 1.0 below first threshold', () => {
    expect(priorityForAge(0)).toBe(1.0);
    expect(priorityForAge(1000)).toBe(1.0);
  });

  it('crosses through 1.2 / 1.5 / 2.0 thresholds', () => {
    // Thresholds (5/15/30 min @ 10Hz): 3000/9000/18000
    expect(priorityForAge(5 * 60 * 10)).toBe(1.2);
    expect(priorityForAge(15 * 60 * 10)).toBe(1.5);
    expect(priorityForAge(30 * 60 * 10)).toBe(2.0);
    expect(priorityForAge(99999999)).toBe(2.0);
  });
});

describe('pickTemplateWeighted', () => {
  it('returns null on empty list', () => {
    expect(pickTemplateWeighted([])).toBeNull();
  });

  it('picks based on weight distribution', () => {
    const t1 = { template_id: 't1', weight: 1 } as JobBoardTaskTemplate;
    const t2 = { template_id: 't2', weight: 9 } as JobBoardTaskTemplate;
    let t1Count = 0;
    let t2Count = 0;
    for (let i = 0; i < 1000; i++) {
      const pick = pickTemplateWeighted([t1, t2], () => Math.random());
      if (pick?.template_id === 't1') t1Count++;
      else t2Count++;
    }
    // t2 by mělo dominovat (přibližně 9:1).
    expect(t2Count).toBeGreaterThan(t1Count * 4);
  });
});

describe('isObjectiveSatisfied', () => {
  it('returns false when count not met', () => {
    expect(
      isObjectiveSatisfied({ type: 'kill_mob', target: 'mob.giant_rat', count: 3 }, {
        'kill_mob:mob.giant_rat': 2,
      }),
    ).toBe(false);
  });

  it('returns true when count met', () => {
    expect(
      isObjectiveSatisfied({ type: 'kill_mob', target: 'mob.giant_rat', count: 3 }, {
        'kill_mob:mob.giant_rat': 3,
      }),
    ).toBe(true);
  });

  it('handles deliver_item objective same way', () => {
    expect(
      isObjectiveSatisfied({ type: 'deliver_item', target: 'material.bone', count: 5 }, {
        'deliver_item:material.bone': 5,
      }),
    ).toBe(true);
  });
});

describe('makeTaskFromTemplate', () => {
  it('generates unique IDs via counter', () => {
    const state = makeBaseState();
    const template = getAllJobBoardTemplates()[0]!;
    const t1 = makeTaskFromTemplate(state, template, 100);
    const t2 = makeTaskFromTemplate(state, template, 100);
    expect(t1.task_id).not.toBe(t2.task_id);
    expect(t1.priority_bonus_multiplier).toBe(1.0);
    expect(t1.current_takers).toBe(0);
    expect(t1.fulfilled_count).toBe(0);
    expect(t1.taker_user_ids).toEqual([]);
  });
});

describe('seedInitialJobBoard', () => {
  it('populates pool from templates', () => {
    const state = makeBaseState();
    seedInitialJobBoard(state, 0);
    const taskCount = Object.keys(state.jobBoardTasks).length;
    expect(taskCount).toBeGreaterThan(0);
    expect(taskCount).toBeLessThanOrEqual(getAllJobBoardTemplates().length);
    expect(state.jobBoardTasksByVillage['village.blatiny']).toBeDefined();
  });
});

// ── Take / Submit / Abandon flow ──────────────────────────────────────────

function seedTask(state: WorldMatchState, overrides: Partial<JobBoardTask> = {}): JobBoardTask {
  const template = getJobBoardTemplate('blatiny.kill_rats')!;
  const task: JobBoardTask = {
    ...makeTaskFromTemplate(state, template, 0),
    ...overrides,
  };
  state.jobBoardTasks = { ...state.jobBoardTasks, [task.task_id]: task };
  state.jobBoardTasksByVillage = {
    ...state.jobBoardTasksByVillage,
    [task.village_id]: {
      ...(state.jobBoardTasksByVillage[task.village_id] ?? {}),
      [task.task_id]: true,
    },
  };
  return task;
}

describe('handleJobTaskTaken', () => {
  it('adds entry to player blob and bumps current_takers', () => {
    const state = makeBaseState();
    const task = seedTask(state);
    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskTaken(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    expect(state.jobBoardTasks[task.task_id]?.current_takers).toBe(1);
    expect(state.jobBoardTasks[task.task_id]?.taker_user_ids).toContain('user1');
    expect(getQuest().jobs[task.task_id]).toBeDefined();
    // Should have sent JOB_TASK_PROGRESS unicast + JOB_BOARD_UPDATED broadcast.
    expect(sent.find((s) => s.op === 63)).toBeTruthy(); // JOB_TASK_PROGRESS
    expect(sent.find((s) => s.op === 65)).toBeTruthy(); // JOB_BOARD_UPDATED
  });

  it('rejects with task_full + sends JOB_TASK_REJECTED when at max_concurrent_takers', () => {
    const state = makeBaseState();
    const task = seedTask(state, { current_takers: 5, max_concurrent_takers: 5 });
    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskTaken(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    expect(getQuest().jobs[task.task_id]).toBeUndefined();
    const rejectMsg = sent.find((s) => s.op === 78); // JOB_TASK_REJECTED
    expect(rejectMsg).toBeTruthy();
    const body = JSON.parse(rejectMsg!.data);
    expect(body.action).toBe('take');
    expect(body.reason).toBe('task_full');
    expect(body.task_id).toBe(task.task_id);
  });

  it('rejects with out_of_range when player too far', () => {
    const state = makeBaseState();
    state.presencesByUserId.user1!.position = { x: 0, y: 0 }; // far from NPC at (22,27)
    const task = seedTask(state);
    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskTaken(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    expect(getQuest().jobs[task.task_id]).toBeUndefined();
    const rejectMsg = sent.find((s) => s.op === 78);
    expect(rejectMsg).toBeTruthy();
    expect(JSON.parse(rejectMsg!.data).reason).toBe('out_of_range');
  });

  it('rejects with already_taken when player already has entry', () => {
    const state = makeBaseState();
    const task = seedTask(state, { current_takers: 1, taker_user_ids: ['user1'] });
    state.playerQuestBlobs.user1!.jobs = {
      [task.task_id]: {
        task_id: task.task_id,
        template_id: task.template_id,
        village_id: task.village_id,
        taken_at_tick: 0,
        state: 'active',
        progress: {},
      },
    };
    const { nk } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskTaken(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    const rejectMsg = sent.find((s) => s.op === 78);
    expect(rejectMsg).toBeTruthy();
    expect(JSON.parse(rejectMsg!.data).reason).toBe('already_taken');
  });

  it('JOB_TASK_PROGRESS posílaný po take obsahuje title + objective + event=taken', () => {
    const state = makeBaseState();
    const task = seedTask(state);
    const { nk } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskTaken(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    const progressMsg = sent.find((s) => s.op === 63);
    expect(progressMsg).toBeTruthy();
    const body = JSON.parse(progressMsg!.data);
    expect(body.event).toBe('taken');
    expect(body.title?.cs).toBe(task.title.cs);
    expect(body.description?.cs).toBe(task.description.cs);
    expect(body.objective?.target).toBe(task.objective.target);
  });
});

describe('progressJobObjectivesKillMob', () => {
  it('increments kill_mob counter and sends JOB_TASK_PROGRESS', () => {
    const state = makeBaseState();
    const task = seedTask(state);
    // Take task first.
    state.playerQuestBlobs.user1!.jobs = {
      [task.task_id]: {
        task_id: task.task_id,
        template_id: task.template_id,
        village_id: task.village_id,
        taken_at_tick: 0,
        state: 'active',
        progress: {},
      },
    };
    state.jobBoardTasks[task.task_id]!.taker_user_ids = ['user1'];
    state.jobBoardTasks[task.task_id]!.current_takers = 1;

    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    progressJobObjectivesKillMob(state, nk, mockLogger, dispatcher, makePresence('user1'), 'mob.giant_rat');

    expect(getQuest().jobs[task.task_id]?.progress['kill_mob:mob.giant_rat']).toBe(1);
    expect(sent.filter((s) => s.op === 63).length).toBe(1);
  });

  it('caps progress at objective.count', () => {
    const state = makeBaseState();
    const task = seedTask(state); // kill_rats: count=3
    state.playerQuestBlobs.user1!.jobs = {
      [task.task_id]: {
        task_id: task.task_id,
        template_id: task.template_id,
        village_id: task.village_id,
        taken_at_tick: 0,
        state: 'active',
        progress: { 'kill_mob:mob.giant_rat': 3 },
      },
    };
    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher } = makeDispatcher();

    progressJobObjectivesKillMob(state, nk, mockLogger, dispatcher, makePresence('user1'), 'mob.giant_rat');

    expect(getQuest().jobs[task.task_id]?.progress['kill_mob:mob.giant_rat']).toBe(3);
  });

  it('ignores tasks whose mob target does not match', () => {
    const state = makeBaseState();
    const task = seedTask(state); // mob.giant_rat
    state.playerQuestBlobs.user1!.jobs = {
      [task.task_id]: {
        task_id: task.task_id,
        template_id: task.template_id,
        village_id: task.village_id,
        taken_at_tick: 0,
        state: 'active',
        progress: {},
      },
    };
    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher } = makeDispatcher();

    progressJobObjectivesKillMob(state, nk, mockLogger, dispatcher, makePresence('user1'), 'mob.wolf');

    expect(getQuest().jobs[task.task_id]?.progress['kill_mob:mob.giant_rat']).toBeUndefined();
  });
});

describe('handleJobTaskSubmit', () => {
  it('rejects with not_taken when player has no entry', () => {
    const state = makeBaseState();
    const task = seedTask(state);
    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskSubmit(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    expect(getQuest().jobs_completed[task.task_id]).toBeUndefined();
    const rejectMsg = sent.find((s) => s.op === 78);
    expect(rejectMsg).toBeTruthy();
    expect(JSON.parse(rejectMsg!.data).reason).toBe('not_taken');
  });

  it('rejects kill_mob with objective_not_met when count not satisfied', () => {
    const state = makeBaseState();
    const task = seedTask(state);
    state.playerQuestBlobs.user1!.jobs = {
      [task.task_id]: {
        task_id: task.task_id,
        template_id: task.template_id,
        village_id: task.village_id,
        taken_at_tick: 0,
        state: 'active',
        progress: { 'kill_mob:mob.giant_rat': 1 }, // not enough (need 3)
      },
    };
    state.jobBoardTasks[task.task_id]!.taker_user_ids = ['user1'];
    state.jobBoardTasks[task.task_id]!.current_takers = 1;

    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskSubmit(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    expect(getQuest().jobs_completed[task.task_id]).toBeUndefined();
    expect(getQuest().jobs[task.task_id]).toBeDefined();
    const rejectMsg = sent.find((s) => s.op === 78);
    expect(rejectMsg).toBeTruthy();
    expect(JSON.parse(rejectMsg!.data).reason).toBe('objective_not_met');
  });

  it('completes kill_mob when satisfied — moves entry, increments fulfilled_count, broadcasts', () => {
    const state = makeBaseState();
    // Need presence to have skilly/atributy/sources for awardXp.
    state.presencesByUserId.user1!.skilly = [];
    state.presencesByUserId.user1!.atributy = [];
    state.presencesByUserId.user1!.sources = [];

    const task = seedTask(state);
    state.playerQuestBlobs.user1!.jobs = {
      [task.task_id]: {
        task_id: task.task_id,
        template_id: task.template_id,
        village_id: task.village_id,
        taken_at_tick: 0,
        state: 'active',
        progress: { 'kill_mob:mob.giant_rat': 3 },
      },
    };
    state.jobBoardTasks[task.task_id]!.taker_user_ids = ['user1'];
    state.jobBoardTasks[task.task_id]!.current_takers = 1;

    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskSubmit(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    expect(getQuest().jobs[task.task_id]).toBeUndefined();
    expect(getQuest().jobs_completed[task.task_id]).toBeDefined();
    // Reputation applied.
    expect(getQuest().reputation['village.blatiny']).toBeGreaterThanOrEqual(112);
    // JOB_TASK_COMPLETED unicast sent.
    expect(sent.find((s) => s.op === 64)).toBeTruthy();
  });

  it('rejects deliver_item with inventory_short when items missing (with detail)', () => {
    const state = makeBaseState();
    const template = getJobBoardTemplate('blatiny.deliver_bones')!;
    const task: JobBoardTask = {
      ...makeTaskFromTemplate(state, template, 0),
    };
    state.jobBoardTasks = { [task.task_id]: task };
    state.jobBoardTasksByVillage = {
      'village.blatiny': { [task.task_id]: true },
    };
    state.playerQuestBlobs.user1!.jobs = {
      [task.task_id]: {
        task_id: task.task_id,
        template_id: task.template_id,
        village_id: task.village_id,
        taken_at_tick: 0,
        state: 'active',
        progress: {},
      },
    };
    state.jobBoardTasks[task.task_id]!.taker_user_ids = ['user1'];
    state.jobBoardTasks[task.task_id]!.current_takers = 1;

    const inventory = {
      inventory: [
        { item_id: 'material.bone', quantity: 2 }, // need 5
        ...Array.from({ length: 23 }, () => ({ item_id: null, quantity: 0 })),
      ],
      equipment: [],
    };
    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1, inventory);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskSubmit(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    expect(getQuest().jobs_completed[task.task_id]).toBeUndefined();
    const rejectMsg = sent.find((s) => s.op === 78);
    expect(rejectMsg).toBeTruthy();
    const body = JSON.parse(rejectMsg!.data);
    expect(body.reason).toBe('inventory_short');
    expect(body.detail?.item_id).toBe('material.bone');
    expect(body.detail?.need).toBe(5);
    expect(body.detail?.have).toBe(2);
  });
});

describe('cleanupOrphanJobs', () => {
  it('removes blob.jobs entries whose task no longer exists + sends expired event', async () => {
    const { cleanupOrphanJobs } = await import('./jobBoard.js');
    const state = makeBaseState();
    // Player má v blobu task, který už neexistuje (post-restart, post-fulfilled_max).
    state.playerQuestBlobs.user1!.jobs = {
      'task.orphan': {
        task_id: 'task.orphan',
        template_id: 'blatiny.kill_rats',
        village_id: 'village.blatiny',
        taken_at_tick: 0,
        state: 'active',
        progress: { 'kill_mob:mob.giant_rat': 2 },
      },
    };
    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    const cleaned = cleanupOrphanJobs(
      state,
      nk,
      mockLogger,
      dispatcher,
      makePresence('user1'),
      state.playerQuestBlobs.user1!,
    );

    expect(cleaned.jobs['task.orphan']).toBeUndefined();
    expect(getQuest().jobs['task.orphan']).toBeUndefined();
    const expiredMsg = sent.find(
      (s) => s.op === 63 && JSON.parse(s.data).event === 'expired',
    );
    expect(expiredMsg).toBeTruthy();
  });

  it('keeps entries whose task still exists', async () => {
    const { cleanupOrphanJobs } = await import('./jobBoard.js');
    const state = makeBaseState();
    const task = seedTask(state);
    state.playerQuestBlobs.user1!.jobs = {
      [task.task_id]: {
        task_id: task.task_id,
        template_id: task.template_id,
        village_id: task.village_id,
        taken_at_tick: 0,
        state: 'active',
        progress: {},
      },
    };
    const { nk } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    const cleaned = cleanupOrphanJobs(
      state,
      nk,
      mockLogger,
      dispatcher,
      makePresence('user1'),
      state.playerQuestBlobs.user1!,
    );

    expect(cleaned.jobs[task.task_id]).toBeDefined();
    expect(sent.find((s) => s.op === 63)).toBeUndefined();
  });
});

describe('handleJobTaskAbandon — reject path', () => {
  it('rejects with not_taken when player has no entry', () => {
    const state = makeBaseState();
    const task = seedTask(state);
    const { nk } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskAbandon(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    const rejectMsg = sent.find((s) => s.op === 78);
    expect(rejectMsg).toBeTruthy();
    expect(JSON.parse(rejectMsg!.data).reason).toBe('not_taken');
  });

  it('on success sends JOB_TASK_PROGRESS with event=abandoned', () => {
    const state = makeBaseState();
    const task = seedTask(state);
    state.playerQuestBlobs.user1!.jobs = {
      [task.task_id]: {
        task_id: task.task_id,
        template_id: task.template_id,
        village_id: task.village_id,
        taken_at_tick: 0,
        state: 'active',
        progress: {},
      },
    };
    state.jobBoardTasks[task.task_id]!.taker_user_ids = ['user1'];
    state.jobBoardTasks[task.task_id]!.current_takers = 1;

    const { nk } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher, sent } = makeDispatcher();

    handleJobTaskAbandon(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    const abandoned = sent.find(
      (s) => s.op === 63 && JSON.parse(s.data).event === 'abandoned',
    );
    expect(abandoned).toBeTruthy();
  });
});

describe('handleJobTaskAbandon — success path', () => {
  it('removes entry from blob and decrements current_takers', () => {
    const state = makeBaseState();
    const task = seedTask(state);
    state.playerQuestBlobs.user1!.jobs = {
      [task.task_id]: {
        task_id: task.task_id,
        template_id: task.template_id,
        village_id: task.village_id,
        taken_at_tick: 0,
        state: 'active',
        progress: { 'kill_mob:mob.giant_rat': 1 },
      },
    };
    state.jobBoardTasks[task.task_id]!.taker_user_ids = ['user1'];
    state.jobBoardTasks[task.task_id]!.current_takers = 1;

    const { nk, getQuest } = makeNk(state.playerQuestBlobs.user1);
    const { dispatcher } = makeDispatcher();

    handleJobTaskAbandon(
      state,
      mockLogger,
      nk,
      dispatcher,
      makePresence('user1'),
      JSON.stringify({ task_id: task.task_id }),
      0,
    );

    expect(getQuest().jobs[task.task_id]).toBeUndefined();
    expect(state.jobBoardTasks[task.task_id]?.current_takers).toBe(0);
    expect(state.jobBoardTasks[task.task_id]?.taker_user_ids).toEqual([]);
  });
});

describe('projectTaskView', () => {
  it('marks taken_by_self when player has entry', () => {
    const state = makeBaseState();
    const task = seedTask(state);
    const blob = emptyQuestBlob();
    blob.jobs[task.task_id] = {
      task_id: task.task_id,
      template_id: task.template_id,
      village_id: task.village_id,
      taken_at_tick: 0,
      state: 'active',
      progress: { 'kill_mob:mob.giant_rat': 3 },
    };
    const view = projectTaskView(task, 'user1', blob);
    expect(view.taken_by_self).toBe(true);
    expect(view.self_submittable).toBe(true);
  });

  it('returns sane defaults for non-takers', () => {
    const state = makeBaseState();
    const task = seedTask(state);
    const view = projectTaskView(task, null, null);
    expect(view.taken_by_self).toBe(false);
    expect(view.self_submittable).toBe(false);
  });
});
