// Dialog panel — DOM overlay nad Phaser canvasem.
// Server-driven (zobrazuje aktuální node + options od serveru, nikdy nezná
// celé dialog tree). Toggle: klávesa Esc nebo "Sbohem" option.

import type { DialogOpen, DialogOptionPayload } from 'irij-shared/messages';

type OnOptionClick = (optionId: string) => void;
type OnCloseClick = () => void;

// Placeholder NPC portrait emoji map. Phase 18 art pass nahradí real spritem.
const NPC_EMOJI: Record<string, string> = {
  'npc.kovar_blatiny': '⚒️',
  'npc.selka_hospoda': '🥖',
};

export class DialogPanel {
  private readonly el: HTMLDivElement;
  private currentDialogId: string | null = null;
  private currentNodeId: string | null = null;

  constructor(
    private readonly onOption: OnOptionClick,
    private readonly onClose: OnCloseClick,
  ) {
    this.el = this.buildPanel();
    document.body.appendChild(this.el);
  }

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'irij-dialog';
    panel.style.cssText = `
      display: none;
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      width: min(640px, 90vw);
      background: rgba(20, 12, 6, 0.97);
      border: 1px solid #6b4a32;
      border-radius: 8px;
      padding: 14px 16px;
      z-index: 1100;
      font-family: monospace;
      color: #d4c5b0;
      user-select: none;
      box-shadow: 0 6px 24px rgba(0,0,0,0.85);
    `;

    const header = document.createElement('div');
    header.id = 'irij-dialog-header';
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      border-bottom: 1px solid #3d2418;
      padding-bottom: 8px;
    `;
    panel.appendChild(header);

    const portrait = document.createElement('div');
    portrait.id = 'irij-dialog-portrait';
    portrait.style.cssText = `
      width: 40px; height: 40px;
      background: rgba(60,35,15,0.9);
      border: 1px solid #6b4a32;
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px;
      flex-shrink: 0;
    `;
    portrait.textContent = '👤';
    header.appendChild(portrait);

    const title = document.createElement('div');
    title.id = 'irij-dialog-speaker';
    title.style.cssText = 'font-size: 14px; font-weight: bold; color: #c8a86a;';
    title.textContent = '';
    header.appendChild(title);

    const text = document.createElement('div');
    text.id = 'irij-dialog-text';
    text.style.cssText = `
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 12px;
      min-height: 40px;
      color: #d4c5b0;
    `;
    panel.appendChild(text);

    const options = document.createElement('div');
    options.id = 'irij-dialog-options';
    options.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    panel.appendChild(options);

    return panel;
  }

  // Show or update with new node payload from server.
  showNode(payload: DialogOpen): void {
    this.currentDialogId = payload.dialog_id;
    this.currentNodeId = payload.node_id;

    const portrait = document.getElementById('irij-dialog-portrait');
    if (portrait) {
      portrait.textContent = NPC_EMOJI[payload.speaker_npc_id] ?? '👤';
    }

    const speakerEl = document.getElementById('irij-dialog-speaker');
    if (speakerEl) {
      speakerEl.textContent = payload.speaker_display_name_cs ?? '';
    }

    const textEl = document.getElementById('irij-dialog-text');
    if (textEl) {
      textEl.textContent = payload.text?.cs ?? '';
    }

    this.renderOptions(payload.options ?? []);
    this.el.style.display = 'block';
  }

  private renderOptions(options: DialogOptionPayload[]): void {
    const optsEl = document.getElementById('irij-dialog-options');
    if (!optsEl) return;
    optsEl.innerHTML = '';

    if (options.length === 0) {
      const closeBtn = this.makeOptionButton('Sbohem.', true, () => this.onClose());
      optsEl.appendChild(closeBtn);
      return;
    }

    for (const opt of options) {
      const label = opt.text?.cs ?? '...';
      const btn = this.makeOptionButton(label, opt.available, () => {
        if (!opt.available) return;
        this.onOption(opt.id);
      });
      optsEl.appendChild(btn);
    }
  }

  private makeOptionButton(
    label: string,
    available: boolean,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = `▸ ${label}`;
    btn.disabled = !available;
    btn.style.cssText = `
      background: ${available ? '#3d2418' : '#1a1008'};
      color: ${available ? '#d4c5b0' : '#6b5a45'};
      border: 1px solid ${available ? '#6b4a32' : '#3d2418'};
      border-radius: 4px;
      padding: 8px 12px;
      cursor: ${available ? 'pointer' : 'not-allowed'};
      font-family: monospace;
      font-size: 12px;
      text-align: left;
      transition: background 0.1s;
    `;
    if (available) {
      btn.addEventListener('mouseenter', () => {
        btn.style.background = '#5a3520';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = '#3d2418';
      });
    }
    btn.addEventListener('click', onClick);
    return btn;
  }

  hide(): void {
    this.el.style.display = 'none';
    this.currentDialogId = null;
    this.currentNodeId = null;
  }

  isVisible(): boolean {
    return this.el.style.display !== 'none';
  }

  getCurrentDialogId(): string | null {
    return this.currentDialogId;
  }

  getCurrentNodeId(): string | null {
    return this.currentNodeId;
  }

  destroy(): void {
    this.el.remove();
  }
}
