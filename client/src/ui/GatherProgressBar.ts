// Phase 10: Floating gather progress bar — DOM overlay nad postavou.
// Zobrazí se při GATHER_PROGRESS, schová se při GATHER_COMPLETED.

import type { GatherProgress, GatherCompleted } from 'irij-shared/messages';

export class GatherProgressBar {
  private readonly el: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly label: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'irij-gather-progress';
    this.el.style.cssText = `
      display: none;
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      width: 240px;
      background: rgba(20, 12, 6, 0.95);
      border: 1px solid #6b4a32;
      border-radius: 4px;
      padding: 8px 10px;
      z-index: 1000;
      font-family: monospace;
      color: #d4c5b0;
      user-select: none;
      box-shadow: 0 2px 12px rgba(0,0,0,0.7);
    `;

    this.label = document.createElement('div');
    this.label.style.cssText = 'font-size: 11px; margin-bottom: 4px; color: #c8a86a;';
    this.label.textContent = 'Těžím…';
    this.el.appendChild(this.label);

    const bar = document.createElement('div');
    bar.style.cssText = 'background: #1f1109; height: 8px; border-radius: 2px; overflow: hidden;';
    this.fill = document.createElement('div');
    this.fill.style.cssText = 'background: linear-gradient(90deg, #6e4d2a, #c8a86a); height: 100%; width: 0%;';
    bar.appendChild(this.fill);
    this.el.appendChild(bar);

    document.body.appendChild(this.el);
  }

  onProgress(payload: GatherProgress, displayName: string): void {
    this.el.style.display = 'block';
    this.label.textContent = `${displayName} (${Math.round((payload.progress_pct ?? 0) * 100)}%)`;
    const pct = Math.max(0, Math.min(1, payload.progress_pct ?? 0));
    this.fill.style.width = `${pct * 100}%`;
  }

  onCompleted(_payload: GatherCompleted): void {
    this.el.style.display = 'none';
    this.fill.style.width = '0%';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  destroy(): void {
    this.el.remove();
  }
}
