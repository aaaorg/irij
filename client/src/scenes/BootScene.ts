import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    // TODO: preload essentials (loading spinner sprite, font)
  }

  create(): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Irij — boot…', {
        fontSize: '24px',
        color: '#d4c5b0',
      })
      .setOrigin(0.5);

    // Po boot přejdi do WorldScene
    this.time.delayedCall(500, () => {
      this.scene.start('WorldScene');
    });
  }
}
