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
import type { Position } from 'irij-shared/types';
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

// Hrubý HUD click-shield: HUD label je v levém horním rohu (12, 12) s padding,
// celkově nepřesáhne ~30 px výšky a ~200 px šířky pro rozumný display_name.
// Pro Phase 4c stačí; Phase 17 polish bude mít proper hit-region/depth picking.
const HUD_GUARD_W = 200;
const HUD_GUARD_H = 30;

// Deterministic interpolation state per entity (per ADR-019). Klient drží
// path baseline ze serveru a každý frame v `update()` přepočítá sprite pozici
// z `Date.now() - startedAtMs`. Self-correcting: tab v pozadí zastaví Phaser
// scene, ale `Date.now()` běží dál — po tab return update() recomputuje pozici
// z wall-clock baseline a sprite plynule (nebo skokem) chytí server-current.
interface EntityMovementState {
  from: Position;
  path: Position[];
  speedTps: number;
  startedAtMs: number;
}

export class WorldScene extends Phaser.Scene {
  private player?: Phaser.GameObjects.Sprite;
  private matchId?: string;
  private connRef?: NakamaConnection;
  private selfUserId?: string;
  private otherPlayers: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private entityMoveStates: Map<string, EntityMovementState> = new Map();
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
    // movement; klient nepredikuje, jen posílá MOVE_REQUEST a deterministic-ky
    // lerpuje per ADR-019. Server posílá ENTITY_MOVED 1× s celou path, klient
    // udržuje wall-clock baseline a v update() recomputuje sprite pozici every frame.
    // TODO post-MVP: client-side prediction + reconciliation pro skrytí ~50 ms latence.
    // TODO post-MVP: 1 Hz WORLD_SNAPSHOT keepalive proti server clock drift.
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
      // Per ADR-019: pokud entity je uprostřed pohybu, server pošle path
      // suffix v snapshotu. Po spawnu sprite hned spustíme TweenChain, takže
      // joiner vidí ostatní v plynulém pohybu.
      if (
        entity.id !== this.selfUserId &&
        entity.path &&
        entity.path.length > 0 &&
        entity.speed_tps !== undefined
      ) {
        this.startEntityMovement(entity.id, entity.position, entity.path, entity.speed_tps);
      }
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
    this.entityMoveStates.delete(payload.entity_id);
    this.tweens.killTweensOf(sprite);
    sprite.destroy();
    this.otherPlayers.delete(payload.entity_id);
  }

  private handleEntityMoved(payload: EntityMoved): void {
    if (!payload?.entity_id || !payload.from || !Array.isArray(payload.path)) return;
    if (payload.path.length === 0) return;
    if (typeof payload.speed_tps !== 'number' || payload.speed_tps <= 0) return;

    // Sprite check je defensive — pokud chybí (race s ENTITY_SPAWNED), uložíme
    // state stejně, update() ho ignoruje a smaže až přijde ENTITY_SPAWNED. Tj.
    // pre-spawn ENTITY_MOVED se ztratí, ale to je akceptovatelné — server posílá
    // ENTITY_SPAWNED s aktuální pozicí.
    const hasSprite =
      payload.entity_id === this.selfUserId
        ? !!this.player
        : this.otherPlayers.has(payload.entity_id);
    if (!hasSprite) {
      console.warn(`[match ENTITY_MOVED] sprite not found for ${payload.entity_id.slice(0, 8)}`);
      return;
    }

    this.startEntityMovement(payload.entity_id, payload.from, payload.path, payload.speed_tps);
  }

  // Sdílený pipeline pro WORLD_SNAPSHOT in-flight entries i ENTITY_MOVED:
  // ulož deterministic baseline state (path + startedAtMs); update() loop
  // přepočítá sprite pozici every frame z `Date.now() - startedAtMs`. Žádný
  // Phaser tween — rAF v hidden tabu pause-uje a způsobil by drift od serveru.
  // Per ADR-019.
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
  }

  // Phaser scene update — zavolán každý frame. Itereuje aktivní movement states
  // a deterministic-ky vypočítá sprite pozici z wall-clock elapsed. Self-correcting:
  // - Hidden tab → Phaser pause → update neběží → sprite stojí. Date.now() přitom
  //   roste, takže po tab return první update spočítá `tilesElapsed` z plného
  //   uplynulého času a sprite chytí current correct pozici (snap nebo path-end).
  // - Drift od serveru se korriguje při každém ENTITY_MOVED — server pošle nový
  //   `from` (= current server position), klient přepíše state, sprite od příští
  //   frame jede z nové baseline.
  override update(_time: number, _delta: number): void {
    if (this.entityMoveStates.size === 0) return;
    const now = Date.now();
    const completed: string[] = [];

    for (const [entityId, state] of this.entityMoveStates) {
      const sprite =
        entityId === this.selfUserId ? this.player : this.otherPlayers.get(entityId);
      if (!sprite) {
        completed.push(entityId);
        continue;
      }

      const elapsedMs = now - state.startedAtMs;
      const tilesElapsed = (elapsedMs * state.speedTps) / 1000;

      if (tilesElapsed >= state.path.length) {
        // Path doběhl — snap na poslední tile, vyčisti state.
        const last = state.path[state.path.length - 1];
        if (last) {
          const px = this.tileCenterPx(last);
          sprite.setPosition(px.x, px.y);
          sprite.setDepth(depthForDynamic(last.y));
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
    }

    for (const id of completed) {
      this.entityMoveStates.delete(id);
    }
  }

  private tileCenterPx(tile: Position): { x: number; y: number } {
    const { sx, sy } = worldToScreen(tile.x, tile.y);
    return { x: sx + TILE_W_PX / 2, y: sy + TILE_H_PX / 2 };
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
    const center = this.tileCenterPx({ x, y });

    const sprite = this.add
      .sprite(center.x, center.y, CHARACTER_KEY, FRAME_FACING_SE)
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
    const { x, y } = profile.player_state.current_position;
    const center = this.tileCenterPx({ x, y });
    // Phaser ISOMETRIC tilemap renderuje tile (x,y) tak, že bounding box top-left
    // je na worldToScreen(x,y). Diamond center = +TW/2 vodorovně, +TH/2 svisle.
    // Sprite s origin (0.5, 1) → feet anchor sedí v diamond centru.
    this.player = this.add
      .sprite(center.x, center.y, CHARACTER_KEY, FRAME_FACING_SE)
      .setOrigin(0.5, 1)
      .setDepth(depthForDynamic(y));

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
    // Phaser Scale.RESIZE už upravuje renderer; HUD je ScrollFactor 0, takže
    // zůstává v levém horním rohu automaticky. Camera bounds drží beze změny.
  }

  private onShutdown(): void {
    this.scale.off('resize', this.onResize, this);
    this.input.off('pointerdown', this.handlePointerDown, this);

    // Cleanup ostatní hráče + UI tweens (toast fadeOut atd.). Movement state
    // je čistě data, žádné tweens pro pohyb (deterministic update loop per ADR-019).
    this.tweens.killAll();
    this.entityMoveStates.clear();
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
