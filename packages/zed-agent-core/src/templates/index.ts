/**
 * @module templates
 * Handlebars prompt templates, ported 1:1 from Zed.
 */

export {
  buildSystemPrompt,
  systemPromptDataFromHost,
} from './system-prompt.js';
export type { SystemPromptData } from './system-prompt.js';

export {
  buildXmlEditPrompt,
  buildDiffFencedEditPrompt,
  buildCreateFilePrompt,
  buildDiffJudgePrompt,
} from './edit-prompts.js';
export type { EditPromptData, DiffJudgeData } from './edit-prompts.js';
