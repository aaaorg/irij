// Static catalog of job board templates — viz server/data/job_board_templates.json.
// Loaded once at module init. Per-village seskupení pro generátor.

import type { JobBoardTaskTemplate } from 'irij-shared/types';

import templatesData from '../../data/job_board_templates.json';

const TEMPLATES: JobBoardTaskTemplate[] = templatesData as unknown as JobBoardTaskTemplate[];

const TEMPLATES_BY_ID: { [id: string]: JobBoardTaskTemplate } = {};
const TEMPLATES_BY_VILLAGE: { [villageId: string]: JobBoardTaskTemplate[] } = {};

for (const t of TEMPLATES) {
  TEMPLATES_BY_ID[t.template_id] = t;
  if (!TEMPLATES_BY_VILLAGE[t.village_id]) TEMPLATES_BY_VILLAGE[t.village_id] = [];
  TEMPLATES_BY_VILLAGE[t.village_id]!.push(t);
}

export function getJobBoardTemplate(templateId: string): JobBoardTaskTemplate | null {
  return TEMPLATES_BY_ID[templateId] ?? null;
}

export function getJobBoardTemplatesForVillage(villageId: string): JobBoardTaskTemplate[] {
  return TEMPLATES_BY_VILLAGE[villageId] ?? [];
}

export function getAllJobBoardTemplates(): JobBoardTaskTemplate[] {
  return TEMPLATES;
}
