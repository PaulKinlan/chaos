/**
 * Role template registry.
 *
 * Maps role names to functions that produce the initial CLAUDE.md content
 * for an agent with that role.
 */

import { neutralTemplate } from './neutral.js';
import { researcherTemplate } from './researcher.js';
import { coderTemplate } from './coder.js';
import { writerTemplate } from './writer.js';
import { plannerTemplate } from './planner.js';
import { reviewerTemplate } from './reviewer.js';

export type TemplateFunction = (agentName: string) => string;

export const templates: Record<string, TemplateFunction> = {
  neutral: neutralTemplate,
  researcher: researcherTemplate,
  coder: coderTemplate,
  writer: writerTemplate,
  planner: plannerTemplate,
  reviewer: reviewerTemplate,
};

/** Get a template function by role name. Falls back to neutral. */
export function getTemplate(role: string): TemplateFunction {
  return templates[role] ?? templates.neutral;
}

/** List all available role names. */
export function listRoles(): string[] {
  return Object.keys(templates);
}
