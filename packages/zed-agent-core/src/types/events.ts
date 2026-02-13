/**
 * Agent events — the complete union of all events emitted by the backend to the UI.
 * Ported from: crates/agent/src/thread.rs — ThreadEvent
 *              crates/acp_thread/src/acp_thread.rs — various update events
 *
 * This is THE primary communication channel from the backend to any UI.
 */

import type { SessionId, ToolCallId, UserMessageId } from './branded.js';
import type { StopReason } from './language-model.js';
import type {
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolCallUpdateFields,
  ToolKind,
  PermissionOptions,
  ToolPermissionContext,
} from './tools.js';
import type { AcpTokenUsage, RetryStatus, UserMessageContent } from './thread.js';

// ---------------------------------------------------------------------------
// Individual event types
// ---------------------------------------------------------------------------

/** A user message was added to the thread. */
export interface UserMessageEvent {
  type: 'user_message';
  id: UserMessageId;
  content: UserMessageContent[];
}

/** The agent is streaming text. */
export interface AgentTextEvent {
  type: 'agent_text';
  text: string;
}

/** The agent is streaming thinking/reasoning. */
export interface AgentThinkingEvent {
  type: 'agent_thinking';
  text: string;
}

/** A new tool call has been initiated. */
export interface ToolCallEvent {
  type: 'tool_call';
  toolCallId: ToolCallId;
  toolName: string;
  title: string;
  kind: ToolKind;
  input: unknown;
  meta?: Record<string, unknown>;
}

/** A tool call has been updated (status, output, content, etc.). */
export interface ToolCallUpdateEvent {
  type: 'tool_call_update';
  toolCallId: ToolCallId;
  fields: ToolCallUpdateFields;
  meta?: Record<string, unknown>;
}

/** A tool call needs user authorization before proceeding. */
export interface ToolCallAuthorizationEvent {
  type: 'tool_call_authorization';
  toolCallId: ToolCallId;
  toolName: string;
  title: string;
  options: PermissionOptions;
  context: ToolPermissionContext;
  /**
   * Call this function with the chosen permission option ID.
   * The promise resolves when authorization is complete.
   */
  respond: (optionId: string) => void;
}

/** A subagent has been spawned. */
export interface SubagentSpawnedEvent {
  type: 'subagent_spawned';
  sessionId: SessionId;
}

/** The agent is retrying after an error. */
export interface RetryEvent {
  type: 'retry';
  status: RetryStatus;
}

/** The agent's turn has ended. */
export interface StopEvent {
  type: 'stop';
  reason: StopReason;
}

/** An error occurred during the agent's turn. */
export interface ErrorEvent {
  type: 'error';
  error: Error;
}

/** The thread's title has been updated. */
export interface TitleUpdatedEvent {
  type: 'title_updated';
  sessionId: SessionId;
  title: string;
}

/** Token usage has been updated. */
export interface TokenUsageUpdatedEvent {
  type: 'token_usage_updated';
  sessionId: SessionId;
  usage: AcpTokenUsage | null;
}

/** The session list has changed (thread created, deleted, etc.). */
export interface SessionListUpdatedEvent {
  type: 'session_list_updated';
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

/**
 * The complete union of all events the backend can emit.
 * Any UI must handle (or ignore) these events to render the agent experience.
 */
export type AgentEvent =
  | UserMessageEvent
  | AgentTextEvent
  | AgentThinkingEvent
  | ToolCallEvent
  | ToolCallUpdateEvent
  | ToolCallAuthorizationEvent
  | SubagentSpawnedEvent
  | RetryEvent
  | StopEvent
  | ErrorEvent
  | TitleUpdatedEvent
  | TokenUsageUpdatedEvent
  | SessionListUpdatedEvent;
