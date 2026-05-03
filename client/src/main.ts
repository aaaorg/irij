import Phaser from 'phaser';
import { TILE_SIZE_PX } from 'irij-shared/constants';
import { BootScene } from './scenes/BootScene.js';
import { WorldScene } from './scenes/WorldScene.js';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#1a0f08',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: false,
    roundPixels: true,
  },
  scene: [BootScene, WorldScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);

// Sanity log z shared
console.log(`Irij client starting. Tile size = ${TILE_SIZE_PX}px.`);
