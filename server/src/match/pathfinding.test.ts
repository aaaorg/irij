import { describe, expect, it } from 'vitest';
import type { Position } from 'irij-shared/types';
import { findPath } from './pathfinding.js';
import { maskFromTiledMap, isWalkable, type WalkableMask } from './walkable.js';

function makeOpenMask(w: number, h: number): WalkableMask {
  return maskFromTiledMap({
    width: w,
    height: h,
    layers: [
      {
        name: 'terrain',
        type: 'tilelayer',
        width: w,
        height: h,
        data: new Array(w * h).fill(1),
      },
    ],
  });
}

function makeWallMask(): WalkableMask {
  // 10×10, row y=5 is wall (gid=3) except x=0
  const data = new Array(100).fill(1);
  for (let x = 1; x < 10; x++) {
    data[5 * 10 + x] = 3;
  }
  return maskFromTiledMap({
    width: 10,
    height: 10,
    layers: [
      { name: 'terrain', type: 'tilelayer', width: 10, height: 10, data },
    ],
  });
}

describe('findPath', () => {
  const mask = makeOpenMask(10, 10);

  it('returns [] when from === to', () => {
    expect(findPath(mask, { x: 5, y: 5 }, { x: 5, y: 5 })).toEqual([]);
  });

  it('finds cardinal path', () => {
    const path = findPath(mask, { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3);
    expect(path![path!.length - 1]).toEqual({ x: 3, y: 0 });
  });

  it('finds diagonal path (octile cost)', () => {
    const path = findPath(mask, { x: 0, y: 0 }, { x: 3, y: 3 });
    expect(path).not.toBeNull();
    // pure diagonal = 3 steps
    expect(path!.length).toBe(3);
    expect(path![2]).toEqual({ x: 3, y: 3 });
  });

  it('finds mixed cardinal+diagonal path', () => {
    const path = findPath(mask, { x: 0, y: 0 }, { x: 5, y: 3 });
    expect(path).not.toBeNull();
    // optimal 8-dir path: 3 diagonal + 2 cardinal = 5 steps
    expect(path!.length).toBe(5);
    expect(path![path!.length - 1]).toEqual({ x: 5, y: 3 });
  });

  it('respects MAX_PATH_LENGTH cap', () => {
    const bigMask = makeOpenMask(100, 100);
    const result = findPath(bigMask, { x: 0, y: 0 }, { x: 99, y: 0 }, {
      maxPathLength: 10,
    });
    expect(result).toBeNull();
  });

  it('returns null for unreachable target (surrounded by walls)', () => {
    // 5×5 mask, center tile (2,2) walkable but surrounded by non-walkable
    const data = new Array(25).fill(3); // all water
    data[2 * 5 + 2] = 1; // center walkable
    data[0] = 1; // (0,0) walkable
    const isolated = maskFromTiledMap({
      width: 5,
      height: 5,
      layers: [
        { name: 'terrain', type: 'tilelayer', width: 5, height: 5, data },
      ],
    });
    expect(findPath(isolated, { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
  });

  it('returns null for non-walkable target', () => {
    const data = new Array(25).fill(1);
    data[2 * 5 + 2] = 3; // (2,2) water
    const m = maskFromTiledMap({
      width: 5,
      height: 5,
      layers: [
        { name: 'terrain', type: 'tilelayer', width: 5, height: 5, data },
      ],
    });
    expect(findPath(m, { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
  });

  it('returns null for out-of-bounds target', () => {
    expect(findPath(mask, { x: 0, y: 0 }, { x: 50, y: 50 })).toBeNull();
  });

  it('does not cut corners (no diagonal through L-wall)', () => {
    // 5×5, wall at (2,1) and (1,2) forming L — diagonal (1,1)→(2,2) blocked
    const data = new Array(25).fill(1);
    data[1 * 5 + 2] = 3; // (2,1) wall
    data[2 * 5 + 1] = 3; // (1,2) wall
    const m = maskFromTiledMap({
      width: 5,
      height: 5,
      layers: [
        { name: 'terrain', type: 'tilelayer', width: 5, height: 5, data },
      ],
    });
    const path = findPath(m, { x: 1, y: 1 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    // Cannot go diagonally (1,1)→(2,2) because (2,1) and (1,2) are walls.
    // Must go around: at least 3+ steps
    expect(path!.length).toBeGreaterThan(1);
    // Verify no step is a diagonal that cuts the corner
    let prev: Position = { x: 1, y: 1 };
    for (const step of path!) {
      const dx = step.x - prev.x;
      const dy = step.y - prev.y;
      if (dx !== 0 && dy !== 0) {
        // diagonal step: both adjacent cardinal tiles must be walkable
        expect(isWalkable(m, prev.x + dx, prev.y)).toBe(true);
        expect(isWalkable(m, prev.x, prev.y + dy)).toBe(true);
      }
      prev = step;
    }
  });

  it('navigates around wall using opening', () => {
    const m = makeWallMask();
    // from (5,3) to (5,7), wall at y=5 (x=1..9), opening at x=0
    const path = findPath(m, { x: 5, y: 3 }, { x: 5, y: 7 });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 5, y: 7 });
  });

  it('returns null when maxNodes exceeded', () => {
    const bigMask = makeOpenMask(50, 50);
    const result = findPath(bigMask, { x: 0, y: 0 }, { x: 49, y: 49 }, {
      maxNodes: 5,
    });
    expect(result).toBeNull();
  });

  it('path does not include starting position', () => {
    const path = findPath(mask, { x: 2, y: 2 }, { x: 4, y: 2 });
    expect(path).not.toBeNull();
    expect(path![0]).not.toEqual({ x: 2, y: 2 });
  });
});
