/**
 * @module permissions
 * Tool permission engine and supporting systems.
 */

export {
  decidePermissionFromSettings,
  decidePermissionForPath,
} from './tool-permissions.js';
export type { ToolPermissionDecision } from './tool-permissions.js';

export {
  extractCommands,
  extractBaseCommand,
} from './shell-command-parser.js';

export {
  extractTerminalPattern,
  extractTerminalPatternDisplay,
  extractPathPattern,
  extractPathPatternDisplay,
  extractUrlPattern,
  extractUrlPatternDisplay,
} from './pattern-extraction.js';
