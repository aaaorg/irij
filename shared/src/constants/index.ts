// Tickrate konstanty — viz docs/04-tech-adr.md ADR-007
// Master tick = 10 Hz. Ostatní tickrates jsou násobky.

export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ; // 100 ms

export const COMBAT_TICK_INTERVAL = 3; // 3 master ticks = 300 ms
export const AI_TICK_INTERVAL = 5; // 5 master ticks = 500 ms
export const RESOURCE_RESPAWN_CHECK_INTERVAL = 150; // 15 s
export const PLAYER_AUTOSAVE_INTERVAL = 300; // 30 s
export const JOB_BOARD_GENERATION_INTERVAL = 18000; // 30 min

// Movement
export const MOVEMENT_SPEED_TPS_BASE = 3; // tiles per second
export const MAX_PATH_LENGTH_TILES = 64;

// World scaling
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

// Network
export const HEARTBEAT_INTERVAL_MS = 15_000;
