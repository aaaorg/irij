import { describe, it, expect } from 'vitest';
import type { DialogOption } from 'irij-shared/types';

import {
  isOptionVisible,
  parseDialogChooseRequest,
  parseInteractNpcRequest,
} from './dialog.js';

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
    expect(isOptionVisible(opt)).toBe(true);
  });

  it('returns false when show_if requires knowledge (Phase 11+ stub)', () => {
    const opt: DialogOption = {
      id: 'a',
      text: { cs: 'A' },
      next: 'b',
      show_if: { knowledge: 'lore.polednice_rumor' },
    };
    // Phase 9: gated options jsou vždy hidden, dokud není implementovaný knowledge check.
    expect(isOptionVisible(opt)).toBe(false);
  });

  it('returns false when show_if requires reputation_min (Phase 11+ stub)', () => {
    const opt: DialogOption = {
      id: 'a',
      text: { cs: 'A' },
      next: 'b',
      show_if: { reputation_min: 100 },
    };
    expect(isOptionVisible(opt)).toBe(false);
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
