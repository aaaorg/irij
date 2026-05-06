// Phase 10: Crafting panel — DOM overlay s listem dostupných receptů
// + queue counter. Toggle klávesou 'C' nebo HUD tlačítkem.
//
// Klient nezná recipe katalog ze serveru (stejně jako u dialog/inventory),
// proto si embedne mini-summary receptů (stejně jako server/data/recipes.json).
// Drift po Phase 18 polish — tehdy dovezeme přes RPC.

import type { CraftCompleted, CraftProgress } from 'irij-shared/messages';

export interface CraftingRecipeSummary {
  id: string;
  name_cs: string;
  description_cs: string;
  station_required?: string;
  inputs: Array<{ item_id: string; quantity: number; name_cs: string }>;
  output: { item_id: string; quantity: number; name_cs: string };
  primary_skill_name: string;
  primary_skill_level: number;
  crafting_time_ms: number;
}

// Minimal hard-coded list (mirror of server/data/recipes.json) — Phase 18 polish
// nahradí RPC fetchem.
export const CRAFTING_RECIPES: CraftingRecipeSummary[] = [
  {
    id: 'recipe.whetstone.t1',
    name_cs: 'Brousek',
    description_cs: 'Naostří čepel před bojem.',
    station_required: 'smith_forge',
    inputs: [{ item_id: 'material.stone.flint', quantity: 1, name_cs: 'Pazourek' }],
    output: { item_id: 'consumable.whetstone.t1', quantity: 1, name_cs: 'Brousek' },
    primary_skill_name: 'smithing',
    primary_skill_level: 1,
    crafting_time_ms: 2000,
  },
  {
    id: 'recipe.weapon.dagger.bronze',
    name_cs: 'Bronzová dýka',
    description_cs: 'Krátká lehká dýka.',
    station_required: 'smith_forge',
    inputs: [
      { item_id: 'material.ore.copper', quantity: 1, name_cs: 'Měděná ruda' },
      { item_id: 'material.wood.oak', quantity: 1, name_cs: 'Dubové dřevo' },
    ],
    output: { item_id: 'weapon.melee.dagger.bronze', quantity: 1, name_cs: 'Bronzová dýka' },
    primary_skill_name: 'smithing',
    primary_skill_level: 1,
    crafting_time_ms: 4000,
  },
  {
    id: 'recipe.weapon.sword.bronze',
    name_cs: 'Bronzový meč',
    description_cs: 'Spolehlivý meč pro začátečníky.',
    station_required: 'smith_forge',
    inputs: [
      { item_id: 'material.ore.copper', quantity: 2, name_cs: 'Měděná ruda' },
      { item_id: 'material.wood.oak', quantity: 1, name_cs: 'Dubové dřevo' },
    ],
    output: { item_id: 'weapon.melee.sword.bronze', quantity: 1, name_cs: 'Bronzový meč' },
    primary_skill_name: 'smithing',
    primary_skill_level: 5,
    crafting_time_ms: 5000,
  },
];

export class CraftingPanel {
  private readonly el: HTMLDivElement;
  private readonly onCraft: (recipeId: string, quantity: number) => void;
  private statusEl: HTMLDivElement | null = null;
  private currentRecipeId: string | null = null;

  constructor(onCraft: (recipeId: string, quantity: number) => void) {
    this.onCraft = onCraft;
    this.el = this.buildPanel();
    document.body.appendChild(this.el);
  }

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'irij-crafting';
    panel.style.cssText = `
      display: none;
      position: fixed;
      top: 60px;
      right: 16px;
      width: 320px;
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
    title.textContent = 'Kovárna — recepty';
    title.style.cssText = 'font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #c8a86a; border-bottom: 1px solid #3d2418; padding-bottom: 6px;';
    panel.appendChild(title);

    for (const r of CRAFTING_RECIPES) {
      panel.appendChild(this.buildRecipeRow(r));
    }

    const status = document.createElement('div');
    status.id = 'irij-crafting-status';
    status.style.cssText = 'margin-top: 10px; font-size: 11px; color: #8a7a65; min-height: 16px;';
    panel.appendChild(status);
    this.statusEl = status;

    return panel;
  }

  private buildRecipeRow(r: CraftingRecipeSummary): HTMLDivElement {
    const row = document.createElement('div');
    row.dataset.recipeId = r.id;
    row.style.cssText = 'border: 1px solid #3d2418; border-radius: 4px; padding: 6px; margin-bottom: 6px; font-size: 11px;';

    const head = document.createElement('div');
    head.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 3px;';
    head.innerHTML = `
      <span style="color:#c8a86a; font-weight: bold;">${r.name_cs}</span>
      <span style="color:#8a7a65;">${r.primary_skill_name} ${r.primary_skill_level}</span>
    `;
    row.appendChild(head);

    const inputs = document.createElement('div');
    inputs.style.cssText = 'color: #a89a7c; margin-bottom: 4px;';
    inputs.textContent = 'Vstup: ' + r.inputs.map((i) => `${i.quantity}× ${i.name_cs}`).join(', ');
    row.appendChild(inputs);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 4px;';
    for (const qty of [1, 5, 30]) {
      const btn = document.createElement('button');
      btn.textContent = `Vyrobit ${qty}×`;
      btn.dataset.recipeId = r.id;
      btn.dataset.quantity = String(qty);
      btn.style.cssText = `
        flex: 1;
        background: #3d2418;
        color: #c8a86a;
        border: 1px solid #6b4a32;
        border-radius: 3px;
        padding: 4px;
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
      `;
      btn.addEventListener('click', () => this.onCraft(r.id, qty));
      buttons.appendChild(btn);
    }
    row.appendChild(buttons);

    return row;
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

  onProgress(payload: CraftProgress): void {
    this.currentRecipeId = payload.recipe_id;
    if (!this.statusEl) return;
    const recipe = CRAFTING_RECIPES.find((r) => r.id === payload.recipe_id);
    const name = recipe?.name_cs ?? payload.recipe_id;
    const pct = Math.round((payload.progress_pct ?? 0) * 100);
    this.statusEl.textContent = `Kuju ${name}… ${pct}% (zbývá: ${payload.remaining_cycles})`;
    this.statusEl.style.color = '#c8a86a';
  }

  onCompleted(payload: CraftCompleted): void {
    if (!this.statusEl) return;
    const recipe = CRAFTING_RECIPES.find((r) => r.id === payload.recipe_id);
    const name = recipe?.name_cs ?? payload.recipe_id;
    if (payload.batch_done) {
      if (payload.success) {
        const rarity = payload.output?.rarity ?? 'common';
        this.statusEl.textContent = `Hotovo: ${name} (${rarity}). Cyklus dokončen.`;
        this.statusEl.style.color = '#88dd88';
      } else if (payload.fail && payload.reason === 'completed') {
        this.statusEl.textContent = `${name}: Selhal. Suroviny ztraceny.`;
        this.statusEl.style.color = '#ff8855';
      } else {
        this.statusEl.textContent = `${name}: ${payload.reason ?? 'zrušeno'}.`;
        this.statusEl.style.color = '#aa6666';
      }
      this.currentRecipeId = null;
    } else if (payload.success) {
      this.statusEl.textContent = `${name}: 1× hotovo, zbývá ${payload.remaining_cycles}.`;
      this.statusEl.style.color = '#88dd88';
    } else {
      this.statusEl.textContent = `${name}: cyklus selhal, zbývá ${payload.remaining_cycles}.`;
      this.statusEl.style.color = '#ff8855';
    }
  }

  getCurrentRecipeId(): string | null {
    return this.currentRecipeId;
  }

  destroy(): void {
    this.el.remove();
  }
}
