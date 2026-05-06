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

// Click-to-tile hit test pro 2:1 dimetric diamond mřížku.
//
// worldToScreen(x, y) vrací bbox top-left tile (Phaser ISOMETRIC tilemap konvence).
// Diamond center tile (x, y) je tedy ((x-y)*HW + HW, (x+y)*HH + HH).
// Pro lookup "ve kterém diamondu leží point" musíme posunout screen tak, aby
// celočíselný world coord odpovídal centru (ne rohu bbox), a pak round (ne floor)
// — diamond se rozkládá symetricky ±0.5 v world prostoru kolem centeru
// (|Δx| + |Δy| ≤ 0.5 = uvnitř diamondu).
//
// Vstup je relativní k anchor tile (0,0) — odeber camera/origin offset před voláním
// (např. Phaser pointer.worldX/worldY, ne raw canvas pixels).
export function tileCenterPx(tileX: number, tileY: number): { x: number; y: number } {
  const { sx, sy } = worldToScreen(tileX, tileY);
  return { x: sx + TILE_W_PX / 2, y: sy + TILE_H_PX / 2 };
}

export function screenToTile(sx: number, sy: number): WorldTile {
  const adjSx = sx - HALF_W;
  const adjSy = sy - HALF_H;
  const w = screenToWorld(adjSx, adjSy);
  return { x: Math.round(w.x), y: Math.round(w.y) };
}
