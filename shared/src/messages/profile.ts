// Profile RPC payloady — viz docs/03-message-katalog.md sekce Profile.
// Wire format: JSON. Použití na klientovi i serveru.

import type {
  Appearance,
  AtributRow,
  EquipmentEntry,
  Gender,
  InventorySlot,
  Player,
  PlayerState,
  SatchelEntry,
  SkillRow,
} from '../types/player.js';

// rpc.profile.create_character

export interface CreateCharacterRequest {
  username: string;
  display_name: string;
  gender: Gender;
  appearance: Appearance;
}

export type CreateCharacterResponse =
  | { ok: true; player_id: string }
  | { ok: false; error: CreateCharacterError };

export type CreateCharacterError =
  | 'invalid_username'
  | 'username_taken'
  | 'invalid_display_name'
  | 'invalid_gender'
  | 'invalid_appearance'
  | 'already_exists';

// rpc.profile.get_self

export type GetSelfResponse =
  | { exists: false }
  | {
      exists: true;
      player: Player;
      player_state: PlayerState;
      atributy: AtributRow[];
      skilly: SkillRow[];
      inventory: InventorySlot[];
      satchel: SatchelEntry[];
      equipment: EquipmentEntry[];
    };
