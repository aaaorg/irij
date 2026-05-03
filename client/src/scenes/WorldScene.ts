import Phaser from 'phaser';
import type { NakamaConnection } from '../nakama.js';
import { REGISTRY_KEY_CONNECTION } from './LoginScene.js';

export class WorldScene extends Phaser.Scene {
  private connection?: NakamaConnection;

  constructor() {
    super('WorldScene');
  }

  create(): void {
    const conn = this.registry.get(REGISTRY_KEY_CONNECTION) as NakamaConnection | undefined;

    if (!conn) {
      // Defenzivní fallback — WorldScene by neměla být spuštěna bez connection,
      // ale kdyby přes deeplink / restart, vrať se na login.
      console.warn('WorldScene started without connection — returning to LoginScene');
      this.scene.start('LoginScene');
      return;
    }

    this.connection = conn;
    const userId = conn.session.user_id ?? '<unknown>';

    this.add
      .text(this.scale.width / 2, this.scale.height / 2, `Vítej v Iriji\n${userId}\n(WorldScene — TODO Phase 3+)`, {
        fontSize: '20px',
        color: '#d4c5b0',
        align: 'center',
      })
      .setOrigin(0.5);

    conn.socket.ondisconnect = (evt) => {
      console.warn('Nakama socket disconnected', evt);
      this.scene.start('LoginScene');
    };

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  private onShutdown(): void {
    // Drop reference; reálný teardown sockietu řešíme až při explicit logoutu
    // nebo když Phaser tear-downuje celou scénu (např. browser close).
    this.connection = undefined;
  }
}
