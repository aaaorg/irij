// Phase 13: Shop UI — DOM panel zobrazený po dialog effectu `open_shop`
// (server pošle SHOP_OPEN). Levá sekce: NPC stock (sell_items), pravá: hráč
// inventář pro prodej (buy_items NPC = co NPC kupuje).

import { Op } from 'irij-shared/messages';
import type {
  ShopBuyEntryView,
  ShopBuyRequest,
  ShopOpen,
  ShopRejected,
  ShopSellEntryView,
  ShopSellRequest,
} from 'irij-shared/messages';
import type { NakamaConnection } from '../nakama.js';

export interface ShopCallbacks {
  conn: NakamaConnection;
  matchId: string;
  onClose?: () => void;
  // Vrátí množství daného itemu v hráčově inventáři — pro prodejní sloupec.
  getInventoryCount: (itemId: string) => number;
  // Pro displayName fallback v UI (catalog name).
  getItemDisplayName?: (itemId: string) => string;
}

const PANEL_ID = 'irij-shop';

export class ShopPanel {
  private readonly el: HTMLDivElement;
  private cb: ShopCallbacks;
  private currentSnapshot: ShopOpen | null = null;

  constructor(cb: ShopCallbacks) {
    this.cb = cb;
    this.el = this.buildPanel();
    document.body.appendChild(this.el);
  }

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      display: none;
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      width: min(720px, calc(100vw - 32px));
      max-height: calc(100vh - 80px);
      overflow-y: auto;
      background: rgba(20, 12, 6, 0.97);
      border: 1px solid #6b4a32;
      border-radius: 6px;
      padding: 14px 16px;
      z-index: 1100;
      font-family: monospace;
      color: #d4c5b0;
      user-select: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.85);
    `;

    const header = document.createElement('div');
    header.style.cssText =
      'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #3d2418; padding-bottom: 6px;';

    const title = document.createElement('div');
    title.id = `${PANEL_ID}-title`;
    title.style.cssText = 'font-size: 14px; font-weight: bold; color: #c8a86a;';
    title.textContent = 'Obchod';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
      'background: transparent; border: 1px solid #6b4a32; color: #d4c5b0; font-family: monospace; cursor: pointer; padding: 2px 8px; border-radius: 3px;';
    closeBtn.onclick = () => this.hide();
    header.appendChild(closeBtn);

    panel.appendChild(header);

    const meta = document.createElement('div');
    meta.id = `${PANEL_ID}-meta`;
    meta.style.cssText = 'font-size: 11px; color: #8c7d68; margin-bottom: 8px;';
    panel.appendChild(meta);

    const grid = document.createElement('div');
    grid.id = `${PANEL_ID}-grid`;
    grid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px;';
    panel.appendChild(grid);

    return panel;
  }

  isVisible(): boolean {
    return this.el.style.display !== 'none';
  }

  show(): void {
    this.el.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
    this.cb.onClose?.();
  }

  // Voláno z WorldScene po INVENTORY_CHANGED — sloupec sell může mít jiný count.
  onInventoryChanged(): void {
    if (this.isVisible()) this.render();
  }

  // Server posílá kompletní snapshot — full re-render.
  onOpen(payload: ShopOpen): void {
    this.currentSnapshot = payload;
    this.show();
    this.render();
  }

  onRejected(payload: ShopRejected): string {
    // Vrátí lokalizovanou hlášku — WorldScene ji ukáže jako toast.
    return mapRejectReason(payload);
  }

  private render(): void {
    if (!this.currentSnapshot) return;

    const snap = this.currentSnapshot;
    const titleEl = document.getElementById(`${PANEL_ID}-title`);
    if (titleEl) titleEl.textContent = snap.title.cs;

    const metaEl = document.getElementById(`${PANEL_ID}-meta`);
    if (metaEl) {
      const typeLabel = snap.table_type === 'general' ? 'obecný kupec' : `specialista (${snap.table_type})`;
      metaEl.textContent = `${snap.npc_display_name_cs} — ${typeLabel}`;
    }

    const grid = document.getElementById(`${PANEL_ID}-grid`);
    if (!grid) return;
    grid.innerHTML = '';

    grid.appendChild(this.buildSellSection(snap.sell_items, snap.npc_id));
    grid.appendChild(this.buildBuySection(snap.buy_items, snap.npc_id));
  }

  // Levý sloupec: NPC prodává hráči ⇒ klient pošle SHOP_BUY.
  private buildSellSection(entries: ShopSellEntryView[], npcId: string): HTMLDivElement {
    const section = document.createElement('div');
    section.style.cssText = 'border: 1px solid #3d2418; border-radius: 4px; padding: 8px;';

    const h = document.createElement('div');
    h.textContent = 'Prodává (kup od NPC)';
    h.style.cssText = 'font-size: 12px; color: #c8a86a; margin-bottom: 6px; font-weight: bold;';
    section.appendChild(h);

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Nic na prodej.';
      empty.style.cssText = 'font-size: 11px; color: #8c7d68;';
      section.appendChild(empty);
      return section;
    }

    for (const entry of entries) {
      section.appendChild(this.buildSellRow(entry, npcId));
    }
    return section;
  }

  private buildSellRow(entry: ShopSellEntryView, npcId: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText =
      'display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid #2a1c10; font-size: 11px;';

    const name = document.createElement('div');
    name.style.cssText = 'flex: 1;';
    name.textContent = `${entry.display_name_cs}`;
    row.appendChild(name);

    const meta = document.createElement('div');
    meta.style.cssText = 'min-width: 110px; color: #c8a86a;';
    meta.textContent = `${entry.sell_price_denar} d · ${entry.stock_current}/${entry.stock_max}`;
    row.appendChild(meta);

    const buyBtns = document.createElement('div');
    buyBtns.style.cssText = 'display: flex; gap: 4px;';
    for (const qty of [1, 5]) {
      const b = document.createElement('button');
      b.textContent = `+${qty}`;
      b.disabled = entry.stock_current < qty;
      b.style.cssText = `
        background: ${entry.stock_current < qty ? '#2a1c10' : '#3d2418'};
        border: 1px solid #6b4a32;
        color: ${entry.stock_current < qty ? '#5a4d3a' : '#d4c5b0'};
        font-family: monospace;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 3px;
        cursor: ${entry.stock_current < qty ? 'default' : 'pointer'};
      `;
      if (entry.stock_current >= qty) {
        b.onclick = () => this.sendBuy(npcId, entry.item_id, qty);
      }
      buyBtns.appendChild(b);
    }
    row.appendChild(buyBtns);
    return row;
  }

  // Pravý sloupec: NPC kupuje od hráče ⇒ klient pošle SHOP_SELL.
  private buildBuySection(entries: ShopBuyEntryView[], npcId: string): HTMLDivElement {
    const section = document.createElement('div');
    section.style.cssText = 'border: 1px solid #3d2418; border-radius: 4px; padding: 8px;';

    const h = document.createElement('div');
    h.textContent = 'Kupuje (prodej NPC)';
    h.style.cssText = 'font-size: 12px; color: #c8a86a; margin-bottom: 6px; font-weight: bold;';
    section.appendChild(h);

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Tento NPC nic nekupuje.';
      empty.style.cssText = 'font-size: 11px; color: #8c7d68;';
      section.appendChild(empty);
      return section;
    }

    for (const entry of entries) {
      section.appendChild(this.buildBuyRow(entry, npcId));
    }
    return section;
  }

  private buildBuyRow(entry: ShopBuyEntryView, npcId: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText =
      'display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid #2a1c10; font-size: 11px;';

    const have = this.cb.getInventoryCount(entry.item_id);
    const remaining = Math.max(0, entry.buy_limit_per_day - entry.buy_consumed_today);

    const name = document.createElement('div');
    name.style.cssText = 'flex: 1;';
    const grayed = have === 0 || remaining === 0;
    name.style.color = grayed ? '#5a4d3a' : '#d4c5b0';
    name.textContent = `${entry.display_name_cs} (mám ${have})`;
    row.appendChild(name);

    const meta = document.createElement('div');
    meta.style.cssText = 'min-width: 110px; color: #c8a86a;';
    meta.textContent = `${entry.buy_price_denar} d · limit ${remaining}/${entry.buy_limit_per_day}`;
    row.appendChild(meta);

    const sellBtns = document.createElement('div');
    sellBtns.style.cssText = 'display: flex; gap: 4px;';
    for (const qty of [1, 5]) {
      const canSell = have >= qty && remaining >= qty;
      const b = document.createElement('button');
      b.textContent = `−${qty}`;
      b.disabled = !canSell;
      b.style.cssText = `
        background: ${canSell ? '#3d2418' : '#2a1c10'};
        border: 1px solid #6b4a32;
        color: ${canSell ? '#d4c5b0' : '#5a4d3a'};
        font-family: monospace;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 3px;
        cursor: ${canSell ? 'pointer' : 'default'};
      `;
      if (canSell) {
        b.onclick = () => this.sendSell(npcId, entry.item_id, qty);
      }
      sellBtns.appendChild(b);
    }
    // "Vše" tlačítko — prodá maximum, co lze (min(have, remaining)).
    const allQty = Math.min(have, remaining);
    if (allQty > 1) {
      const allBtn = document.createElement('button');
      allBtn.textContent = `−${allQty}`;
      allBtn.style.cssText =
        'background: #3d2418; border: 1px solid #6b4a32; color: #d4c5b0; font-family: monospace; font-size: 11px; padding: 2px 6px; border-radius: 3px; cursor: pointer;';
      allBtn.onclick = () => this.sendSell(npcId, entry.item_id, allQty);
      sellBtns.appendChild(allBtn);
    }
    row.appendChild(sellBtns);
    return row;
  }

  private sendBuy(npcId: string, itemId: string, quantity: number): void {
    const payload: ShopBuyRequest = { npc_id: npcId, item_id: itemId, quantity };
    this.cb.conn.socket
      .sendMatchState(this.cb.matchId, Op.SHOP_BUY, JSON.stringify(payload))
      .catch((err) => console.warn('shop buy send failed', err));
  }

  private sendSell(npcId: string, itemId: string, quantity: number): void {
    const payload: ShopSellRequest = { npc_id: npcId, item_id: itemId, quantity };
    this.cb.conn.socket
      .sendMatchState(this.cb.matchId, Op.SHOP_SELL, JSON.stringify(payload))
      .catch((err) => console.warn('shop sell send failed', err));
  }

  destroy(): void {
    this.el.remove();
  }
}

function mapRejectReason(payload: ShopRejected): string {
  switch (payload.reason) {
    case 'unknown_table':
      return 'Tento NPC nemá obchod.';
    case 'unknown_item':
      return 'Tento předmět neexistuje.';
    case 'out_of_range':
      return 'Pojď blíž k obchodníkovi.';
    case 'not_for_sale':
      return 'Tento předmět není na prodej.';
    case 'not_buying':
      return 'Tento NPC tohle nekupuje.';
    case 'out_of_stock':
      return 'Není skladem.';
    case 'inventory_full':
      return 'Nemáš místo v inventáři.';
    case 'inventory_short':
      return 'Nemáš dost kusů na prodej.';
    case 'insufficient_funds':
      return 'Nemáš dost denárů.';
    case 'buy_limit_reached':
      return 'NPC již dnes vyčerpal nákupní limit.';
    case 'rate_limited':
      return 'Pomaleji.';
    case 'invalid_quantity':
      return 'Neplatné množství.';
    default:
      return 'Obchod nelze provést.';
  }
}
