import { describe, expect, it } from 'vitest';
import { isWalkableGid } from 'irij-shared';

describe('isWalkableGid (shared)', () => {
  it('returns false for gid 0 (void)', () => {
    expect(isWalkableGid(0)).toBe(false);
  });

  it('returns false for gid 3 (water)', () => {
    expect(isWalkableGid(3)).toBe(false);
  });

  it('returns true for gid 1 (grass)', () => {
    expect(isWalkableGid(1)).toBe(true);
  });

  it('returns true for gid 2 (dirt)', () => {
    expect(isWalkableGid(2)).toBe(true);
  });
});
