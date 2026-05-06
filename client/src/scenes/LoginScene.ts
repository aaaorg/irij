import Phaser from 'phaser';
import type { GetSelfResponse } from 'irij-shared/messages';
import { getOrCreateDeviceId } from '../device.js';
import { connectAsGuest } from '../nakama.js';
import { callRpc } from '../rpc.js';

export const REGISTRY_KEY_CONNECTION = 'nakama.connection';
export const REGISTRY_KEY_PLAYER = 'irij.player';

// Když get_self vrátí exists=true, hodnota uložená pod REGISTRY_KEY_PLAYER má tento tvar.
export type PlayerProfile = Extract<GetSelfResponse, { exists: true }>;

interface AuthButton {
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

const COLORS = {
  bgPanel: 0x2c1810,
  bgPanelHover: 0x3d2418,
  bgPanelDisabled: 0x1f1109,
  border: 0x6b4a32,
  textPrimary: '#d4c5b0',
  textMuted: '#8a7a65',
  textError: '#e25c5c',
  textSuccess: '#a8d4a0',
};

const BUTTON_W = 280;
const BUTTON_H = 48;

export class LoginScene extends Phaser.Scene {
  private guestButton?: AuthButton;
  private statusText?: Phaser.GameObjects.Text;
  private isConnecting = false;

  constructor() {
    super('LoginScene');
  }

  create(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    this.add
      .text(cx, cy - 200, 'IRIJ', {
        fontSize: '72px',
        color: COLORS.textPrimary,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy - 140, 'Svět slovanského folklóru', {
        fontSize: '18px',
        color: COLORS.textMuted,
        fontStyle: 'italic',
      })
      .setOrigin(0.5);

    // Phase 1: jediný funkční button. Discord/Google/E-mail přijdou v Phase 19.
    this.guestButton = this.makeButton(cx, cy - 40, 'Hrát jako host', () => this.handleGuestLogin(), true);
    this.makeButton(cx, cy + 20, 'Discord (brzy)', undefined, false);
    this.makeButton(cx, cy + 80, 'Google (brzy)', undefined, false);
    this.makeButton(cx, cy + 140, 'E-mail (brzy)', undefined, false);

    this.statusText = this.add
      .text(cx, cy + 220, '', {
        fontSize: '16px',
        color: COLORS.textMuted,
        align: 'center',
        wordWrap: { width: 480 },
      })
      .setOrigin(0.5);

  }

  private makeButton(
    x: number,
    y: number,
    text: string,
    onClick: (() => void) | undefined,
    enabled: boolean,
  ): AuthButton {
    const rect = this.add
      .rectangle(x, y, BUTTON_W, BUTTON_H, enabled ? COLORS.bgPanel : COLORS.bgPanelDisabled)
      .setStrokeStyle(2, COLORS.border);

    const label = this.add
      .text(x, y, text, {
        fontSize: '18px',
        color: enabled ? COLORS.textPrimary : COLORS.textMuted,
      })
      .setOrigin(0.5);

    if (enabled && onClick) {
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerover', () => rect.setFillStyle(COLORS.bgPanelHover));
      rect.on('pointerout', () => rect.setFillStyle(COLORS.bgPanel));
      rect.on('pointerdown', onClick);
    }

    return { rect, label };
  }

  private setGuestButtonEnabled(enabled: boolean, label?: string): void {
    if (!this.guestButton) return;
    const { rect, label: text } = this.guestButton;
    if (label) text.setText(label);
    if (enabled) {
      rect.setFillStyle(COLORS.bgPanel);
      text.setColor(COLORS.textPrimary);
      rect.setInteractive({ useHandCursor: true });
    } else {
      rect.setFillStyle(COLORS.bgPanelDisabled);
      text.setColor(COLORS.textMuted);
      rect.disableInteractive();
    }
  }

  private setStatus(message: string, color: string = COLORS.textMuted): void {
    this.statusText?.setText(message);
    this.statusText?.setColor(color);
  }

  private async handleGuestLogin(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;
    this.setGuestButtonEnabled(false, 'Připojuji…');
    this.setStatus('Sjednávám spojení s Iriji…');

    try {
      const deviceId = getOrCreateDeviceId();
      const conn = await connectAsGuest(deviceId);
      this.registry.set(REGISTRY_KEY_CONNECTION, conn);
      const userId = conn.session.user_id ?? '<unknown>';
      console.log(`Connected as user ${userId}`);

      this.setStatus('Načítám postavu…');
      const self = await callRpc<Record<string, never>, GetSelfResponse>(
        conn,
        'rpc.profile.get_self',
        {},
      );

      if (self.exists) {
        this.registry.set(REGISTRY_KEY_PLAYER, self);
        this.setStatus(`Vítej zpět, ${self.player.display_name}`, COLORS.textSuccess);
        this.time.delayedCall(400, () => this.scene.start('WorldScene'));
      } else {
        this.setStatus('Žádná postava — pojď ji vytvořit.', COLORS.textSuccess);
        this.time.delayedCall(400, () => this.scene.start('CharacterCreationScene'));
      }
    } catch (err) {
      console.error('Nakama connect / get_self failed', err);
      this.setStatus(`Spojení selhalo: ${this.formatError(err)}`, COLORS.textError);
      this.setGuestButtonEnabled(true, 'Hrát jako host');
      this.isConnecting = false;
    }
  }

  private formatError(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const obj = err as Record<string, unknown>;
      if (typeof obj.message === 'string') return obj.message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return 'Neznámá chyba';
    }
  }

}
