// Quest log + journal UI overlay — Phase 11.
// Toggle klávesou 'Q' nebo HUD button. Dvě sekce:
//   1. Aktivní questy — title, current step description, progress (kill counts).
//   2. Deník (completed) — title, date, "klikni pro lore". MVP: jen list.
// Quest data se hromadí přes QUEST_PROGRESS / QUEST_COMPLETED events,
// state mirror se načítá z initial WORLD_SNAPSHOT scope (server pošle aktivní
// questy individuálně přes QUEST_PROGRESS s event='advanced' v matchJoin).

import type {
  JobBoardTaskView,
  JobBoardUpdated,
  JobTaskCompleted,
  JobTaskProgress,
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

// Phase 12: aktivní job board task — drží jen progress / submittable / view metadata.
interface ActiveJobEntry {
  taskId: string;
  templateId: string;
  titleCs: string;
  descriptionCs: string;
  view: JobBoardTaskView | null; // pokud máme plné view (z board open / updated)
  progress: Record<string, number>;
  submittable: boolean;
}

interface CompletedJobEntry {
  taskId: string;
  titleCs: string;
  completedAt: string;
}

export interface QuestPanelCallbacks {
  // Pro deliver_item job tasky — vrací count itemu v hráčově inventáři.
  // Quest engine objective types tuto callback nepoužívají (kill_mob /
  // interact_with_object / talk_to_npc mají progress přímo ze serveru).
  getInventoryCount?: (itemId: string) => number;
}

export class QuestPanel {
  private readonly el: HTMLDivElement;
  private active = new Map<string, ActiveQuestEntry>();
  private completed = new Map<string, CompletedQuestEntry>();
  private jobsActive = new Map<string, ActiveJobEntry>();
  private jobsCompleted = new Map<string, CompletedJobEntry>();
  private cb: QuestPanelCallbacks;

  constructor(cb: QuestPanelCallbacks = {}) {
    this.cb = cb;
    this.el = this.buildPanel();
    document.body.appendChild(this.el);
  }

  // Voláno z WorldScene po INVENTORY_CHANGED — refresh deliver_item progress
  // counterů v jobs sekci.
  onInventoryChanged(): void {
    this.render();
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

    const jobsSection = document.createElement('div');
    jobsSection.id = 'irij-quests-jobs';
    jobsSection.style.cssText = 'margin-bottom: 12px;';
    panel.appendChild(jobsSection);

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
    this.jobsActive.clear();
    this.jobsCompleted.clear();
  }

  // === Phase 12: job board state mirroring ============================

  // Server pushed JOB_TASK_PROGRESS — fresh stav konkrétního tasku. Phase 12
  // server vždy posílá title/description/objective v payloadu, takže panel
  // má aktuální data i bez otevřeného boardu (po reconnectu, po take, po kill).
  // 'expired'/'abandoned' eventy entry odstraní.
  onJobProgress(payload: JobTaskProgress): void {
    if (payload.event === 'expired' || payload.event === 'abandoned') {
      this.jobsActive.delete(payload.task_id);
      this.render();
      return;
    }
    const existing = this.jobsActive.get(payload.task_id);
    // Priority: payload.title (server always provides in Phase 12) >
    // existing.view (z dříve přijatého JobBoardOpen) > existing.titleCs.
    const titleCs =
      payload.title?.cs ?? existing?.view?.title.cs ?? existing?.titleCs ?? payload.template_id;
    const descriptionCs =
      payload.description?.cs ?? existing?.view?.description.cs ?? existing?.descriptionCs ?? '';
    // Build minimal view if we don't have one yet — to získá objective renderer
    // přístup ke kill_mob counteru v renderJobs().
    const view: JobBoardTaskView | null = existing?.view
      ? {
          ...existing.view,
          self_progress: payload.progress,
          self_submittable: payload.submittable,
          taken_by_self: true,
        }
      : payload.title && payload.description && payload.objective
        ? {
            task_id: payload.task_id,
            template_id: payload.template_id,
            village_id: '',
            type: payload.objective.type,
            issuer_npc_id: '',
            deliver_to_npc_id: '',
            title: payload.title,
            description: payload.description,
            objective: payload.objective,
            reward: { currency_denar: 0 },
            max_concurrent_takers: 1,
            current_takers: 1,
            fulfilled_count: 0,
            fulfilled_max: 1,
            priority_bonus_multiplier: 1.0,
            taken_by_self: true,
            self_progress: payload.progress,
            self_submittable: payload.submittable,
          }
        : null;
    this.jobsActive.set(payload.task_id, {
      taskId: payload.task_id,
      templateId: payload.template_id,
      titleCs,
      descriptionCs,
      view,
      progress: payload.progress,
      submittable: payload.submittable,
    });
    this.render();
  }

  // Pokud máme plný view payload (z board open / updated), použijeme ho —
  // doplní popisek atd.
  onJobBoardUpdated(payload: JobBoardUpdated): void {
    for (const t of payload.added) this.applyJobView(t);
    for (const t of payload.changed) this.applyJobView(t);
    for (const id of payload.removed) {
      // Pokud task ze světa zmizel a hráč ho má jako aktivní (např. expired
      // nebo fulfilled_max), nech entry — server pošle abandon zvlášť.
      const view = this.jobsActive.get(id);
      if (view && !view.view?.taken_by_self) this.jobsActive.delete(id);
    }
    this.render();
  }

  applyJobView(view: JobBoardTaskView): void {
    if (!view.taken_by_self) return; // panel zobrazuje jen aktivní hráčovy
    const entry: ActiveJobEntry = {
      taskId: view.task_id,
      templateId: view.template_id,
      titleCs: view.title.cs,
      descriptionCs: view.description.cs,
      view,
      progress: view.self_progress ?? {},
      submittable: view.self_submittable,
    };
    this.jobsActive.set(view.task_id, entry);
  }

  onJobCompleted(payload: JobTaskCompleted): void {
    this.jobsActive.delete(payload.task_id);
    this.jobsCompleted.set(payload.task_id, {
      taskId: payload.task_id,
      titleCs: payload.title.cs,
      completedAt: new Date().toISOString(),
    });
    this.render();
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
    this.renderJobs();
    this.renderCompleted();
  }

  private renderJobs(): void {
    const sec = document.getElementById('irij-quests-jobs');
    if (!sec) return;
    sec.innerHTML = '';

    const heading = document.createElement('div');
    heading.style.cssText = 'font-size: 11px; color: #c8a86a; margin-bottom: 4px; border-top: 1px solid #3d2418; padding-top: 6px;';
    heading.textContent = `Hospodské úkoly (${this.jobsActive.size})`;
    sec.appendChild(heading);

    if (this.jobsActive.size === 0) return;

    for (const entry of this.jobsActive.values()) {
      const obj = entry.view?.objective;
      // Lokální vyhodnocení submittable — pro deliver_item ignorujeme server flag
      // a počítáme z aktuálního inventáře (server self_submittable z view je
      // pro deliver_item vždy false).
      const submittable =
        obj?.type === 'deliver_item' && this.cb.getInventoryCount
          ? this.cb.getInventoryCount(obj.target) >= obj.count
          : entry.submittable;

      const wrap = document.createElement('div');
      wrap.style.cssText = `margin: 4px 0; padding: 4px 8px; background: rgba(40,24,12,0.7); border-left: 2px solid ${submittable ? '#6e9c4e' : '#8a7a65'}; border-radius: 2px;`;
      const t = document.createElement('div');
      t.style.cssText = 'font-size: 11px; color: #f7e9c8;';
      t.textContent = entry.titleCs;
      wrap.appendChild(t);
      if (obj) {
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size: 10px; color: #8a7a65;';
        if (obj.type === 'kill_mob') {
          const have = entry.progress[`${obj.type}:${obj.target}`] ?? 0;
          meta.textContent = `Zabít ${obj.target}: ${Math.min(have, obj.count)}/${obj.count}${submittable ? ' ✓' : ''}`;
        } else {
          // deliver_item: progress z inventory.
          const inv = this.cb.getInventoryCount?.(obj.target) ?? 0;
          meta.textContent = `Doručit ${obj.target}: ${Math.min(inv, obj.count)}/${obj.count}${submittable ? ' ✓ (jdi k zadavateli)' : ''}`;
        }
        wrap.appendChild(meta);
      }
      sec.appendChild(wrap);
    }
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
