// Phase 12: Job Board UI overlay — DOM panel zobrazený po dialog effectu
// `open_job_board` (server pošle JOB_BOARD_OPEN). Panel zobrazí list tasků
// vesnice, hráč může vzít / submitovat / opustit task.

import { Op } from 'irij-shared/messages';
import type {
  JobBoardOpen,
  JobBoardTaskView,
  JobBoardUpdated,
  JobTaskAbandonRequest,
  JobTaskCompleted,
  JobTaskProgress,
  JobTaskSubmitRequest,
  JobTaskTakenRequest,
} from 'irij-shared/messages';
import type { NakamaConnection } from '../nakama.js';

export interface JobBoardCallbacks {
  conn: NakamaConnection;
  matchId: string;
  onClose?: () => void;
  // Vrací aktuální počet daného itemu v hráčově inventáři. Pro deliver_item
  // tasky klient počítá `submittable` lokálně (server `self_submittable` je
  // pro deliver_item vždy false — server přímo neví o aktuálním inventory
  // stavu při každém broadcast a posílá pouze server-side progress mapu,
  // která je u deliver_item prázdná).
  getInventoryCount: (itemId: string) => number;
}

const PANEL_ID = 'irij-jobboard';

export class JobBoardPanel {
  private readonly el: HTMLDivElement;
  private cb: JobBoardCallbacks;
  private currentVillageId: string | null = null;
  private currentIssuerNpcId: string | null = null;
  private tasksById = new Map<string, JobBoardTaskView>();

  constructor(cb: JobBoardCallbacks) {
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
      width: min(560px, calc(100vw - 32px));
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
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #3d2418; padding-bottom: 6px;';

    const title = document.createElement('div');
    title.id = `${PANEL_ID}-title`;
    title.style.cssText = 'font-size: 14px; font-weight: bold; color: #c8a86a;';
    title.textContent = 'Hospodský board';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background: transparent; border: 1px solid #6b4a32; color: #d4c5b0; font-family: monospace; cursor: pointer; padding: 2px 8px; border-radius: 3px;';
    closeBtn.onclick = () => this.hide();
    header.appendChild(closeBtn);

    panel.appendChild(header);

    const list = document.createElement('div');
    list.id = `${PANEL_ID}-list`;
    panel.appendChild(list);

    return panel;
  }

  isVisible(): boolean {
    return this.el.style.display !== 'none';
  }

  // Voláno z WorldScene po INVENTORY_CHANGED — hráč sebral/zahodil item,
  // může se změnit submittable stav deliver_item tasků.
  onInventoryChanged(): void {
    if (this.isVisible()) this.render();
  }

  // Vrací efektivní submittable stav — pro deliver_item se počítá lokálně
  // z inventory countu (server self_submittable nezohledňuje inventář).
  // Pro kill_mob a ostatní typy se použije server-side flag.
  private effectiveSubmittable(task: JobBoardTaskView): boolean {
    if (task.objective.type === 'deliver_item') {
      const have = this.cb.getInventoryCount(task.objective.target);
      return have >= task.objective.count;
    }
    return task.self_submittable;
  }

  show(): void {
    this.el.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
    this.cb.onClose?.();
  }

  destroy(): void {
    this.el.remove();
  }

  // Server pushed JOB_BOARD_OPEN — fresh snapshot, replace state.
  onOpen(payload: JobBoardOpen): void {
    this.currentVillageId = payload.village_id;
    this.currentIssuerNpcId = payload.issuer_npc_id;
    this.tasksById.clear();
    for (const task of payload.tasks) this.tasksById.set(task.task_id, task);
    this.show();
    this.render();
  }

  // Server broadcast JOB_BOARD_UPDATED — incremental delta. Server posílá
  // tento broadcast všem hráčům v match (= globální view), takže pole
  // `taken_by_self` / `self_progress` / `self_submittable` v payloadu jsou
  // vždy false/undefined (server neví, kdo je příjemce). Klient si tedy
  // tato per-player pole musí zachovat z předchozího lokálního stavu —
  // jinak by JOB_BOARD_UPDATED, který přijde po JOB_TASK_PROGRESS event=taken,
  // přepsal naše „mám to vzaté" do „nemám to vzaté".
  onUpdated(payload: JobBoardUpdated): void {
    if (this.currentVillageId && payload.village_id !== this.currentVillageId) return;
    for (const t of payload.added) this.tasksById.set(t.task_id, t);
    for (const t of payload.changed) {
      const existing = this.tasksById.get(t.task_id);
      const merged: JobBoardTaskView = existing
        ? {
            ...t,
            taken_by_self: existing.taken_by_self,
            self_progress: existing.self_progress,
            self_submittable: existing.self_submittable,
          }
        : t;
      this.tasksById.set(t.task_id, merged);
    }
    for (const id of payload.removed) this.tasksById.delete(id);
    if (this.isVisible()) this.render();
  }

  // Per-task progress update — taken / progress (kill_mob) / abandoned / expired /
  // snapshot. Pokud server pošle progress, ale task už není v tasksById (zavřený
  // panel + reconnect), nic nedělá — v takovém případě vidíš entry až po dalším
  // open boardu.
  onTaskProgress(payload: JobTaskProgress): void {
    const existing = this.tasksById.get(payload.task_id);
    if (payload.event === 'abandoned') {
      // Klient odeber „taken_by_self" stav — task zůstává jako „Vzít úkol"
      // zase k dispozici.
      if (existing) {
        this.tasksById.set(payload.task_id, {
          ...existing,
          taken_by_self: false,
          self_progress: undefined,
          self_submittable: false,
        });
      }
      if (this.isVisible()) this.render();
      return;
    }
    if (payload.event === 'expired') {
      // Task vypršel/byl smazaný ze serveru — odeber.
      this.tasksById.delete(payload.task_id);
      if (this.isVisible()) this.render();
      return;
    }
    if (!existing) return;
    this.tasksById.set(payload.task_id, {
      ...existing,
      taken_by_self: true,
      self_progress: payload.progress,
      self_submittable: payload.submittable,
    });
    if (this.isVisible()) this.render();
  }

  // Po submit — task se buď removuje (fulfilled_max) nebo updatuje. Klient
  // odbaví reward UI; tady jen vyčistíme self-state.
  onTaskCompleted(payload: JobTaskCompleted): void {
    const existing = this.tasksById.get(payload.task_id);
    if (existing) {
      this.tasksById.set(payload.task_id, {
        ...existing,
        taken_by_self: false,
        self_progress: undefined,
        self_submittable: false,
      });
    }
    if (this.isVisible()) this.render();
  }

  private render(): void {
    const list = document.getElementById(`${PANEL_ID}-list`);
    if (!list) return;
    list.innerHTML = '';

    if (this.tasksById.size === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size: 11px; color: #6b4a32; font-style: italic; padding: 8px 0;';
      empty.textContent = 'Žádné aktuální poptávky. Zkus přijít později.';
      list.appendChild(empty);
      return;
    }

    const sorted = Array.from(this.tasksById.values()).sort((a, b) => {
      if (a.taken_by_self !== b.taken_by_self) return a.taken_by_self ? -1 : 1;
      if (a.priority_bonus_multiplier !== b.priority_bonus_multiplier) {
        return b.priority_bonus_multiplier - a.priority_bonus_multiplier;
      }
      return a.task_id.localeCompare(b.task_id);
    });

    for (const task of sorted) {
      list.appendChild(this.buildTaskRow(task));
    }
  }

  private buildTaskRow(task: JobBoardTaskView): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.dataset.taskId = task.task_id;
    wrap.dataset.taken = task.taken_by_self ? '1' : '0';
    wrap.style.cssText = `
      margin-bottom: 10px;
      padding: 8px 10px;
      background: ${task.taken_by_self ? 'rgba(70, 50, 18, 0.7)' : 'rgba(40, 24, 12, 0.7)'};
      border-left: 3px solid ${task.taken_by_self ? '#f0c060' : '#6b4a32'};
      border-radius: 3px;
    `;

    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size: 13px; font-weight: bold; color: #f7e9c8;';
    title.textContent = task.title.cs;
    titleRow.appendChild(title);

    if (task.priority_bonus_multiplier > 1.0) {
      const bonus = document.createElement('span');
      bonus.style.cssText = 'font-size: 10px; color: #ff9c6e; font-weight: bold;';
      bonus.textContent = task.priority_bonus_multiplier >= 2.0
        ? 'URGENTNÍ ×2'
        : `+${Math.round((task.priority_bonus_multiplier - 1) * 100)}%`;
      titleRow.appendChild(bonus);
    }
    wrap.appendChild(titleRow);

    const desc = document.createElement('div');
    desc.style.cssText = 'font-size: 11px; color: #d4c5b0; margin-bottom: 6px; line-height: 1.4;';
    desc.textContent = task.description.cs;
    wrap.appendChild(desc);

    // Objective + reward summary.
    const meta = document.createElement('div');
    meta.style.cssText = 'font-size: 10px; color: #8a7a65; margin-bottom: 6px;';
    const objText = this.formatObjective(task);
    const rewardText = this.formatReward(task);
    meta.textContent = `${objText}  •  ${rewardText}  •  Hráči: ${task.current_takers}/${task.max_concurrent_takers}`;
    wrap.appendChild(meta);

    // Action button row.
    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 6px;';
    if (task.taken_by_self) {
      const submittable = this.effectiveSubmittable(task);
      if (submittable) {
        actions.appendChild(
          this.button('Vyzvednout odměnu', '#6e9c4e', () => this.submit(task.task_id), 'submit'),
        );
      } else {
        const status = document.createElement('span');
        status.style.cssText = 'font-size: 10px; color: #c8a86a; padding: 4px 0;';
        status.textContent = '(plň úkol — pak se vrať)';
        actions.appendChild(status);
      }
      actions.appendChild(
        this.button('Zrušit', '#9c4a4a', () => this.abandon(task.task_id), 'abandon'),
      );
    } else if (task.current_takers >= task.max_concurrent_takers) {
      const full = document.createElement('span');
      full.style.cssText = 'font-size: 10px; color: #6b4a32; padding: 4px 0;';
      full.textContent = '(zaplněno)';
      actions.appendChild(full);
    } else {
      actions.appendChild(
        this.button('Vzít úkol', '#6e8c9c', () => this.take(task.task_id), 'take'),
      );
    }
    wrap.appendChild(actions);

    return wrap;
  }

  private formatObjective(task: JobBoardTaskView): string {
    const obj = task.objective;
    if (obj.type === 'kill_mob') {
      const have = task.self_progress?.[`${obj.type}:${obj.target}`] ?? 0;
      return task.taken_by_self
        ? `Zabít ${obj.target}: ${Math.min(have, obj.count)}/${obj.count}`
        : `Zabít ${obj.target} ×${obj.count}`;
    }
    // deliver_item: counter z inventáře (i když není taken — informativní).
    const have = this.cb.getInventoryCount(obj.target);
    return `Doručit ${obj.target}: ${Math.min(have, obj.count)}/${obj.count}`;
  }

  private formatReward(task: JobBoardTaskView): string {
    const parts: string[] = [];
    if (task.reward.currency_denar > 0) {
      const adjusted = Math.floor(task.reward.currency_denar * task.priority_bonus_multiplier);
      parts.push(`${adjusted} d`);
    }
    if (task.reward.xp) {
      for (const skill of Object.keys(task.reward.xp)) {
        const amt = task.reward.xp[skill] ?? 0;
        const adjusted = Math.floor(amt * task.priority_bonus_multiplier);
        parts.push(`${adjusted} XP/${skill}`);
      }
    }
    if (task.reward.reputation) {
      for (const village of Object.keys(task.reward.reputation)) {
        const delta = task.reward.reputation[village] ?? 0;
        parts.push(`${delta > 0 ? '+' : ''}${delta} rep`);
      }
    }
    return parts.join(' / ');
  }

  private button(
    label: string,
    color: string,
    onClick: () => void,
    action?: 'take' | 'submit' | 'abandon',
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (action) btn.dataset.action = action;
    btn.style.cssText = `
      background: ${color};
      color: #f7e9c8;
      border: 1px solid #1a0e04;
      font-family: monospace;
      font-size: 11px;
      padding: 5px 10px;
      cursor: pointer;
      border-radius: 3px;
    `;
    btn.onclick = onClick;
    return btn;
  }

  // === Actions ============================================================

  private take(taskId: string): void {
    const payload: JobTaskTakenRequest = { task_id: taskId };
    this.send(Op.JOB_TASK_TAKEN, payload);
  }

  private submit(taskId: string): void {
    const payload: JobTaskSubmitRequest = { task_id: taskId };
    this.send(Op.JOB_TASK_SUBMIT, payload);
  }

  private abandon(taskId: string): void {
    const payload: JobTaskAbandonRequest = { task_id: taskId };
    this.send(Op.JOB_TASK_ABANDON, payload);
  }

  private send(opCode: number, payload: unknown): void {
    void this.cb.conn.socket
      .sendMatchState(this.cb.matchId, opCode, JSON.stringify(payload))
      .catch((err: unknown) => {
        console.warn('JobBoardPanel send failed', err);
      });
  }
}
