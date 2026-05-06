// Skill panel — DOM overlay listing 4 atributy + 17 skillů s XP bary.
// Toggle klávesou 'K' nebo tlačítkem v HUDu. Phase 8.

import type { AtributRow, SkillRow } from 'irij-shared/types';
import { LEVEL_CAP, levelProgress } from 'irij-shared';

const ATRIBUT_LABELS: Record<string, string> = {
  strength: 'Síla',
  dexterity: 'Obratnost',
  intelligence: 'Inteligence',
  vitality: 'Životy',
};

const SKILL_LABELS: Record<string, string> = {
  melee: 'Boj zblízka',
  ranged: 'Lukostřelba',
  magic: 'Kouzelnictví',
  defense: 'Obrana',
  mining: 'Hornictví',
  woodcutting: 'Dřevorubectví',
  fishing: 'Rybaření',
  herbalism: 'Bylinkářství',
  hunting: 'Lov',
  smithing: 'Kovářství',
  cooking: 'Vaření',
  tailoring: 'Krejčovství',
  alchemy: 'Alchymie',
  carpentry: 'Tesařství',
  storytelling: 'Vyprávění',
  prayer: 'Modlitba',
  thievery: 'Lupičství',
};

const SKILL_ICONS: Record<string, string> = {
  melee: '⚔️',
  ranged: '🏹',
  magic: '✨',
  defense: '🛡️',
  mining: '⛏️',
  woodcutting: '🪓',
  fishing: '🎣',
  herbalism: '🌿',
  hunting: '🦌',
  smithing: '🔨',
  cooking: '🍲',
  tailoring: '🧵',
  alchemy: '⚗️',
  carpentry: '🪵',
  storytelling: '📖',
  prayer: '🙏',
  thievery: '🗝️',
};

const ATRIBUT_ICONS: Record<string, string> = {
  strength: '💪',
  dexterity: '🤸',
  intelligence: '🧠',
  vitality: '❤️',
};

export class SkillPanel {
  private readonly el: HTMLDivElement;
  private atributy: AtributRow[] = [];
  private skilly: SkillRow[] = [];
  private totalLevel = 0;

  constructor() {
    this.el = this.buildPanel();
    document.body.appendChild(this.el);
  }

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'irij-skills';
    panel.style.cssText = `
      display: none;
      position: fixed;
      top: 60px;
      left: 16px;
      width: 280px;
      max-height: calc(100vh - 80px);
      overflow-y: auto;
      background: rgba(20, 12, 6, 0.97);
      border: 1px solid #6b4a32;
      border-radius: 6px;
      padding: 12px;
      z-index: 1000;
      font-family: monospace;
      color: #d4c5b0;
      user-select: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.8);
    `;

    const title = document.createElement('div');
    title.id = 'irij-skills-title';
    title.style.cssText = 'font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #c8a86a; border-bottom: 1px solid #3d2418; padding-bottom: 6px; display: flex; justify-content: space-between;';
    panel.appendChild(title);

    const atrSection = document.createElement('div');
    atrSection.id = 'irij-skills-atributy';
    atrSection.style.cssText = 'margin-bottom: 12px;';
    panel.appendChild(atrSection);

    const skSection = document.createElement('div');
    skSection.id = 'irij-skills-skilly';
    panel.appendChild(skSection);

    return panel;
  }

  setData(atributy: AtributRow[], skilly: SkillRow[], totalLevel: number): void {
    this.atributy = atributy;
    this.skilly = skilly;
    this.totalLevel = totalLevel;
    this.render();
  }

  applyXpUpdate(
    type: 'skill' | 'atribut',
    name: string,
    newXp: number,
    newLevel: number,
    totalLevel: number,
  ): void {
    const list = type === 'skill' ? this.skilly : this.atributy;
    const row = list.find((r) => r.name === name);
    if (row) {
      row.xp = newXp;
      row.level = newLevel;
    }
    this.totalLevel = totalLevel;
    this.render();
  }

  toggle(): void {
    this.el.style.display = this.el.style.display === 'none' ? 'block' : 'none';
  }

  destroy(): void {
    this.el.remove();
  }

  private render(): void {
    const title = document.getElementById('irij-skills-title');
    if (title) {
      title.innerHTML = `<span>Schopnosti</span><span style="color:#8a7a65; font-weight:normal;">Total: ${this.totalLevel}</span>`;
    }
    this.renderSection('irij-skills-atributy', 'Atributy', this.atributy, ATRIBUT_LABELS, ATRIBUT_ICONS);
    this.renderSection('irij-skills-skilly', 'Skilly', this.skilly, SKILL_LABELS, SKILL_ICONS);
  }

  private renderSection(
    elId: string,
    heading: string,
    rows: Array<{ name: string; xp: number; level: number }>,
    labels: Record<string, string>,
    icons: Record<string, string>,
  ): void {
    const section = document.getElementById(elId);
    if (!section) return;
    section.innerHTML = '';

    const head = document.createElement('div');
    head.textContent = heading;
    head.style.cssText = 'font-size: 11px; color: #c8a86a; margin-bottom: 4px;';
    section.appendChild(head);

    for (const row of rows) {
      section.appendChild(this.buildRow(row, labels, icons));
    }
  }

  private buildRow(
    row: { name: string; xp: number; level: number },
    labels: Record<string, string>,
    icons: Record<string, string>,
  ): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin: 2px 0; font-size: 11px;';

    const top = document.createElement('div');
    top.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    top.innerHTML = `
      <span><span style="margin-right:4px">${icons[row.name] ?? '·'}</span>${labels[row.name] ?? row.name}</span>
      <span style="color:#c8a86a; font-weight:bold;">${row.level}<span style="color:#8a7a65; font-weight:normal;">/${LEVEL_CAP}</span></span>
    `;
    wrapper.appendChild(top);

    const progress = levelProgress(row.xp);
    const bar = document.createElement('div');
    bar.style.cssText = 'background: #1f1109; height: 5px; border-radius: 2px; margin-top: 2px; overflow: hidden;';
    const fill = document.createElement('div');
    const pct = Math.max(0, Math.min(1, progress.pct));
    fill.style.cssText = `background: linear-gradient(90deg, #6e4d2a, #c8a86a); height: 100%; width: ${pct * 100}%;`;
    bar.appendChild(fill);
    wrapper.appendChild(bar);

    if (progress.toNextLevel > 0) {
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size: 9px; color: #6b4a32; text-align: right; margin-top: 1px;';
      meta.textContent = `${row.xp.toLocaleString('cs-CZ')} XP (do ${row.level + 1}: ${(progress.toNextLevel - progress.intoLevel).toLocaleString('cs-CZ')})`;
      wrapper.appendChild(meta);
    } else {
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size: 9px; color: #6b4a32; text-align: right; margin-top: 1px;';
      meta.textContent = `${row.xp.toLocaleString('cs-CZ')} XP (max)`;
      wrapper.appendChild(meta);
    }

    return wrapper;
  }
}
