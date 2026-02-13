/**
 * Tool permission engine.
 * Ported from: crates/agent/src/tool_permissions.rs (~1,100 LOC production)
 *
 * Evaluates whether a tool call should be allowed, denied, or require user confirmation
 * based on settings rules (always_allow, always_deny patterns).
 */

import type { AgentSettings } from '../types/settings.js';
import { extractCommands } from './shell-command-parser.js';

/**
 * Permission decision result.
 */
export type ToolPermissionDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason: string }
  | { type: 'confirm' };

/**
 * Decide whether a tool call should be allowed based on settings.
 * Ported from: decide_permission_from_settings()
 *
 * @param toolName The tool being invoked.
 * @param inputValues The tool's input values to check against patterns.
 * @param settings The current agent settings.
 */
export function decidePermissionFromSettings(
  toolName: string,
  inputValues: string[],
  settings: AgentSettings,
): ToolPermissionDecision {
  // In 'auto' mode, allow everything
  if (settings.toolPermissionMode === 'auto') {
    return { type: 'allow' };
  }

  // In 'always_ask' mode, always confirm
  if (settings.toolPermissionMode === 'always_ask') {
    return { type: 'confirm' };
  }

  // Custom mode — check rules
  // Check always_deny rules first (deny takes priority)
  if (settings.alwaysDeny) {
    for (const rule of settings.alwaysDeny) {
      if (rule.tool === toolName) {
        if (!rule.pattern) {
          // Deny all invocations of this tool
          return { type: 'deny', reason: `Tool '${toolName}' is always denied` };
        }
        // Check pattern against inputs
        if (matchesPattern(rule.pattern, inputValues, toolName)) {
          return { type: 'deny', reason: `Tool '${toolName}' denied by pattern: ${rule.pattern}` };
        }
      }
    }
  }

  // Check always_allow rules
  if (settings.alwaysAllow) {
    for (const rule of settings.alwaysAllow) {
      if (rule.tool === toolName) {
        if (!rule.pattern) {
          // Allow all invocations of this tool
          return { type: 'allow' };
        }
        // Check pattern against inputs
        if (matchesPattern(rule.pattern, inputValues, toolName)) {
          return { type: 'allow' };
        }
      }
    }
  }

  // No matching rule — confirm
  return { type: 'confirm' };
}

/**
 * Check if the input values match a permission pattern.
 *
 * For terminal tools, we need to check EVERY sub-command in a compound command.
 * This prevents attacks like "cargo build && rm -rf /" from matching "^cargo".
 */
function matchesPattern(pattern: string, inputValues: string[], toolName: string): boolean {
  try {
    const regex = new RegExp(pattern);

    for (const value of inputValues) {
      if (toolName === 'terminal') {
        // For terminal commands, check every sub-command
        const commands = extractCommands(value);
        const allMatch = commands.every((cmd) => regex.test(cmd));
        if (allMatch && commands.length > 0) {
          return true;
        }
      } else {
        if (regex.test(value)) {
          return true;
        }
      }
    }

    return false;
  } catch {
    // Invalid regex pattern
    return false;
  }
}

/**
 * Decide permission for a path-based tool.
 * Ported from: decide_permission_for_path()
 */
export function decidePermissionForPath(
  toolName: string,
  paths: string[],
  settings: AgentSettings,
): ToolPermissionDecision {
  return decidePermissionFromSettings(toolName, paths, settings);
}
