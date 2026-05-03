// Character creation — Phase 2 minimální text-mode UI.
// Hezké UI přijde v Phase 17. Tady jen funkční pole + klávesnice + odeslání RPC.

import Phaser from 'phaser';
import { APPEARANCE_OPTIONS, DISPLAY_NAME_MAX, DISPLAY_NAME_MIN } from 'irij-shared/constants';
import type {
  CreateCharacterRequest,
  CreateCharacterResponse,
  GetSelfResponse,
} from 'irij-shared/messages';
import type { Gender } from 'irij-shared/types';
import { callRpc } from '../rpc.js';
import type { NakamaConnection } from '../nakama.js';
import { REGISTRY_KEY_CONNECTION, REGISTRY_KEY_PLAYER } from './LoginScene.js';

const COLORS = {
  textPrimary: '#d4c5b0',
  textMuted: '#8a7a65',
  textError: '#e25c5c',
  textSuccess: '#a8d4a0',
  textActive: '#f5d97e',
  border: 0x6b4a32,
  bgPanel: 0x2c1810,
};

type FieldKey = 'username' | 'display_name' | 'gender' | 'hair_id' | 'skin_tone_id' | 'outfit_id';
const FIELD_ORDER: FieldKey[] = ['username', 'display_name', 'gender', 'hair_id', 'skin_tone_id', 'outfit_id'];

const FIELD_LABELS: Record<FieldKey, string> = {
  username: 'Přihlašovací jméno (3–16, a–z 0–9 _)',
  display_name: 'Zobrazované jméno (3–24, lze diakritiku)',
  gender: 'Pohlaví (←/→ M/F)',
  hair_id: 'Vlasy (←/→ 0–11)',
  skin_tone_id: 'Pleť (←/→ 0–11)',
  outfit_id: 'Outfit (←/→ 0–11)',
};

interface FormState {
  username: string;
  display_name: string;
  gender: Gender;
  hair_id: number;
  skin_tone_id: number;
  outfit_id: number;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_username: 'Přihlašovací jméno musí mít 3–16 znaků (a–z, A–Z, 0–9, _).',
  username_taken: 'Toto jméno už někdo používá.',
  invalid_display_name: 'Zobrazované jméno musí mít 3–24 znaků a nesmí začínat/končit mezerou.',
  invalid_gender: 'Neplatné pohlaví.',
  invalid_appearance: 'Neplatný vzhled.',
  already_exists: 'Postava už existuje, načítám…',
};

export class CharacterCreationScene extends Phaser.Scene {
  private connection!: NakamaConnection;
  private form!: FormState;
  private activeIdx = 0;
  private fieldTexts: Partial<Record<FieldKey, Phaser.GameObjects.Text>> = {};
  private statusText?: Phaser.GameObjects.Text;
  private hintText?: Phaser.GameObjects.Text;
  private isSubmitting = false;

  constructor() {
    super('CharacterCreationScene');
  }

  create(): void {
    const conn = this.registry.get(REGISTRY_KEY_CONNECTION) as NakamaConnection | undefined;
    if (!conn) {
      console.warn('CharacterCreationScene without connection — back to login');
      this.scene.start('LoginScene');
      return;
    }
    this.connection = conn;

    // Resetuj state — Phaser instance scene přežívá scene.start, takže field initializer
    // by se podruhé nezavolal a form by si pamatoval staré hodnoty.
    this.form = {
      username: '',
      display_name: '',
      gender: 'M',
      hair_id: 0,
      skin_tone_id: 0,
      outfit_id: 0,
    };
    this.activeIdx = 0;
    this.fieldTexts = {};
    this.isSubmitting = false;

    const cx = this.scale.width / 2;
    const topY = 80;

    this.add
      .text(cx, topY, 'Vytvoř postavu', { fontSize: '36px', color: COLORS.textPrimary, fontStyle: 'bold' })
      .setOrigin(0.5);

    this.add
      .text(cx, topY + 44, 'Tab přepíná pole · Enter potvrdí', { fontSize: '14px', color: COLORS.textMuted })
      .setOrigin(0.5);

    let y = topY + 100;
    for (const key of FIELD_ORDER) {
      this.add
        .text(cx - 220, y, FIELD_LABELS[key], { fontSize: '14px', color: COLORS.textMuted })
        .setOrigin(0, 0.5);
      const valueText = this.add
        .text(cx + 220, y, '', { fontSize: '18px', color: COLORS.textPrimary })
        .setOrigin(1, 0.5);
      this.fieldTexts[key] = valueText;
      y += 44;
    }

    this.hintText = this.add
      .text(cx, y + 12, '', { fontSize: '13px', color: COLORS.textMuted, align: 'center' })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(cx, y + 56, '', {
        fontSize: '15px',
        color: COLORS.textMuted,
        align: 'center',
        wordWrap: { width: 500 },
      })
      .setOrigin(0.5);

    this.add
      .text(cx, y + 110, '[ Enter ] Vytvořit postavu', { fontSize: '16px', color: COLORS.textActive })
      .setOrigin(0.5);

    this.input.keyboard?.on('keydown', this.handleKey, this);
    this.refresh();
  }

  private handleKey(event: KeyboardEvent): void {
    if (this.isSubmitting) return;

    if (event.key === 'Tab') {
      event.preventDefault();
      const dir = event.shiftKey ? -1 : 1;
      this.activeIdx = (this.activeIdx + dir + FIELD_ORDER.length) % FIELD_ORDER.length;
      this.refresh();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void this.submit();
      return;
    }

    const field = FIELD_ORDER[this.activeIdx];
    if (!field) return;

    if (field === 'username') {
      this.handleTextInput(event, 'username', 16, /^[a-zA-Z0-9_]$/);
    } else if (field === 'display_name') {
      this.handleTextInput(event, 'display_name', DISPLAY_NAME_MAX, null);
    } else if (field === 'gender') {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key.toLowerCase() === 'm' || event.key.toLowerCase() === 'f') {
        this.form.gender = this.form.gender === 'M' ? 'F' : 'M';
        this.refresh();
      }
    } else {
      this.handleNumericCycle(event, field);
    }
  }

  private handleTextInput(
    event: KeyboardEvent,
    key: 'username' | 'display_name',
    max: number,
    allowedChar: RegExp | null,
  ): void {
    if (event.key === 'Backspace') {
      // Pro display_name (UTF-8) ořež po code point, ne po UTF-16 unit.
      const cps = [...this.form[key]];
      cps.pop();
      this.form[key] = cps.join('');
      this.refresh();
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    if (allowedChar && !allowedChar.test(event.key)) return;
    if ([...this.form[key]].length >= max) return;
    this.form[key] += event.key;
    this.refresh();
  }

  private handleNumericCycle(event: KeyboardEvent, field: 'hair_id' | 'skin_tone_id' | 'outfit_id'): void {
    let delta = 0;
    if (event.key === 'ArrowLeft') delta = -1;
    else if (event.key === 'ArrowRight') delta = 1;
    else return;
    const next = (this.form[field] + delta + APPEARANCE_OPTIONS) % APPEARANCE_OPTIONS;
    this.form[field] = next;
    this.refresh();
  }

  private refresh(): void {
    for (let i = 0; i < FIELD_ORDER.length; i++) {
      const key = FIELD_ORDER[i]!;
      const text = this.fieldTexts[key];
      if (!text) continue;
      const isActive = i === this.activeIdx;
      const value = this.renderValue(key);
      text.setText(value);
      text.setColor(isActive ? COLORS.textActive : COLORS.textPrimary);
    }
    const activeKey = FIELD_ORDER[this.activeIdx];
    this.hintText?.setText(activeKey ? `Editovat: ${FIELD_LABELS[activeKey]}` : '');
  }

  private renderValue(key: FieldKey): string {
    if (key === 'username') return this.form.username || '—';
    if (key === 'display_name') return this.form.display_name || '—';
    if (key === 'gender') return this.form.gender === 'M' ? 'Muž (M)' : 'Žena (F)';
    return String(this.form[key]);
  }

  private setStatus(message: string, color: string = COLORS.textMuted): void {
    this.statusText?.setText(message);
    this.statusText?.setColor(color);
  }

  private async submit(): Promise<void> {
    if (this.isSubmitting) return;

    if ([...this.form.username].length < 3) {
      this.setStatus(ERROR_MESSAGES.invalid_username!, COLORS.textError);
      return;
    }
    if ([...this.form.display_name.trim()].length < DISPLAY_NAME_MIN) {
      this.setStatus(ERROR_MESSAGES.invalid_display_name!, COLORS.textError);
      return;
    }

    this.isSubmitting = true;
    this.setStatus('Posílám…');

    const req: CreateCharacterRequest = {
      username: this.form.username,
      display_name: this.form.display_name,
      gender: this.form.gender,
      appearance: {
        hair_id: this.form.hair_id,
        skin_tone_id: this.form.skin_tone_id,
        outfit_id: this.form.outfit_id,
      },
    };

    try {
      const res = await callRpc<CreateCharacterRequest, CreateCharacterResponse>(
        this.connection,
        'rpc.profile.create_character',
        req,
      );
      if (!res.ok) {
        const msg = ERROR_MESSAGES[res.error] ?? `Chyba: ${res.error}`;
        this.setStatus(msg, COLORS.textError);
        this.isSubmitting = false;
        return;
      }

      this.setStatus('Postava vytvořena, načítám…', COLORS.textSuccess);
      const self = await callRpc<Record<string, never>, GetSelfResponse>(
        this.connection,
        'rpc.profile.get_self',
        {},
      );
      if (!self.exists) {
        this.setStatus('Server hlásí, že postava neexistuje. Zkus znovu.', COLORS.textError);
        this.isSubmitting = false;
        return;
      }
      this.registry.set(REGISTRY_KEY_PLAYER, self);
      this.scene.start('WorldScene');
    } catch (err) {
      console.error('create_character failed', err);
      this.setStatus(`Spojení selhalo: ${formatError(err)}`, COLORS.textError);
      this.isSubmitting = false;
    }
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'neznámá chyba';
  }
}
