import Phaser from 'phaser';
import type {
  CombatResolved,
  EntityDespawned,
  EntityDied,
  EntityMoved,
  EntitySpawned,
  FindOrCreateMatchResponse,
  MoveRejected,
  WorldSnapshot,
  WorldSnapshotEntity,
} from 'irij-shared/messages';
import { Op } from 'irij-shared/messages';
import type { Position } from 'irij-shared/types';
import type { NakamaConnection } from '../nakama.js';
import { TILE_H_PX, TILE_W_PX, screenToTile, worldToScreen } from '../render/projection.js';
import { depthForDynamic } from '../render/ysort.js';
import { callRpc } from '../rpc.js';
import { REGISTRY_KEY_CONNECTION, REGISTRY_KEY_PLAYER, type PlayerProfile } from './LoginScene.js';

const MAP_KEY = 'mapTest';
const TILESET_IMAGE_KEY = 'tilesetPlaceholder';
const TILESET_NAME = 'placeholder';
const TERRAIN_LAYER_NAME = 'terrain';
const CHARACTER_KEY = 'characterPlaceholder';
const WOLF_KEY = 'mobWolf';
const RAT_KEY = 'mobRat';
const DROP_KEY = 'dropPlaceholder';

const FRAME_FACING_SE = 0;

const HUD_GUARD_W = 200;
const HUD_GUARD_H = 30;

const MOB_TEXTURE_MAP: Record<string, string> = {
  'mob.wolf': WOLF_KEY,
  'mob.giant_rat': RAT_KEY,
};

interface EntityMovementState {
  from: Position;
  path: Position[];
  speedTps: number;
  startedAtMs: number;
}

interface HpBarState {
  bg: Phaser.GameObjects.Rectangle;
  fg: Phaser.GameObjects.Rectangle;
  hpPct: number;
}

export class WorldScene extends Phaser.Scene {
  private player?: Phaser.GameObjects.Sprite;
  private matchId?: string;
  private connRef?: NakamaConnection;
  private selfUserId?: string;
  private otherPlayers: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private mobSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private dropSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private entityMoveStates: Map<string, EntityMovementState> = new Map();
  private hpBars: Map<string, HpBarState> = new Map();
  private entityTilePositions: Map<string, Position> = new Map();
  private clientSeq = 0;
  private rejectToast?: Phaser.GameObjects.Text;
  private pendingAttackTarget: string | null = null;
  private selfTilePosition: Position = { x: 25, y: 25 };

  constructor() {
    super('WorldScene');
  }

  preload(): void {
    this.load.image(TILESET_IMAGE_KEY, 'maps/placeholder_iso_tileset.png');
    this.load.tilemapTiledJSON(MAP_KEY, 'maps/test_50x50.tmj');
    this.load.spritesheet(CHARACTER_KEY, 'sprites/placeholder_character.png', {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet(WOLF_KEY, 'sprites/placeholder_wolf.png', {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet(RAT_KEY, 'sprites/placeholder_rat.png', {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.image(DROP_KEY, 'sprites/placeholder_drop.png');
  }

  create(): void {
    const conn = this.registry.get(REGISTRY_KEY_CONNECTION) as NakamaConnection | undefined;
    const profile = this.registry.get(REGISTRY_KEY_PLAYER) as PlayerProfile | undefined;

    if (!conn || !profile) {
      console.warn('WorldScene started without connection/profile — returning to LoginScene');
      this.scene.start('LoginScene');
      return;
    }

    this.buildTilemap();
    this.spawnPlayer(profile);
    this.buildHud(profile);

    this.connRef = conn;
    this.selfUserId = conn.session.user_id;

    conn.socket.ondisconnect = (evt) => {
      console.warn('Nakama socket disconnected', evt);
      this.scene.start('LoginScene');
    };

    this.scale.on('resize', this.onResize, this);
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    this.joinWorldMatch(conn).catch((err) => {
      console.error('joinWorldMatch failed', err);
    });
  }

  private async joinWorldMatch(conn: NakamaConnection): Promise<void> {
    const response = await callRpc<Record<string, never>, FindOrCreateMatchResponse>(
      conn,
      'rpc.world.find_or_create_match',
      {},
    );
    if (!response.ok) {
      console.error(`find_or_create_match failed: ${response.error}`);
      return;
    }

    const { match_id } = response;
    console.log(`Joining world match ${match_id}`);

    conn.socket.onmatchdata = (md) => {
      let payload: unknown;
      try {
        const text =
          typeof md.data === 'string'
            ? md.data
            : new TextDecoder().decode(md.data as unknown as ArrayBuffer);
        payload = text.length > 0 ? JSON.parse(text) : null;
      } catch (err) {
        console.warn(`Failed to decode match data op=${md.op_code}`, err);
        return;
      }

      switch (md.op_code) {
        case Op.WORLD_SNAPSHOT:
          this.handleWorldSnapshot(payload as WorldSnapshot);
          break;
        case Op.ENTITY_SPAWNED:
          this.handleEntitySpawned(payload as EntitySpawned);
          break;
        case Op.ENTITY_DESPAWNED:
          this.handleEntityDespawned(payload as EntityDespawned);
          break;
        case Op.ENTITY_MOVED:
          this.handleEntityMoved(payload as EntityMoved);
          break;
        case Op.MOVE_REJECTED:
          this.handleMoveRejected(payload as MoveRejected);
          break;
        case Op.COMBAT_RESOLVED:
          this.handleCombatResolved(payload as CombatResolved);
          break;
        case Op.ENTITY_DIED:
          this.handleEntityDied(payload as EntityDied);
          break;
        default:
          console.debug(`[match] unhandled op=${md.op_code}`);
      }
    };
    conn.socket.onmatchpresence = (mp) => {
      const joinIds = (mp.joins ?? []).map((p) => p.user_id ?? p.username);
      const leaveIds = (mp.leaves ?? []).map((p) => p.user_id ?? p.username);
      console.log(`[match presence] joins=${JSON.stringify(joinIds)} leaves=${JSON.stringify(leaveIds)}`);
    };

    try {
      const match = await conn.socket.joinMatch(match_id);
      this.matchId = match.match_id;
      console.log(`Joined match ${this.matchId} (size=${match.size})`);
    } catch (err) {
      console.error('socket.joinMatch failed', err);
    }
  }

  // === Match data handlers ============================================

  private handleWorldSnapshot(snapshot: WorldSnapshot): void {
    if (!snapshot || !Array.isArray(snapshot.entities)) return;

    // Clean up stale remote players before processing snapshot (prevents duplicate sprites
    // when Playwright smoke test or rapid reconnect produces overlapping sessions)
    for (const [id, sprite] of this.otherPlayers) {
      this.entityMoveStates.delete(id);
      this.removeHpBar(id);
      this.entityTilePositions.delete(id);
      sprite.destroy();
    }
    this.otherPlayers.clear();

    for (const entity of snapshot.entities) {
      if (entity.type === 'player') {
        this.spawnRemotePlayerIfNeeded(entity);
        if (
          entity.id !== this.selfUserId &&
          entity.path &&
          entity.path.length > 0 &&
          entity.speed_tps !== undefined
        ) {
          this.startEntityMovement(entity.id, entity.position, entity.path, entity.speed_tps);
        }
      } else if (entity.type === 'mob') {
        this.spawnMobIfNeeded(entity);
        if (entity.path && entity.path.length > 0 && entity.speed_tps !== undefined) {
          this.startEntityMovement(entity.id, entity.position, entity.path, entity.speed_tps);
        }
      } else if (entity.type === 'drop') {
        this.spawnDropIfNeeded(entity);
      }
    }
  }

  private handleEntitySpawned(payload: EntitySpawned): void {
    if (!payload?.entity_id) return;
    if (payload.type === 'player') {
      if (payload.entity_id === this.selfUserId) return;
      this.spawnRemotePlayerIfNeeded({
        id: payload.entity_id,
        type: 'player',
        position: payload.position,
        display_name: payload.display_name,
        hp_pct: payload.hp_pct,
      });
    } else if (payload.type === 'mob') {
      this.spawnMobIfNeeded({
        id: payload.entity_id,
        type: 'mob',
        position: payload.position,
        mob_id: payload.mob_id,
        display_name_cs: payload.display_name_cs,
        level: payload.level,
        hp_pct: payload.hp_pct,
      });
    } else if (payload.type === 'drop') {
      this.spawnDropIfNeeded({
        id: payload.entity_id,
        type: 'drop',
        position: payload.position,
        items: payload.items,
      });
    }
  }

  private handleEntityDespawned(payload: EntityDespawned): void {
    if (!payload?.entity_id) return;
    const entityId = payload.entity_id;

    // Player
    const playerSprite = this.otherPlayers.get(entityId);
    if (playerSprite) {
      this.entityMoveStates.delete(entityId);
      this.tweens.killTweensOf(playerSprite);
      playerSprite.destroy();
      this.otherPlayers.delete(entityId);
      this.removeHpBar(entityId);
      this.entityTilePositions.delete(entityId);
      return;
    }

    // Mob
    const mobSprite = this.mobSprites.get(entityId);
    if (mobSprite) {
      this.entityMoveStates.delete(entityId);
      this.tweens.killTweensOf(mobSprite);
      mobSprite.destroy();
      this.mobSprites.delete(entityId);
      this.removeHpBar(entityId);
      this.entityTilePositions.delete(entityId);
      return;
    }

    // Drop
    const dropSprite = this.dropSprites.get(entityId);
    if (dropSprite) {
      dropSprite.destroy();
      this.dropSprites.delete(entityId);
    }
  }

  private handleEntityMoved(payload: EntityMoved): void {
    if (!payload?.entity_id || !payload.from || !Array.isArray(payload.path)) return;
    if (payload.path.length === 0) return;
    if (typeof payload.speed_tps !== 'number' || payload.speed_tps <= 0) return;

    const hasSprite =
      payload.entity_id === this.selfUserId
        ? !!this.player
        : this.otherPlayers.has(payload.entity_id) || this.mobSprites.has(payload.entity_id);
    if (!hasSprite) {
      console.warn(`[match ENTITY_MOVED] sprite not found for ${payload.entity_id.slice(0, 8)}`);
      return;
    }

    this.startEntityMovement(payload.entity_id, payload.from, payload.path, payload.speed_tps);
  }

  private handleCombatResolved(payload: CombatResolved): void {
    if (!payload) return;

    const targetSprite =
      this.mobSprites.get(payload.target_id) ??
      this.otherPlayers.get(payload.target_id) ??
      (payload.target_id === this.selfUserId ? this.player : undefined);

    if (targetSprite) {
      const isSelfTarget = payload.target_id === this.selfUserId;
      let color = '#ffffff';
      if (isSelfTarget) color = '#ff4444';
      if (payload.hit_type === 'critical') color = '#ffff00';
      if (payload.hit_type === 'miss') color = '#888888';

      const text = payload.hit_type === 'miss' ? 'Miss' : String(payload.damage);
      this.showFloatingText(targetSprite.x, targetSprite.y - 20, text, color);
    }

    // Update HP bar
    const mob = this.mobSprites.get(payload.target_id);
    if (mob) {
      const def = mob.getData('hpMax') as number | undefined;
      if (def && def > 0) {
        this.updateHpBar(payload.target_id, payload.remaining_hp / def);
      }
    }

    // Self HP update
    if (payload.target_id === this.selfUserId && this.player) {
      const hpMax = this.player.getData('hpMax') as number ?? 10;
      if (hpMax > 0) {
        this.updateHpBar('self', payload.remaining_hp / hpMax);
      }
    }
  }

  private handleEntityDied(payload: EntityDied): void {
    if (!payload?.entity_id) return;

    const mobSprite = this.mobSprites.get(payload.entity_id);
    if (mobSprite) {
      this.entityMoveStates.delete(payload.entity_id);
      this.removeHpBar(payload.entity_id);
      this.entityTilePositions.delete(payload.entity_id);
      this.tweens.add({
        targets: mobSprite,
        alpha: 0,
        duration: 500,
        ease: 'Linear',
        onComplete: () => {
          mobSprite.destroy();
          this.mobSprites.delete(payload.entity_id);
        },
      });
    }

    if (payload.killer_id === this.selfUserId && payload.xp_awarded.length > 0) {
      const xpText = payload.xp_awarded
        .map((a) => `+${a.amount} ${a.skill}`)
        .join(', ');
      this.showToast(`XP: ${xpText}`, '#44ff44');
    }
  }

  private handleMoveRejected(payload: MoveRejected): void {
    if (!payload) return;
    console.warn(`[match MOVE_REJECTED] reason=${payload.reason} client_seq=${payload.client_seq}`);
    if (payload.reason === 'rate_limited') return;
    this.showMoveRejectedToast(payload.reason);
  }

  // === Movement ======================================================

  private startEntityMovement(
    entityId: string,
    from: Position,
    path: Position[],
    speedTps: number,
  ): void {
    if (path.length === 0) return;
    this.entityMoveStates.set(entityId, {
      from: { x: from.x, y: from.y },
      path: path.map((p) => ({ x: p.x, y: p.y })),
      speedTps,
      startedAtMs: Date.now(),
    });
    this.entityTilePositions.set(entityId, { x: from.x, y: from.y });
  }

  override update(_time: number, _delta: number): void {
    if (this.entityMoveStates.size === 0 && this.hpBars.size === 0) return;
    const now = Date.now();
    const completed: string[] = [];

    for (const [entityId, state] of this.entityMoveStates) {
      const sprite = this.getSpriteForEntity(entityId);
      if (!sprite) {
        completed.push(entityId);
        continue;
      }

      const elapsedMs = now - state.startedAtMs;
      const tilesElapsed = (elapsedMs * state.speedTps) / 1000;

      if (tilesElapsed >= state.path.length) {
        const last = state.path[state.path.length - 1];
        if (last) {
          const px = this.tileCenterPx(last);
          sprite.setPosition(px.x, px.y);
          sprite.setDepth(depthForDynamic(last.y));
          this.entityTilePositions.set(entityId, { x: last.x, y: last.y });
          if (entityId === this.selfUserId) {
            this.selfTilePosition = { x: last.x, y: last.y };
          }
        }
        completed.push(entityId);
        continue;
      }

      const idx = Math.floor(Math.max(0, tilesElapsed));
      const subTile = tilesElapsed - idx;
      const startTile = idx === 0 ? state.from : (state.path[idx - 1] ?? state.from);
      const endTile = state.path[idx];
      if (!endTile) {
        completed.push(entityId);
        continue;
      }

      const startPx = this.tileCenterPx(startTile);
      const endPx = this.tileCenterPx(endTile);
      const x = startPx.x + (endPx.x - startPx.x) * subTile;
      const y = startPx.y + (endPx.y - startPx.y) * subTile;
      const lerpedY = startTile.y + (endTile.y - startTile.y) * subTile;

      sprite.setPosition(x, y);
      sprite.setDepth(depthForDynamic(lerpedY));
      this.entityTilePositions.set(entityId, { x: endTile.x, y: endTile.y });
      if (entityId === this.selfUserId) {
        this.selfTilePosition = { x: endTile.x, y: endTile.y };
      }
    }

    for (const id of completed) {
      this.entityMoveStates.delete(id);
      if (id === this.selfUserId) {
        this.checkPendingAttack();
      }
    }

    this.updateAllHpBarPositions();

    if (this.pendingAttackTarget) {
      this.checkPendingAttack();
    }
  }

  private checkPendingAttack(): void {
    if (!this.pendingAttackTarget || !this.connRef || !this.matchId) return;

    const targetId = this.pendingAttackTarget;
    const mobSprite = this.mobSprites.get(targetId);
    if (!mobSprite || !mobSprite.active || mobSprite.alpha <= 0) {
      this.pendingAttackTarget = null;
      return;
    }

    const mobPos = this.entityTilePositions.get(targetId);
    if (!mobPos) {
      this.pendingAttackTarget = null;
      return;
    }

    const dist = Math.max(
      Math.abs(this.selfTilePosition.x - mobPos.x),
      Math.abs(this.selfTilePosition.y - mobPos.y),
    );

    if (dist === 1) {
      // In range — attack
      this.pendingAttackTarget = null;
      this.clientSeq += 1;
      const payload = JSON.stringify({
        target_id: targetId,
        client_seq: this.clientSeq,
      });
      this.connRef.socket
        .sendMatchState(this.matchId, Op.ATTACK_REQUEST, payload)
        .catch((err) => {
          console.warn(`sendMatchState ATTACK_REQUEST failed`, err);
        });
    } else if (!this.selfUserId || !this.entityMoveStates.has(this.selfUserId)) {
      // Not moving and not in range — re-approach
      const approachTile = this.findBestAdjacentTile(mobPos);
      this.clientSeq += 1;
      const payload = JSON.stringify({
        target: approachTile,
        client_seq: this.clientSeq,
      });
      this.connRef.socket
        .sendMatchState(this.matchId, Op.MOVE_REQUEST, payload)
        .catch((err) => {
          console.warn(`sendMatchState MOVE_REQUEST (re-approach) failed`, err);
        });
    }
  }

  private getSpriteForEntity(entityId: string): Phaser.GameObjects.Sprite | undefined {
    if (entityId === this.selfUserId) return this.player;
    return this.otherPlayers.get(entityId) ?? this.mobSprites.get(entityId);
  }

  private tileCenterPx(tile: Position): { x: number; y: number } {
    const { sx, sy } = worldToScreen(tile.x, tile.y);
    return { x: sx + TILE_W_PX / 2, y: sy + TILE_H_PX / 2 };
  }

  // === Sprite helpers =================================================

  private spawnRemotePlayerIfNeeded(entity: WorldSnapshotEntity): void {
    if (!entity?.id) return;
    if (entity.type !== 'player') return;
    if (entity.id === this.selfUserId) return;
    if (this.otherPlayers.has(entity.id)) return;

    const { x, y } = entity.position;
    const center = this.tileCenterPx({ x, y });

    const sprite = this.add
      .sprite(center.x, center.y, CHARACTER_KEY, FRAME_FACING_SE)
      .setOrigin(0.5, 1)
      .setDepth(depthForDynamic(y));
    if (entity.display_name) sprite.setData('displayName', entity.display_name);
    this.otherPlayers.set(entity.id, sprite);
    this.entityTilePositions.set(entity.id, { x, y });
  }

  private spawnMobIfNeeded(entity: WorldSnapshotEntity): void {
    if (!entity?.id) return;
    if (this.mobSprites.has(entity.id)) return;

    const { x, y } = entity.position;
    const center = this.tileCenterPx({ x, y });
    const textureKey = MOB_TEXTURE_MAP[entity.mob_id ?? ''] ?? WOLF_KEY;

    const sprite = this.add
      .sprite(center.x, center.y, textureKey, FRAME_FACING_SE)
      .setOrigin(0.5, 1)
      .setDepth(depthForDynamic(y));

    if (entity.display_name_cs) sprite.setData('displayName', entity.display_name_cs);
    if (entity.level !== undefined) sprite.setData('level', entity.level);
    const hpPct = entity.hp_pct ?? 1;

    // Store hp_max for later updates. We infer from mob_id.
    const hpMaxMap: Record<string, number> = { 'mob.wolf': 30, 'mob.giant_rat': 15 };
    sprite.setData('hpMax', hpMaxMap[entity.mob_id ?? ''] ?? 30);

    this.mobSprites.set(entity.id, sprite);
    this.entityTilePositions.set(entity.id, { x, y });

    if (hpPct < 1) {
      this.createHpBar(entity.id, sprite, hpPct);
    }
  }

  private spawnDropIfNeeded(entity: WorldSnapshotEntity): void {
    if (!entity?.id) return;
    if (this.dropSprites.has(entity.id)) return;

    const { x, y } = entity.position;
    const center = this.tileCenterPx({ x, y });

    const sprite = this.add
      .sprite(center.x, center.y, DROP_KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(depthForDynamic(y) - 1);

    this.dropSprites.set(entity.id, sprite);
  }

  // === HP Bar =========================================================

  private createHpBar(entityId: string, sprite: Phaser.GameObjects.Sprite, hpPct: number): void {
    const barW = 28;
    const barH = 4;
    const bg = this.add
      .rectangle(sprite.x - barW / 2, sprite.y - sprite.height - 6, barW, barH, 0x440000)
      .setOrigin(0, 0)
      .setDepth(depthForDynamic(sprite.y) + 1);
    const fg = this.add
      .rectangle(sprite.x - barW / 2, sprite.y - sprite.height - 6, barW * hpPct, barH, 0x00cc00)
      .setOrigin(0, 0)
      .setDepth(depthForDynamic(sprite.y) + 2);

    this.hpBars.set(entityId, { bg, fg, hpPct });
  }

  private updateHpBar(entityId: string, hpPct: number): void {
    const existing = this.hpBars.get(entityId);
    if (existing) {
      existing.hpPct = hpPct;
      existing.fg.width = 28 * Math.max(0, hpPct);
      if (hpPct < 0.3) {
        existing.fg.fillColor = 0xcc0000;
      } else if (hpPct < 0.6) {
        existing.fg.fillColor = 0xcccc00;
      } else {
        existing.fg.fillColor = 0x00cc00;
      }
    } else {
      let sprite: Phaser.GameObjects.Sprite | undefined;
      if (entityId === 'self') {
        sprite = this.player;
      } else {
        sprite = this.mobSprites.get(entityId) ?? this.otherPlayers.get(entityId);
      }
      if (sprite) {
        this.createHpBar(entityId === 'self' ? 'self' : entityId, sprite, hpPct);
      }
    }
  }

  private removeHpBar(entityId: string): void {
    const bar = this.hpBars.get(entityId);
    if (bar) {
      bar.bg.destroy();
      bar.fg.destroy();
      this.hpBars.delete(entityId);
    }
  }

  private updateAllHpBarPositions(): void {
    for (const [entityId, bar] of this.hpBars) {
      let sprite: Phaser.GameObjects.Sprite | undefined;
      if (entityId === 'self') {
        sprite = this.player;
      } else {
        sprite = this.mobSprites.get(entityId) ?? this.otherPlayers.get(entityId);
      }
      if (!sprite || !sprite.active) {
        this.removeHpBar(entityId);
        continue;
      }
      const barW = 28;
      bar.bg.setPosition(sprite.x - barW / 2, sprite.y - sprite.height - 6);
      bar.fg.setPosition(sprite.x - barW / 2, sprite.y - sprite.height - 6);
      bar.bg.setDepth(sprite.depth + 1);
      bar.fg.setDepth(sprite.depth + 2);
    }
  }

  // === Floating text ==================================================

  private showFloatingText(x: number, y: number, text: string, color: string): void {
    const floatText = this.add
      .text(x, y, text, {
        fontSize: '14px',
        fontStyle: 'bold',
        color,
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(100_001);

    this.tweens.add({
      targets: floatText,
      y: y - 30,
      alpha: 0,
      duration: 800,
      ease: 'Linear',
      onComplete: () => floatText.destroy(),
    });
  }

  private showToast(message: string, color: string): void {
    const cx = this.scale.width / 2;
    const toast = this.add
      .text(cx, 90, message, {
        fontSize: '16px',
        color,
        backgroundColor: '#00000080',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100_001);

    this.tweens.add({
      targets: toast,
      alpha: 0,
      duration: 2000,
      ease: 'Linear',
      onComplete: () => toast.destroy(),
    });
  }

  // === Click-to-move / click-to-attack ================================

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.x < HUD_GUARD_W && pointer.y < HUD_GUARD_H) return;
    if (!this.connRef || !this.matchId) return;

    const tile = screenToTile(pointer.worldX, pointer.worldY);
    if (!Number.isFinite(tile.x) || !Number.isFinite(tile.y)) return;

    // Check if clicking on or near a mob
    const targetMobId = this.findMobAtTile(tile.x, tile.y);
    if (targetMobId) {
      const mobPos = this.entityTilePositions.get(targetMobId);
      const dist = mobPos
        ? Math.max(
            Math.abs(this.selfTilePosition.x - mobPos.x),
            Math.abs(this.selfTilePosition.y - mobPos.y),
          )
        : Infinity;

      if (dist === 1) {
        // In range (adjacent) — attack immediately
        this.pendingAttackTarget = null;
        this.clientSeq += 1;
        const payload = JSON.stringify({
          target_id: targetMobId,
          client_seq: this.clientSeq,
        });
        this.connRef.socket
          .sendMatchState(this.matchId, Op.ATTACK_REQUEST, payload)
          .catch((err) => {
            console.warn(`sendMatchState ATTACK_REQUEST failed`, err);
          });
      } else if (mobPos) {
        // Out of range — auto-approach: walk to adjacent tile, then attack
        this.pendingAttackTarget = targetMobId;
        const approachTile = this.findBestAdjacentTile(mobPos);
        this.clientSeq += 1;
        const payload = JSON.stringify({
          target: approachTile,
          client_seq: this.clientSeq,
        });
        this.connRef.socket
          .sendMatchState(this.matchId, Op.MOVE_REQUEST, payload)
          .catch((err) => {
            console.warn(`sendMatchState MOVE_REQUEST (approach) failed`, err);
          });
      }
      return;
    }

    // Default: move request (cancel pending attack)
    this.pendingAttackTarget = null;
    this.clientSeq += 1;
    const matchId = this.matchId;
    const conn = this.connRef;
    const seq = this.clientSeq;
    const payload = JSON.stringify({
      target: { x: tile.x, y: tile.y },
      client_seq: seq,
    });

    conn.socket.sendMatchState(matchId, Op.MOVE_REQUEST, payload).catch((err) => {
      console.warn(`sendMatchState MOVE_REQUEST seq=${seq} failed`, err);
    });
  }

  private findBestAdjacentTile(mobPos: Position): Position {
    const offsets = [
      { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 },
      { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
    ];
    let best = { x: mobPos.x, y: mobPos.y - 1 };
    let bestDist = Infinity;
    for (const off of offsets) {
      const tx = mobPos.x + off.x;
      const ty = mobPos.y + off.y;
      const dist = Math.max(
        Math.abs(this.selfTilePosition.x - tx),
        Math.abs(this.selfTilePosition.y - ty),
      );
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: tx, y: ty };
      }
    }
    return best;
  }

  private findMobAtTile(tileX: number, tileY: number): string | null {
    for (const [entityId, pos] of this.entityTilePositions) {
      if (!this.mobSprites.has(entityId)) continue;
      if (pos.x === tileX && pos.y === tileY) return entityId;
      // Also check adjacent tiles for easier targeting
      if (Math.abs(pos.x - tileX) <= 1 && Math.abs(pos.y - tileY) <= 1) {
        const sprite = this.mobSprites.get(entityId);
        if (sprite && sprite.active && sprite.alpha > 0) return entityId;
      }
    }
    return null;
  }

  private showMoveRejectedToast(reason: string): void {
    if (this.rejectToast) {
      this.tweens.killTweensOf(this.rejectToast);
      this.rejectToast.destroy();
      this.rejectToast = undefined;
    }
    const cx = this.scale.width / 2;
    const toast = this.add
      .text(cx, 60, `Tam se nedostaneš (${reason})`, {
        fontSize: '16px',
        color: '#e25c5c',
        backgroundColor: '#00000080',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100_001);
    this.rejectToast = toast;
    this.tweens.add({
      targets: toast,
      alpha: 0,
      duration: 1500,
      ease: 'Linear',
      onComplete: () => {
        toast.destroy();
        if (this.rejectToast === toast) this.rejectToast = undefined;
      },
    });
  }

  // === Setup helpers ==================================================

  private buildTilemap(): void {
    const map = this.make.tilemap({ key: MAP_KEY });
    const tileset = map.addTilesetImage(TILESET_NAME, TILESET_IMAGE_KEY);
    if (!tileset) {
      throw new Error(`Tileset "${TILESET_NAME}" nenalezen v ${MAP_KEY}.tmj`);
    }
    const layer = map.createLayer(TERRAIN_LAYER_NAME, tileset, 0, 0);
    if (!layer) {
      throw new Error(`Layer "${TERRAIN_LAYER_NAME}" nenalezen v ${MAP_KEY}.tmj`);
    }
    layer.setDepth(0);

    const halfW = TILE_W_PX / 2;
    const halfH = TILE_H_PX / 2;
    const minX = -(map.height - 1) * halfW;
    const maxX = map.width * halfW + halfW;
    const maxY = (map.width + map.height) * halfH;
    this.cameras.main.setBounds(minX, 0, maxX - minX, maxY);
    this.cameras.main.setBackgroundColor('#1a0f08');
  }

  private spawnPlayer(profile: PlayerProfile): void {
    const { x, y } = profile.player_state.current_position;
    const center = this.tileCenterPx({ x, y });
    this.player = this.add
      .sprite(center.x, center.y, CHARACTER_KEY, FRAME_FACING_SE)
      .setOrigin(0.5, 1)
      .setDepth(depthForDynamic(y));
    this.player.setData('hpMax', profile.player_state.hp_max ?? 10);
    this.selfTilePosition = { x, y };

    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
  }

  private buildHud(profile: PlayerProfile): void {
    const { display_name } = profile.player;
    const { current_zone_id, current_position } = profile.player_state;
    this.add
      .text(
        12,
        12,
        `${display_name} · ${current_zone_id} (${current_position.x}, ${current_position.y})`,
        { fontSize: '14px', color: '#d4c5b0', backgroundColor: '#00000080', padding: { x: 6, y: 4 } },
      )
      .setScrollFactor(0)
      .setDepth(100_000);
  }

  private onResize(): void {
    // Phaser Scale.RESIZE handled automatically
  }

  private onShutdown(): void {
    this.scale.off('resize', this.onResize, this);
    this.input.off('pointerdown', this.handlePointerDown, this);

    this.tweens.killAll();
    this.entityMoveStates.clear();
    for (const sprite of this.otherPlayers.values()) sprite.destroy();
    this.otherPlayers.clear();
    for (const sprite of this.mobSprites.values()) sprite.destroy();
    this.mobSprites.clear();
    for (const sprite of this.dropSprites.values()) sprite.destroy();
    this.dropSprites.clear();
    for (const bar of this.hpBars.values()) {
      bar.bg.destroy();
      bar.fg.destroy();
    }
    this.hpBars.clear();
    this.entityTilePositions.clear();

    if (this.rejectToast) {
      this.rejectToast.destroy();
      this.rejectToast = undefined;
    }

    this.player = undefined;
    this.selfUserId = undefined;
    this.clientSeq = 0;
    this.pendingAttackTarget = null;

    if (this.matchId && this.connRef) {
      const matchId = this.matchId;
      const conn = this.connRef;
      conn.socket.leaveMatch(matchId).catch((err) => {
        console.warn(`leaveMatch ${matchId} failed (likely socket already closed)`, err);
      });
    }
    this.matchId = undefined;
    this.connRef = undefined;
  }
}
