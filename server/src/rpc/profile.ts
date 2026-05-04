// Profile RPCs — viz docs/03-message-katalog.md sekce Profile.
// Handlery jsou pojmenované exportované funkce; registrují se inline v main.ts InitModule.

import {
  APPEARANCE_OPTIONS,
  ATRIBUT_NAMES,
  DEFAULT_HP,
  DEFAULT_MANA,
  DEFAULT_SPAWN_POSITION,
  DEFAULT_SPAWN_ZONE,
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  EQUIPMENT_SLOTS,
  INVENTORY_SLOTS,
  SKILL_NAMES,
  STORAGE_COLLECTIONS,
  USERNAME_REGEX,
} from 'irij-shared/constants';
import type {
  CreateCharacterError,
  CreateCharacterRequest,
  CreateCharacterResponse,
  GetSelfResponse,
} from 'irij-shared/messages';
import type {
  AtributRow,
  EquipmentEntry,
  InventorySlot,
  Player,
  SatchelEntry,
  SkillRow,
} from 'irij-shared/types';
import { logAudit } from '../lib/audit.js';

// Storage je owner-readable, server-only writable. Klient čte přes RPC, ne přímo.
const PERMISSION_OWNER_READ = 1;
const PERMISSION_NO_WRITE = 0;

export function profileGetSelf(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string,
): string {
  const userId = ctx.userId;
  if (!userId) {
    return JSON.stringify({ exists: false } satisfies GetSelfResponse);
  }

  const objects = nk.storageRead([
    { collection: STORAGE_COLLECTIONS.PLAYER, key: userId, userId },
    { collection: STORAGE_COLLECTIONS.PLAYER_SKILLS, key: userId, userId },
    { collection: STORAGE_COLLECTIONS.PLAYER_INVENTORY, key: userId, userId },
  ]);

  const playerObj = objects.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER);
  const skillsObj = objects.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER_SKILLS);
  const invObj = objects.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER_INVENTORY);

  if (!playerObj || !skillsObj || !invObj) {
    return JSON.stringify({ exists: false } satisfies GetSelfResponse);
  }

  const player = playerObj.value as Player;
  const skillsBlob = skillsObj.value as { atributy: AtributRow[]; skilly: SkillRow[] };
  const invBlob = invObj.value as {
    inventory: InventorySlot[];
    satchel: SatchelEntry[];
    equipment: EquipmentEntry[];
  };

  logger.info(`get_self ok for ${userId}`);

  const response: GetSelfResponse = {
    exists: true,
    player,
    atributy: skillsBlob.atributy,
    skilly: skillsBlob.skilly,
    inventory: invBlob.inventory,
    satchel: invBlob.satchel,
    equipment: invBlob.equipment,
  };
  return JSON.stringify(response);
}

export function profileCreateCharacter(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string,
): string {
  const userId = ctx.userId;
  if (!userId) {
    return errorResponse('invalid_username');
  }

  const req = parseRequest(payload);
  if (!req) {
    return errorResponse('invalid_username');
  }

  const validationError = validate(req);
  if (validationError) {
    return errorResponse(validationError);
  }

  // Anti-double-create: pokud už player blob existuje, odmítni.
  const existing = nk.storageRead([
    { collection: STORAGE_COLLECTIONS.PLAYER, key: userId, userId },
  ]);
  if (existing.length > 0) {
    return errorResponse('already_exists');
  }

  // Username unikátnost přes Nakama account (account.username je unique index).
  const usernameTaken = isUsernameTaken(nk, req.username, userId);
  if (usernameTaken) {
    return errorResponse('username_taken');
  }

  const now = new Date().toISOString();

  const player: Player = {
    id: userId,
    username: req.username,
    display_name: req.display_name,
    gender: req.gender,
    appearance: { ...req.appearance },
    created_at: now,
    last_login_at: now,
    last_logout_at: now,
    total_xp: 0,
    total_level: ATRIBUT_NAMES.length + SKILL_NAMES.length, // 21 × lvl 1
    current_zone_id: DEFAULT_SPAWN_ZONE,
    current_position: { ...DEFAULT_SPAWN_POSITION },
    hp_current: DEFAULT_HP,
    hp_last_update_at: now,
    death_debuff_expires_at: null,
    mana_current: DEFAULT_MANA,
    mana_last_update_at: now,
    tutorial_completed: false,
    settings: {},
  };

  const atributy: AtributRow[] = ATRIBUT_NAMES.map((name) => ({ name, xp: 0, level: 1 }));
  const skilly: SkillRow[] = SKILL_NAMES.map((name) => ({ name, xp: 0, level: 1 }));

  const inventory: InventorySlot[] = Array.from({ length: INVENTORY_SLOTS }, (_, i) => ({
    slot_index: i,
    item_id: null,
    quantity: 0,
  }));
  const satchel: SatchelEntry[] = [];
  const equipment: EquipmentEntry[] = EQUIPMENT_SLOTS.map((slot) => ({
    slot,
    item_id: null,
    quantity: 0,
  }));

  // Update Nakama account username; pokud někdo mezitím stejný username chytl,
  // accountUpdateId throwne — chytneme jako username_taken.
  try {
    nk.accountUpdateId(userId, req.username, req.display_name, undefined, undefined, undefined, undefined, undefined);
  } catch (err) {
    logger.warn(`accountUpdateId failed for ${userId}: ${String(err)}`);
    return errorResponse('username_taken');
  }

  // Atomicky zapíšeme všechny tři bloby. Pokud zápis selže, accountUpdateId zůstane,
  // ale `exists` check zabrání duplicitnímu vytvoření při retry.
  nk.storageWrite([
    {
      collection: STORAGE_COLLECTIONS.PLAYER,
      key: userId,
      userId,
      value: player,
      permissionRead: PERMISSION_OWNER_READ,
      permissionWrite: PERMISSION_NO_WRITE,
    },
    {
      collection: STORAGE_COLLECTIONS.PLAYER_SKILLS,
      key: userId,
      userId,
      value: { atributy, skilly, sources: [] },
      permissionRead: PERMISSION_OWNER_READ,
      permissionWrite: PERMISSION_NO_WRITE,
    },
    {
      collection: STORAGE_COLLECTIONS.PLAYER_INVENTORY,
      key: userId,
      userId,
      value: { inventory, satchel, equipment },
      permissionRead: PERMISSION_OWNER_READ,
      permissionWrite: PERMISSION_NO_WRITE,
    },
  ]);

  logger.info(`Character created for ${userId} (username=${req.username})`);

  logAudit(nk, 'character_created', {
    userId,
    ip: ctx.clientIp,
    payload: { username: req.username, display_name: req.display_name },
  });

  const response: CreateCharacterResponse = { ok: true, player_id: userId };
  return JSON.stringify(response);
}

function parseRequest(payload: string): CreateCharacterRequest | null {
  try {
    const parsed = JSON.parse(payload) as Partial<CreateCharacterRequest>;
    if (
      typeof parsed.username === 'string' &&
      typeof parsed.display_name === 'string' &&
      (parsed.gender === 'M' || parsed.gender === 'F') &&
      parsed.appearance &&
      typeof parsed.appearance === 'object'
    ) {
      return parsed as CreateCharacterRequest;
    }
    return null;
  } catch {
    return null;
  }
}

function validate(req: CreateCharacterRequest): CreateCharacterError | null {
  if (!USERNAME_REGEX.test(req.username)) return 'invalid_username';

  const trimmed = req.display_name.trim();
  // [...str] iteruje code points, takže emoji/CJK počítáme správně.
  const length = [...trimmed].length;
  if (length < DISPLAY_NAME_MIN || length > DISPLAY_NAME_MAX) return 'invalid_display_name';
  if (trimmed !== req.display_name) return 'invalid_display_name';

  if (req.gender !== 'M' && req.gender !== 'F') return 'invalid_gender';

  const a = req.appearance;
  if (!isInRange(a.hair_id, 0, APPEARANCE_OPTIONS - 1)) return 'invalid_appearance';
  if (!isInRange(a.skin_tone_id, 0, APPEARANCE_OPTIONS - 1)) return 'invalid_appearance';
  if (!isInRange(a.outfit_id, 0, APPEARANCE_OPTIONS - 1)) return 'invalid_appearance';

  return null;
}

function isInRange(n: unknown, min: number, max: number): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
}

function isUsernameTaken(nk: nkruntime.Nakama, username: string, currentUserId: string): boolean {
  try {
    const users = nk.usersGetUsername([username]);
    return users.some((u) => u.userId !== currentUserId);
  } catch {
    return false;
  }
}

function errorResponse(error: CreateCharacterError): string {
  const response: CreateCharacterResponse = { ok: false, error };
  return JSON.stringify(response);
}
