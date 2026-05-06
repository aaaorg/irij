// Inventory panel — DOM overlay nad Phaser canvasem.
// Toggle klávesou 'I' nebo tlačítkem v HUDu.

import type { InventorySlot } from 'irij-shared/types';

type OnEquipClick = (slotIndex: number) => void;
type OnDropClick = (slotIndex: number) => void;
type OnConsumeClick = (slotIndex: number) => void;

interface ItemInfo {
  id: string;
  name: string;
  category: string;
  isEquipable: boolean;
  isConsumable: boolean;
  quantity: number;
}

const ITEM_DISPLAY_NAMES: Record<string, string> = {
  'material.hide.wolf': 'Vlčí kůže',
  'material.bone': 'Kost',
  'material.hide.rat': 'Krysa kůže',
  'material.ore.iron': 'Železná ruda',
  'material.ore.copper': 'Měděná ruda',
  'material.wood.oak': 'Dubové dřevo',
  'consumable.food.raw_meat': 'Syrové maso',
  'consumable.food.bread': 'Chléb',
  'consumable.whetstone.t1': 'Brousek',
  'weapon.melee.dagger.bronze': 'Bronzová dýka',
  'weapon.melee.sword.bronze': 'Bronzový meč',
  'weapon.melee.sword.iron': 'Železný meč',
  'weapon.melee.mace.bronze': 'Bronzový palcát',
  'armor.body.leather': 'Kožená zbroj',
  'armor.head.leather': 'Kožená přilba',
  'armor.legs.leather': 'Kožené kalhoty',
  'armor.hands.leather': 'Kožené rukavice',
  'tool.hammer': 'Kladivo',
  'currency.denar': 'Denáry',
  'material.gem.rough': 'Surový drahokam',
};

function isEquipable(category: string): boolean {
  return (
    category.startsWith('weapon.') ||
    category.startsWith('armor.') ||
    category.startsWith('consumable.whetstone') ||
    category.startsWith('consumable.arrow') ||
    category.startsWith('consumable.rune')
  );
}

function isConsumable(category: string): boolean {
  return category.startsWith('consumable.food');
}

function getCategoryLabel(category: string): string {
  if (category.startsWith('weapon.melee')) return 'Zbraň (melee)';
  if (category.startsWith('weapon.ranged')) return 'Zbraň (ranged)';
  if (category.startsWith('armor.body')) return 'Zbroj (trup)';
  if (category.startsWith('armor.head')) return 'Přilba';
  if (category.startsWith('armor.legs')) return 'Kalhoty';
  if (category.startsWith('armor.hands')) return 'Rukavice';
  if (category.startsWith('armor.feet')) return 'Boty';
  if (category.startsWith('armor.cape')) return 'Plášť';
  if (category.startsWith('consumable.food')) return 'Jídlo';
  if (category.startsWith('consumable.whetstone')) return 'Brousek (holster)';
  if (category.startsWith('material')) return 'Materiál';
  if (category.startsWith('tool')) return 'Nástroj';
  if (category.startsWith('currency')) return 'Měna';
  return category;
}

export class InventoryPanel {
  private readonly el: HTMLDivElement;
  private slots: InventorySlot[] = [];
  private selectedSlot: number | null = null;

  constructor(
    private readonly onEquip: OnEquipClick,
    private readonly onDrop: OnDropClick,
    private readonly onConsume: OnConsumeClick,
  ) {
    this.el = this.buildPanel();
    document.body.appendChild(this.el);
  }

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'irij-inventory';
    panel.style.cssText = `
      display: none;
      position: fixed;
      top: 60px;
      right: 16px;
      width: 260px;
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
    title.textContent = 'Inventář';
    title.style.cssText = 'font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #c8a86a; border-bottom: 1px solid #3d2418; padding-bottom: 6px;';
    panel.appendChild(title);

    const grid = document.createElement('div');
    grid.id = 'irij-inv-grid';
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; margin-bottom: 10px;';
    panel.appendChild(grid);

    const info = document.createElement('div');
    info.id = 'irij-inv-info';
    info.style.cssText = 'min-height: 60px; font-size: 11px; border-top: 1px solid #3d2418; padding-top: 8px;';
    panel.appendChild(info);

    const actions = document.createElement('div');
    actions.id = 'irij-inv-actions';
    actions.style.cssText = 'display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;';
    panel.appendChild(actions);

    return panel;
  }

  update(slots: InventorySlot[]): void {
    this.slots = slots;
    this.selectedSlot = null;
    this.renderGrid();
    this.renderInfo(null);
  }

  applyChanges(changes: Array<{ slot_index: number; item_id?: string | null; quantity?: number }>): void {
    for (const ch of changes) {
      const slot = this.slots[ch.slot_index];
      if (!slot) continue;
      if (ch.item_id !== undefined) slot.item_id = ch.item_id;
      if (ch.quantity !== undefined) slot.quantity = ch.quantity;
    }
    const sel = this.selectedSlot;
    this.renderGrid();
    if (sel !== null) {
      const s = this.slots[sel];
      this.renderInfo(s && s.item_id ? this.buildInfo(s) : null);
    }
  }

  private buildInfo(slot: InventorySlot): ItemInfo | null {
    if (!slot.item_id) return null;
    const id = slot.item_id;
    const parts = id.split('.');
    const category = parts.slice(0, parts.length > 3 ? 3 : 2).join('.');
    return {
      id,
      name: ITEM_DISPLAY_NAMES[id] ?? id,
      category: id.split('.').slice(0, -1).join('.'),
      isEquipable: isEquipable(id),
      isConsumable: isConsumable(id),
      quantity: slot.quantity,
    };
  }

  private renderGrid(): void {
    const grid = document.getElementById('irij-inv-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (const slot of this.slots) {
      const cell = document.createElement('div');
      cell.style.cssText = `
        width: 36px; height: 36px;
        background: ${slot.item_id ? 'rgba(60,35,15,0.9)' : 'rgba(30,18,8,0.6)'};
        border: 1px solid ${this.selectedSlot === slot.slot_index ? '#c8a86a' : '#3d2418'};
        border-radius: 3px;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        cursor: ${slot.item_id ? 'pointer' : 'default'};
        font-size: 9px;
        color: #a89070;
        overflow: hidden;
        position: relative;
      `;

      if (slot.item_id) {
        const icon = document.createElement('div');
        icon.textContent = this.getItemEmoji(slot.item_id);
        icon.style.cssText = 'font-size: 16px; line-height: 1;';
        cell.appendChild(icon);

        if (slot.quantity > 1) {
          const qty = document.createElement('div');
          qty.textContent = String(slot.quantity);
          qty.style.cssText = 'position: absolute; bottom: 1px; right: 2px; font-size: 8px; color: #d4c5b0;';
          cell.appendChild(qty);
        }

        const idx = slot.slot_index;
        cell.addEventListener('click', () => {
          this.selectedSlot = idx;
          this.renderGrid();
          this.renderInfo(this.buildInfo(slot));
        });
      }

      grid.appendChild(cell);
    }
  }

  private getItemEmoji(itemId: string): string {
    if (itemId.startsWith('weapon.melee.dagger')) return '🗡️';
    if (itemId.startsWith('weapon.melee.sword')) return '⚔️';
    if (itemId.startsWith('weapon.melee.mace')) return '🔨';
    if (itemId.startsWith('weapon.melee')) return '🗡️';
    if (itemId.startsWith('armor.head')) return '🪖';
    if (itemId.startsWith('armor.body')) return '🧥';
    if (itemId.startsWith('armor.legs')) return '👖';
    if (itemId.startsWith('armor.hands')) return '🧤';
    if (itemId.startsWith('consumable.food')) return '🍖';
    if (itemId.startsWith('consumable.whetstone')) return '🪨';
    if (itemId.startsWith('material.hide')) return '🐺';
    if (itemId.startsWith('material.bone')) return '🦴';
    if (itemId.startsWith('material.ore')) return '⛏️';
    if (itemId.startsWith('material.wood')) return '🪵';
    if (itemId.startsWith('material.gem')) return '💎';
    if (itemId.startsWith('tool.hammer')) return '🔨';
    if (itemId.startsWith('currency.denar')) return '🪙';
    return '📦';
  }

  private renderInfo(info: ItemInfo | null): void {
    const infoEl = document.getElementById('irij-inv-info');
    const actionsEl = document.getElementById('irij-inv-actions');
    if (!infoEl || !actionsEl) return;

    if (!info) {
      infoEl.textContent = 'Vyber slot pro detail.';
      actionsEl.innerHTML = '';
      return;
    }

    infoEl.innerHTML = `<b>${info.name}</b><br><span style="color:#8a7a65">${getCategoryLabel(info.category)}</span><br>Počet: ${info.quantity}`;
    actionsEl.innerHTML = '';

    if (info.isEquipable) {
      const equipBtn = this.makeButton('Equipovat', '#4a7a4a', () => {
        if (this.selectedSlot !== null) this.onEquip(this.selectedSlot);
      });
      actionsEl.appendChild(equipBtn);
    }

    if (info.isConsumable) {
      const useBtn = this.makeButton('Použít', '#4a6a7a', () => {
        if (this.selectedSlot !== null) this.onConsume(this.selectedSlot);
      });
      actionsEl.appendChild(useBtn);
    }

    const dropBtn = this.makeButton('Zahodit', '#7a4a4a', () => {
      if (this.selectedSlot !== null) this.onDrop(this.selectedSlot);
    });
    actionsEl.appendChild(dropBtn);
  }

  private makeButton(label: string, bg: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      background: ${bg};
      color: #d4c5b0;
      border: 1px solid #6b4a32;
      border-radius: 3px;
      padding: 4px 10px;
      cursor: pointer;
      font-family: monospace;
      font-size: 11px;
    `;
    btn.addEventListener('click', onClick);
    return btn;
  }

  toggle(): void {
    this.el.style.display = this.el.style.display === 'none' ? 'block' : 'none';
  }

  show(): void {
    this.el.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  isVisible(): boolean {
    return this.el.style.display !== 'none';
  }

  destroy(): void {
    this.el.remove();
  }
}
