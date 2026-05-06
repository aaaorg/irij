// Quest log + journal UI overlay — Phase 11.
// Toggle klávesou 'Q' nebo HUD button. Dvě sekce:
//   1. Aktivní questy — title, current step description, progress (kill counts).
//   2. Deník (completed) — title, date, "klikni pro lore". MVP: jen list.
// Quest data se hromadí přes QUEST_PROGRESS / QUEST_COMPLETED events,
// state mirror se načítá z initial WORLD_SNAPSHOT scope (server pošle aktivní
// questy individuálně přes QUEST_PROGRESS s event='advanced' v matchJoin).

import type {
  QuestCompleted,
  QuestProgress,
} from 'irij-shared/messages';
import type { QuestStepDefinition } from 'irij-shared/types';

interface ActiveQuestEntry {
  questId: string;
  titleCs: string;
  descriptionCs: string;
  currentStepId: string | null;
  currentStep: QuestStepDefinition | null;
  stepProgress: Record<string, number>;
}

interface CompletedQuestEntry {
  questId: string;
  titleCs: string;
  completedAt: string; // ISO from client receipt
}

export class QuestPanel {
  private readonly el: HTMLDivElement;
  private active = new Map<string, ActiveQuestEntry>();
  private completed = new Map<string, CompletedQuestEntry>();

  constructor() {
    this.el = this.buildPanel();
    document.body.appendChild(this.el);
  }

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = 'irij-quests';
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
    title.style.cssText = 'font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #c8a86a; border-bottom: 1px solid #3d2418; padding-bottom: 6px;';
    title.textContent = 'Deník questů';
    panel.appendChild(title);

    const activeSection = document.createElement('div');
    activeSection.id = 'irij-quests-active';
    activeSection.style.cssText = 'margin-bottom: 12px;';
    panel.appendChild(activeSection);

    const completedSection = document.createElement('div');
    completedSection.id = 'irij-quests-completed';
    panel.appendChild(completedSection);

    return panel;
  }

  isVisible(): boolean {
    return this.el.style.display !== 'none';
  }

  toggle(): void {
    this.el.style.display = this.el.style.display === 'none' ? 'block' : 'none';
    if (this.isVisible()) this.render();
  }

  destroy(): void {
    this.el.remove();
    this.active.clear();
    this.completed.clear();
  }

  // Server-pushed update — buď started (fresh quest) nebo advanced (kroku
  // přibyl progress, nebo se posunul step). Klient vždy přepíše entry pro
  // ten quest aktuálním server snapshotem.
  onProgress(payload: QuestProgress): void {
    const entry: ActiveQuestEntry = {
      questId: payload.quest_id,
      titleCs: payload.title.cs,
      descriptionCs: payload.description.cs,
      currentStepId: payload.current_step_id,
      currentStep: payload.step,
      stepProgress: payload.step_progress,
    };
    this.active.set(payload.quest_id, entry);
    // Vždy re-renderujeme i pokud je panel hidden — DOM elementy zůstanou
    // aktuální, takže když hráč panel otevře, vidí čerstvý stav. Smoke test
    // používá textContent na hidden DOM pro ověření quest progress.
    this.render();
  }

  onCompleted(payload: QuestCompleted): void {
    this.active.delete(payload.quest_id);
    this.completed.set(payload.quest_id, {
      questId: payload.quest_id,
      titleCs: payload.title.cs,
      completedAt: new Date().toISOString(),
    });
    this.render();
  }

  // Helper pro WorldScene.update() — přečte si první aktivní quest pro HUD ticker.
  getFirstActive(): ActiveQuestEntry | null {
    for (const v of this.active.values()) return v;
    return null;
  }

  private render(): void {
    this.renderActive();
    this.renderCompleted();
  }

  private renderActive(): void {
    const sec = document.getElementById('irij-quests-active');
    if (!sec) return;
    sec.innerHTML = '';

    const heading = document.createElement('div');
    heading.style.cssText = 'font-size: 11px; color: #c8a86a; margin-bottom: 4px;';
    heading.textContent = `Aktivní (${this.active.size})`;
    sec.appendChild(heading);

    if (this.active.size === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size: 11px; color: #6b4a32; font-style: italic;';
      empty.textContent = 'Zatím nemáš žádný aktivní quest. Promluv s NPC ve vesnici.';
      sec.appendChild(empty);
      return;
    }

    for (const entry of this.active.values()) {
      sec.appendChild(this.buildActiveEntry(entry));
    }
  }

  private buildActiveEntry(entry: ActiveQuestEntry): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 10px; padding: 6px 8px; background: rgba(40,24,12,0.7); border-left: 2px solid #c8a86a; border-radius: 2px;';

    const t = document.createElement('div');
    t.style.cssText = 'font-size: 12px; font-weight: bold; color: #f7e9c8; margin-bottom: 3px;';
    t.textContent = entry.titleCs;
    wrap.appendChild(t);

    if (entry.currentStep) {
      const step = document.createElement('div');
      step.style.cssText = 'font-size: 11px; color: #d4c5b0; margin-bottom: 3px;';
      step.textContent = `→ ${entry.currentStep.description.cs}`;
      wrap.appendChild(step);

      // Pokud objective má progress (kill_mob count), zobraz progres bar.
      if (entry.currentStep.objective.type === 'kill_mob') {
        const progressKey = `kill_mob:${entry.currentStep.objective.target}`;
        const have = entry.stepProgress[progressKey] ?? 0;
        const need = entry.currentStep.objective.count;
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size: 10px; color: #8a7a65; text-align: right;';
        meta.textContent = `${have} / ${need}`;
        wrap.appendChild(meta);
      }
    }

    return wrap;
  }

  private renderCompleted(): void {
    const sec = document.getElementById('irij-quests-completed');
    if (!sec) return;
    sec.innerHTML = '';

    const heading = document.createElement('div');
    heading.style.cssText = 'font-size: 11px; color: #c8a86a; margin-bottom: 4px; border-top: 1px solid #3d2418; padding-top: 6px;';
    heading.textContent = `Deník (${this.completed.size})`;
    sec.appendChild(heading);

    if (this.completed.size === 0) return;

    for (const entry of this.completed.values()) {
      const row = document.createElement('div');
      row.style.cssText = 'font-size: 11px; color: #8a7a65; margin: 2px 0; padding-left: 8px;';
      row.textContent = `✓ ${entry.titleCs}`;
      sec.appendChild(row);
    }
  }
}
