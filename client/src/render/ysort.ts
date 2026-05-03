// Y-sort depth ordering — viz docs/04 ADR-018, sekce 4 + 6.
//
// Dynamické sprity (postavy, mobi, drops, projektily) musí mít depth nastavený
// per frame podle world Y, jinak strom vepředu nepřekryje postavu vzadu.
// Statický terrain vyřídí sám Phaser tilemap renderer (ISOMETRIC orientation).
//
// Depth bandy zabraňují z-fightingu mezi vrstvami:
//   terrain   0     .. 999
//   props     1000  .. 9999    (statické multi-height objekty: zdi, stromy, střechy)
//   dynamic   10000+           (postavy, mobi, drops, projektily, floating texty)
//
// Uvnitř bandu je depth = base + worldY * SCALE + featOffset. SCALE > 0 zaručuje
// monotónní řazení; featOffset (typicky 0..tileH) řeší jemné rozdíly anchor pointů
// uvnitř jedné tile (např. dva sprity v stejné dlaždici).

export const DEPTH_TERRAIN_BASE = 0;
export const DEPTH_PROPS_BASE = 1000;
export const DEPTH_DYNAMIC_BASE = 10000;

const Y_SCALE = 10; // 10 jednotek / tile umožňuje sub-tile řazení přes featOffset

export function depthForDynamic(worldY: number, featOffset = 0): number {
  return DEPTH_DYNAMIC_BASE + worldY * Y_SCALE + featOffset;
}

export function depthForProp(worldY: number, featOffset = 0): number {
  return DEPTH_PROPS_BASE + worldY * Y_SCALE + featOffset;
}
