/**
 * Agent settings types.
 * Ported from: crates/agent_settings/src/agent_settings.rs
 *              crates/agent_settings/src/agent_profile.rs
 */

import type { AgentProfileId } from './branded.js';

// ---------------------------------------------------------------------------
// LanguageModelSelection — crates/settings
// ---------------------------------------------------------------------------

export interface LanguageModelSelection {
  provider: string;
  model: string;
  enableThinking?: boolean;
  effort?: string;
}

// ---------------------------------------------------------------------------
// AgentProfileSettings — crates/agent_settings/src/agent_profile.rs
// ---------------------------------------------------------------------------

export interface AgentProfileSettings {
  /** Optional preferred model for this profile. */
  defaultModel?: LanguageModelSelection;

  /** Tool enable/disable overrides. Key is tool name, value is enabled. */
  tools?: Record<string, boolean>;

  /** Context server tool overrides. Key is "serverId/toolName". */
  contextServerTools?: Record<string, boolean>;

  /** Check if a built-in tool is enabled in this profile. */
  isToolEnabled(toolName: string): boolean;

  /** Check if a context server tool is enabled. */
  isContextServerToolEnabled(serverId: string, toolName: string): boolean;
}

/**
 * Default implementation of AgentProfileSettings.
 * All tools enabled by default.
 */
export function defaultAgentProfileSettings(
  overrides?: Partial<AgentProfileSettings>,
): AgentProfileSettings {
  const tools = overrides?.tools ?? {};
  const contextServerTools = overrides?.contextServerTools ?? {};

  return {
    defaultModel: overrides?.defaultModel,
    tools,
    contextServerTools,
    isToolEnabled(toolName: string): boolean {
      return tools[toolName] !== false;
    },
    isContextServerToolEnabled(serverId: string, toolName: string): boolean {
      const key = `${serverId}/${toolName}`;
      return contextServerTools[key] !== false;
    },
  };
}

// ---------------------------------------------------------------------------
// ToolPermissionMode — crates/settings
// ---------------------------------------------------------------------------

export type ToolPermissionMode = 'always_ask' | 'auto' | 'custom';

// ---------------------------------------------------------------------------
// AgentSettings — crates/agent_settings/src/agent_settings.rs
// ---------------------------------------------------------------------------

export interface AgentSettings {
  /** Default language model selection. */
  defaultModel?: LanguageModelSelection;

  /** Default profile ID. */
  defaultProfile: AgentProfileId;

  /** Named profiles. */
  profiles: Map<AgentProfileId, AgentProfileSettings>;

  /** Tool permission mode. */
  toolPermissionMode: ToolPermissionMode;

  /** Always-allow rules for tools. */
  alwaysAllow?: Array<{ tool: string; pattern?: string }>;

  /** Always-deny rules for tools. */
  alwaysDeny?: Array<{ tool: string; pattern?: string }>;

  /** Temperature override (null = use model default). */
  temperature?: number;
}

/**
 * Summarize thread prompt.
 * Ported from: SUMMARIZE_THREAD_PROMPT in agent_settings.
 */
export const SUMMARIZE_THREAD_PROMPT =
  'Generate a concise title (max 8 words) for this conversation. ' +
  'Return ONLY the title text, no quotes, no explanation. ' +
  'Focus on the main topic or task discussed.';

/**
 * Detailed summarize thread prompt.
 * Ported from: SUMMARIZE_THREAD_DETAILED_PROMPT in agent_settings.
 */
export const SUMMARIZE_THREAD_DETAILED_PROMPT =
  'Generate a detailed summary of this conversation in 2-3 sentences. ' +
  'Include the main topics discussed, any code changes made, and the current status. ' +
  'Return ONLY the summary text, no quotes, no explanation.';

/**
 * Get the temperature for a model based on settings.
 * Ported from: AgentSettings::temperature_for_model
 */
export function temperatureForModel(
  settings: AgentSettings,
): number | undefined {
  return settings.temperature;
}
