// A* pathfinding nad WalkableMask — viz docs/03-message-katalog.md (MOVE_REQUEST)
// a docs/02c-data-model-svet.md (Walkable mask), ADR-020 (8-directional movement).
//
// Konvence:
//   - **8-směrová** (4 cardinal N/S/E/W + 4 diagonal NE/NW/SE/SW). Cardinal step
//     cost = 1, diagonal cost = √2 (octile). Důvod: přirozenější pohyb v iso
//     gridu, kratší cesty (Chebyshev distance místo Manhattan), lepší UX při
//     click-to-move přes volnou plochu.
//   - **Octile heuristika** `max(|dx|,|dy|) + (√2-1)·min(|dx|,|dy|)` — admissible
//     pro 8-conn grid s octile costs.
//   - **No corner cutting:** diagonální krok mezi (x,y) a (x+dx,y+dy) je povolen
//     jen pokud jsou (x+dx,y) i (x,y+dy) walkable. Bez toho by sprite "pronikal
//     rohem" mezi dvě non-walkable dlaždice (např. dvě stěny v L-tvaru), což
//     vypadá jako bug a komplikuje budoucí collision/range validaci.
//   - **Diagonal-first expansion:** v sousedním poli sloupkujeme diagonály před
//     cardinaly, takže při tie-breaku f-hodnoty A* preferuje diagonální postup
//     před zubatým střídáním cardinal/cardinal — výsledné cesty vypadají
//     "rovnější".
//   - **Step count vs cost:** `g` drží octile cost (float), ale samostatný
//     `steps` counter drží počet kroků v cestě — `MAX_PATH_LENGTH_TILES` cap se
//     vztahuje k step countu (= path.length), ne k cost. Tím zůstává smysl
//     konstanty stabilní bez ohledu na zastoupení diagonál.
//   - **Bounded:** closedSet cap (anti-DoS pro unreachable target v obrovské
//     mapě) + maxPathLength cap (anti-teleport: hráč nemůže poslat target za
//     roh světa).
//   - **Binary min-heap** pro open set (sort() v hot loopu by byl O(n log n)
//     per push; heap je O(log n)). Pro 50×50 mapu detail nezáleží, ale post-MVP
//     256×256+ to přestane být zanedbatelné.
//
// API: pure function, žádný Nakama runtime dependency. Snadno mockuvatelné kdyby
// někdy vznikl test runner.

import type { Position } from 'irij-shared/types';
import { isInBounds, isWalkable, type WalkableMask } from './walkable.js';

const DEFAULT_MAX_NODES = 4096;
const DEFAULT_MAX_PATH_LENGTH = 64;

const SQRT2 = Math.SQRT2;

interface PathNode {
  x: number;
  y: number;
  g: number; // octile cost from start (cardinal=1, diagonal=√2)
  f: number; // g + h (priority)
  steps: number; // počet kroků v cestě (pro maxPathLength cap)
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

// Octile distance: admissible heuristika pro 8-conn grid s costs (1, √2).
// Forma `(dx+dy) + (√2 - 2) * min(dx,dy)` je ekvivalentní `max + (√2-1)*min`,
// jen méně podmínek.
function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

// 8-směrové sousedí. Diagonály (dx≠0 ∧ dy≠0) jsou vyjmenované první — při tie
// breaku f-hodnoty A* expanduje diagonální node dřív než cardinal, což produkuje
// vizuálně přímější cesty v otevřeném prostoru (méně "schodišťování").
const NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

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
    f: octile(from.x, from.y, to.x, to.y),
    steps: 0,
    parent: null,
  };
  open.push(startNode);
  bestG[keyOf(from.x, from.y)] = 0;

  let expanded = 0;

  while (open.size() > 0) {
    const cur = open.pop()!;
    const ck = keyOf(cur.x, cur.y);
    if (closed[ck]) continue;
    closed[ck] = true;
    expanded++;
    if (expanded > maxNodes) return null;

    if (cur.x === to.x && cur.y === to.y) {
      // Reconstruct path. Step count je v `cur.steps`; cap už checknutý při
      // expansion, ale double-check defenzivně.
      if (cur.steps > maxPathLength) return null;
      const out: Position[] = [];
      let n: PathNode | null = cur;
      while (n && n.parent) {
        out.push({ x: n.x, y: n.y });
        n = n.parent;
      }
      out.reverse();
      return out;
    }

    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!isInBounds(walkable, nx, ny)) continue;
      if (!isWalkable(walkable, nx, ny)) continue;
      // No corner cutting: diagonální krok přes (cur.x+dx, cur.y) AND
      // (cur.x, cur.y+dy) musí být oba walkable. Bez toho by se sprite
      // "protlačil" mezi dvě stěny v L-rohu — vypadá to jako bug a komplikuje
      // budoucí collision (kdyby přibyly tile-edge bariéry, zachová se invariant
      // "step prochází přes nelinii non-walkable bloku").
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal) {
        if (!isWalkable(walkable, cur.x + dx, cur.y)) continue;
        if (!isWalkable(walkable, cur.x, cur.y + dy)) continue;
      }
      const nk = keyOf(nx, ny);
      if (closed[nk]) continue;
      const stepCost = diagonal ? SQRT2 : 1;
      const ng = cur.g + stepCost;
      const nsteps = cur.steps + 1;
      // Early prune: cesta delší než cap → skip (anti-teleport target za roh světa).
      if (nsteps > maxPathLength) continue;
      const prevBest = bestG[nk];
      if (prevBest !== undefined && ng >= prevBest) continue;
      bestG[nk] = ng;
      open.push({
        x: nx,
        y: ny,
        g: ng,
        f: ng + octile(nx, ny, to.x, to.y),
        steps: nsteps,
        parent: cur,
      });
    }
  }

  return null;
}
