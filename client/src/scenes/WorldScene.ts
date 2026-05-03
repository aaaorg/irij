import Phaser from 'phaser';
import type {
  EntityMoved,
  FindOrCreateMatchResponse,
  MoveRejected,
} from 'irij-shared/messages';
import { Op } from 'irij-shared/messages';
import type { NakamaConnection } from '../nakama.js';
import { TILE_H_PX, TILE_W_PX, worldToScreen } from '../render/projection.js';
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
const FRAME_FACING_SE = 0;

export class WorldScene extends Phaser.Scene {
  private player?: Phaser.GameObjects.Sprite;
  private matchId?: string;
  private connRef?: NakamaConnection;

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

    conn.socket.ondisconnect = (evt) => {
      console.warn('Nakama socket disconnected', evt);
      this.scene.start('LoginScene');
    };

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    // Phase 4a: po render setup zavolej find_or_create_match a joinMatch.
    // Fire-and-forget — chyba jen logujeme, render nepadá. Movement protokol
    // (MOVE_REQUEST/ENTITY_MOVED) přijde v Phase 4b, render ostatních hráčů
    // v Phase 4c. Teď jen subscribneme matchdata/presence a logujeme.
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
      // 4b: log all match data, decode known opcodes pro debug. 4c udělá real
      // routing (sprite spawn/move/despawn, interpolation, snapshot hydrate).
      const senderId = md.presence?.user_id ?? 'server';
      console.log(`[match] op=${md.op_code} from=${senderId} bytes=${md.data.length}`);
      try {
        // Nakama-js doručuje md.data jako Uint8Array; dekódujeme na string.
        const text =
          typeof md.data === 'string'
            ? md.data
            : new TextDecoder().decode(md.data as unknown as ArrayBuffer);
        if (md.op_code === Op.ENTITY_MOVED) {
          const moved = JSON.parse(text) as EntityMoved;
          console.log(
            `[match ENTITY_MOVED] entity=${moved.entity_id.slice(0, 8)} from=(${moved.from.x},${moved.from.y}) to=(${moved.to.x},${moved.to.y}) tick=${moved.server_tick}`,
          );
        } else if (md.op_code === Op.MOVE_REJECTED) {
          const rejected = JSON.parse(text) as MoveRejected;
          console.warn(
            `[match MOVE_REJECTED] reason=${rejected.reason} client_seq=${rejected.client_seq}`,
          );
        }
      } catch (err) {
        console.warn('Failed to decode match data', err);
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
    this.player = undefined;

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
