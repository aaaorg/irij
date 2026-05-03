// Isometric render projection — viz docs/04 ADR-018.
//
// Logický grid je ortogonální (x, y) v tiles; isometric je čistě klient render
// transformace. Server, pathfinding, collision, message payloads pracují vždy
// s world-space tile coords. Žádné pixel souřadnice nesmí překročit tuhle hranici.
//
// 2:1 dimetric projekce, footprint 64×32 px:
//   sx = (x - y) * (TILE_W / 2)
//   sy = (x + y) * (TILE_H / 2)
//   x  = (sx / (TILE_W / 2) + sy / (TILE_H / 2)) / 2
//   y  = (sy / (TILE_H / 2) - sx / (TILE_W / 2)) / 2

export const TILE_W_PX = 64;
export const TILE_H_PX = 32;

const HALF_W = TILE_W_PX / 2;
const HALF_H = TILE_H_PX / 2;

export interface ScreenPoint {
  sx: number;
  sy: number;
}

export interface WorldTile {
  x: number;
  y: number;
}

export function worldToScreen(x: number, y: number): ScreenPoint {
  return {
    sx: (x - y) * HALF_W,
    sy: (x + y) * HALF_H,
  };
}

export function screenToWorld(sx: number, sy: number): WorldTile {
  const fx = sx / HALF_W;
  const fy = sy / HALF_H;
  return {
    x: (fx + fy) / 2,
    y: (fy - fx) / 2,
  };
}

// Click-to-tile: screenToWorld vrací floats — pro tile lookup je třeba floor.
// Vstupní souřadnice musí být v stejném prostoru jako worldToScreen výstup
// (tj. relativní k anchor tile (0,0), ne raw canvas pixely — odeber camera/origin offset
// před voláním).
export function screenToTile(sx: number, sy: number): WorldTile {
  const w = screenToWorld(sx, sy);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}
