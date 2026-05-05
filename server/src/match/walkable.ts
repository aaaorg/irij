// Walkable mask — server-side reprezentace mapy pro pathfinding + movement validaci.
//
// Per ADR-005 (chunk-cluster ready): storage je per-chunk objekt klíčovaný "cx,cy",
// ne globální 2D pole. Post-MVP rozdělení 4×4 chunků = 1 match nesmí vyžadovat
// refactor — proto už teď držíme chunk index, i když MVP má jen 1 chunk (50×50).
//
// Per ADR-018: logický grid je čistě ortogonální (x, y) v tiles. Žádné px coords.
// Per docs/02c sekce "Walkable mask": per-tile bool, generuje se z combined kolizí
// terrain + objects (zatím jen terrain, objects layer přijde v Phase 18).
//
// **Goja constraint:** Nakama JS runtime mezi handler voláními Export()-uje state
// do Go `map[string]interface{}` a rekonstruuje fresh Goja objekty přes
// `stateObject.Set(k, v)` (viz runtime_javascript_match_core.go). Class instances
// by ztratily prototype, takže WalkableMask je čistá **data** (plain object) +
// module-level **funkce** (isInBounds/isWalkable/...). Pro stejný důvod
// používáme `number[]` místo `Uint8Array` — typed array round-trip přes Go map
// není zaručeně stabilní napříč callbacks.
//
// Storage volba: 1 byte per tile v plain `number[]` (ne bit-packed). Důvod:
// jednoduchost + Goja-friendly. Per-chunk 64×64 = 4096 entries; 50×50 mapa
// se vejde do jediného chunku (4096 entries, ~few KB v JS heap, triviální).

import { CHUNK_SIZE_TILES } from 'irij-shared/constants';
import type { Position, TiledMap } from 'irij-shared/types';
import { isWalkableGid } from 'irij-shared';

const TERRAIN_LAYER_NAME = 'terrain';

export interface WalkableMask {
  width: number;
  height: number;
  // chunkKey "cx,cy" → array CHUNK_SIZE_TILES² bytes (1=walkable, 0=non).
  // Goja-safe plain object místo Map; number[] místo Uint8Array kvůli stable JSON
  // round-tripu mezi handler callbacks.
  chunks: { [chunkKey: string]: number[] };
}

function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function maskFromTiledMap(map: TiledMap): WalkableMask {
  const terrain = map.layers.find(
    (l) => l.type === 'tilelayer' && l.name === TERRAIN_LAYER_NAME,
  );
  if (!terrain) {
    throw new Error(
      `walkable.fromTiledMap: layer "${TERRAIN_LAYER_NAME}" not found (layers: ${map.layers.map((l) => l.name).join(', ')})`,
    );
  }

  const { width, height } = map;
  const chunks: { [chunkKey: string]: number[] } = {};

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gid = terrain.data[y * width + x] ?? 0;
      const walkable = isWalkableGid(gid);

      const cx = Math.floor(x / CHUNK_SIZE_TILES);
      const cy = Math.floor(y / CHUNK_SIZE_TILES);
      const k = chunkKey(cx, cy);
      let chunk = chunks[k];
      if (!chunk) {
        chunk = new Array<number>(CHUNK_SIZE_TILES * CHUNK_SIZE_TILES).fill(0);
        chunks[k] = chunk;
      }
      const lx = x - cx * CHUNK_SIZE_TILES;
      const ly = y - cy * CHUNK_SIZE_TILES;
      chunk[ly * CHUNK_SIZE_TILES + lx] = walkable ? 1 : 0;
    }
  }

  return { width, height, chunks };
}

export function isInBounds(mask: WalkableMask, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < mask.width && y < mask.height;
}

export function isWalkable(mask: WalkableMask, x: number, y: number): boolean {
  if (!isInBounds(mask, x, y)) return false;
  const cx = Math.floor(x / CHUNK_SIZE_TILES);
  const cy = Math.floor(y / CHUNK_SIZE_TILES);
  const chunk = mask.chunks[chunkKey(cx, cy)];
  if (!chunk) return false;
  const lx = x - cx * CHUNK_SIZE_TILES;
  const ly = y - cy * CHUNK_SIZE_TILES;
  return chunk[ly * CHUNK_SIZE_TILES + lx] === 1;
}

// 8-směrové BFS — vrátí nejbližší walkable tile v zadaném radius, nebo null.
// Použije se jako fallback pro click-on-non-walkable UX (klient klikne na vodu →
// najdi nejbližší břeh). Per ADR-020 jde o pohyb 8-směrový, takže "nejbližší"
// znamená Chebyshev distance (max(|dx|,|dy|)), ne Manhattan — tile diagonálně
// 1 krok je stejně dosažitelný jako tile cardinálně 1 krok.
//
// `maxRadius` se interpretuje jako BFS hloubka = Chebyshev distance v krocích;
// hodnota 8 znamená "v okruhu 8 kroků libovolnou kombinací cardinal/diagonal".
export function nearestWalkable(
  mask: WalkableMask,
  x: number,
  y: number,
  maxRadius: number,
): Position | null {
  if (isWalkable(mask, x, y)) return { x, y };

  const visited: { [k: string]: true } = {};
  const queue: Array<{ x: number; y: number; d: number }> = [{ x, y, d: 0 }];
  visited[`${x},${y}`] = true;

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.d > maxRadius) return null;
    if (node.d > 0 && isWalkable(mask, node.x, node.y)) {
      return { x: node.x, y: node.y };
    }
    // 8-směrová expanze — 4 cardinal + 4 diagonal. Match-uje pohybový model A*
    // (pathfinding.ts) a `WORLD_TICK` advance: kdyby fallback vrátil tile dál
    // přes 4-conn BFS, A* by se k němu pak dostal kratší 8-conn cestou a
    // semantika "nejbližší dosažitelný" by lhala.
    const neighbors = [
      { x: node.x + 1, y: node.y },
      { x: node.x - 1, y: node.y },
      { x: node.x, y: node.y + 1 },
      { x: node.x, y: node.y - 1 },
      { x: node.x + 1, y: node.y + 1 },
      { x: node.x + 1, y: node.y - 1 },
      { x: node.x - 1, y: node.y + 1 },
      { x: node.x - 1, y: node.y - 1 },
    ];
    for (const n of neighbors) {
      const k = `${n.x},${n.y}`;
      if (visited[k]) continue;
      visited[k] = true;
      // BFS pokračuje i přes non-walkable, ale mimo bounds zastaví.
      // Validní tile range pro mapu width×height je [0, width-1] × [0, height-1].
      if (n.x < 0 || n.y < 0 || n.x >= mask.width || n.y >= mask.height) continue;
      queue.push({ x: n.x, y: n.y, d: node.d + 1 });
    }
  }
  return null;
}

// Diagnostika pro matchInit log.
export function countWalkable(mask: WalkableMask): number {
  let count = 0;
  for (const k of Object.keys(mask.chunks)) {
    const chunk = mask.chunks[k];
    if (!chunk) continue;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 1) count++;
    }
  }
  return count;
}

// Smoke testy v komentáři (repo nemá test runner — viz CLAUDE.md "Co v repu zatím není"):
//
//   const m = maskFromTiledMap(testMap);
//   assert(isInBounds(m, 0, 0) === true);
//   assert(isInBounds(m, 50, 50) === false);  // out-of-bounds pro 50×50 mapu
//   assert(isWalkable(m, 25, 25) === true);   // crossroads = dirt path
//   assert(isWalkable(m, 34, 30) === false);  // water patch (gid 3)
//   const np = nearestWalkable(m, 34, 30, 8);
//   assert(np !== null);                       // najde grass kolem water patche
