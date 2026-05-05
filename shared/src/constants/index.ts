// Tickrate konstanty — viz docs/04-tech-adr.md ADR-007
// Master tick = 10 Hz. Ostatní tickrates jsou násobky.

export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ; // 100 ms

export const COMBAT_TICK_INTERVAL = 6; // 6 master ticks = 600 ms (OSRS tempo per G1 decision)
export const AI_TICK_INTERVAL = 5; // 5 master ticks = 500 ms
export const RESOURCE_RESPAWN_CHECK_INTERVAL = 150; // 15 s
export const PLAYER_AUTOSAVE_INTERVAL = 300; // 30 s
export const JOB_BOARD_GENERATION_INTERVAL = 18000; // 30 min

// Movement
export const MOVEMENT_SPEED_TPS_BASE = 3; // tiles per second
export const MAX_PATH_LENGTH_TILES = 64;

// Walkable mask — gid → walkable bool. Phase 3 placeholder tileset má jen 3 dlaždice
// (grass=1, dirt=2, water=3). Voda je non-walkable, zbytek walkable.
// TODO: parsovat z tileset.tiles[].properties.walkable, jakmile designeři potřebují
// per-tile granularitu (Phase 18 polish, plná Blatiny mapa).
export const NON_WALKABLE_TILE_GIDS: ReadonlySet<number> = new Set<number>([3]);

// Broadcast scope per ADR-007: hráč vidí 3×3 chunkové okolí kolem svého chunku
// (Chebyshev distance ≤ 1). Movement broadcasts, spawn/despawn jdou jen presencím
// v tomto okolí, ne celý match.
export const BROADCAST_CHUNK_RADIUS = 1;

// Když klient pošle MOVE_REQUEST na non-walkable tile (např. click na vodu),
// server si fallbackem najde nejbližší walkable v BFS radius. Konstanta
// definovaná tady už v 4a, aby v 4b nebyla rozesetá. Hodnota 8 tilů = 1/8
// chunk (8/64), dostatečná pro UX edge cases bez rizika "snap přes půl mapy".
export const NEAREST_WALKABLE_BFS_RADIUS = 8;

// World scaling
// TILE_SIZE_PX je legacy konstanta (logický scale faktor pro UI/HUD calculations).
// Skutečný render je isometric 2:1 dimetric — viz ADR-018 a klient render konstanty
// (TILE_W_PX = 64, TILE_H_PX = 32) v client/src/render/projection.ts (Phase 3+).
// Server kód s pixel souřadnicemi nepracuje; všechny world coords jsou v tiles.
export const TILE_SIZE_PX = 48;
export const CHUNK_SIZE_TILES = 64;
export const MVP_WORLD_SIZE_TILES = 256;

// Inventory
export const INVENTORY_SLOTS = 24;
export const SATCHEL_BASE_KG = 30;
export const SATCHEL_KG_PER_STRENGTH_LEVEL = 0.5;

// Currency
export const CURRENCY_MAX_STACK = 1_000_000;

// Skill / atribut
export const LEVEL_CAP = 99;
export const TOTAL_LEVEL_MAX = 21 * LEVEL_CAP; // 4 atribut + 17 skill

// Reputation
export const REPUTATION_MAX = 1000;
export const REPUTATION_DEFAULT = 100;

// Death
export const HOMESICKNESS_DURATION_MS = 10 * 60 * 1000;
export const HOMESICKNESS_XP_PENALTY_PCT = 25;
export const HOMESICKNESS_DAMAGE_PENALTY_PCT = 15;

// Combat
export const MELEE_RANGE_TILES = 1;
export const ATTACK_RATE_LIMIT_MAX = 4; // max 4 ATTACK_REQUEST per second
export const DROP_DESPAWN_TICKS = 6000; // 10 minutes at 10 Hz
export const MOB_RESPAWN_CHECK_INTERVAL = 10; // check every 1 s

// Network
export const HEARTBEAT_INTERVAL_MS = 15_000;

// Storage collections (Nakama Storage Engine, klíč = userId) — viz docs/02a sekce Storage layer notes.
export const STORAGE_COLLECTIONS = {
  PLAYER: 'player',
  PLAYER_STATE: 'player_state',
  PLAYER_SKILLS: 'player_skills',
  PLAYER_INVENTORY: 'player_inventory',
} as const;

// Profile validation — viz docs/02a Player.username / display_name.
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/;
export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 24;
export const APPEARANCE_OPTIONS = 12; // 0..11 inclusive, viz Appearance v 02a

// Master enumerace pro inicializaci nové postavy. Hodnoty musí matchnout types/player.ts unions.
export const ATRIBUT_NAMES = ['strength', 'dexterity', 'intelligence', 'vitality'] as const;

export const SKILL_NAMES = [
  'melee', 'ranged', 'magic', 'defense',
  'mining', 'woodcutting', 'fishing', 'herbalism', 'hunting',
  'smithing', 'cooking', 'tailoring', 'alchemy', 'carpentry',
  'storytelling', 'prayer', 'thievery',
] as const;

export const EQUIPMENT_SLOTS = [
  'helmet', 'cape', 'amulet', 'weapon', 'body',
  'shield', 'legs', 'gloves', 'boots', 'ring', 'holster',
] as const;

// Spawn defaults pro nově vytvořené postavy. Hodnota odpovídá crossroads
// dirt cesty na Phase 3 test mapě (50×50 isometric); finální mapa Blatin
// v Phase 18 bude mít vlastní spawn point.
export const DEFAULT_SPAWN_ZONE = 'blatiny';
export const DEFAULT_SPAWN_POSITION = { x: 25, y: 25 } as const;
export const DEFAULT_HP = 10;
export const DEFAULT_MANA = 0;
