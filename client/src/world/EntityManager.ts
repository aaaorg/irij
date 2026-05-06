import Phaser from 'phaser';
import type { WorldSnapshotEntity } from 'irij-shared/messages';
import type { Position } from 'irij-shared/types';
import { tileCenterPx } from '../render/projection.js';
import { depthForDynamic } from '../render/ysort.js';

export const CHARACTER_KEY = 'characterPlaceholder';
export const WOLF_KEY = 'mobWolf';
export const RAT_KEY = 'mobRat';
export const DROP_KEY = 'dropPlaceholder';
export const FRAME_FACING_SE = 0;

const MOB_TEXTURE_MAP: Record<string, string> = {
  'mob.wolf': WOLF_KEY,
  'mob.giant_rat': RAT_KEY,
};

const MOB_HP_MAX: Record<string, number> = {
  'mob.wolf': 30,
  'mob.giant_rat': 15,
};

export class EntityManager {
  readonly otherPlayers = new Map<string, Phaser.GameObjects.Sprite>();
  readonly mobSprites = new Map<string, Phaser.GameObjects.Sprite>();
  readonly dropSprites = new Map<string, Phaser.GameObjects.Sprite>();
  readonly tilePositions = new Map<string, Position>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly selfUserId: string,
  ) {}

  getSprite(entityId: string): Phaser.GameObjects.Sprite | undefined {
    return this.otherPlayers.get(entityId) ?? this.mobSprites.get(entityId);
  }

  spawnRemotePlayer(entity: WorldSnapshotEntity): void {
    if (!entity?.id || entity.type !== 'player') return;
    if (entity.id === this.selfUserId || this.otherPlayers.has(entity.id)) return;

    const { x, y } = entity.position;
    const center = tileCenterPx(x, y);
    const sprite = this.scene.add
      .sprite(center.x, center.y, CHARACTER_KEY, FRAME_FACING_SE)
      .setOrigin(0.5, 1)
      .setDepth(depthForDynamic(y));
    if (entity.display_name) sprite.setData('displayName', entity.display_name);
    this.otherPlayers.set(entity.id, sprite);
    this.tilePositions.set(entity.id, { x, y });
  }

  spawnMob(entity: WorldSnapshotEntity): number {
    if (!entity?.id || this.mobSprites.has(entity.id)) return 1;

    const { x, y } = entity.position;
    const center = tileCenterPx(x, y);
    const textureKey = MOB_TEXTURE_MAP[entity.mob_id ?? ''] ?? WOLF_KEY;

    const sprite = this.scene.add
      .sprite(center.x, center.y, textureKey, FRAME_FACING_SE)
      .setOrigin(0.5, 1)
      .setDepth(depthForDynamic(y));

    if (entity.display_name_cs) sprite.setData('displayName', entity.display_name_cs);
    if (entity.level !== undefined) sprite.setData('level', entity.level);
    sprite.setData('hpMax', MOB_HP_MAX[entity.mob_id ?? ''] ?? 30);

    this.mobSprites.set(entity.id, sprite);
    this.tilePositions.set(entity.id, { x, y });

    return entity.hp_pct ?? 1;
  }

  spawnDrop(entity: WorldSnapshotEntity): void {
    if (!entity?.id || this.dropSprites.has(entity.id)) return;

    const { x, y } = entity.position;
    const center = tileCenterPx(x, y);

    const sprite = this.scene.add
      .sprite(center.x, center.y, DROP_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(depthForDynamic(y) - 1);

    this.dropSprites.set(entity.id, sprite);
  }

  clearRemotePlayers(): void {
    for (const [id] of this.otherPlayers) {
      this.tilePositions.delete(id);
    }
    for (const sprite of this.otherPlayers.values()) sprite.destroy();
    this.otherPlayers.clear();
  }

  despawnEntity(entityId: string): void {
    const player = this.otherPlayers.get(entityId);
    if (player) {
      player.destroy();
      this.otherPlayers.delete(entityId);
      this.tilePositions.delete(entityId);
      return;
    }
    const mob = this.mobSprites.get(entityId);
    if (mob) {
      mob.destroy();
      this.mobSprites.delete(entityId);
      this.tilePositions.delete(entityId);
      return;
    }
    const drop = this.dropSprites.get(entityId);
    if (drop) {
      drop.destroy();
      this.dropSprites.delete(entityId);
    }
  }

  destroy(): void {
    for (const s of this.otherPlayers.values()) s.destroy();
    this.otherPlayers.clear();
    for (const s of this.mobSprites.values()) s.destroy();
    this.mobSprites.clear();
    for (const s of this.dropSprites.values()) s.destroy();
    this.dropSprites.clear();
    this.tilePositions.clear();
  }
}
