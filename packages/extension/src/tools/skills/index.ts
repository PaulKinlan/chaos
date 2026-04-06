/**
 * Skills Tools Index
 *
 * Exports getSkillTools(agentId) returning all skill management tools.
 */

import type { ToolSet } from 'ai';
import { createInstallSkillTool } from './install-skill.js';
import { createRemoveSkillTool } from './remove-skill.js';
import { createListSkillsTool } from './list-skills.js';
import { createFetchSkillTool } from './fetch-skill.js';
import { createSearchSkillsTool } from './search-skills.js';
import { createAutoInstallSkillTool } from './auto-install-skill.js';

/**
 * Returns all skill management tools as a ToolSet record.
 */
export function getSkillTools(agentId: string): ToolSet {
  return {
    install_skill: createInstallSkillTool(agentId),
    remove_skill: createRemoveSkillTool(agentId),
    list_skills: createListSkillsTool(agentId),
    fetch_skill: createFetchSkillTool(agentId),
    search_skills: createSearchSkillsTool(agentId),
    auto_install_skill: createAutoInstallSkillTool(agentId),
  };
}
