export interface AttackRequest {
  target_id: string;
  client_seq: number;
}

export interface CastSpellRequest {
  spell_id: string;
  target_id?: string;
  target_position?: { x: number; y: number };
  client_seq: number;
}

export type HitType = 'normal' | 'critical' | 'miss' | 'block';

export interface CombatResolved {
  attacker_id: string;
  target_id: string;
  damage: number;
  hit_type: HitType;
  remaining_hp: number;
}

export interface EntityDamaged {
  entity_id: string;
  damage: number;
  current_hp: number;
  source_id: string;
}

export interface EntityDied {
  entity_id: string;
  killer_id: string;
  drops: Array<{ item_id: string; quantity: number }> | null;
  xp_awarded: Array<{ skill: string; amount: number }>;
}
