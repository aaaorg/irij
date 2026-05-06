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
} from 'irij-shared/messages';
import { Op } from 'irij-shared/messages';
import { DEFAULT_SPAWN_POSITION } from 'irij-shared/constants';
import type { NakamaConnection } from '../nakama.js';
import { TILE_H_PX, TILE_W_PX, screenToTile, tileCenterPx } from '../render/projection.js';
import { depthForDynamic } from '../render/ysort.js';
import { callRpc } from '../rpc.js';
import { REGISTRY_KEY_CONNECTION, REGISTRY_KEY_PLAYER, type PlayerProfile } from './LoginScene.js';
import {
  EntityManager,
  CHARACTER_KEY,
  WOLF_KEY,
  RAT_KEY,
  DROP_KEY,
  FRAME_FACING_SE,
} from '../world/EntityManager.js';
import { MovementInterpolator } from '../world/MovementInterpolator.js';
import { CombatController } from '../world/CombatController.js';
import { HpBarManager } from '../world/HpBarManager.js';
import { MoveRejectedToast, showFloatingText, showToast } from '../world/FloatingText.js';

const MAP_KEY = 'mapTest';
const TILESET_IMAGE_KEY = 'tilesetPlaceholder';
const TILESET_NAME = 'placeholder';
const TERRAIN_LAYER_NAME = 'terrain';

const HUD_GUARD_W = 200;
const HUD_GUARD_H = 30;

export class WorldScene extends Phaser.Scene {
  private player?: Phaser.GameObjects.Sprite;
  private matchId?: string;
  private connRef?: NakamaConnection;
  private selfUserId?: string;
  private clientSeq = 0;

  private entities!: EntityManager;
  private movement!: MovementInterpolator;
  private combat!: CombatController;
  private hpBars!: HpBarManager;
  private rejectToast!: MoveRejectedToast;

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

    this.connRef = conn;
    const userId = conn.session.user_id!;
    this.selfUserId = userId;

    this.buildTilemap();
    this.spawnPlayer(profile);
    this.buildHud(profile);

    this.entities = new EntityManager(this, userId);
    this.hpBars = new HpBarManager(this);
    this.movement = new MovementInterpolator(
      this.entities,
      userId,
      (id) => this.resolveSprite(id),
    );
    this.movement.selfTilePosition = { ...profile.player_state.current_position };
    this.combat = new CombatController(this, this.entities, this.movement, userId);
    this.rejectToast = new MoveRejectedToast(this);

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

  private resolveSprite(entityId: string): Phaser.GameObjects.Sprite | undefined {
    if (entityId === this.selfUserId) return this.player;
    return this.entities.getSprite(entityId);
  }

  private nextSeq(): number {
    this.clientSeq += 1;
    return this.clientSeq;
  }

  // === Match join ========================================================

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

  // === Match data handlers ===============================================

  private handleWorldSnapshot(snapshot: WorldSnapshot): void {
    if (!snapshot || !Array.isArray(snapshot.entities)) return;

    for (const id of this.entities.otherPlayers.keys()) {
      this.movement.removeEntity(id);
      this.hpBars.remove(id);
    }
    this.entities.clearRemotePlayers();

    for (const entity of snapshot.entities) {
      if (entity.type === 'player') {
        this.entities.spawnRemotePlayer(entity);
        if (
          entity.id !== this.selfUserId &&
          entity.path &&
          entity.path.length > 0 &&
          entity.speed_tps !== undefined
        ) {
          this.movement.startMovement(entity.id, entity.position, entity.path, entity.speed_tps);
        }
      } else if (entity.type === 'mob') {
        const hpPct = this.entities.spawnMob(entity);
        if (hpPct < 1) {
          const sprite = this.entities.mobSprites.get(entity.id);
          if (sprite) this.hpBars.create(entity.id, sprite, hpPct);
        }
        if (entity.path && entity.path.length > 0 && entity.speed_tps !== undefined) {
          this.movement.startMovement(entity.id, entity.position, entity.path, entity.speed_tps);
        }
      } else if (entity.type === 'drop') {
        this.entities.spawnDrop(entity);
      }
    }
  }

  private handleEntitySpawned(payload: EntitySpawned): void {
    if (!payload?.entity_id) return;
    if (payload.type === 'player') {
      if (payload.entity_id === this.selfUserId) return;
      this.entities.spawnRemotePlayer({
        id: payload.entity_id,
        type: 'player',
        position: payload.position,
        display_name: payload.display_name,
        hp_pct: payload.hp_pct,
      });
    } else if (payload.type === 'mob') {
      const hpPct = this.entities.spawnMob({
        id: payload.entity_id,
        type: 'mob',
        position: payload.position,
        mob_id: payload.mob_id,
        display_name_cs: payload.display_name_cs,
        level: payload.level,
        hp_pct: payload.hp_pct,
      });
      if (hpPct < 1) {
        const sprite = this.entities.mobSprites.get(payload.entity_id);
        if (sprite) this.hpBars.create(payload.entity_id, sprite, hpPct);
      }
    } else if (payload.type === 'drop') {
      this.entities.spawnDrop({
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

    const sprite = this.entities.getSprite(entityId);
    if (sprite) this.tweens.killTweensOf(sprite);
    this.movement.removeEntity(entityId);
    this.hpBars.remove(entityId);
    this.entities.despawnEntity(entityId);
  }

  private handleEntityMoved(payload: EntityMoved): void {
    if (!payload?.entity_id || !payload.from) return;

    if (!Array.isArray(payload.path) || payload.path.length === 0) {
      this.movement.snapToPosition(payload.entity_id, payload.from);
      return;
    }

    if (typeof payload.speed_tps !== 'number' || payload.speed_tps <= 0) return;

    const hasSprite =
      payload.entity_id === this.selfUserId
        ? !!this.player
        : this.entities.otherPlayers.has(payload.entity_id) ||
          this.entities.mobSprites.has(payload.entity_id);
    if (!hasSprite) {
      console.warn(`[match ENTITY_MOVED] sprite not found for ${payload.entity_id.slice(0, 8)}`);
      return;
    }

    this.movement.startMovement(payload.entity_id, payload.from, payload.path, payload.speed_tps);
  }

  private handleCombatResolved(payload: CombatResolved): void {
    if (!payload) return;

    const targetSprite =
      this.entities.mobSprites.get(payload.target_id) ??
      this.entities.otherPlayers.get(payload.target_id) ??
      (payload.target_id === this.selfUserId ? this.player : undefined);

    if (targetSprite) {
      const isSelfTarget = payload.target_id === this.selfUserId;
      let color = '#ffffff';
      if (isSelfTarget) color = '#ff4444';
      if (payload.hit_type === 'critical') color = '#ffff00';
      if (payload.hit_type === 'miss') color = '#888888';

      const text = payload.hit_type === 'miss' ? 'Miss' : String(payload.damage);
      showFloatingText(this, targetSprite.x, targetSprite.y - 20, text, color);
    }

    const mob = this.entities.mobSprites.get(payload.target_id);
    if (mob) {
      const def = mob.getData('hpMax') as number | undefined;
      if (def && def > 0) {
        this.hpBars.update(payload.target_id, payload.remaining_hp / def, () => mob);
      }
    }

    if (payload.target_id === this.selfUserId && this.player) {
      const hpMax = (this.player.getData('hpMax') as number) ?? 10;
      if (hpMax > 0) {
        this.hpBars.update('self', payload.remaining_hp / hpMax, () => this.player);
      }
    }
  }

  private handleEntityDied(payload: EntityDied): void {
    if (!payload?.entity_id) return;

    if (payload.entity_id === this.selfUserId) {
      this.handleSelfDeath();
      return;
    }

    const mobSprite = this.entities.mobSprites.get(payload.entity_id);
    if (mobSprite) {
      this.movement.removeEntity(payload.entity_id);
      this.hpBars.remove(payload.entity_id);
      this.entities.tilePositions.delete(payload.entity_id);
      this.tweens.add({
        targets: mobSprite,
        alpha: 0,
        duration: 500,
        ease: 'Linear',
        onComplete: () => {
          mobSprite.destroy();
          this.entities.mobSprites.delete(payload.entity_id);
        },
      });
    }

    const playerSprite = this.entities.otherPlayers.get(payload.entity_id);
    if (playerSprite) {
      this.movement.removeEntity(payload.entity_id);
      this.hpBars.remove(payload.entity_id);
      this.entities.tilePositions.delete(payload.entity_id);
      this.tweens.killTweensOf(playerSprite);
      playerSprite.destroy();
      this.entities.otherPlayers.delete(payload.entity_id);
    }

    if (payload.killer_id === this.selfUserId && payload.xp_awarded.length > 0) {
      const xpText = payload.xp_awarded
        .map((a) => `+${a.amount} ${a.skill}`)
        .join(', ');
      showToast(this, `XP: ${xpText}`, '#44ff44');
    }
  }

  private handleSelfDeath(): void {
    this.movement.removeEntity(this.selfUserId!);
    this.combat.cancelPendingAttack();
    this.hpBars.remove('self');

    const spawnPos = DEFAULT_SPAWN_POSITION;
    this.movement.selfTilePosition = { x: spawnPos.x, y: spawnPos.y };
    this.entities.tilePositions.set(this.selfUserId!, { x: spawnPos.x, y: spawnPos.y });

    if (this.player) {
      const px = tileCenterPx(spawnPos.x, spawnPos.y);
      this.player.setPosition(px.x, px.y);
      this.player.setDepth(depthForDynamic(spawnPos.y));
      this.player.setData('hpCurrent', (this.player.getData('hpMax') as number) ?? 10);
    }

    showToast(this, 'Zemřel jsi!', '#ff4444');
  }

  private handleMoveRejected(payload: MoveRejected): void {
    if (!payload) return;
    console.warn(`[match MOVE_REJECTED] reason=${payload.reason} client_seq=${payload.client_seq}`);
    if (payload.reason === 'rate_limited') return;
    this.rejectToast.show(payload.reason);
  }

  // === Game loop =========================================================

  override update(_time: number, _delta: number): void {
    if (this.movement.moveStates.size === 0 && this.hpBars.size === 0) return;

    const completed = this.movement.update();
    for (const id of completed) {
      if (id === this.selfUserId) {
        this.combat.tick(this.connRef, this.matchId, () => this.nextSeq());
      }
    }

    this.hpBars.updateAllPositions((id) => this.resolveSprite(id));

    if (this.combat.pendingAttackTarget) {
      this.combat.tick(this.connRef, this.matchId, () => this.nextSeq());
    }
  }

  // === Input =============================================================

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.x < HUD_GUARD_W && pointer.y < HUD_GUARD_H) return;
    if (!this.connRef || !this.matchId) return;

    const tile = screenToTile(pointer.worldX, pointer.worldY);
    if (!Number.isFinite(tile.x) || !Number.isFinite(tile.y)) return;

    const targetMobId = this.combat.findMobAtTile(tile.x, tile.y);
    if (targetMobId) {
      this.combat.handleMobClick(targetMobId, this.connRef, this.matchId, () => this.nextSeq());
      return;
    }

    this.combat.cancelPendingAttack();
    const seq = this.nextSeq();
    const payload = JSON.stringify({
      target: { x: tile.x, y: tile.y },
      client_seq: seq,
    });

    this.connRef.socket.sendMatchState(this.matchId, Op.MOVE_REQUEST, payload).catch((err) => {
      console.warn(`sendMatchState MOVE_REQUEST seq=${seq} failed`, err);
    });
  }

  // === Setup =============================================================

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
    const center = tileCenterPx(x, y);
    this.player = this.add
      .sprite(center.x, center.y, CHARACTER_KEY, FRAME_FACING_SE)
      .setOrigin(0.5, 1)
      .setDepth(depthForDynamic(y));
    this.player.setData('hpMax', profile.player_state.hp_max ?? 10);

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
    this.movement.destroy();
    this.entities.destroy();
    this.hpBars.destroy();
    this.combat.destroy();
    this.rejectToast.destroy();

    this.player = undefined;
    this.selfUserId = undefined;
    this.clientSeq = 0;

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
