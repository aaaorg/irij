import Phaser from 'phaser';
import { getOrCreateDeviceId } from '../device.js';
import { connectAsGuest, type NakamaConnection } from '../nakama.js';

const REGISTRY_KEY_CONNECTION = 'nakama.connection';

export class WorldScene extends Phaser.Scene {
  private statusText?: Phaser.GameObjects.Text;
  private connection?: NakamaConnection;

  constructor() {
    super('WorldScene');
  }

  create(): void {
    this.statusText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Připojuji k Iriji…', {
        fontSize: '20px',
        color: '#d4c5b0',
        align: 'center',
      })
      .setOrigin(0.5);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    void this.connect();
  }

  private async connect(): Promise<void> {
    const deviceId = getOrCreateDeviceId();
    try {
      const conn = await connectAsGuest(deviceId);
      this.connection = conn;
      this.registry.set(REGISTRY_KEY_CONNECTION, conn);

      const userId = conn.session.user_id ?? '<unknown>';
      console.log(`Connected as user ${userId}`);

      conn.socket.ondisconnect = (evt) => {
        console.warn('Nakama socket disconnected', evt);
        this.showError('Spojení se serverem ztraceno.');
      };

      this.statusText?.setText(`Připojen jako ${userId}\n(WorldScene — TODO)`);
      this.statusText?.setColor('#a8d4a0');
    } catch (err) {
      console.error('Nakama connect failed', err);
      this.showError(this.formatError(err));
    }
  }

  private showError(message: string): void {
    this.statusText?.setText(`Chyba spojení:\n${message}`);
    this.statusText?.setColor('#e25c5c');
  }

  private formatError(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
      return JSON.stringify(err);
    } catch {
      return 'Neznámá chyba';
    }
  }

  private onShutdown(): void {
    this.connection?.socket.disconnect(false);
    this.connection = undefined;
  }
}
