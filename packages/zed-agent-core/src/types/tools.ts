/**
 * Tool types.
 * Ported from: crates/agent/src/thread.rs — AgentTool, AnyAgentTool, ToolCallEventStream
 *              agent_client_protocol — ToolKind, ToolCall, ToolCallUpdate, etc.
 */

import type { LanguageModelToolUseId, ToolCallId } from './branded.js';
import type { LanguageModelToolResultContent, LanguageModelToolSchemaFormat } from './language-model.js';

// ---------------------------------------------------------------------------
// ToolKind — agent_client_protocol
// ---------------------------------------------------------------------------

export type ToolKind = 'read' | 'write' | 'execute' | 'fetch' | 'other';

// ---------------------------------------------------------------------------
// ToolCallStatus — agent_client_protocol
// ---------------------------------------------------------------------------

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// ---------------------------------------------------------------------------
// ToolCallLocation — agent_client_protocol
// ---------------------------------------------------------------------------

export interface ToolCallLocation {
  path: string;
  line?: number;
}

// ---------------------------------------------------------------------------
// ToolCallContent — agent_client_protocol
// ---------------------------------------------------------------------------

export type ToolCallContent =
  | { type: 'content'; content: string }
  | { type: 'terminal'; terminalId: string }
  | { type: 'diff'; path: string; diff: string };

// ---------------------------------------------------------------------------
// ToolCall — agent_client_protocol
// ---------------------------------------------------------------------------

export interface ToolCall {
  toolCallId: ToolCallId;
  title: string;
  kind: ToolKind;
  content: ToolCallContent[];
  status: ToolCallStatus;
  locations: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ToolCallUpdateFields — agent_client_protocol
// ---------------------------------------------------------------------------

export interface ToolCallUpdateFields {
  kind?: ToolKind;
  status?: ToolCallStatus;
  title?: string;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

// ---------------------------------------------------------------------------
// ToolCallUpdate — agent_client_protocol
// ---------------------------------------------------------------------------

export interface ToolCallUpdate {
  toolCallId: ToolCallId;
  fields: ToolCallUpdateFields;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Permission types — crates/agent/src/thread.rs
// ---------------------------------------------------------------------------

export type PermissionOptionKind =
  | 'allow_once'
  | 'reject_once'
  | 'allow_always'
  | 'reject_always';

export interface PermissionOption {
  id: string;
  label: string;
  kind: PermissionOptionKind;
}

export interface PermissionOptionChoice {
  allow: PermissionOption;
  deny: PermissionOption;
}

export type PermissionOptions =
  | { type: 'dropdown'; choices: PermissionOptionChoice[] };

export interface ToolPermissionContext {
  toolName: string;
  inputValues: string[];
}

// ---------------------------------------------------------------------------
// AgentTool interface — crates/agent/src/thread.rs
// ---------------------------------------------------------------------------

/**
 * The output from running a tool: both what the LLM sees and the raw structured output.
 * Ported from: AgentToolOutput
 */
export interface AgentToolOutput {
  /** What the LLM receives as the tool result. */
  llmOutput: LanguageModelToolResultContent;
  /** The full structured output (for UI display, replay, persistence). */
  rawOutput: unknown;
}

/**
 * Context provided to a tool during execution.
 * Replaces Zed's App/Context + Entity references with a clean interface.
 */
export interface ToolContext {
  /** The host environment providing file system, terminal, etc. */
  host: import('./host.js').BackendHost;
  /** Event stream for reporting progress back to the UI. */
  eventStream: ToolCallEventStream;
  /** Abort signal — set when user cancels the tool. */
  signal: AbortSignal;
}

/**
 * Event stream for a single tool call execution.
 * Ported from: crates/agent/src/thread.rs — ToolCallEventStream
 */
export interface ToolCallEventStream {
  /** The tool use ID for this invocation. */
  readonly toolUseId: LanguageModelToolUseId;

  /** Update fields on the tool call (title, content, status, locations, etc.). */
  updateFields(fields: ToolCallUpdateFields): void;

  /** Update fields with additional metadata. */
  updateFieldsWithMeta(fields: ToolCallUpdateFields, meta?: Record<string, unknown>): void;

  /**
   * Request authorization from the user.
   * Returns a promise that resolves when the user approves, or rejects if denied.
   */
  authorize(title: string, context: ToolPermissionContext): Promise<void>;

  /** Returns a promise that resolves when the user cancels the tool call. */
  cancelledByUser(): Promise<void>;

  /** Returns true if the user has cancelled this tool call. */
  wasCancelledByUser(): boolean;
}

/**
 * The core AgentTool interface.
 * Ported from: crates/agent/src/thread.rs — AgentTool trait
 *
 * @template TInput The tool's input type (must be JSON-serializable and have a JSON Schema).
 * @template TOutput The tool's output type (must be JSON-serializable).
 */
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  /** Unique tool name (max 64 characters). */
  readonly name: string;

  /** Tool kind for UI categorization. */
  readonly kind: ToolKind;

  /** Human-readable description (extracted from the input schema's description field). */
  description(): string;

  /**
   * Returns the JSON Schema describing this tool's input.
   * @param format The schema format the model expects.
   */
  inputSchema(format?: LanguageModelToolSchemaFormat): unknown;

  /**
   * Whether this tool supports a given provider.
   * Some tools (like web_search) may only work with specific providers.
   */
  supportsProvider?(providerId: string): boolean;

  /**
   * The initial title to display for this tool call.
   * Called with parsed input if available, or null if parsing failed.
   */
  initialTitle(input: TInput | null): string;

  /**
   * Run the tool.
   *
   * @param input The parsed tool input.
   * @param context Execution context with host, event stream, and abort signal.
   * @returns The tool output.
   */
  run(input: TInput, context: ToolContext): Promise<AgentToolOutput>;

  /**
   * Replay a previous tool execution (for UI display when loading history).
   * Optional — tools that produce visual side effects should implement this.
   */
  replay?(input: TInput, output: TOutput, context: ToolContext): void;
}

/**
 * Type-erased version of AgentTool for use in collections.
 * Ported from: AnyAgentTool trait
 */
export interface AnyAgentTool {
  readonly name: string;
  readonly kind: ToolKind;
  description(): string;
  inputSchema(format?: LanguageModelToolSchemaFormat): unknown;
  supportsProvider?(providerId: string): boolean;
  initialTitle(rawInput: unknown): string;
  run(rawInput: unknown, context: ToolContext): Promise<AgentToolOutput>;
  replay?(rawInput: unknown, rawOutput: unknown, context: ToolContext): void;
}

/**
 * Erase the type parameters of an AgentTool for storage in a registry.
 * Ported from: Erased<T> wrapper in Zed
 */
export function eraseToolType<TInput, TOutput>(
  tool: AgentTool<TInput, TOutput>,
): AnyAgentTool {
  return {
    name: tool.name,
    kind: tool.kind,
    description: () => tool.description(),
    inputSchema: (format) => tool.inputSchema(format),
    supportsProvider: tool.supportsProvider?.bind(tool),
    initialTitle: (rawInput: unknown) => {
      try {
        return tool.initialTitle(rawInput as TInput);
      } catch {
        return tool.initialTitle(null as unknown as TInput);
      }
    },
    run: async (rawInput: unknown, context: ToolContext) => {
      const input = rawInput as TInput;
      return tool.run(input, context);
    },
    replay: tool.replay
      ? (rawInput: unknown, rawOutput: unknown, context: ToolContext) => {
          tool.replay!(rawInput as TInput, rawOutput as TOutput, context);
        }
      : undefined,
  };
}

/** Maximum tool name length (from Zed's MAX_TOOL_NAME_LENGTH). */
export const MAX_TOOL_NAME_LENGTH = 64;
