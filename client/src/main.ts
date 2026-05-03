import Phaser from 'phaser';
import { TILE_SIZE_PX } from 'irij-shared/constants';
import { BootScene } from './scenes/BootScene.js';
import { LoginScene } from './scenes/LoginScene.js';
import { CharacterCreationScene } from './scenes/CharacterCreationScene.js';
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
  scene: [BootScene, LoginScene, CharacterCreationScene, WorldScene],
};

const game = new Phaser.Game(config);

// Sanity log z shared
console.log(`Irij client starting. Tile size = ${TILE_SIZE_PX}px.`);

// Dev-only: expose game pro testy / browser konzoli (Playwright, QA, debugging).
// Vite tree-shake-uje `import.meta.env.DEV` v production buildu na false → blok zmizí.
if (import.meta.env.DEV) {
  (window as unknown as { __irijGame: Phaser.Game }).__irijGame = game;
}
