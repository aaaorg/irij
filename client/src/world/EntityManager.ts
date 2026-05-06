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

// Phase 9: NPC placeholder uses character spritesheet + per-NPC tint until art pass.
const NPC_TINTS: Record<string, number> = {
  'npc.kovar_blatiny': 0xd49d4f, // amber/copper — kovář
  'npc.selka_hospoda': 0xc8d4ad, // pale lime — selka
};

export class EntityManager {
  readonly otherPlayers = new Map<string, Phaser.GameObjects.Sprite>();
  readonly mobSprites = new Map<string, Phaser.GameObjects.Sprite>();
  readonly dropSprites = new Map<string, Phaser.GameObjects.Sprite>();
  readonly npcSprites = new Map<string, Phaser.GameObjects.Sprite>();
  readonly npcTilePositions = new Map<string, Position>();
  readonly tilePositions = new Map<string, Position>();
  // Tile positions for drop entities (separate map for O(1) pickup detection).
  readonly dropTilePositions = new Map<string, Position>();

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

  spawnNpc(entity: WorldSnapshotEntity): void {
    if (!entity?.id || entity.type !== 'npc' || this.npcSprites.has(entity.id)) return;

    const { x, y } = entity.position;
    const center = tileCenterPx(x, y);

    const sprite = this.scene.add
      .sprite(center.x, center.y, CHARACTER_KEY, FRAME_FACING_SE)
      .setOrigin(0.5, 1)
      .setDepth(depthForDynamic(y));

    const tint = NPC_TINTS[entity.npc_id ?? ''] ?? 0xeeccaa;
    sprite.setTint(tint);

    if (entity.display_name_cs) sprite.setData('displayName', entity.display_name_cs);
    if (entity.npc_id) sprite.setData('npcId', entity.npc_id);

    this.npcSprites.set(entity.id, sprite);
    this.npcTilePositions.set(entity.id, { x, y });
  }

  // Returns the npc instanceId if a NPC occupies exactly the given tile.
  // Used for click-to-talk routing — exact-tile match nutí navigaci k NPC,
  // ne fake "interact from across the map" jako broader Chebyshev oblast.
  findNpcAtTile(tileX: number, tileY: number): string | null {
    for (const [npcId, pos] of this.npcTilePositions) {
      if (pos.x === tileX && pos.y === tileY) return npcId;
    }
    return null;
  }

  getNpcPosition(instanceId: string): { x: number; y: number } | undefined {
    return this.npcTilePositions.get(instanceId);
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
    this.dropTilePositions.set(entity.id, { x, y });
  }

  // Returns the dropId if any drop occupies the given tile (Chebyshev ≤ 1 tolerance).
  findDropAtTile(tileX: number, tileY: number): string | null {
    for (const [dropId, pos] of this.dropTilePositions) {
      if (Math.abs(pos.x - tileX) <= 1 && Math.abs(pos.y - tileY) <= 1) {
        return dropId;
      }
    }
    return null;
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
      this.dropTilePositions.delete(entityId);
      return;
    }
    const npc = this.npcSprites.get(entityId);
    if (npc) {
      npc.destroy();
      this.npcSprites.delete(entityId);
      this.npcTilePositions.delete(entityId);
    }
  }

  destroy(): void {
    for (const s of this.otherPlayers.values()) s.destroy();
    this.otherPlayers.clear();
    for (const s of this.mobSprites.values()) s.destroy();
    this.mobSprites.clear();
    for (const s of this.dropSprites.values()) s.destroy();
    this.dropSprites.clear();
    for (const s of this.npcSprites.values()) s.destroy();
    this.npcSprites.clear();
    this.tilePositions.clear();
    this.dropTilePositions.clear();
    this.npcTilePositions.clear();
  }
}
