import { describe, expect, it } from 'vitest';

import { parseGatherRequest } from './gathering.js';
import { getAllResourceNodeDefs, getResourceNodeDef } from '../lib/recipes.js';

describe('parseGatherRequest', () => {
  it('accepts well-formed payload', () => {
    const r = parseGatherRequest({ resource_node_id: 'node.stone.kamenolom_001' });
    expect(r).not.toBeNull();
    expect(r?.resource_node_id).toBe('node.stone.kamenolom_001');
  });

  it('rejects missing field', () => {
    expect(parseGatherRequest({})).toBeNull();
    expect(parseGatherRequest({ foo: 'bar' })).toBeNull();
  });

  it('rejects empty string', () => {
    expect(parseGatherRequest({ resource_node_id: '' })).toBeNull();
  });

  it('rejects wrong type', () => {
    expect(parseGatherRequest({ resource_node_id: 42 })).toBeNull();
    expect(parseGatherRequest(null)).toBeNull();
  });
});

describe('Resource node catalog', () => {
  it('has at least 3 nodes', () => {
    const all = getAllResourceNodeDefs();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it('every node has matching resource_id, position and timing', () => {
    for (const node of getAllResourceNodeDefs()) {
      expect(node.id).toMatch(/^node\./);
      expect(node.resource_id).toMatch(/^material\./);
      expect(node.gather_time_ms).toBeGreaterThan(0);
      expect(node.yield_quantity).toBeGreaterThan(0);
      expect(node.respawn_min_s).toBeLessThanOrEqual(node.respawn_max_s);
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('resolves node by id', () => {
    const node = getResourceNodeDef('node.stone.kamenolom_001');
    expect(node).not.toBeNull();
    expect(node?.resource_id).toBe('material.stone.flint');
  });

  it('returns null for unknown node id', () => {
    expect(getResourceNodeDef('node.unknown')).toBeNull();
  });
});
