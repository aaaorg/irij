import Phaser from 'phaser';
import type { NakamaConnection } from '../nakama.js';
import { TILE_H_PX, TILE_W_PX, worldToScreen } from '../render/projection.js';
import { depthForDynamic } from '../render/ysort.js';
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

    conn.socket.ondisconnect = (evt) => {
      console.warn('Nakama socket disconnected', evt);
      this.scene.start('LoginScene');
    };

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
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
  }
}
