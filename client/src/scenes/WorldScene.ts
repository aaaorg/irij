import Phaser from 'phaser';
import type {
  EntityDespawned,
  EntityMoved,
  EntitySpawned,
  FindOrCreateMatchResponse,
  MoveRejected,
  WorldSnapshot,
  WorldSnapshotEntity,
} from 'irij-shared/messages';
import { Op } from 'irij-shared/messages';
import type { NakamaConnection } from '../nakama.js';
import { TILE_H_PX, TILE_W_PX, screenToTile, worldToScreen } from '../render/projection.js';
import { depthForDynamic } from '../render/ysort.js';
import { callRpc } from '../rpc.js';
import { REGISTRY_KEY_CONNECTION, REGISTRY_KEY_PLAYER, type PlayerProfile } from './LoginScene.js';

const MAP_KEY = 'mapTest';
const TILESET_IMAGE_KEY = 'tilesetPlaceholder';
const TILESET_NAME = 'placeholder'; // musí matchnout `name` v test_50x50.tmj
const TERRAIN_LAYER_NAME = 'terrain';
const CHARACTER_KEY = 'characterPlaceholder';

// Sprite-sheet frame index pro 4 iso směry (asset gen pořadí: SE, SW, NW, NE).
// Phase 3 statická postava → fix na SE (default facing pro 2:1 iso kompas).
// Phase 4c stále nemění frame podle směru pohybu — animace pohybu (frame
// switching podle azimutu) přijde v Phase 6+ s polish sprite anims.
const FRAME_FACING_SE = 0;

// Délka tween mezi dvěma tile updaty. Server posílá ENTITY_MOVED tile-by-tile
// při ~3 tiles/s (ADR-007: TICK_HZ=10, MOVE_TICK_INTERVAL ≈ 3 → každých 333 ms).
// 100 ms lerp skončí dlouho před dalším updatem; kdyby server burstnul víc
// updates rychleji než 100 ms, killTweensOf v handleru přepíše předchozí tween.
const MOVE_TWEEN_MS = 100;

// Hrubý HUD click-shield: HUD label je v levém horním rohu (12, 12) s padding,
// celkově nepřesáhne ~30 px výšky a ~200 px šířky pro rozumný display_name.
// Pro Phase 4c stačí; Phase 17 polish bude mít proper hit-region/depth picking.
const HUD_GUARD_W = 200;
const HUD_GUARD_H = 30;

export class WorldScene extends Phaser.Scene {
  private player?: Phaser.GameObjects.Sprite;
  private matchId?: string;
  private connRef?: NakamaConnection;
  private selfUserId?: string;
  private otherPlayers: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private clientSeq = 0;
  private rejectToast?: Phaser.GameObjects.Text;

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
  }

  create(): void {
    const conn = this.registry.get(REGISTRY_KEY_CONNECTION) as NakamaConnection | undefined;
    const profile = this.registry.get(REGISTRY_KEY_PLAYER) as PlayerProfile | undefined;

    if (!conn || !profile) {
      // Defenzivní fallback — WorldScene by neměla být spuštěna bez connection a profilu,
      // ale kdyby přes deeplink / restart, vrať se na login.
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

    // Phase 4c: click-to-move + dispatch table na onmatchdata. Server-authoritative
    // movement; klient nepredikuje, jen posílá MOVE_REQUEST a tweenuje na ENTITY_MOVED.
    // TODO post-MVP: client-side prediction + reconciliation pro skrytí ~50 ms latence.
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

    // Subscribe BEFORE joinMatch — Nakama může poslat WORLD_SNAPSHOT během
    // matchJoin handleru, takže handler musí být registrovaný předtím, než
    // server potvrdí join.
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
    for (const entity of snapshot.entities) {
      this.spawnRemotePlayerIfNeeded(entity);
    }
  }

  private handleEntitySpawned(payload: EntitySpawned): void {
    if (!payload?.entity_id) return;
    if (payload.type !== 'player') return; // mobi/drops/npc Phase 6+
    if (payload.entity_id === this.selfUserId) return; // self → vlastní spawnPlayer
    this.spawnRemotePlayerIfNeeded({
      id: payload.entity_id,
      type: 'player',
      position: payload.position,
      display_name: payload.display_name,
      hp_pct: payload.hp_pct,
    });
  }

  private handleEntityDespawned(payload: EntityDespawned): void {
    if (!payload?.entity_id) return;
    const sprite = this.otherPlayers.get(payload.entity_id);
    if (!sprite) return;
    this.tweens.killTweensOf(sprite);
    sprite.destroy();
    this.otherPlayers.delete(payload.entity_id);
  }

  private handleEntityMoved(payload: EntityMoved): void {
    if (!payload?.entity_id || !payload.to) return;

    const sprite =
      payload.entity_id === this.selfUserId ? this.player : this.otherPlayers.get(payload.entity_id);
    if (!sprite) {
      // Race: ENTITY_MOVED před ENTITY_SPAWNED. Server by měl posílat v pořadí,
      // ale defensive — neaplikujeme, ENTITY_SPAWNED později vytvoří sprite na
      // aktuální pozici.
      console.warn(`[match ENTITY_MOVED] sprite not found for ${payload.entity_id.slice(0, 8)}`);
      return;
    }

    const { sx, sy } = worldToScreen(payload.to.x, payload.to.y);
    const targetPx = sx + TILE_W_PX / 2;
    const targetPy = sy + TILE_H_PX / 2;

    // Depth musí reflektovat budoucí pozici hned, jinak Y-sort flickeruje
    // během tween (sprite by zůstal v depth-band z `from` zatímco se pohybuje
    // do `to`).
    sprite.setDepth(depthForDynamic(payload.to.y));

    // Killni případný předchozí tween — burst updates by jinak hazardily.
    this.tweens.killTweensOf(sprite);
    this.tweens.add({
      targets: sprite,
      x: targetPx,
      y: targetPy,
      duration: MOVE_TWEEN_MS,
      ease: 'Linear',
    });
  }

  private handleMoveRejected(payload: MoveRejected): void {
    if (!payload) return;
    console.warn(`[match MOVE_REJECTED] reason=${payload.reason} client_seq=${payload.client_seq}`);
    // rate_limited → tichý, žádný UI toast (anti-spam UX, hráč obvykle jen klikal moc rychle).
    if (payload.reason === 'rate_limited') return;
    this.showMoveRejectedToast(payload.reason);
  }

  // === Sprite helpers =================================================

  private spawnRemotePlayerIfNeeded(entity: WorldSnapshotEntity): void {
    if (!entity?.id) return;
    if (entity.type !== 'player') return;
    if (entity.id === this.selfUserId) return;
    if (this.otherPlayers.has(entity.id)) return; // re-snapshot / duplicate spawn

    const { x, y } = entity.position;
    const { sx, sy } = worldToScreen(x, y);
    const px = sx + TILE_W_PX / 2;
    const py = sy + TILE_H_PX / 2;

    const sprite = this.add
      .sprite(px, py, CHARACTER_KEY, FRAME_FACING_SE)
      .setOrigin(0.5, 1)
      .setDepth(depthForDynamic(y));
    if (entity.display_name) sprite.setData('displayName', entity.display_name);
    this.otherPlayers.set(entity.id, sprite);
  }

  // === Click-to-move ==================================================

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    // Hrubý HUD click-shield. Lepší řešení (depth-based picking nebo proper
    // hit-region) v Phase 17 UI polish.
    if (pointer.x < HUD_GUARD_W && pointer.y < HUD_GUARD_H) return;

    if (!this.connRef || !this.matchId) return;

    // pointer.worldX/worldY — screen coords transformované přes camera scroll/zoom.
    // pointer.x/y by selhalo, jakmile se kamera pohnula (camera.startFollow).
    const tile = screenToTile(pointer.worldX, pointer.worldY);
    if (!Number.isFinite(tile.x) || !Number.isFinite(tile.y)) return;

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
    layer.setDepth(0); // terrain band per ADR-018

    // Camera bounds: pro iso mapu W×H je x rozsah [-(H-1)·tw/2, W·tw/2 + tw/2],
    // y rozsah [0, (W+H)·th/2]. Phaser layer.x/y už zahrnuje (0,0) tile bbox top-left.
    const halfW = TILE_W_PX / 2;
    const halfH = TILE_H_PX / 2;
    const minX = -(map.height - 1) * halfW;
    const maxX = map.width * halfW + halfW;
    const maxY = (map.width + map.height) * halfH;
    this.cameras.main.setBounds(minX, 0, maxX - minX, maxY);
    this.cameras.main.setBackgroundColor('#1a0f08');
  }

  private spawnPlayer(profile: PlayerProfile): void {
    const { x, y } = profile.player.current_position;
    const { sx, sy } = worldToScreen(x, y);
    // Phaser ISOMETRIC tilemap renderuje tile (x,y) tak, že bounding box top-left
    // je na worldToScreen(x,y). Diamond center = +TW/2 vodorovně, +TH/2 svisle.
    // Sprite s origin (0.5, 1) → feet anchor sedí v diamond centru.
    const px = sx + TILE_W_PX / 2;
    const py = sy + TILE_H_PX / 2;

    this.player = this.add
      .sprite(px, py, CHARACTER_KEY, FRAME_FACING_SE)
      .setOrigin(0.5, 1)
      .setDepth(depthForDynamic(y));

    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
  }

  private buildHud(profile: PlayerProfile): void {
    const { display_name, current_zone_id, current_position } = profile.player;
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
    // Phaser Scale.RESIZE už upravuje renderer; HUD je ScrollFactor 0, takže
    // zůstává v levém horním rohu automaticky. Camera bounds drží beze změny.
  }

  private onShutdown(): void {
    this.scale.off('resize', this.onResize, this);
    this.input.off('pointerdown', this.handlePointerDown, this);

    // Cleanup ostatní hráče. tweens.killAll() vyřeší case s aktivním lerp.
    this.tweens.killAll();
    for (const sprite of this.otherPlayers.values()) {
      sprite.destroy();
    }
    this.otherPlayers.clear();

    if (this.rejectToast) {
      this.rejectToast.destroy();
      this.rejectToast = undefined;
    }

    this.player = undefined;
    this.selfUserId = undefined;
    this.clientSeq = 0;

    // Best-effort match cleanup. Socket může být disconnected (např. když shutdown
    // přišel z ondisconnect handleru) → leaveMatch hodí, fire-and-forget.
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
