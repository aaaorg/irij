// A* pathfinding nad WalkableMask — viz docs/03-message-katalog.md (MOVE_REQUEST)
// a docs/02c-data-model-svet.md (Walkable mask).
//
// Konvence:
//   - 4-směrová (N/S/E/W), žádné diagonály. Důvod: matchne iso aesthetic +
//     zjednodušuje range validaci pro budoucí combat (manhattan = grid distance).
//   - Manhattan heuristika (admissible pro 4-conn grid s uniform cost).
//   - Binary min-heap pro open set (sort() v hot loopu by byl O(n log n) per push;
//     heap je O(log n)). Pro 50×50 mapu detail nezáleží, ale post-MVP 256×256+
//     to přestane být zanedbatelné.
//   - Bounded: closedSet cap (anti-DoS, pokud target unreachable v obrovské mapě)
//     + maxPathLength cap (anti-teleport: hráč nemůže poslat target za roh světa).
//
// API: pure function, žádný Nakama runtime dependency. Snadno mockuvatelné kdyby
// někdy vznikl test runner.

import type { Position } from 'irij-shared/types';
import { isInBounds, isWalkable, type WalkableMask } from './walkable.js';

const DEFAULT_MAX_NODES = 4096;
const DEFAULT_MAX_PATH_LENGTH = 64;

interface PathNode {
  x: number;
  y: number;
  g: number; // cost from start
  f: number; // g + h (priority)
  parent: PathNode | null;
}

// Binary min-heap keyed on `f`. Stable enough — A* doesn't require strict
// tie-breaking (mírně horší path při shodě, ale stále optimal).
class MinHeap {
  private data: PathNode[] = [];

  size(): number {
    return this.data.length;
  }

  push(node: PathNode): void {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): PathNode | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last !== undefined) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const a = this.data[i];
      const b = this.data[parent];
      if (a === undefined || b === undefined) break;
      if (a.f >= b.f) break;
      this.data[i] = b;
      this.data[parent] = a;
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      const cur = this.data[smallest];
      const lNode = left < n ? this.data[left] : undefined;
      const rNode = right < n ? this.data[right] : undefined;
      if (cur === undefined) break;
      if (lNode !== undefined && lNode.f < cur.f) smallest = left;
      const sNode = this.data[smallest];
      if (rNode !== undefined && sNode !== undefined && rNode.f < sNode.f) {
        smallest = right;
      }
      if (smallest === i) break;
      const a = this.data[i];
      const b = this.data[smallest];
      if (a === undefined || b === undefined) break;
      this.data[i] = b;
      this.data[smallest] = a;
      i = smallest;
    }
  }
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

export interface FindPathOptions {
  maxNodes?: number;
  maxPathLength?: number;
}

// findPath: vrátí pole tile coordů od first-step po target (NEZAČÍNÁ from).
//   - `[]` pokud from === to (no movement needed).
//   - `null` pokud target není walkable, nebo cesta neexistuje, nebo překročí
//     bounds (path > maxPathLength, expanded > maxNodes).
//
// Caller (handleMoveRequest) zodpovídá za snap non-walkable target přes
// nearestWalkable BFS PŘED voláním findPath.
export function findPath(
  walkable: WalkableMask,
  from: Position,
  to: Position,
  opts?: FindPathOptions,
): Position[] | null {
  const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;
  const maxPathLength = opts?.maxPathLength ?? DEFAULT_MAX_PATH_LENGTH;

  if (from.x === to.x && from.y === to.y) return [];
  if (!isInBounds(walkable, to.x, to.y)) return null;
  if (!isWalkable(walkable, to.x, to.y)) return null;
  if (!isInBounds(walkable, from.x, from.y)) return null;
  // from doesn't have to be walkable (could be on a non-walkable tile in some
  // edge cases — e.g. spawned on a tile that just turned non-walkable). But we
  // still allow leaving it. Most calls will have walkable from.

  const open = new MinHeap();
  const closed: { [k: string]: true } = {};
  const bestG: { [k: string]: number } = {};

  const startNode: PathNode = {
    x: from.x,
    y: from.y,
    g: 0,
    f: manhattan(from.x, from.y, to.x, to.y),
    parent: null,
  };
  open.push(startNode);
  bestG[keyOf(from.x, from.y)] = 0;

  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  let expanded = 0;

  while (open.size() > 0) {
    const cur = open.pop()!;
    const ck = keyOf(cur.x, cur.y);
    if (closed[ck]) continue;
    closed[ck] = true;
    expanded++;
    if (expanded > maxNodes) return null;

    if (cur.x === to.x && cur.y === to.y) {
      // Reconstruct path. Length = cur.g; if too long, reject.
      if (cur.g > maxPathLength) return null;
      const out: Position[] = [];
      let n: PathNode | null = cur;
      while (n && n.parent) {
        out.push({ x: n.x, y: n.y });
        n = n.parent;
      }
      out.reverse();
      return out;
    }

    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!isInBounds(walkable, nx, ny)) continue;
      if (!isWalkable(walkable, nx, ny)) continue;
      const nk = keyOf(nx, ny);
      if (closed[nk]) continue;
      const ng = cur.g + 1;
      // Early prune: if path would exceed max even with zero remaining, skip.
      if (ng > maxPathLength) continue;
      const prevBest = bestG[nk];
      if (prevBest !== undefined && ng >= prevBest) continue;
      bestG[nk] = ng;
      open.push({
        x: nx,
        y: ny,
        g: ng,
        f: ng + manhattan(nx, ny, to.x, to.y),
        parent: cur,
      });
    }
  }

  return null;
}
