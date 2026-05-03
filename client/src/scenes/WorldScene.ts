import Phaser from 'phaser';
import type { NakamaConnection } from '../nakama.js';
import { REGISTRY_KEY_CONNECTION, REGISTRY_KEY_PLAYER, type PlayerProfile } from './LoginScene.js';

export class WorldScene extends Phaser.Scene {
  private connection?: NakamaConnection;

  constructor() {
    super('WorldScene');
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

    this.connection = conn;
    const { display_name, current_zone_id, current_position } = profile.player;

    this.add
      .text(
        this.scale.width / 2,
        this.scale.height / 2,
        `Vítej v Iriji\n${display_name}\n${current_zone_id} (${current_position.x}, ${current_position.y})\n(WorldScene — TODO Phase 3+)`,
        {
          fontSize: '20px',
          color: '#d4c5b0',
          align: 'center',
        },
      )
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
