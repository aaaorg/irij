import { describe, expect, it } from 'vitest';
import {
  maskFromTiledMap,
  isInBounds,
  isWalkable,
  nearestWalkable,
  countWalkable,
} from './walkable.js';

function makeTiledMap(
  width: number,
  height: number,
  data: number[],
  layerName = 'terrain',
) {
  return {
    width,
    height,
    layers: [
      { name: layerName, type: 'tilelayer', width, height, data },
    ],
  };
}

describe('maskFromTiledMap', () => {
  it('creates walkable mask from valid map', () => {
    const data = [1, 1, 2, 3, 1, 2, 1, 3, 1]; // 3×3, gid 3 = water
    const mask = maskFromTiledMap(makeTiledMap(3, 3, data));
    expect(mask.width).toBe(3);
    expect(mask.height).toBe(3);
    expect(countWalkable(mask)).toBe(7); // 9 - 2 water tiles
  });

  it('treats gid 0 as non-walkable (void)', () => {
    const data = [0, 1, 1, 1];
    const mask = maskFromTiledMap(makeTiledMap(2, 2, data));
    expect(isWalkable(mask, 0, 0)).toBe(false);
    expect(isWalkable(mask, 1, 0)).toBe(true);
  });

  it('marks gid 3 (water) as non-walkable', () => {
    const data = [1, 3, 2, 1];
    const mask = maskFromTiledMap(makeTiledMap(2, 2, data));
    expect(isWalkable(mask, 1, 0)).toBe(false);
    expect(isWalkable(mask, 0, 1)).toBe(true);
  });

  it('throws when terrain layer is missing', () => {
    expect(() =>
      maskFromTiledMap({
        width: 2,
        height: 2,
        layers: [
          { name: 'objects', type: 'tilelayer', width: 2, height: 2, data: [1, 1, 1, 1] },
        ],
      }),
    ).toThrow(/terrain/);
  });

  it('handles empty layers array', () => {
    expect(() =>
      maskFromTiledMap({ width: 2, height: 2, layers: [] }),
    ).toThrow(/terrain/);
  });
});

describe('isInBounds', () => {
  const mask = maskFromTiledMap(makeTiledMap(5, 5, new Array(25).fill(1)));

  it('returns true for valid coordinates', () => {
    expect(isInBounds(mask, 0, 0)).toBe(true);
    expect(isInBounds(mask, 4, 4)).toBe(true);
    expect(isInBounds(mask, 2, 3)).toBe(true);
  });

  it('returns false for negative coordinates', () => {
    expect(isInBounds(mask, -1, 0)).toBe(false);
    expect(isInBounds(mask, 0, -1)).toBe(false);
  });

  it('returns false for coordinates at or beyond bounds', () => {
    expect(isInBounds(mask, 5, 0)).toBe(false);
    expect(isInBounds(mask, 0, 5)).toBe(false);
    expect(isInBounds(mask, 50, 50)).toBe(false);
  });
});

describe('isWalkable', () => {
  const data = [1, 3, 1, 1]; // 2×2, (1,0) = water
  const mask = maskFromTiledMap(makeTiledMap(2, 2, data));

  it('returns true for walkable tile', () => {
    expect(isWalkable(mask, 0, 0)).toBe(true);
  });

  it('returns false for non-walkable tile', () => {
    expect(isWalkable(mask, 1, 0)).toBe(false);
  });

  it('returns false for out-of-bounds', () => {
    expect(isWalkable(mask, 10, 10)).toBe(false);
    expect(isWalkable(mask, -1, 0)).toBe(false);
  });
});

describe('nearestWalkable', () => {
  it('returns same position if already walkable', () => {
    const mask = maskFromTiledMap(makeTiledMap(3, 3, new Array(9).fill(1)));
    expect(nearestWalkable(mask, 1, 1, 8)).toEqual({ x: 1, y: 1 });
  });

  it('finds nearest walkable tile (8-conn BFS)', () => {
    // 5×5, center and ring around center are water, outer ring is grass
    const data = new Array(25).fill(1);
    data[2 * 5 + 2] = 3; // (2,2) water
    data[1 * 5 + 2] = 3; // (2,1)
    data[3 * 5 + 2] = 3; // (2,3)
    data[2 * 5 + 1] = 3; // (1,2)
    data[2 * 5 + 3] = 3; // (3,2)
    const mask = maskFromTiledMap(makeTiledMap(5, 5, data));
    const result = nearestWalkable(mask, 2, 2, 8);
    expect(result).not.toBeNull();
    // Should be one of the diagonal neighbors at distance 1 (Chebyshev)
    const dist = Math.max(
      Math.abs(result!.x - 2),
      Math.abs(result!.y - 2),
    );
    expect(dist).toBe(1);
    expect(isWalkable(mask, result!.x, result!.y)).toBe(true);
  });

  it('respects maxRadius limit', () => {
    // All non-walkable except far corner
    const data = new Array(25).fill(3);
    data[0] = 1; // only (0,0) walkable
    const mask = maskFromTiledMap(makeTiledMap(5, 5, data));
    // From (4,4), distance to (0,0) is 4 Chebyshev
    expect(nearestWalkable(mask, 4, 4, 3)).toBeNull();
    expect(nearestWalkable(mask, 4, 4, 4)).toEqual({ x: 0, y: 0 });
  });

  it('returns null when no walkable tile within radius', () => {
    const data = new Array(25).fill(3); // all water
    const mask = maskFromTiledMap(makeTiledMap(5, 5, data));
    expect(nearestWalkable(mask, 2, 2, 8)).toBeNull();
  });
});
