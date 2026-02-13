/**
 * Thread and message types.
 * Ported from: crates/agent/src/thread.rs — Message, UserMessage, AgentMessage, etc.
 *              crates/acp_thread/src/mention.rs — MentionUri
 */

import type {
  LanguageModelToolUseId,
  SessionId,
  UserMessageId,
  PromptId,
  AgentProfileId,
} from './branded.js';
import type {
  LanguageModelImage,
  LanguageModelToolUse,
  LanguageModelToolResult,
  LanguageModelToolResultContent,
  TokenUsage,
} from './language-model.js';

// ---------------------------------------------------------------------------
// MentionUri — crates/acp_thread/src/mention.rs
// ---------------------------------------------------------------------------

export type MentionUri =
  | { type: 'file'; absPath: string }
  | { type: 'pasted_image' }
  | { type: 'directory'; absPath: string }
  | { type: 'symbol'; absPath: string; symbolName: string; lineRange: [number, number] }
  | { type: 'selection'; absPath?: string; lineRange: [number, number] }
  | { type: 'thread'; sessionId: SessionId }
  | { type: 'text_thread'; sessionId: SessionId }
  | { type: 'rule'; id: string }
  | { type: 'fetch'; url: string }
  | { type: 'diagnostics'; absPath?: string }
  | { type: 'terminal_selection'; terminalId: string };

// ---------------------------------------------------------------------------
// UserMessage content — crates/agent/src/thread.rs
// ---------------------------------------------------------------------------

export type UserMessageContent =
  | { type: 'text'; text: string }
  | { type: 'mention'; uri: MentionUri; content: string }
  | { type: 'image'; image: LanguageModelImage };

// ---------------------------------------------------------------------------
// UserMessage — crates/agent/src/thread.rs
// ---------------------------------------------------------------------------

export interface UserMessage {
  id: UserMessageId;
  content: UserMessageContent[];
}

// ---------------------------------------------------------------------------
// AgentMessage content — crates/agent/src/thread.rs
// ---------------------------------------------------------------------------

export type AgentMessageContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; toolUse: LanguageModelToolUse };

// ---------------------------------------------------------------------------
// AgentMessage — crates/agent/src/thread.rs
// ---------------------------------------------------------------------------

export interface AgentMessage {
  content: AgentMessageContent[];
  toolResults: Map<LanguageModelToolUseId, LanguageModelToolResult>;
  reasoningDetails?: unknown;
}

export function emptyAgentMessage(): AgentMessage {
  return {
    content: [],
    toolResults: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Message — crates/agent/src/thread.rs
// ---------------------------------------------------------------------------

export type Message =
  | { type: 'user'; message: UserMessage }
  | { type: 'agent'; message: AgentMessage }
  | { type: 'resume' };

// ---------------------------------------------------------------------------
// SubagentContext — crates/agent/src/thread.rs
// ---------------------------------------------------------------------------

export interface SubagentContext {
  /** ID of the parent thread. */
  parentThreadId: SessionId;
  /** Current depth level (0 = root agent, 1 = first-level subagent, etc.). */
  depth: number;
}

/** Maximum subagent nesting depth. */
export const MAX_SUBAGENT_DEPTH = 4;

/** Maximum parallel subagents. */
export const MAX_PARALLEL_SUBAGENTS = 8;

// ---------------------------------------------------------------------------
// RetryStrategy — crates/agent/src/thread.rs
// ---------------------------------------------------------------------------

export type RetryStrategy =
  | { type: 'exponential_backoff'; initialDelayMs: number; maxAttempts: number }
  | { type: 'fixed'; delayMs: number; maxAttempts: number };

/** Maximum retry attempts (from Zed's MAX_RETRY_ATTEMPTS). */
export const MAX_RETRY_ATTEMPTS = 4;

/** Base retry delay in ms (from Zed's BASE_RETRY_DELAY). */
export const BASE_RETRY_DELAY_MS = 5000;

// ---------------------------------------------------------------------------
// RetryStatus — crates/acp_thread/src/acp_thread.rs
// ---------------------------------------------------------------------------

export interface RetryStatus {
  lastError: string;
  attempt: number;
  maxAttempts: number;
  startedAt: number; // timestamp ms
  durationMs: number;
}

// ---------------------------------------------------------------------------
// ACP TokenUsage — crates/acp_thread/src/connection.rs
// (different from language_model TokenUsage — includes max_tokens)
// ---------------------------------------------------------------------------

export interface AcpTokenUsage {
  maxTokens: number;
  usedTokens: number;
  inputTokens: number;
  outputTokens: number;
}

// ---------------------------------------------------------------------------
// Thread persistence types — crates/agent/src/db.rs
// ---------------------------------------------------------------------------

export interface DbLanguageModel {
  provider: string;
  model: string;
}

export interface DbThread {
  title: string;
  messages: Message[];
  updatedAt: string; // ISO 8601
  detailedSummary?: string;
  initialProjectSnapshot?: unknown;
  cumulativeTokenUsage: TokenUsage;
  requestTokenUsage: Map<UserMessageId, TokenUsage>;
  model?: DbLanguageModel;
  profile?: AgentProfileId;
  imported: boolean;
  subagentContext?: SubagentContext;
}

export interface DbThreadMetadata {
  id: SessionId;
  title: string;
  updatedAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// ProjectSnapshot — crates/agent/src/agent.rs
// ---------------------------------------------------------------------------

export interface ProjectSnapshot {
  worktreeSnapshots: unknown[];
  timestamp: string; // ISO 8601
}
