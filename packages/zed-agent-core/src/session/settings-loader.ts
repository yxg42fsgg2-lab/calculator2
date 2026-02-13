/**
 * Settings loader — loads AgentSettings from a config file.
 * Ported from: crates/agent_settings/src/agent_settings.rs settings persistence
 *
 * Supports JSON config files matching Zed's settings format.
 */

import type { AgentSettings, AgentProfileSettings } from '../types/settings.js';
import { defaultAgentProfileSettings, type LanguageModelSelection } from '../types/settings.js';
import type { AgentProfileId } from '../types/branded.js';
import { agentProfileId } from '../types/branded.js';

/**
 * Raw config file format (matches Zed's settings.json agent section).
 */
export interface AgentConfigFile {
  agent?: {
    default_model?: {
      provider: string;
      model: string;
      enable_thinking?: boolean;
      effort?: string;
    };
    default_profile?: string;
    profiles?: Record<string, {
      default_model?: {
        provider: string;
        model: string;
        enable_thinking?: boolean;
      };
      tools?: Record<string, boolean>;
    }>;
    /** Tool permission mode: "auto" | "always_ask" | "custom" */
    tool_permission_mode?: string;
    always_allow?: Array<{ tool: string; pattern?: string }>;
    always_deny?: Array<{ tool: string; pattern?: string }>;
    temperature?: number;
  };
}

/**
 * Load AgentSettings from a parsed config object.
 * Typically read from a JSON file (settings.json).
 */
export function loadSettingsFromConfig(config: AgentConfigFile): AgentSettings {
  const agentConfig = config.agent ?? {};

  // Default model
  let defaultModel: LanguageModelSelection | undefined;
  if (agentConfig.default_model) {
    defaultModel = {
      provider: agentConfig.default_model.provider,
      model: agentConfig.default_model.model,
      enableThinking: agentConfig.default_model.enable_thinking,
      effort: agentConfig.default_model.effort,
    };
  }

  // Profiles
  const profiles = new Map<AgentProfileId, AgentProfileSettings>();
  if (agentConfig.profiles) {
    for (const [id, profileConfig] of Object.entries(agentConfig.profiles)) {
      const profileModel = profileConfig.default_model
        ? {
            provider: profileConfig.default_model.provider,
            model: profileConfig.default_model.model,
            enableThinking: profileConfig.default_model.enable_thinking,
          }
        : undefined;

      profiles.set(
        agentProfileId(id),
        defaultAgentProfileSettings({
          defaultModel: profileModel,
          tools: profileConfig.tools,
        }),
      );
    }
  }

  // Ensure default profile exists
  const defaultProfileId = agentProfileId(agentConfig.default_profile ?? 'default');
  if (!profiles.has(defaultProfileId)) {
    profiles.set(defaultProfileId, defaultAgentProfileSettings());
  }

  // Permission mode
  const toolPermissionMode = agentConfig.tool_permission_mode === 'always_ask'
    ? 'always_ask' as const
    : agentConfig.tool_permission_mode === 'custom'
      ? 'custom' as const
      : 'auto' as const;

  return {
    defaultModel,
    defaultProfile: defaultProfileId,
    profiles,
    toolPermissionMode,
    alwaysAllow: agentConfig.always_allow,
    alwaysDeny: agentConfig.always_deny,
    temperature: agentConfig.temperature,
  };
}

/**
 * Load settings from a JSON string.
 */
export function loadSettingsFromJson(json: string): AgentSettings {
  const config = JSON.parse(json) as AgentConfigFile;
  return loadSettingsFromConfig(config);
}

/**
 * Create default settings (auto-allow everything).
 */
export function defaultSettings(): AgentSettings {
  const profiles = new Map<AgentProfileId, AgentProfileSettings>();
  profiles.set(agentProfileId('default'), defaultAgentProfileSettings());

  return {
    defaultProfile: agentProfileId('default'),
    profiles,
    toolPermissionMode: 'auto',
  };
}
