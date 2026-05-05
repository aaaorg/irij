import { describe, expect, it } from 'vitest';
import { asPlayer, asPlayerState } from './player.js';

describe('asPlayer', () => {
  const validPlayer = {
    schema_version: 1,
    id: 'abc-123',
    username: 'testuser',
    display_name: 'Test User',
    gender: 'M',
    appearance: { hair_id: 0, skin_tone_id: 1, outfit_id: 2 },
    created_at: '2026-01-01T00:00:00Z',
    last_login_at: '2026-01-01T00:00:00Z',
    total_xp: 0,
    total_level: 21,
    tutorial_completed: false,
    settings: {},
  };

  it('accepts valid Player object', () => {
    expect(asPlayer(validPlayer)).toEqual(validPlayer);
  });

  it('returns null for null', () => {
    expect(asPlayer(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(asPlayer(undefined)).toBeNull();
  });

  it('returns null for non-object', () => {
    expect(asPlayer('string')).toBeNull();
    expect(asPlayer(42)).toBeNull();
  });

  it('returns null for array', () => {
    expect(asPlayer([])).toBeNull();
  });

  it('returns null when schema_version missing', () => {
    const { schema_version, ...rest } = validPlayer;
    expect(asPlayer(rest)).toBeNull();
  });

  it('returns null when id is not string', () => {
    expect(asPlayer({ ...validPlayer, id: 123 })).toBeNull();
  });

  it('returns null when username is not string', () => {
    expect(asPlayer({ ...validPlayer, username: null })).toBeNull();
  });

  it('returns null when gender is invalid', () => {
    expect(asPlayer({ ...validPlayer, gender: 'X' })).toBeNull();
  });

  it('returns null when appearance is missing', () => {
    expect(asPlayer({ ...validPlayer, appearance: null })).toBeNull();
  });

  it('returns null when total_xp is not number', () => {
    expect(asPlayer({ ...validPlayer, total_xp: 'zero' })).toBeNull();
  });
});

describe('asPlayerState', () => {
  const validState = {
    schema_version: 1,
    current_zone_id: 'blatiny',
    current_position: { x: 25, y: 25 },
    hp_current: 10,
    hp_max: 10,
    mana_current: 0,
    death_debuff_expires_at: null,
    last_logout_at: '2026-01-01T00:00:00Z',
  };

  it('accepts valid PlayerState object', () => {
    expect(asPlayerState(validState)).toEqual(validState);
  });

  it('returns null for null', () => {
    expect(asPlayerState(null)).toBeNull();
  });

  it('returns null for non-object', () => {
    expect(asPlayerState('string')).toBeNull();
  });

  it('returns null when schema_version missing', () => {
    const { schema_version, ...rest } = validState;
    expect(asPlayerState(rest)).toBeNull();
  });

  it('returns null when current_zone_id is not string', () => {
    expect(asPlayerState({ ...validState, current_zone_id: 42 })).toBeNull();
  });

  it('returns null when current_position is null', () => {
    expect(asPlayerState({ ...validState, current_position: null })).toBeNull();
  });

  it('returns null when position.x is not number', () => {
    expect(asPlayerState({ ...validState, current_position: { x: 'a', y: 25 } })).toBeNull();
  });

  it('returns null when hp_current is not number', () => {
    expect(asPlayerState({ ...validState, hp_current: null })).toBeNull();
  });

  it('returns null when hp_max is not number', () => {
    expect(asPlayerState({ ...validState, hp_max: 'ten' })).toBeNull();
  });
});
