import Phaser from 'phaser';

export class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  override create(): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'WorldScene — TODO', {
        fontSize: '20px',
        color: '#d4c5b0',
      })
      .setOrigin(0.5);

    // TODO: Phase 1+ — Nakama session, match join, world rendering
  }
}
