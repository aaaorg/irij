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
  CreateCharacterResponse,
  GetSelfResponse,
} from 'irij-shared/messages';
import type {
  AtributRow,
  EquipmentEntry,
  InventorySlot,
  Player,
  PlayerState,
  SatchelEntry,
  SkillRow,
} from 'irij-shared/types';
import { int, obj, oneOf, parse, str } from 'irij-shared';
import { asPlayer, asPlayerState, emptyQuestBlob } from 'irij-shared/types';
import { logAudit } from '../lib/audit.js';
import { RpcError } from '../lib/errors.js';
import { log } from '../lib/log.js';

const PERMISSION_OWNER_READ = 1;
const PERMISSION_NO_WRITE = 0;

const CreateCharacterSchema = obj({
  username: str().min(3).max(16).pattern(USERNAME_REGEX),
  display_name: str().min(DISPLAY_NAME_MIN).max(DISPLAY_NAME_MAX),
  gender: oneOf('M' as const, 'F' as const),
  appearance: obj({
    hair_id: int().min(0).max(APPEARANCE_OPTIONS - 1),
    skin_tone_id: int().min(0).max(APPEARANCE_OPTIONS - 1),
    outfit_id: int().min(0).max(APPEARANCE_OPTIONS - 1),
  }),
});

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
    { collection: STORAGE_COLLECTIONS.PLAYER_STATE, key: userId, userId },
    { collection: STORAGE_COLLECTIONS.PLAYER_SKILLS, key: userId, userId },
    { collection: STORAGE_COLLECTIONS.PLAYER_INVENTORY, key: userId, userId },
  ]);

  const playerObj = objects.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER);
  const stateObj = objects.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER_STATE);
  const skillsObj = objects.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER_SKILLS);
  const invObj = objects.find((o) => o.collection === STORAGE_COLLECTIONS.PLAYER_INVENTORY);

  if (!playerObj || !stateObj || !skillsObj || !invObj) {
    return JSON.stringify({ exists: false } satisfies GetSelfResponse);
  }

  const player = asPlayer(playerObj.value);
  const playerState = asPlayerState(stateObj.value);
  if (!player || !playerState) {
    log(logger, 'warn', 'get_self: blob narrowing failed', { userId });
    return JSON.stringify({ exists: false } satisfies GetSelfResponse);
  }

  const skillsBlob = skillsObj.value as { atributy: AtributRow[]; skilly: SkillRow[] };
  const invBlob = invObj.value as {
    inventory: InventorySlot[];
    satchel: SatchelEntry[];
    equipment: EquipmentEntry[];
  };

  log(logger, 'info', 'get_self ok', { userId });

  const response: GetSelfResponse = {
    exists: true,
    player,
    player_state: playerState,
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
    throw new RpcError('invalid_username');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new RpcError('invalid_username');
  }

  const result = parse(CreateCharacterSchema, parsed);
  if (!result.ok) {
    const firstError = result.errors[0] ?? '';
    if (firstError.includes('username')) throw new RpcError('invalid_username');
    if (firstError.includes('display_name')) throw new RpcError('invalid_display_name');
    if (firstError.includes('gender')) throw new RpcError('invalid_gender');
    if (firstError.includes('appearance') || firstError.includes('hair_id') || firstError.includes('skin_tone_id') || firstError.includes('outfit_id'))
      throw new RpcError('invalid_appearance');
    throw new RpcError('invalid_username');
  }

  const req = result.value;

  // Display name: validate code-point length (emoji/CJK).
  const trimmed = req.display_name.trim();
  const cpLength = [...trimmed].length;
  if (cpLength < DISPLAY_NAME_MIN || cpLength > DISPLAY_NAME_MAX) {
    throw new RpcError('invalid_display_name');
  }
  if (trimmed !== req.display_name) {
    throw new RpcError('invalid_display_name');
  }

  // Anti-double-create: pokud už player blob existuje, odmítni.
  const existing = nk.storageRead([
    { collection: STORAGE_COLLECTIONS.PLAYER, key: userId, userId },
  ]);
  if (existing.length > 0) {
    throw new RpcError('already_exists');
  }

  // Username unikátnost přes Nakama account.
  if (isUsernameTaken(nk, req.username, userId)) {
    throw new RpcError('username_taken');
  }

  const now = new Date().toISOString();

  const player: Player = {
    schema_version: 1,
    id: userId,
    username: req.username,
    display_name: req.display_name,
    gender: req.gender,
    appearance: { ...req.appearance },
    created_at: now,
    last_login_at: now,
    total_xp: 0,
    total_level: ATRIBUT_NAMES.length + SKILL_NAMES.length,
    tutorial_completed: false,
    settings: {},
  };

  const playerState: PlayerState = {
    schema_version: 1,
    current_zone_id: DEFAULT_SPAWN_ZONE,
    current_position: { ...DEFAULT_SPAWN_POSITION },
    hp_current: DEFAULT_HP,
    hp_max: DEFAULT_HP,
    mana_current: DEFAULT_MANA,
    death_debuff_expires_at: null,
    last_logout_at: now,
  };

  const atributy: AtributRow[] = ATRIBUT_NAMES.map((name) => ({ name, xp: 0, level: 1 }));
  const skilly: SkillRow[] = SKILL_NAMES.map((name) => ({ name, xp: 0, level: 1 }));

  const inventory: InventorySlot[] = Array.from({ length: INVENTORY_SLOTS }, (_, i) => ({
    slot_index: i,
    item_id: null,
    quantity: 0,
  }));
  // Phase 10 starter kit — tool.pickaxe.bronze + tool.axe.bronze + tool.hammer
  // dovolují gathering (kámen/dřevo) a smith_forge crafting hned po char create.
  // Starší character accounty mohou nářadí získat přes kovářův dialog (option
  // "Půjčíš mi nářadí na řemeslo?").
  const STARTER_TOOLS = ['tool.pickaxe.bronze', 'tool.axe.bronze', 'tool.hammer'];
  for (let i = 0; i < STARTER_TOOLS.length; i++) {
    const slot = inventory[i];
    if (slot) {
      slot.item_id = STARTER_TOOLS[i] ?? null;
      slot.quantity = 1;
    }
  }
  const satchel: SatchelEntry[] = [];
  const equipment: EquipmentEntry[] = EQUIPMENT_SLOTS.map((slot) => ({
    slot,
    item_id: null,
    quantity: 0,
  }));

  try {
    nk.accountUpdateId(userId, req.username, req.display_name, undefined, undefined, undefined, undefined, undefined);
  } catch (err) {
    log(logger, 'warn', 'accountUpdateId failed', { userId, error: String(err) });
    throw new RpcError('username_taken');
  }

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
      collection: STORAGE_COLLECTIONS.PLAYER_STATE,
      key: userId,
      userId,
      value: playerState,
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
    {
      collection: STORAGE_COLLECTIONS.PLAYER_QUESTS,
      key: userId,
      userId,
      value: emptyQuestBlob(),
      permissionRead: PERMISSION_OWNER_READ,
      permissionWrite: PERMISSION_NO_WRITE,
    },
  ]);

  log(logger, 'info', 'character created', { userId, username: req.username });

  logAudit(nk, 'character_created', {
    userId,
    ip: ctx.clientIp,
    payload: { username: req.username, display_name: req.display_name },
  });

  const response: CreateCharacterResponse = { ok: true, player_id: userId };
  return JSON.stringify(response);
}

function isUsernameTaken(nk: nkruntime.Nakama, username: string, currentUserId: string): boolean {
  try {
    const users = nk.usersGetUsername([username]);
    return users.some((u) => u.userId !== currentUserId);
  } catch {
    return false;
  }
}
