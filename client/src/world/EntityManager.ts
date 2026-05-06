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
  // Phase 10: resource nodes + craft stations.
  readonly resourceNodeSprites = new Map<string, Phaser.GameObjects.Container>();
  readonly resourceNodePositions = new Map<string, Position>();
  readonly craftStationSprites = new Map<string, Phaser.GameObjects.Container>();
  readonly craftStationPositions = new Map<string, Position>();
  readonly craftStationTypes = new Map<string, string>();
  // Phase 11: quest objects.
  readonly questObjectSprites = new Map<string, Phaser.GameObjects.Container>();
  readonly questObjectPositions = new Map<string, Position>();
  readonly questObjectDisplayNames = new Map<string, string>();

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

  // Phase 10: Resource node placeholder — colored circle + label, depth ~props band.
  spawnResourceNode(entity: WorldSnapshotEntity): void {
    if (!entity?.id || entity.type !== 'resource_node' || this.resourceNodeSprites.has(entity.id)) return;

    const { x, y } = entity.position;
    const center = tileCenterPx(x, y);
    const kind = entity.resource_kind ?? 'ore_node';
    const color = kind === 'tree' ? 0x2d6a2f : kind === 'ore_node' ? 0x8a8580 : 0xb56a3e;
    const circle = this.scene.add.circle(0, -8, 14, color).setStrokeStyle(2, 0xffeeaa);
    const label = this.scene.add
      .text(0, -28, entity.display_name_cs ?? 'Surovinový bod', {
        fontSize: '10px',
        color: '#f7e9c8',
        backgroundColor: '#000000a0',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1);
    const container = this.scene.add.container(center.x, center.y, [circle, label]);
    container.setDepth(depthForDynamic(y) - 2);
    container.setData('resourceNodeId', entity.id);
    container.setData('resourceKind', kind);

    this.resourceNodeSprites.set(entity.id, container);
    this.resourceNodePositions.set(entity.id, { x, y });
  }

  findResourceNodeAtTile(tileX: number, tileY: number): string | null {
    for (const [nodeId, pos] of this.resourceNodePositions) {
      if (pos.x === tileX && pos.y === tileY) return nodeId;
    }
    return null;
  }

  getResourceNodePosition(nodeId: string): Position | undefined {
    return this.resourceNodePositions.get(nodeId);
  }

  // Phase 10: Craft station placeholder — orange square + name label.
  spawnCraftStation(entity: WorldSnapshotEntity): void {
    if (!entity?.id || entity.type !== 'craft_station' || this.craftStationSprites.has(entity.id)) return;

    const { x, y } = entity.position;
    const center = tileCenterPx(x, y);
    const stationType = entity.station_type ?? 'smith_forge';
    const color = stationType === 'smith_forge' ? 0xc25c2c : 0xa37b3d;
    const rect = this.scene.add.rectangle(0, -10, 26, 26, color).setStrokeStyle(2, 0xffeeaa);
    const label = this.scene.add
      .text(0, -32, entity.display_name_cs ?? 'Kovárna', {
        fontSize: '10px',
        color: '#f7e9c8',
        backgroundColor: '#000000a0',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1);
    const container = this.scene.add.container(center.x, center.y, [rect, label]);
    container.setDepth(depthForDynamic(y) - 2);
    container.setData('stationId', entity.id);
    container.setData('stationType', stationType);

    this.craftStationSprites.set(entity.id, container);
    this.craftStationPositions.set(entity.id, { x, y });
    this.craftStationTypes.set(entity.id, stationType);
  }

  findCraftStationAtTile(tileX: number, tileY: number): string | null {
    for (const [id, pos] of this.craftStationPositions) {
      if (pos.x === tileX && pos.y === tileY) return id;
    }
    return null;
  }

  // Vrátí true pokud je hráč ≤ 2 dlaždice (Chebyshev) od libovolné stanice
  // požadovaného typu.
  isStationInRange(playerX: number, playerY: number, stationType: string): boolean {
    for (const [id, pos] of this.craftStationPositions) {
      if (this.craftStationTypes.get(id) !== stationType) continue;
      const cheb = Math.max(Math.abs(playerX - pos.x), Math.abs(playerY - pos.y));
      if (cheb <= 2) return true;
    }
    return false;
  }

  // Phase 11: quest object placeholder — magenta diamond + label, depth ~props band.
  // Po interakci server pošle ENTITY_DESPAWNED, despawnEntity() je odebere.
  spawnQuestObject(entity: WorldSnapshotEntity): void {
    if (!entity?.id || entity.type !== 'quest_object' || this.questObjectSprites.has(entity.id)) return;

    const { x, y } = entity.position;
    const center = tileCenterPx(x, y);
    const star = this.scene.add.star(0, -10, 5, 6, 14, 0xd6457c).setStrokeStyle(2, 0xffeeaa);
    const label = this.scene.add
      .text(0, -32, entity.display_name_cs ?? 'Quest objekt', {
        fontSize: '10px',
        color: '#ffd1ec',
        backgroundColor: '#000000a0',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1);
    const container = this.scene.add.container(center.x, center.y, [star, label]);
    container.setDepth(depthForDynamic(y) - 1);
    container.setData('questObjectId', entity.quest_object_id ?? entity.id);

    this.questObjectSprites.set(entity.id, container);
    this.questObjectPositions.set(entity.id, { x, y });
    this.questObjectDisplayNames.set(entity.id, entity.display_name_cs ?? 'Něco zvláštního');
  }

  getQuestObjectDisplayName(id: string): string | undefined {
    return this.questObjectDisplayNames.get(id);
  }

  findQuestObjectAtTile(tileX: number, tileY: number): string | null {
    for (const [id, pos] of this.questObjectPositions) {
      if (pos.x === tileX && pos.y === tileY) return id;
    }
    return null;
  }

  getQuestObjectPosition(id: string): Position | undefined {
    return this.questObjectPositions.get(id);
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
      return;
    }
    const node = this.resourceNodeSprites.get(entityId);
    if (node) {
      node.destroy();
      this.resourceNodeSprites.delete(entityId);
      this.resourceNodePositions.delete(entityId);
      return;
    }
    const station = this.craftStationSprites.get(entityId);
    if (station) {
      station.destroy();
      this.craftStationSprites.delete(entityId);
      this.craftStationPositions.delete(entityId);
      this.craftStationTypes.delete(entityId);
      return;
    }
    const questObj = this.questObjectSprites.get(entityId);
    if (questObj) {
      questObj.destroy();
      this.questObjectSprites.delete(entityId);
      this.questObjectPositions.delete(entityId);
      this.questObjectDisplayNames.delete(entityId);
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
    for (const s of this.resourceNodeSprites.values()) s.destroy();
    this.resourceNodeSprites.clear();
    for (const s of this.craftStationSprites.values()) s.destroy();
    this.craftStationSprites.clear();
    for (const s of this.questObjectSprites.values()) s.destroy();
    this.questObjectSprites.clear();
    this.tilePositions.clear();
    this.dropTilePositions.clear();
    this.npcTilePositions.clear();
    this.resourceNodePositions.clear();
    this.craftStationPositions.clear();
    this.craftStationTypes.clear();
    this.questObjectPositions.clear();
    this.questObjectDisplayNames.clear();
  }
}
