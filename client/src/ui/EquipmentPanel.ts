// Equipment panel — DOM overlay zobrazující equipnuté předměty.
// Otevírá/zavírá se spolu s InventoryPanelem.

import type { EquipmentEntry, EquipmentSlot } from 'irij-shared/types';

type OnUnequipClick = (slot: EquipmentSlot) => void;

const SLOT_LABELS: Record<EquipmentSlot, string> = {
  helmet: 'Přilba',
  cape: 'Plášť',
  amulet: 'Amulet',
  weapon: 'Zbraň',
  body: 'Zbroj',
  shield: 'Štít',
  legs: 'Kalhoty',
  gloves: 'Rukavice',
  boots: 'Boty',
  ring: 'Prsten',
  holster: 'Holster',
};

const ITEM_SHORT_NAMES: Record<string, string> = {
  'weapon.melee.dagger.bronze': 'Bronz. dýka',
  'weapon.melee.sword.bronze': 'Bronz. meč',
  'weapon.melee.sword.iron': 'Železný meč',
  'weapon.melee.mace.bronze': 'Bronz. palcát',
  'armor.body.leather': 'Kož. zbroj',
  'armor.head.leather': 'Kož. přilba',
  'armor.legs.leather': 'Kož. kalhoty',
  'armor.hands.leather': 'Kož. rukavice',
  'consumable.whetstone.t1': 'Brousek T1',
};

function getItemEmoji(itemId: string): string {
  if (itemId.startsWith('weapon.melee.dagger')) return '🗡️';
  if (itemId.startsWith('weapon.melee.sword')) return '⚔️';
  if (itemId.startsWith('weapon.melee.mace')) return '🔨';
  if (itemId.startsWith('weapon.melee')) return '🗡️';
  if (itemId.startsWith('armor.head')) return '🪖';
  if (itemId.startsWith('armor.body')) return '🧥';
  if (itemId.startsWith('armor.legs')) return '👖';
  if (itemId.startsWith('armor.hands')) return '🧤';
  if (itemId.startsWith('consumable.whetstone')) return '🪨';
  return '📦';
}

export class EquipmentPanel {
  private readonly el: HTMLDivElement;
  private slots: EquipmentEntry[] = [];

  constructor(private readonly onUnequip: OnUnequipClick) {
    this.el = this.buildPanel();
    document.body.appendChild(this.el);
  }

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'irij-equipment';
    panel.style.cssText = `
      display: none;
      position: fixed;
      top: 60px;
      right: 284px;
      width: 180px;
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
    title.textContent = 'Equipment';
    title.style.cssText = 'font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #c8a86a; border-bottom: 1px solid #3d2418; padding-bottom: 6px;';
    panel.appendChild(title);

    const slotsEl = document.createElement('div');
    slotsEl.id = 'irij-equip-slots';
    panel.appendChild(slotsEl);

    return panel;
  }

  update(slots: EquipmentEntry[]): void {
    this.slots = slots.map((s) => ({ ...s }));
    this.render();
  }

  applyChange(slotName: EquipmentSlot, itemId: string | null): void {
    const entry = this.slots.find((s) => s.slot === slotName);
    if (entry) {
      entry.item_id = itemId;
      entry.quantity = itemId ? 1 : 0;
    }
    this.render();
  }

  getEquippedWeapon(): string | null {
    return this.slots.find((s) => s.slot === 'weapon')?.item_id ?? null;
  }

  private render(): void {
    const slotsEl = document.getElementById('irij-equip-slots');
    if (!slotsEl) return;
    slotsEl.innerHTML = '';

    for (const entry of this.slots) {
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 4px; padding: 3px 4px;
        background: ${entry.item_id ? 'rgba(60,35,15,0.6)' : 'rgba(20,12,6,0.4)'};
        border: 1px solid ${entry.item_id ? '#4a3020' : '#2a1a0a'};
        border-radius: 3px; font-size: 10px;
      `;

      const label = document.createElement('span');
      label.style.cssText = 'color: #8a7a65; width: 60px; flex-shrink: 0;';
      label.textContent = SLOT_LABELS[entry.slot];

      const itemLabel = document.createElement('span');
      itemLabel.style.cssText = 'flex: 1; text-align: center; color: #d4c5b0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0 4px;';
      if (entry.item_id) {
        const emoji = getItemEmoji(entry.item_id);
        const name = ITEM_SHORT_NAMES[entry.item_id] ?? entry.item_id.split('.').pop() ?? '?';
        itemLabel.textContent = `${emoji} ${name}`;
      } else {
        itemLabel.style.color = '#3d2a1a';
        itemLabel.textContent = '—';
      }

      row.appendChild(label);
      row.appendChild(itemLabel);

      if (entry.item_id) {
        const unequipBtn = document.createElement('button');
        unequipBtn.textContent = '✕';
        unequipBtn.style.cssText = `
          background: transparent; border: none; color: #7a4a4a;
          cursor: pointer; font-size: 10px; padding: 0 2px; flex-shrink: 0;
        `;
        const slot = entry.slot;
        unequipBtn.addEventListener('click', () => this.onUnequip(slot));
        row.appendChild(unequipBtn);
      }

      slotsEl.appendChild(row);
    }
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
