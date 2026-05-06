// Phase 11 quest engine unit testy. Mockujeme Nakama storage + dispatcher
// in-memory; testujeme prerequisites validation, state transitions, completion
// reward distribuci a knowledge/reputation gate flow.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyQuestBlob } from 'irij-shared/types';
import type { PlayerQuestBlob } from 'irij-shared/types';

import { getAllQuestObjects, getAllQuests, getQuestDef, getQuestObjectDef } from '../lib/quests.js';
import {
  changeReputation,
  checkOptionVisibility,
  getQuestBlob,
  progressObjective,
  tryStartQuest,
  unlockKnowledge,
} from './quest.js';
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

// Minimal stub state — quest engine přistupuje jen k `playerQuestBlobs` /
// `playerQuestVersions` / `npcInstances` / `presencesByUserId`. Ostatní fieldy
// nejsou potřeba pro unit testy. Cast přes `as unknown` zabrání TS errors za
// chybějící fieldy bez vlivu na runtime cestu.
function makeState(blob: PlayerQuestBlob = emptyQuestBlob()): WorldMatchState {
  return {
    playerQuestBlobs: { user1: blob },
    playerQuestVersions: { user1: 'v1' },
    npcInstances: {
      'npc.kovar_blatiny': {
        instanceId: 'npc.kovar_blatiny',
        npcId: 'npc.kovar_blatiny',
        position: { x: 27, y: 25 },
        lastChunk: '0,0',
      },
    },
    presencesByUserId: {
      user1: { presence: makePresence('user1') },
    },
  } as unknown as WorldMatchState;
}

function makeNk(initialBlob: PlayerQuestBlob = emptyQuestBlob()) {
  let storedBlob = initialBlob;
  const storageRead = vi.fn().mockImplementation(() => [
    {
      collection: 'player_quests',
      key: 'user1',
      userId: 'user1',
      value: storedBlob,
      version: 'v1',
    },
  ]);
  const storageWrite = vi.fn().mockImplementation((writes: Array<{ value: PlayerQuestBlob }>) => {
    if (writes[0]) storedBlob = writes[0].value;
    return [{ version: `v${Math.random().toString(36).slice(2, 6)}` }];
  });
  return {
    nk: { storageRead, storageWrite } as unknown as nkruntime.Nakama,
    getStored: () => storedBlob,
  };
}

function makeDispatcher() {
  const sent: Array<{ op: number; data: string }> = [];
  return {
    dispatcher: {
      broadcastMessage: vi
        .fn()
        .mockImplementation((op: number, data: string) => sent.push({ op, data })),
    } as unknown as nkruntime.MatchDispatcher,
    sent,
  };
}

describe('quest catalog', () => {
  it('loads synovec_kovar quest', () => {
    const def = getQuestDef('quest.synovec_kovar');
    expect(def).not.toBeNull();
    expect(def?.steps.length).toBe(3);
    expect(def?.steps[0]?.objective.type).toBe('interact_with_object');
    expect(def?.steps[1]?.objective.type).toBe('kill_mob');
    expect(def?.steps[2]?.objective.type).toBe('talk_to_npc');
  });

  it('loads bloody_amulet quest object', () => {
    const obj = getQuestObjectDef('object.bloody_amulet');
    expect(obj).not.toBeNull();
    expect(obj?.consume_on_interact).toBe(true);
  });

  it('returns at least 1 quest in catalog', () => {
    expect(getAllQuests().length).toBeGreaterThan(0);
    expect(getAllQuestObjects().length).toBeGreaterThan(0);
  });
});

describe('tryStartQuest', () => {
  it('starts quest with no prerequisites', () => {
    const state = makeState();
    const { nk } = makeNk();
    const result = tryStartQuest(state, nk, mockLogger, 'user1', 'quest.synovec_kovar');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.progress.current_step_id).toBe('find_clue_in_swamp');
      expect(result.progress.state).toBe('active');
    }
    const blob = getQuestBlob(state, 'user1');
    expect(blob.active['quest.synovec_kovar']).toBeDefined();
  });

  it('rejects unknown quest', () => {
    const state = makeState();
    const { nk } = makeNk();
    const result = tryStartQuest(state, nk, mockLogger, 'user1', 'quest.nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_quest');
  });

  it('rejects already active quest', () => {
    const blob = emptyQuestBlob();
    blob.active['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      state: 'active',
      current_step_id: 'find_clue_in_swamp',
      step_progress: {},
      started_at: '2026-05-06T10:00:00Z',
    };
    const state = makeState(blob);
    const { nk } = makeNk(blob);
    const result = tryStartQuest(state, nk, mockLogger, 'user1', 'quest.synovec_kovar');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_active');
  });

  it('rejects already completed (lockout_after_complete=true)', () => {
    const blob = emptyQuestBlob();
    blob.completed['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      completed_at: '2026-05-06T11:00:00Z',
    };
    const state = makeState(blob);
    const { nk } = makeNk(blob);
    const result = tryStartQuest(state, nk, mockLogger, 'user1', 'quest.synovec_kovar');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_completed');
  });
});

describe('progressObjective — kill_mob', () => {
  it('does nothing if no active quest matches', () => {
    const state = makeState();
    const { nk } = makeNk();
    const { dispatcher, sent } = makeDispatcher();
    progressObjective(state, nk, mockLogger, dispatcher, makePresence('user1'), {
      type: 'kill_mob',
      mob_id: 'mob.wolf',
    });
    expect(sent.length).toBe(0);
  });

  it('does not advance when at find_clue_in_swamp step (interact objective)', () => {
    const blob = emptyQuestBlob();
    blob.active['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      state: 'active',
      current_step_id: 'find_clue_in_swamp',
      step_progress: {},
      started_at: '2026-05-06T10:00:00Z',
    };
    const state = makeState(blob);
    const { nk } = makeNk(blob);
    const { dispatcher } = makeDispatcher();
    progressObjective(state, nk, mockLogger, dispatcher, makePresence('user1'), {
      type: 'kill_mob',
      mob_id: 'mob.hastrman',
    });
    const updated = getQuestBlob(state, 'user1').active['quest.synovec_kovar'];
    expect(updated?.current_step_id).toBe('find_clue_in_swamp');
  });

  it('advances to return_to_kovar after killing hastrman at defeat step', () => {
    const blob = emptyQuestBlob();
    blob.active['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      state: 'active',
      current_step_id: 'defeat_hastrman',
      step_progress: {},
      started_at: '2026-05-06T10:00:00Z',
    };
    const state = makeState(blob);
    const { nk } = makeNk(blob);
    const { dispatcher, sent } = makeDispatcher();
    progressObjective(state, nk, mockLogger, dispatcher, makePresence('user1'), {
      type: 'kill_mob',
      mob_id: 'mob.hastrman',
    });
    const updated = getQuestBlob(state, 'user1').active['quest.synovec_kovar'];
    expect(updated?.current_step_id).toBe('return_to_kovar');
    // QUEST_PROGRESS event 'advanced' broadcastnut.
    expect(sent.length).toBeGreaterThan(0);
  });

  it('ignores wrong mob kill at defeat step', () => {
    const blob = emptyQuestBlob();
    blob.active['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      state: 'active',
      current_step_id: 'defeat_hastrman',
      step_progress: {},
      started_at: '2026-05-06T10:00:00Z',
    };
    const state = makeState(blob);
    const { nk } = makeNk(blob);
    const { dispatcher } = makeDispatcher();
    progressObjective(state, nk, mockLogger, dispatcher, makePresence('user1'), {
      type: 'kill_mob',
      mob_id: 'mob.wolf',
    });
    const updated = getQuestBlob(state, 'user1').active['quest.synovec_kovar'];
    expect(updated?.current_step_id).toBe('defeat_hastrman');
  });
});

describe('progressObjective — interact_with_object', () => {
  it('advances find_clue_in_swamp → defeat_hastrman after amulet interact', () => {
    const blob = emptyQuestBlob();
    blob.active['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      state: 'active',
      current_step_id: 'find_clue_in_swamp',
      step_progress: {},
      started_at: '2026-05-06T10:00:00Z',
    };
    const state = makeState(blob);
    const { nk } = makeNk(blob);
    const { dispatcher } = makeDispatcher();
    progressObjective(state, nk, mockLogger, dispatcher, makePresence('user1'), {
      type: 'interact_with_object',
      object_id: 'object.bloody_amulet',
    });
    const updated = getQuestBlob(state, 'user1').active['quest.synovec_kovar'];
    expect(updated?.current_step_id).toBe('defeat_hastrman');
  });
});

describe('quest completion — full flow with rewards', () => {
  it('moves quest to completed map + applies knowledge + reputation', () => {
    const blob = emptyQuestBlob();
    blob.active['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      state: 'active',
      current_step_id: 'return_to_kovar',
      step_progress: {},
      started_at: '2026-05-06T10:00:00Z',
    };
    // Inject minimal skill/atribut state so awardXp doesn't crash on reading.
    const state = makeState(blob);
    (state.presencesByUserId as Record<string, unknown>)['user1'] = {
      presence: makePresence('user1'),
      skilly: [
        { name: 'melee', xp: 0, level: 1 },
        { name: 'thievery', xp: 0, level: 1 },
      ],
      atributy: [{ name: 'vitality', xp: 0, level: 1 }],
      sources: [],
      totalLevel: 21,
      totalXp: 0,
    };

    const { nk } = makeNk(blob);
    // Storage write also happens for inventory + skills; mock returning ack with version.
    const writeMock = nk.storageWrite as ReturnType<typeof vi.fn>;
    writeMock.mockImplementation(() => [{ version: 'v2' }]);
    // storageRead must handle multi-collection reads (player_quests + player_inventory).
    const inventoryBlob = {
      inventory: Array.from({ length: 24 }, (_, i) => ({
        slot_index: i,
        item_id: null as string | null,
        quantity: 0,
      })),
      satchel: [],
      equipment: [],
    };
    let storedQuestBlob: PlayerQuestBlob = blob;
    (nk.storageRead as ReturnType<typeof vi.fn>).mockImplementation(
      (reads: Array<{ collection: string }>) => {
        return reads.map((r) => {
          if (r.collection === 'player_quests') {
            return {
              collection: 'player_quests',
              key: 'user1',
              userId: 'user1',
              value: storedQuestBlob,
              version: 'v1',
            };
          }
          if (r.collection === 'player_inventory') {
            return {
              collection: 'player_inventory',
              key: 'user1',
              userId: 'user1',
              value: inventoryBlob,
              version: 'v1',
            };
          }
          return null;
        }).filter(Boolean);
      },
    );
    writeMock.mockImplementation((writes: Array<{ collection: string; value: unknown }>) => {
      for (const w of writes) {
        if (w.collection === 'player_quests') storedQuestBlob = w.value as PlayerQuestBlob;
      }
      return writes.map(() => ({ version: 'v2' }));
    });

    const { dispatcher, sent } = makeDispatcher();
    progressObjective(state, nk, mockLogger, dispatcher, makePresence('user1'), {
      type: 'talk_to_npc',
      npc_id: 'npc.kovar_blatiny',
      quest_id: 'quest.synovec_kovar',
      step_id: 'return_to_kovar',
    });

    const finalBlob = getQuestBlob(state, 'user1');
    expect(finalBlob.active['quest.synovec_kovar']).toBeUndefined();
    expect(finalBlob.completed['quest.synovec_kovar']).toBeDefined();
    expect(finalBlob.knowledge).toContain('lore.polednice_origin');
    expect(finalBlob.reputation['village.blatiny']).toBe(300); // 100 default + 200

    // QUEST_COMPLETED broadcastnut.
    const completedMsg = sent.find((s) => s.op === 61);
    expect(completedMsg).toBeDefined();
  });
});

describe('unlockKnowledge / changeReputation', () => {
  it('unlockKnowledge is idempotent', () => {
    const state = makeState();
    const { nk } = makeNk();
    const a = unlockKnowledge(state, nk, mockLogger, 'user1', 'lore.test');
    const b = unlockKnowledge(state, nk, mockLogger, 'user1', 'lore.test');
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(getQuestBlob(state, 'user1').knowledge.filter((k) => k === 'lore.test').length).toBe(1);
  });

  it('changeReputation accumulates delta from default', () => {
    const state = makeState();
    const { nk } = makeNk();
    const v1 = changeReputation(state, nk, mockLogger, 'user1', 'village.blatiny', 50);
    expect(v1).toBe(150); // 100 default + 50
    const v2 = changeReputation(state, nk, mockLogger, 'user1', 'village.blatiny', -10);
    expect(v2).toBe(140);
  });

  it('changeReputation clamps at 1000 max', () => {
    const state = makeState();
    const { nk } = makeNk();
    const v = changeReputation(state, nk, mockLogger, 'user1', 'village.blatiny', 5000);
    expect(v).toBe(1000);
  });
});

describe('checkOptionVisibility — knowledge gate after quest complete', () => {
  it('knowledge gate becomes visible after completing quest with knowledge reward', () => {
    const blob = emptyQuestBlob();
    blob.knowledge.push('lore.polednice_origin');
    expect(
      checkOptionVisibility(blob, { knowledge: 'lore.polednice_origin' }),
    ).toBe(true);
  });
});
