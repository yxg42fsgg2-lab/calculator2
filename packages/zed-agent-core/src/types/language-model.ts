/**
 * Language model types.
 * Ported from: crates/language_model/src/language_model.rs
 *              crates/language_model/src/request.rs
 *              crates/language_model/src/role.rs
 *              crates/language_model/src/tool_schema.ts
 */

import type {
  LanguageModelId,
  LanguageModelName,
  LanguageModelProviderId,
  LanguageModelProviderName,
  LanguageModelToolUseId,
} from './branded.js';

// ---------------------------------------------------------------------------
// Role — crates/language_model/src/role.rs
// ---------------------------------------------------------------------------

export type Role = 'system' | 'user' | 'assistant';

// ---------------------------------------------------------------------------
// StopReason — agent_client_protocol
// ---------------------------------------------------------------------------

export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'refusal'
  | 'cancelled';

// ---------------------------------------------------------------------------
// TokenUsage — crates/language_model/src/language_model.rs
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

export function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens;
}

// ---------------------------------------------------------------------------
// LanguageModelImage — crates/language_model/src/request.rs
// ---------------------------------------------------------------------------

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * A base64-encoded PNG image for language model input.
 * Ported from: crates/language_model/src/request.rs — LanguageModelImage
 */
export interface LanguageModelImage {
  /** Base64-encoded PNG data (without data: URI prefix). */
  source: string;
  /** Pixel dimensions, if known. */
  size?: ImageSize;
}

/** Anthropic wants images smaller than this in both dimensions. */
export const ANTHROPIC_IMAGE_SIZE_LIMIT = 1568;

/** Default per-image hard limit (bytes) for encoded PNG payload. */
export const DEFAULT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Estimate token cost for an image.
 * From Anthropic docs: (width * height) / 750
 */
export function estimateImageTokens(image: LanguageModelImage): number {
  if (!image.size) return 0;
  return Math.ceil((image.size.width * image.size.height) / 750);
}

// ---------------------------------------------------------------------------
// Tool types — crates/language_model/src/language_model.rs
// ---------------------------------------------------------------------------

/**
 * A tool use invocation from the model.
 * Ported from: LanguageModelToolUse
 */
export interface LanguageModelToolUse {
  id: LanguageModelToolUseId;
  name: string;
  rawInput: string;
  input: unknown;
  isInputComplete: boolean;
  /** Thought signature some models send for validation. */
  thoughtSignature?: string;
}

/**
 * The result of a tool execution, sent back to the model.
 * Ported from: LanguageModelToolResult
 */
export interface LanguageModelToolResult {
  toolUseId: LanguageModelToolUseId;
  toolName: string;
  isError: boolean;
  content: LanguageModelToolResultContent;
  output?: unknown;
}

/**
 * Content returned by a tool — either text or an image.
 * Ported from: LanguageModelToolResultContent
 */
export type LanguageModelToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; image: LanguageModelImage };

export function textToolResult(text: string): LanguageModelToolResultContent {
  return { type: 'text', text };
}

export function imageToolResult(image: LanguageModelImage): LanguageModelToolResultContent {
  return { type: 'image', image };
}

export function toolResultContentIsEmpty(content: LanguageModelToolResultContent): boolean {
  if (content.type === 'text') {
    return content.text.trim().length === 0;
  }
  return false;
}

export function toolResultContentToString(content: LanguageModelToolResultContent): string | null {
  if (content.type === 'text') return content.text;
  return null;
}

// ---------------------------------------------------------------------------
// Message types — crates/language_model/src/request.rs
// ---------------------------------------------------------------------------

/**
 * Content within a message.
 * Ported from: MessageContent (7 variants)
 */
export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'image'; image: LanguageModelImage }
  | { type: 'tool_use'; toolUse: LanguageModelToolUse }
  | { type: 'tool_result'; toolResult: LanguageModelToolResult };

/**
 * A message in a completion request.
 * Ported from: LanguageModelRequestMessage
 */
export interface LanguageModelRequestMessage {
  role: Role;
  content: MessageContent[];
  cache: boolean;
  reasoningDetails?: unknown;
}

/**
 * A tool definition in a completion request.
 * Ported from: LanguageModelRequestTool
 */
export interface LanguageModelRequestTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

/**
 * Tool choice mode.
 * Ported from: LanguageModelToolChoice
 */
export type LanguageModelToolChoice = 'auto' | 'any' | 'none';

/**
 * The format for tool input schemas.
 * Ported from: LanguageModelToolSchemaFormat
 */
export type LanguageModelToolSchemaFormat = 'json_schema' | 'simplified';

/**
 * A full completion request.
 * Ported from: LanguageModelRequest
 */
export interface LanguageModelRequest {
  threadId?: string;
  promptId?: string;
  intent?: CompletionIntent;
  messages: LanguageModelRequestMessage[];
  tools: LanguageModelRequestTool[];
  toolChoice?: LanguageModelToolChoice;
  stop?: string[];
  temperature?: number;
  thinkingAllowed?: boolean;
  thinkingEffort?: string;
}

/**
 * Intent of the completion request — used for routing and telemetry.
 * Ported from: cloud_llm_client — CompletionIntent
 */
export type CompletionIntent =
  | 'user_prompt'
  | 'tool_results'
  | 'thread_summarization'
  | 'thread_context_summarization';

// ---------------------------------------------------------------------------
// Completion events — crates/language_model/src/language_model.rs
// ---------------------------------------------------------------------------

/**
 * A completion event streamed from a language model.
 * Ported from: LanguageModelCompletionEvent (12 variants)
 */
export type LanguageModelCompletionEvent =
  | { type: 'queued'; position: number }
  | { type: 'started' }
  | { type: 'stop'; reason: StopReason }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; toolUse: LanguageModelToolUse }
  | {
      type: 'tool_use_json_parse_error';
      id: LanguageModelToolUseId;
      toolName: string;
      rawInput: string;
      jsonParseError: string;
    }
  | { type: 'start_message'; messageId: string }
  | { type: 'reasoning_details'; details: unknown }
  | { type: 'usage_update'; usage: TokenUsage };

// ---------------------------------------------------------------------------
// Effort levels — crates/language_model/src/language_model.rs
// ---------------------------------------------------------------------------

/**
 * An effort level for thinking models.
 * Ported from: LanguageModelEffortLevel
 */
export interface LanguageModelEffortLevel {
  name: string;
  value: string;
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Response message (for non-streaming)
// ---------------------------------------------------------------------------

export interface LanguageModelResponseMessage {
  role?: Role;
  content?: string;
}
