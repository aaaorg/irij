import { describe, it, expect } from 'vitest';
import type { DialogOption } from 'irij-shared/types';
import { emptyQuestBlob } from 'irij-shared/types';

import {
  isOptionVisible,
  parseDialogChooseRequest,
  parseInteractNpcRequest,
} from './dialog.js';
import { checkOptionVisibility } from './quest.js';

// Test stub state — minimal subset needed for isOptionVisible to call
// getQuestBlob / checkOptionVisibility. We only need playerQuestBlobs.
function makeState(blob = emptyQuestBlob()) {
  return {
    playerQuestBlobs: { 'user1': blob },
    playerQuestVersions: {},
  } as unknown as Parameters<typeof isOptionVisible>[1];
}

describe('parseInteractNpcRequest', () => {
  it('parses valid talk request', () => {
    const r = parseInteractNpcRequest({ npc_id: 'npc.kovar_blatiny', action: 'talk' });
    expect(r).toEqual({ npc_id: 'npc.kovar_blatiny', action: 'talk' });
  });

  it('parses shop action', () => {
    const r = parseInteractNpcRequest({ npc_id: 'npc.kovar_blatiny', action: 'shop' });
    expect(r?.action).toBe('shop');
  });

  it('rejects empty npc_id', () => {
    expect(parseInteractNpcRequest({ npc_id: '', action: 'talk' })).toBeNull();
  });

  it('rejects non-string npc_id', () => {
    expect(parseInteractNpcRequest({ npc_id: 123, action: 'talk' })).toBeNull();
  });

  it('rejects unknown action', () => {
    expect(parseInteractNpcRequest({ npc_id: 'npc.x', action: 'attack' })).toBeNull();
  });

  it('rejects missing fields', () => {
    expect(parseInteractNpcRequest({ npc_id: 'npc.x' })).toBeNull();
    expect(parseInteractNpcRequest({ action: 'talk' })).toBeNull();
  });

  it('rejects null', () => {
    expect(parseInteractNpcRequest(null)).toBeNull();
  });
});

describe('parseDialogChooseRequest', () => {
  it('parses valid request', () => {
    const r = parseDialogChooseRequest({
      dialog_id: 'kovar_blatiny',
      node_id: 'root',
      option_id: 'shop',
    });
    expect(r).toEqual({ dialog_id: 'kovar_blatiny', node_id: 'root', option_id: 'shop' });
  });

  it('rejects empty fields', () => {
    expect(parseDialogChooseRequest({ dialog_id: '', node_id: 'root', option_id: 'shop' })).toBeNull();
    expect(parseDialogChooseRequest({ dialog_id: 'd', node_id: '', option_id: 'shop' })).toBeNull();
  });

  it('rejects missing fields', () => {
    expect(parseDialogChooseRequest({ dialog_id: 'd', node_id: 'n' })).toBeNull();
  });

  it('rejects non-object payload', () => {
    expect(parseDialogChooseRequest('string')).toBeNull();
    expect(parseDialogChooseRequest(42)).toBeNull();
  });
});

describe('isOptionVisible', () => {
  it('returns true for option without show_if', () => {
    const opt: DialogOption = {
      id: 'a',
      text: { cs: 'A' },
      next: 'b',
    };
    expect(isOptionVisible(opt, makeState(), 'user1')).toBe(true);
  });

  it('hides option when knowledge gate is missing', () => {
    const opt: DialogOption = {
      id: 'a',
      text: { cs: 'A' },
      next: 'b',
      show_if: { knowledge: 'lore.polednice_rumor' },
    };
    expect(isOptionVisible(opt, makeState(), 'user1')).toBe(false);
  });

  it('shows option when knowledge gate is satisfied', () => {
    const opt: DialogOption = {
      id: 'a',
      text: { cs: 'A' },
      next: 'b',
      show_if: { knowledge: 'lore.polednice_rumor' },
    };
    const blob = emptyQuestBlob();
    blob.knowledge.push('lore.polednice_rumor');
    expect(isOptionVisible(opt, makeState(blob), 'user1')).toBe(true);
  });

  it('hides option when reputation_min not met (default 100, requires 300)', () => {
    const opt: DialogOption = {
      id: 'a',
      text: { cs: 'A' },
      next: 'b',
      show_if: { reputation_min: { village_id: 'village.blatiny', value: 300 } },
    };
    expect(isOptionVisible(opt, makeState(), 'user1')).toBe(false);
  });

  it('shows option when reputation_min satisfied', () => {
    const opt: DialogOption = {
      id: 'a',
      text: { cs: 'A' },
      next: 'b',
      show_if: { reputation_min: { village_id: 'village.blatiny', value: 100 } },
    };
    const blob = emptyQuestBlob();
    blob.reputation['village.blatiny'] = 150;
    expect(isOptionVisible(opt, makeState(blob), 'user1')).toBe(true);
  });
});

describe('checkOptionVisibility — quest_state gate', () => {
  it('not_started: visible when no progress recorded', () => {
    const blob = emptyQuestBlob();
    expect(
      checkOptionVisibility(blob, {
        quest_state: { quest_id: 'quest.synovec_kovar', state: 'not_started' },
      }),
    ).toBe(true);
  });

  it('not_started: hidden when quest active', () => {
    const blob = emptyQuestBlob();
    blob.active['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      state: 'active',
      current_step_id: 'find_clue_in_swamp',
      step_progress: {},
      started_at: '2026-05-06T10:00:00Z',
    };
    expect(
      checkOptionVisibility(blob, {
        quest_state: { quest_id: 'quest.synovec_kovar', state: 'not_started' },
      }),
    ).toBe(false);
  });

  it('active + current_step_id matches', () => {
    const blob = emptyQuestBlob();
    blob.active['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      state: 'active',
      current_step_id: 'return_to_kovar',
      step_progress: {},
      started_at: '2026-05-06T10:00:00Z',
    };
    expect(
      checkOptionVisibility(blob, {
        quest_state: {
          quest_id: 'quest.synovec_kovar',
          state: 'active',
          current_step_id: 'return_to_kovar',
        },
      }),
    ).toBe(true);
  });

  it('active + not_current_step_id excludes return step', () => {
    const blob = emptyQuestBlob();
    blob.active['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      state: 'active',
      current_step_id: 'return_to_kovar',
      step_progress: {},
      started_at: '2026-05-06T10:00:00Z',
    };
    expect(
      checkOptionVisibility(blob, {
        quest_state: {
          quest_id: 'quest.synovec_kovar',
          state: 'active',
          not_current_step_id: 'return_to_kovar',
        },
      }),
    ).toBe(false);
  });

  it('active + not_current_step_id allows mid-step', () => {
    const blob = emptyQuestBlob();
    blob.active['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      state: 'active',
      current_step_id: 'find_clue_in_swamp',
      step_progress: {},
      started_at: '2026-05-06T10:00:00Z',
    };
    expect(
      checkOptionVisibility(blob, {
        quest_state: {
          quest_id: 'quest.synovec_kovar',
          state: 'active',
          not_current_step_id: 'return_to_kovar',
        },
      }),
    ).toBe(true);
  });

  it('completed: only visible after completion', () => {
    const blob = emptyQuestBlob();
    expect(
      checkOptionVisibility(blob, {
        quest_state: { quest_id: 'quest.synovec_kovar', state: 'completed' },
      }),
    ).toBe(false);
    blob.completed['quest.synovec_kovar'] = {
      quest_id: 'quest.synovec_kovar',
      completed_at: '2026-05-06T11:00:00Z',
    };
    expect(
      checkOptionVisibility(blob, {
        quest_state: { quest_id: 'quest.synovec_kovar', state: 'completed' },
      }),
    ).toBe(true);
  });
});

// ── NPC + dialog catalog integrity ──────────────────────────────────────────

import { getAllNpcs, getDialogTree, getNpcDef } from '../lib/dialogs.js';

describe('NPC + dialog catalog', () => {
  it('loads kovar_blatiny NPC', () => {
    const npc = getNpcDef('npc.kovar_blatiny');
    expect(npc).not.toBeNull();
    expect(npc?.flags.talkable).toBe(true);
    expect(npc?.dialog_id).toBe('kovar_blatiny');
  });

  it('loads kovar_blatiny dialog tree with root + shop nodes', () => {
    const tree = getDialogTree('kovar_blatiny');
    expect(tree).not.toBeNull();
    expect(tree?.nodes['root']).toBeDefined();
    expect(tree?.nodes['shop_node']).toBeDefined();
    expect(tree?.root_node_id).toBe('root');
  });

  it('shop option in root node has give_item effect', () => {
    const tree = getDialogTree('kovar_blatiny');
    const root = tree?.nodes['root'];
    const shopOpt = root?.options.find((o) => o.id === 'shop');
    expect(shopOpt).toBeDefined();
    expect(shopOpt?.effects?.[0]?.type).toBe('give_item');
    if (shopOpt?.effects?.[0]?.type === 'give_item') {
      expect(shopOpt.effects[0].item_id).toBe('consumable.whetstone.t1');
    }
  });

  it('returns at least 2 NPCs for catalog', () => {
    const all = getAllNpcs();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('every NPC dialog_id resolves to a tree', () => {
    for (const npc of getAllNpcs()) {
      if (!npc.dialog_id) continue;
      const tree = getDialogTree(npc.dialog_id);
      expect(tree, `NPC ${npc.id} → dialog_id ${npc.dialog_id}`).not.toBeNull();
    }
  });

  it('every dialog tree root_node_id exists in nodes', () => {
    const tree = getDialogTree('kovar_blatiny');
    expect(tree?.nodes[tree!.root_node_id]).toBeDefined();
  });

  it('every option.next either is null or exists in nodes', () => {
    const tree = getDialogTree('kovar_blatiny');
    if (!tree) throw new Error('tree missing');
    for (const nodeId of Object.keys(tree.nodes)) {
      const node = tree.nodes[nodeId]!;
      for (const opt of node.options) {
        if (opt.next === null) continue;
        expect(tree.nodes[opt.next], `node ${nodeId} option ${opt.id} → ${opt.next}`).toBeDefined();
      }
    }
  });
});
