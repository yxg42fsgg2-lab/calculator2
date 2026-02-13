/**
 * Branded type utility for creating nominal types from primitives.
 * This mirrors Rust's newtype pattern used extensively in Zed.
 */
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * Unique identifier for a language model.
 * Ported from: crates/language_model/src/model/mod.rs — LanguageModelId
 */
export type LanguageModelId = Brand<string, 'LanguageModelId'>;

/**
 * Display name for a language model.
 * Ported from: crates/language_model/src/model/mod.rs — LanguageModelName
 */
export type LanguageModelName = Brand<string, 'LanguageModelName'>;

/**
 * Unique identifier for a language model provider (e.g. "anthropic", "openai").
 * Ported from: crates/language_model/src/model/mod.rs — LanguageModelProviderId
 */
export type LanguageModelProviderId = Brand<string, 'LanguageModelProviderId'>;

/**
 * Display name for a language model provider (e.g. "Anthropic", "OpenAI").
 * Ported from: crates/language_model/src/model/mod.rs — LanguageModelProviderName
 */
export type LanguageModelProviderName = Brand<string, 'LanguageModelProviderName'>;

/**
 * Unique identifier for a tool use invocation.
 * Ported from: crates/language_model/src/language_model.rs — LanguageModelToolUseId
 */
export type LanguageModelToolUseId = Brand<string, 'LanguageModelToolUseId'>;

/**
 * Session identifier for an agent thread.
 * Ported from: agent_client_protocol — SessionId
 */
export type SessionId = Brand<string, 'SessionId'>;

/**
 * Terminal instance identifier.
 * Ported from: agent_client_protocol — TerminalId
 */
export type TerminalId = Brand<string, 'TerminalId'>;

/**
 * Tool call identifier.
 * Ported from: agent_client_protocol — ToolCallId
 */
export type ToolCallId = Brand<string, 'ToolCallId'>;

/**
 * User message identifier.
 * Ported from: crates/acp_thread/src/connection.rs — UserMessageId
 */
export type UserMessageId = Brand<string, 'UserMessageId'>;

/**
 * Prompt identifier (tracks the user physically submitting a message).
 * Ported from: crates/agent/src/thread.rs — PromptId
 */
export type PromptId = Brand<string, 'PromptId'>;

/**
 * Agent profile identifier.
 * Ported from: crates/agent_settings/src/agent_profile.rs — AgentProfileId
 */
export type AgentProfileId = Brand<string, 'AgentProfileId'>;

// --- Factory functions ---

export function languageModelId(id: string): LanguageModelId {
  return id as LanguageModelId;
}

export function languageModelName(name: string): LanguageModelName {
  return name as LanguageModelName;
}

export function languageModelProviderId(id: string): LanguageModelProviderId {
  return id as LanguageModelProviderId;
}

export function languageModelProviderName(name: string): LanguageModelProviderName {
  return name as LanguageModelProviderName;
}

export function toolUseId(id: string): LanguageModelToolUseId {
  return id as LanguageModelToolUseId;
}

export function sessionId(id: string): SessionId {
  return id as SessionId;
}

export function terminalId(id: string): TerminalId {
  return id as TerminalId;
}

export function toolCallId(id: string): ToolCallId {
  return id as ToolCallId;
}

export function userMessageId(id: string): UserMessageId {
  return id as UserMessageId;
}

export function promptId(id: string): PromptId {
  return id as PromptId;
}

export function agentProfileId(id: string): AgentProfileId {
  return id as AgentProfileId;
}
