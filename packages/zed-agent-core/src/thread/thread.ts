/**
 * Thread — the core agentic loop.
 * Ported from: crates/agent/src/thread.rs (~1,800 LOC production)
 *
 * This is THE heart of the system. It manages:
 * - Message history
 * - System prompt construction
 * - Completion streaming from the language model
 * - Tool dispatch and result handling
 * - Retry logic with exponential backoff
 * - Token usage tracking
 * - Title/summary generation
 * - Cancellation
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import type { LanguageModel } from '../models/language-model.js';
import type {
  SessionId,
  UserMessageId,
  PromptId,
  LanguageModelToolUseId,
  AgentProfileId,
} from '../types/branded.js';
import {
  sessionId,
  userMessageId,
  promptId,
  toolUseId,
} from '../types/branded.js';
import type {
  LanguageModelRequest,
  LanguageModelRequestMessage,
  LanguageModelCompletionEvent,
  LanguageModelToolResult,
  LanguageModelToolResultContent,
  TokenUsage,
  CompletionIntent,
  StopReason,
} from '../types/language-model.js';
import { emptyTokenUsage, textToolResult } from '../types/language-model.js';
import type {
  Message,
  UserMessage,
  UserMessageContent,
  AgentMessage,
  AgentMessageContent,
  SubagentContext,
  RetryStatus,
  AcpTokenUsage,
  DbThread,
} from '../types/thread.js';
import {
  emptyAgentMessage,
  MAX_RETRY_ATTEMPTS,
  BASE_RETRY_DELAY_MS,
  MAX_SUBAGENT_DEPTH,
  MAX_PARALLEL_SUBAGENTS,
} from '../types/thread.js';
import type {
  AnyAgentTool,
  ToolCallEventStream,
  ToolCallUpdateFields,
  ToolPermissionContext,
  ToolContext,
  AgentToolOutput,
} from '../types/tools.js';
import type { AgentEvent } from '../types/events.js';
import type { BackendHost, EventSink } from '../types/host.js';
import type { AgentSettings, AgentProfileSettings } from '../types/settings.js';
import { SUMMARIZE_THREAD_PROMPT, SUMMARIZE_THREAD_DETAILED_PROMPT } from '../types/settings.js';
import {
  CompletionError,
  PromptTooLargeError,
  RateLimitExceededError,
  ServerOverloadedError,
  ApiInternalServerError,
  UpstreamProviderError,
  HttpResponseError,
  BadRequestFormatError,
  ApiReadResponseError,
  HttpSendError,
  DeserializeResponseError,
  OtherCompletionError,
  type CompletionErrorCode,
} from '../types/completion-error.js';

const TOOL_CANCELED_MESSAGE = 'Tool canceled by user';

// ---------------------------------------------------------------------------
// Thread Events
// ---------------------------------------------------------------------------

export interface ThreadEvents {
  event: [AgentEvent];
  title_updated: [string];
  token_usage_updated: [AcpTokenUsage | null];
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export class Thread extends EventEmitter<ThreadEvents> {
  readonly id: SessionId;
  private _promptId: PromptId;
  private _updatedAt: Date;
  private _title?: string;
  private _summary?: string;
  private messages: Message[] = [];
  private _model?: LanguageModel;
  private _summarizationModel?: LanguageModel;
  private _thinkingEnabled = false;
  private _thinkingEffort?: string;
  private pendingMessage?: AgentMessage;
  private tools: Map<string, AnyAgentTool> = new Map();
  private requestTokenUsage: Map<UserMessageId, TokenUsage> = new Map();
  private cumulativeTokenUsage: TokenUsage = emptyTokenUsage();
  private runningTurnAbort?: AbortController;
  private hasQueuedMessage = false;
  private subagentContext?: SubagentContext;
  private fileReadTimes: Map<string, number> = new Map(); // path → mtime
  private _pendingTitleGeneration = false;
  private _useStreamingEditTool = false;

  // External dependencies
  private host: BackendHost;
  private settings: AgentSettings;
  private systemPromptBuilder?: (tools: string[], modelName?: string) => string;

  constructor(options: ThreadOptions) {
    super();
    this.id = options.id ?? sessionId(uuidv4());
    this._promptId = promptId(uuidv4());
    this._updatedAt = new Date();
    this.host = options.host;
    this.settings = options.settings;
    this._model = options.model;
    this._thinkingEnabled = options.thinkingEnabled ?? false;
    this._thinkingEffort = options.thinkingEffort;
    this.systemPromptBuilder = options.systemPromptBuilder;
    this._useStreamingEditTool = options.useStreamingEditTool ?? false;

    if (options.model?.supportsThinking) {
      this._thinkingEnabled = true;
    }
  }

  // --- Getters ---

  get model(): LanguageModel | undefined { return this._model; }
  get title(): string { return this._title ?? 'New Thread'; }
  get summary(): string | undefined { return this._summary; }
  get thinkingEnabled(): boolean { return this._thinkingEnabled; }
  get thinkingEffort(): string | undefined { return this._thinkingEffort; }
  get updatedAt(): Date { return this._updatedAt; }
  get isEmpty(): boolean { return this.messages.length === 0 && !this._title; }
  get messageCount(): number { return this.messages.length; }
  get isTurnComplete(): boolean { return !this.runningTurnAbort; }
  get isSubagent(): boolean { return !!this.subagentContext; }
  get depth(): number { return this.subagentContext?.depth ?? 0; }

  // --- Setters ---

  setModel(model: LanguageModel): void {
    this._model = model;
    this.emit('token_usage_updated', this.latestTokenUsage());
  }

  setSummarizationModel(model?: LanguageModel): void {
    this._summarizationModel = model;
  }

  setThinkingEnabled(enabled: boolean): void { this._thinkingEnabled = enabled; }
  setThinkingEffort(effort?: string): void { this._thinkingEffort = effort; }
  setTitle(title: string): void {
    this._title = title;
    this.emit('title_updated', title);
  }

  // --- Tool management ---

  addTool(tool: AnyAgentTool): void {
    this.tools.set(tool.name, tool);
  }

  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  registeredToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Add the SubagentTool if depth allows.
   * Ported from: Thread::add_default_tools() subagent check in thread.rs
   *
   * This should be called after all other tools are registered, since the
   * SubagentTool inherits the parent's tool set.
   *
   * Takes a factory function to avoid circular imports between thread and tools.
   */
  addSubagentToolIfEligible(
    factory: (config: {
      model?: LanguageModel;
      parentTools: Map<string, AnyAgentTool>;
      parentDepth: number;
      parentSessionId: SessionId;
      host: BackendHost;
      settings: AgentSettings;
      systemPromptBuilder?: (tools: string[], modelName?: string) => string;
    }) => AnyAgentTool,
  ): void {
    if (this.depth >= MAX_SUBAGENT_DEPTH) return;
    if (this.tools.has('subagent')) return; // Already registered

    const subagentTool = factory({
      model: this._model,
      parentTools: new Map(this.tools),
      parentDepth: this.depth,
      parentSessionId: this.id,
      host: this.host,
      settings: this.settings,
      systemPromptBuilder: this.systemPromptBuilder,
    });

    this.tools.set('subagent', subagentTool);
  }

  // --- Token usage ---

  /**
   * Get the token usage for the latest request.
   */
  latestTokenUsage(): AcpTokenUsage | null {
    const lastUserMsg = this.lastUserMessage();
    if (!lastUserMsg) return null;
    const usage = this.requestTokenUsage.get(lastUserMsg.id);
    if (!usage || !this._model) return null;
    return {
      maxTokens: this._model.maxTokenCount,
      usedTokens: usage.inputTokens + usage.outputTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  }

  /**
   * Get the token usage for a specific request (by user message ID).
   */
  getTokenUsageForMessage(messageId: UserMessageId): TokenUsage | undefined {
    return this.requestTokenUsage.get(messageId);
  }

  /**
   * Get the total input token count as of the message before the given message.
   * Useful for showing how much of the context window is used at each point.
   *
   * Ported from: Thread::tokens_before_message() in thread.rs
   *
   * Returns undefined if:
   * - targetId is the first message (no previous message)
   * - The previous message hasn't received a response yet
   * - targetId is not found
   */
  getTokensBeforeMessage(targetId: UserMessageId): number | undefined {
    let previousUserMessageId: UserMessageId | undefined;

    for (const message of this.messages) {
      if (message.type === 'user') {
        if (message.message.id === targetId) {
          if (!previousUserMessageId) return undefined;
          const usage = this.requestTokenUsage.get(previousUserMessageId);
          return usage?.inputTokens;
        }
        previousUserMessageId = message.message.id;
      }
    }
    return undefined;
  }

  /**
   * Get the total accumulated token usage across all requests.
   */
  get totalTokenUsage(): TokenUsage {
    return { ...this.cumulativeTokenUsage };
  }

  /**
   * Get all per-request token usage entries.
   */
  get allTokenUsage(): ReadonlyMap<UserMessageId, TokenUsage> {
    return this.requestTokenUsage;
  }

  // --- Send message ---

  /**
   * Send a user message and start the agentic loop.
   * Ported from: Thread::send()
   */
  async send(
    content: UserMessageContent[],
    id?: UserMessageId,
  ): Promise<StopReason> {
    const msgId = id ?? userMessageId(uuidv4());
    this.messages.push({
      type: 'user',
      message: { id: msgId, content },
    });
    this.emitEvent({ type: 'user_message', id: msgId, content });
    return this.sendExisting();
  }

  /**
   * Resume after the last message (e.g., after model said "Continue where you left off").
   * Ported from: Thread::resume()
   */
  async resume(): Promise<StopReason> {
    this.messages.push({ type: 'resume' });
    return this.runTurn();
  }

  /**
   * Cancel the currently running turn.
   * Ported from: Thread::cancel()
   */
  cancel(): void {
    this.flushPendingMessage();
    if (this.runningTurnAbort) {
      this.runningTurnAbort.abort();
      this.runningTurnAbort = undefined;
      this.emitEvent({ type: 'stop', reason: 'cancelled' });
    }
  }

  /**
   * Truncate the message history at a given user message.
   * Ported from: Thread::truncate()
   */
  truncate(messageId: UserMessageId): void {
    this.cancel();
    this.pendingMessage = undefined;

    const idx = this.messages.findIndex(
      (m) => m.type === 'user' && m.message.id === messageId,
    );
    if (idx === -1) {
      throw new Error('Message not found');
    }

    // Remove truncated messages' token usage
    for (const msg of this.messages.slice(idx)) {
      if (msg.type === 'user') {
        this.requestTokenUsage.delete(msg.message.id);
      }
    }
    this.messages.length = idx;
    this._summary = undefined;
  }

  // --- Internal ---

  private async sendExisting(): Promise<StopReason> {
    if (!this._model) {
      throw new Error('No language model configured');
    }
    this.advancePromptId();
    return this.runTurn();
  }

  private advancePromptId(): void {
    this._promptId = promptId(uuidv4());
  }

  /**
   * The main agentic loop.
   * Ported from: Thread::run_turn() + Thread::run_turn_internal()
   */
  private async runTurn(): Promise<StopReason> {
    this.flushPendingMessage();
    this.cancel(); // Cancel any previous turn

    const model = this._model;
    if (!model) throw new Error('No language model configured');

    const abortController = new AbortController();
    this.runningTurnAbort = abortController;
    const signal = abortController.signal;
    const messageIx = Math.max(0, this.messages.length - 1);

    this._summary = undefined;

    try {
      const stopReason = await this.runTurnInternal(model, signal);

      if (!signal.aborted) {
        this.flushPendingMessage();
        this.emitEvent({ type: 'stop', reason: stopReason });
        this.generateTitleIfNeeded(model);
      }

      return stopReason;
    } catch (error) {
      if (signal.aborted) {
        return 'cancelled';
      }

      this.flushPendingMessage();

      if (error instanceof CompletionError) {
        if (error.code === 'prompt_too_large') {
          this.emitEvent({ type: 'stop', reason: 'max_tokens' });
          return 'max_tokens';
        }
      }

      this.emitEvent({
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return 'end_turn';
    } finally {
      if (this.runningTurnAbort === abortController) {
        this.runningTurnAbort = undefined;
      }
    }
  }

  /**
   * The inner loop that handles streaming, tool calls, and retries.
   * Ported from: Thread::run_turn_internal()
   */
  private async runTurnInternal(
    model: LanguageModel,
    signal: AbortSignal,
  ): Promise<StopReason> {
    let attempt = 0;
    let intent: CompletionIntent = 'user_prompt';

    while (true) {
      if (signal.aborted) return 'cancelled';

      const request = this.buildCompletionRequest(intent);

      // Stream completion
      const toolResults: LanguageModelToolResult[] = [];
      let completionError: CompletionError | null = null;
      let endTurn = true;

      try {
        for await (const event of model.streamCompletion(request)) {
          if (signal.aborted) return 'cancelled';

          const toolResult = this.handleCompletionEvent(event, signal);
          if (toolResult) {
            endTurn = false;
            // Run tool in background and collect result
            const result = await toolResult;
            toolResults.push(result);

            // Update tool call status
            this.emitEvent({
              type: 'tool_call_update',
              toolCallId: result.toolUseId as unknown as import('../types/branded.js').ToolCallId,
              fields: {
                status: result.isError ? 'failed' : 'completed',
                rawOutput: result.output,
              },
            });

            // Add to pending message
            const pending = this.getPendingMessage();
            pending.toolResults.set(result.toolUseId, result);
          }
        }
      } catch (error) {
        if (error instanceof CompletionError) {
          completionError = error;
        } else {
          completionError = new OtherCompletionError(
            error instanceof Error ? error.message : String(error),
            error instanceof Error ? error : undefined,
          );
        }
      }

      // Flush pending message
      this.flushPendingMessage();

      // Generate title if this is the first turn
      if (!this._title) {
        this.generateTitleIfNeeded(model);
      }

      if (signal.aborted) return 'cancelled';

      // Handle errors with retry
      if (completionError) {
        attempt++;
        const retry = this.getRetryStrategy(completionError, attempt);
        if (!retry) {
          throw completionError;
        }

        this.emitEvent({
          type: 'retry',
          status: {
            lastError: completionError.message,
            attempt,
            maxAttempts: retry.maxAttempts,
            startedAt: Date.now(),
            durationMs: retry.delayMs,
          },
        });

        await sleep(retry.delayMs);

        // If we got text but no tool results, add a Resume
        if (toolResults.length === 0) {
          intent = 'user_prompt';
          this.messages.push({ type: 'resume' });
        }
        continue;
      }

      // If no tool calls, the turn is complete
      if (endTurn || toolResults.length === 0) {
        return 'end_turn';
      }

      // Check for queued message
      if (this.hasQueuedMessage) {
        return 'end_turn';
      }

      // Continue the loop with tool results
      intent = 'tool_results';
      attempt = 0;
    }
  }

  /**
   * Handle a single completion event from the model stream.
   * Returns a tool result promise if a tool needs to be run.
   * Ported from: Thread::handle_completion_event()
   */
  private handleCompletionEvent(
    event: LanguageModelCompletionEvent,
    signal: AbortSignal,
  ): Promise<LanguageModelToolResult> | null {
    switch (event.type) {
      case 'start_message':
        this.flushPendingMessage();
        this.pendingMessage = emptyAgentMessage();
        return null;

      case 'text':
        this.handleTextEvent(event.text);
        return null;

      case 'thinking':
        this.handleThinkingEvent(event.text, event.signature);
        return null;

      case 'redacted_thinking':
        this.handleRedactedThinkingEvent(event.data);
        return null;

      case 'reasoning_details': {
        const pending = this.getPendingMessage();
        pending.reasoningDetails = event.details;
        return null;
      }

      case 'tool_use':
        return this.handleToolUseEvent(event.toolUse, signal);

      case 'tool_use_json_parse_error':
        return Promise.resolve({
          toolUseId: event.id,
          toolName: event.toolName,
          isError: true,
          content: textToolResult(`Error parsing input JSON: ${event.jsonParseError}`),
          output: event.rawInput,
        });

      case 'usage_update':
        this.updateTokenUsage(event.usage);
        return null;

      case 'stop':
        // Stop reasons are handled by the caller
        return null;

      case 'started':
      case 'queued':
        return null;

      default:
        return null;
    }
  }

  private handleTextEvent(text: string): void {
    this.emitEvent({ type: 'agent_text', text });
    const pending = this.getPendingMessage();
    const last = pending.content[pending.content.length - 1];
    if (last && last.type === 'text') {
      (last as { type: 'text'; text: string }).text += text;
    } else {
      pending.content.push({ type: 'text', text });
    }
  }

  private handleThinkingEvent(text: string, signature?: string): void {
    this.emitEvent({ type: 'agent_thinking', text });
    const pending = this.getPendingMessage();
    const last = pending.content[pending.content.length - 1];
    if (last && last.type === 'thinking') {
      const thinking = last as { type: 'thinking'; text: string; signature?: string };
      thinking.text += text;
      if (signature) thinking.signature = signature;
    } else {
      pending.content.push({ type: 'thinking', text, signature });
    }
  }

  private handleRedactedThinkingEvent(data: string): void {
    const pending = this.getPendingMessage();
    pending.content.push({ type: 'redacted_thinking', data });
  }

  /**
   * Handle a tool use event — dispatch to the appropriate tool.
   * Ported from: Thread::handle_tool_use_event()
   */
  private handleToolUseEvent(
    toolUse: import('../types/language-model.js').LanguageModelToolUse,
    signal: AbortSignal,
  ): Promise<LanguageModelToolResult> | null {
    const tool = this.tools.get(toolUse.name);

    // Emit initial tool call event
    const title = tool?.initialTitle(toolUse.input) ?? toolUse.name;
    const kind = tool?.kind ?? 'other';

    this.emitEvent({
      type: 'tool_call',
      toolCallId: toolUse.id as unknown as import('../types/branded.js').ToolCallId,
      toolName: toolUse.name,
      title,
      kind,
      input: toolUse.input,
      meta: { tool_name: toolUse.name },
    });

    // Add to pending message
    const pending = this.getPendingMessage();
    pending.content.push({ type: 'tool_use', toolUse });

    if (!toolUse.isInputComplete) {
      return null; // Still streaming input
    }

    if (!tool) {
      return Promise.resolve({
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        isError: true,
        content: textToolResult(`No tool named ${toolUse.name} exists`),
      });
    }

    // Create tool context
    const eventStream = this.createToolEventStream(toolUse.id);

    // Update status to in_progress
    eventStream.updateFields({ status: 'in_progress' });

    const fileReadTimes = this.fileReadTimes;
    const context: ToolContext = {
      host: this.host,
      eventStream,
      signal,
      recordFileRead(absPath: string, mtime: number) {
        fileReadTimes.set(absPath, mtime);
      },
      getFileReadTime(absPath: string) {
        return fileReadTimes.get(absPath);
      },
    };

    // Run the tool
    return tool.run(toolUse.input, context).then(
      (output: AgentToolOutput) => ({
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        isError: false,
        content: output.llmOutput,
        output: output.rawOutput,
      }),
      (error: Error) => ({
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        isError: true,
        content: textToolResult(error.message),
        output: error.message,
      }),
    );
  }

  /**
   * Create a ToolCallEventStream for a tool invocation.
   */
  private createToolEventStream(id: LanguageModelToolUseId): ToolCallEventStream {
    const thread = this;
    const abortController = new AbortController();
    let cancelled = false;

    // Link to the thread's abort signal
    if (this.runningTurnAbort) {
      this.runningTurnAbort.signal.addEventListener('abort', () => {
        cancelled = true;
        abortController.abort();
      });
    }

    return {
      toolUseId: id,
      updateFields(fields: ToolCallUpdateFields): void {
        thread.emitEvent({
          type: 'tool_call_update',
          toolCallId: id as unknown as import('../types/branded.js').ToolCallId,
          fields,
        });
      },
      updateFieldsWithMeta(fields: ToolCallUpdateFields, meta?: Record<string, unknown>): void {
        thread.emitEvent({
          type: 'tool_call_update',
          toolCallId: id as unknown as import('../types/branded.js').ToolCallId,
          fields,
          meta,
        });
      },
      async authorize(title: string, context: ToolPermissionContext): Promise<void> {
        return new Promise((resolve, reject) => {
          thread.emitEvent({
            type: 'tool_call_authorization',
            toolCallId: id as unknown as import('../types/branded.js').ToolCallId,
            toolName: context.toolName,
            title,
            options: {
              type: 'dropdown',
              choices: [{
                allow: { id: 'allow', label: 'Allow', kind: 'allow_once' },
                deny: { id: 'deny', label: 'Deny', kind: 'reject_once' },
              }],
            },
            context,
            respond: (optionId: string) => {
              if (optionId === 'deny') {
                reject(new Error('Tool call denied by user'));
              } else {
                resolve();
              }
            },
          });
        });
      },
      cancelledByUser(): Promise<void> {
        if (cancelled) return Promise.resolve();
        return new Promise((resolve) => {
          abortController.signal.addEventListener('abort', () => resolve());
        });
      },
      wasCancelledByUser(): boolean {
        return cancelled;
      },
    };
  }

  // --- Request building ---

  /**
   * Build the completion request.
   * Ported from: Thread::build_completion_request()
   */
  /**
   * Build the completion request.
   * Ported from: Thread::build_completion_request()
   */
  private buildCompletionRequest(intent: CompletionIntent): LanguageModelRequest {
    const model = this._model;
    if (!model) throw new Error('No language model configured');

    // Get filtered tools for this turn
    const enabledTools = this.getEnabledTools(model);

    const toolDefs = enabledTools.map((tool) => ({
      name: tool.name,
      description: tool.description(),
      inputSchema: tool.inputSchema(model.toolInputFormat),
    }));

    const toolNames = enabledTools.map((t) => t.name);
    const messages = this.buildRequestMessages(toolNames);

    return {
      threadId: String(this.id),
      promptId: String(this._promptId),
      intent,
      messages,
      tools: toolDefs,
      temperature: this.settings.temperature,
      thinkingAllowed: this._thinkingEnabled,
      thinkingEffort: this._thinkingEffort,
    };
  }

  /**
   * Get the filtered list of tools for this turn.
   * Ported from: Thread::enabled_tools() in thread.rs
   *
   * Filters tools based on:
   * 1. Profile settings (is_tool_enabled)
   * 2. Provider support (supports_provider)
   * 3. Edit tool swap (useStreamingEditTool option)
   * 4. Name length (truncate > MAX_TOOL_NAME_LENGTH)
   */
  private getEnabledTools(model: LanguageModel): AnyAgentTool[] {
    const profile = this.settings.profiles.get(this.settings.defaultProfile);
    // In Zed, this is a feature flag. We expose it as a Thread option.
    const useStreamingEdit = this._useStreamingEditTool;

    return Array.from(this.tools.values()).filter((tool) => {
      // Check profile setting
      // For streaming_edit_file, check profile against "edit_file" since that's what users configure
      const profileToolName = tool.name === 'streaming_edit_file' ? 'edit_file' : tool.name;
      if (profile && !profile.isToolEnabled(profileToolName)) {
        return false;
      }
      // Check provider support
      if (tool.supportsProvider && !tool.supportsProvider(String(model.providerId))) {
        return false;
      }
      // Edit tool swap logic (ported from thread.rs enabled_tools)
      if (tool.name === 'edit_file' && useStreamingEdit) {
        return false; // Exclude regular edit_file when streaming is preferred
      }
      if (tool.name === 'streaming_edit_file' && !useStreamingEdit) {
        return false; // Exclude streaming when regular is preferred
      }
      return true;
    }).map((tool) => {
      // When using streaming edit, expose it as "edit_file" (matching Zed's behavior)
      if (tool.name === 'streaming_edit_file' && useStreamingEdit) {
        return { ...tool, name: 'edit_file' };
      }
      return tool;
    });
  }

  /**
   * Build request messages including system prompt.
   * Ported from: Thread::build_request_messages()
   */
  private buildRequestMessages(enabledToolNames?: string[]): LanguageModelRequestMessage[] {
    const toolNames = enabledToolNames ?? Array.from(this.tools.keys());
    const modelName = this._model?.name;

    // Build system prompt
    const systemPromptText = this.systemPromptBuilder
      ? this.systemPromptBuilder(toolNames, modelName as string | undefined)
      : this.defaultSystemPrompt(toolNames, modelName as string | undefined);

    const messages: LanguageModelRequestMessage[] = [
      {
        role: 'system',
        content: [{ type: 'text', text: systemPromptText }],
        cache: false,
      },
    ];

    // Add conversation messages
    for (const msg of this.messages) {
      const requestMsgs = this.messageToRequest(msg);
      messages.push(...requestMsgs);
    }

    // Add pending message
    if (this.pendingMessage) {
      const requestMsgs = this.agentMessageToRequest(this.pendingMessage);
      messages.push(...requestMsgs);
    }

    // Mark last message for caching
    if (messages.length > 0) {
      messages[messages.length - 1]!.cache = true;
    }

    return messages;
  }

  /**
   * Convert a Message to request format.
   */
  private messageToRequest(msg: Message): LanguageModelRequestMessage[] {
    switch (msg.type) {
      case 'user':
        return [this.userMessageToRequest(msg.message)];
      case 'agent':
        return this.agentMessageToRequest(msg.message);
      case 'resume':
        return [{
          role: 'user',
          content: [{ type: 'text', text: 'Continue where you left off' }],
          cache: false,
        }];
    }
  }

  /**
   * Convert a user message to request format with context tag grouping.
   * Ported from: UserMessage::to_request() in thread.rs
   *
   * Mentions are grouped by type into XML context tags:
   * <context>
   *   <files>...</files>
   *   <directories>...</directories>
   *   <symbols>...</symbols>
   *   <selections>...</selections>
   *   <threads>...</threads>
   *   <fetched_urls>...</fetched_urls>
   *   <rules>...</rules>
   *   <diagnostics>...</diagnostics>
   * </context>
   */
  private userMessageToRequest(msg: UserMessage): LanguageModelRequestMessage {
    const content: import('../types/language-model.js').MessageContent[] = [];

    // Context accumulators (same pattern as Zed)
    const OPEN_CONTEXT = '<context>\nThe following items were attached by the user. They are up-to-date and don\'t need to be re-read.\n\n';
    let fileContext = '';
    let directoryContext = '';
    let symbolContext = '';
    let selectionContext = '';
    let threadContext = '';
    let fetchContext = '';
    let rulesContext = '';
    let diagnosticsContext = '';

    for (const c of msg.content) {
      switch (c.type) {
        case 'text':
          content.push({ type: 'text', text: c.text });
          break;
        case 'image':
          content.push({ type: 'image', image: c.image });
          break;
        case 'mention': {
          const { uri, content: mentionContent } = c;
          // Add a link reference in the main content
          content.push({ type: 'text', text: mentionUriAsLink(uri) });

          // Route mention content to the appropriate context group
          switch (uri.type) {
            case 'file':
              fileContext += `\n\`\`\`${codeblockTag(uri.absPath)}\n${mentionContent}\n\`\`\`\n`;
              break;
            case 'directory':
              directoryContext += `\n${mentionContent}\n`;
              break;
            case 'symbol':
              symbolContext += `\n\`\`\`${codeblockTag(uri.absPath, [uri.lineRange[0], uri.lineRange[1]])}\n${mentionContent}\n\`\`\`\n`;
              break;
            case 'selection':
              selectionContext += `\n\`\`\`${codeblockTag(uri.absPath ?? 'Untitled', [uri.lineRange[0], uri.lineRange[1]])}\n${mentionContent}\n\`\`\`\n`;
              break;
            case 'thread':
            case 'text_thread':
              threadContext += `\n${mentionContent}\n`;
              break;
            case 'rule':
              rulesContext += `\n\`\`\`\n${mentionContent}\n\`\`\`\n`;
              break;
            case 'fetch':
              fetchContext += `\nFetch: ${uri.url}\n\n${mentionContent}`;
              break;
            case 'diagnostics':
              diagnosticsContext += `\n${mentionContent}\n`;
              break;
            case 'terminal_selection':
              selectionContext += `\n\`\`\`console\n${mentionContent}\n\`\`\`\n`;
              break;
          }
          break;
        }
      }
    }

    // Append context groups if they have content
    const contextParts: string[] = [];
    if (fileContext) contextParts.push(`<files>${fileContext}</files>`);
    if (directoryContext) contextParts.push(`<directories>${directoryContext}</directories>`);
    if (symbolContext) contextParts.push(`<symbols>${symbolContext}</symbols>`);
    if (selectionContext) contextParts.push(`<selections>${selectionContext}</selections>`);
    if (threadContext) contextParts.push(`<threads>${threadContext}</threads>`);
    if (fetchContext) contextParts.push(`<fetched_urls>${fetchContext}</fetched_urls>`);
    if (rulesContext) contextParts.push(`<rules>\nThe user has specified the following rules that should be applied:\n${rulesContext}</rules>`);
    if (diagnosticsContext) contextParts.push(`<diagnostics>${diagnosticsContext}</diagnostics>`);

    if (contextParts.length > 0) {
      content.push({ type: 'text', text: OPEN_CONTEXT + contextParts.join('\n') + '\n</context>' });
    }

    return { role: 'user', content, cache: false };
  }

  private agentMessageToRequest(msg: AgentMessage): LanguageModelRequestMessage[] {
    const assistantContent = msg.content.map((c) => {
      switch (c.type) {
        case 'text':
          return { type: 'text' as const, text: c.text };
        case 'thinking':
          return { type: 'thinking' as const, text: c.text, signature: c.signature };
        case 'redacted_thinking':
          return { type: 'redacted_thinking' as const, data: c.data };
        case 'tool_use':
          return { type: 'tool_use' as const, toolUse: c.toolUse };
      }
    });

    const toolResultContent = Array.from(msg.toolResults.values()).map((result) => ({
      type: 'tool_result' as const,
      toolResult: {
        ...result,
        content: result.content.type === 'text' && result.content.text.length === 0
          ? textToolResult('<Tool returned an empty string>')
          : result.content,
      },
    }));

    const result: LanguageModelRequestMessage[] = [];
    if (assistantContent.length > 0) {
      result.push({
        role: 'assistant',
        content: assistantContent,
        cache: false,
        reasoningDetails: msg.reasoningDetails,
      });
    }
    if (toolResultContent.length > 0) {
      result.push({
        role: 'user',
        content: toolResultContent,
        cache: false,
      });
    }
    return result;
  }

  // --- Retry logic ---

  /**
   * Determine retry strategy for an error.
   * Ported from: Thread::retry_strategy_for()
   */
  private getRetryStrategy(
    error: CompletionError,
    attempt: number,
  ): { delayMs: number; maxAttempts: number } | null {
    const strategy = retryStrategyFor(error);
    if (!strategy) return null;

    const maxAttempts = strategy.type === 'exponential_backoff'
      ? strategy.maxAttempts
      : strategy.maxAttempts;

    if (attempt > maxAttempts) return null;

    const delayMs = strategy.type === 'exponential_backoff'
      ? strategy.initialDelayMs * Math.pow(2, attempt - 1)
      : strategy.delayMs;

    return { delayMs, maxAttempts };
  }

  // --- Helpers ---

  private getPendingMessage(): AgentMessage {
    if (!this.pendingMessage) {
      this.pendingMessage = emptyAgentMessage();
    }
    return this.pendingMessage;
  }

  private flushPendingMessage(): void {
    const msg = this.pendingMessage;
    if (!msg) return;
    this.pendingMessage = undefined;

    if (msg.content.length === 0) return;

    // Fill in canceled tool results
    for (const content of msg.content) {
      if (content.type === 'tool_use' && !msg.toolResults.has(content.toolUse.id)) {
        msg.toolResults.set(content.toolUse.id, {
          toolUseId: content.toolUse.id,
          toolName: content.toolUse.name,
          isError: true,
          content: textToolResult(TOOL_CANCELED_MESSAGE),
        });
      }
    }

    this.messages.push({ type: 'agent', message: msg });
    this._updatedAt = new Date();
    this._summary = undefined;
  }

  private updateTokenUsage(usage: TokenUsage): void {
    const lastUserMsg = this.lastUserMessage();
    if (!lastUserMsg) return;
    this.requestTokenUsage.set(lastUserMsg.id, usage);
    this.emit('token_usage_updated', this.latestTokenUsage());
  }

  private lastUserMessage(): UserMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i]!;
      if (msg.type === 'user') return msg.message;
    }
    return undefined;
  }

  private emitEvent(event: AgentEvent): void {
    this.host.events.emit(event);
    this.emit('event', event);
  }

  /**
   * Generate a title for this thread via the summarization model.
   * Ported from: Thread::generate_title() in thread.rs
   *
   * Uses the summarization model (or falls back to the primary model) to
   * generate a concise title. Runs asynchronously and non-blocking.
   */
  private generateTitleIfNeeded(_model: LanguageModel): void {
    if (this._title || this.messages.length === 0 || this._pendingTitleGeneration) return;

    const summaryModel = this._summarizationModel ?? this._model;
    if (!summaryModel) return;

    this._pendingTitleGeneration = true;

    // Build the title generation request from message history
    const requestMessages: LanguageModelRequestMessage[] = [];
    for (const msg of this.messages) {
      const reqMsgs = this.messageToRequest(msg);
      requestMessages.push(...reqMsgs);
    }

    // Add the summarization prompt
    requestMessages.push({
      role: 'user',
      content: [{ type: 'text', text: SUMMARIZE_THREAD_PROMPT }],
      cache: false,
    });

    const request: LanguageModelRequest = {
      messages: requestMessages,
      tools: [],
      temperature: 0.3,
    };

    // Fire and forget — title generation is non-blocking
    (async () => {
      try {
        let title = '';
        for await (const event of summaryModel.streamCompletion(request)) {
          if (event.type === 'text') {
            title += event.text;
            // Stop at first newline (title should be one line)
            if (title.includes('\n')) {
              title = title.split('\n')[0]!;
              break;
            }
          }
        }
        title = title.trim();
        if (title.length > 0 && !this._title) {
          this._title = title;
          this.emit('title_updated', title);
          this.emitEvent({
            type: 'title_updated',
            sessionId: this.id,
            title,
          });
        }
      } catch (err) {
        // Title generation failure is non-fatal — fall back to first message
        const firstUser = this.messages.find((m) => m.type === 'user');
        if (firstUser && firstUser.type === 'user' && !this._title) {
          const text = firstUser.message.content
            .filter((c) => c.type === 'text')
            .map((c) => (c as { type: 'text'; text: string }).text)
            .join(' ');
          if (text.length > 0) {
            this._title = text.length > 50 ? text.slice(0, 50) + '...' : text;
            this.emit('title_updated', this._title);
          }
        }
      } finally {
        this._pendingTitleGeneration = false;
      }
    })();
  }

  /**
   * Generate a detailed summary of the thread.
   * Ported from: Thread::summary() in thread.rs
   */
  async generateSummary(): Promise<string | null> {
    const model = this._summarizationModel ?? this._model;
    if (!model) return null;
    if (this._summary) return this._summary;

    const requestMessages: LanguageModelRequestMessage[] = [];
    for (const msg of this.messages) {
      requestMessages.push(...this.messageToRequest(msg));
    }
    requestMessages.push({
      role: 'user',
      content: [{ type: 'text', text: SUMMARIZE_THREAD_DETAILED_PROMPT }],
      cache: false,
    });

    const request: LanguageModelRequest = {
      messages: requestMessages,
      tools: [],
      temperature: 0.3,
    };

    try {
      let summary = '';
      for await (const event of model.streamCompletion(request)) {
        if (event.type === 'text') {
          summary += event.text;
        }
      }
      summary = summary.trim();
      if (summary.length > 0) {
        this._summary = summary;
      }
      return this._summary ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Simple default system prompt (used if no custom builder is provided).
   * The full Handlebars-based system prompt will be implemented in Phase 8.
   */
  private defaultSystemPrompt(toolNames: string[], modelName?: string): string {
    let prompt =
      'You are a highly skilled software engineer with extensive knowledge in many programming languages, ' +
      'frameworks, design patterns, and best practices.\n\n';

    prompt += '## Communication\n\n';
    prompt += '- Be conversational but professional.\n';
    prompt += '- Format your responses in markdown.\n';
    prompt += '- NEVER lie or make things up.\n\n';

    if (toolNames.length > 0) {
      prompt += '## Tool Use\n\n';
      prompt += '- Make sure to adhere to the tools schema.\n';
      prompt += '- You can call multiple tools in a single response.\n';
      prompt += `- Available tools: ${toolNames.join(', ')}\n\n`;
    }

    const roots = this.host.project.workspaceRoots;
    if (roots.length > 0) {
      prompt += '## Project\n\n';
      prompt += 'The project contains the following root directories:\n\n';
      for (const root of roots) {
        prompt += `- \`${root.absolutePath}\`\n`;
      }
      prompt += '\n';
    }

    prompt += `## System Information\n\n`;
    prompt += `Operating System: ${this.host.project.os}\n`;
    prompt += `Default Shell: ${this.host.project.shell}\n`;

    if (modelName) {
      prompt += `\n## Model Information\n\nYou are powered by the model named ${modelName}.\n`;
    }

    return prompt;
  }

  // --- Serialization (ported from Thread::to_db / Thread::from_db) ---

  /**
   * Serialize the thread to a DbThread for persistence.
   * Ported from: Thread::to_db() in thread.rs
   */
  toDb(): DbThread {
    return {
      title: this.title,
      messages: [...this.messages],
      updatedAt: this._updatedAt.toISOString(),
      detailedSummary: this._summary,
      cumulativeTokenUsage: { ...this.cumulativeTokenUsage },
      requestTokenUsage: new Map(this.requestTokenUsage),
      model: this._model
        ? {
            provider: String(this._model.providerId),
            model: String(this._model.id),
          }
        : undefined,
      imported: false,
      subagentContext: this.subagentContext,
    };
  }

  /**
   * Restore a thread from a DbThread.
   * Ported from: Thread::from_db() in thread.rs
   *
   * Model resolution order:
   * 1. Try to resolve the saved model from registry (if provided)
   * 2. Fall back to options.model
   * 3. Fall back to no model (user must set one before sending)
   */
  static fromDb(
    id: SessionId,
    dbThread: DbThread,
    options: ThreadOptions & {
      registry?: import('../models/registry.js').LanguageModelRegistry;
    },
  ): Thread {
    // Try to resolve the saved model from registry
    let model = options.model;
    if (dbThread.model && options.registry) {
      const resolved = options.registry.selectModel({
        provider: dbThread.model.provider,
        model: dbThread.model.model,
      });
      if (resolved) {
        model = resolved.model;
      }
    }

    const thread = new Thread({
      ...options,
      id,
      model,
      thinkingEnabled: model?.supportsThinking ?? false,
    });
    thread._title = dbThread.title || undefined;
    thread._summary = dbThread.detailedSummary;
    thread.messages = dbThread.messages;
    thread._updatedAt = new Date(dbThread.updatedAt);
    thread.cumulativeTokenUsage = dbThread.cumulativeTokenUsage;
    thread.requestTokenUsage = new Map(dbThread.requestTokenUsage);
    thread.subagentContext = dbThread.subagentContext;
    return thread;
  }

  /**
   * Replay all messages as events (for UI restoration after loading from DB).
   * Ported from: Thread::replay() in thread.rs
   */
  replay(): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const msg of this.messages) {
      switch (msg.type) {
        case 'user':
          events.push({
            type: 'user_message',
            id: msg.message.id,
            content: msg.message.content,
          });
          break;
        case 'agent':
          for (const content of msg.message.content) {
            switch (content.type) {
              case 'text':
                events.push({ type: 'agent_text', text: content.text });
                break;
              case 'thinking':
                events.push({ type: 'agent_thinking', text: content.text });
                break;
              case 'tool_use': {
                const toolUse = content.toolUse;
                const tool = this.tools.get(toolUse.name);
                events.push({
                  type: 'tool_call',
                  toolCallId: toolUse.id as unknown as import('../types/branded.js').ToolCallId,
                  toolName: toolUse.name,
                  title: tool?.initialTitle(toolUse.input) ?? toolUse.name,
                  kind: tool?.kind ?? 'other',
                  input: toolUse.input,
                  meta: { tool_name: toolUse.name },
                });
                // Emit the tool result status
                const result = msg.message.toolResults.get(toolUse.id);
                if (result) {
                  events.push({
                    type: 'tool_call_update',
                    toolCallId: toolUse.id as unknown as import('../types/branded.js').ToolCallId,
                    fields: {
                      status: result.isError ? 'failed' : 'completed',
                      rawOutput: result.output,
                    },
                  });
                }
                break;
              }
            }
          }
          break;
        case 'resume':
          break;
      }
    }
    return events;
  }

  /**
   * Get all messages (for external inspection).
   */
  getMessages(): readonly Message[] {
    return this.messages;
  }

  /**
   * Get the raw title (undefined if not set).
   */
  getRawTitle(): string | undefined {
    return this._title;
  }

  /**
   * Export the full conversation as Markdown.
   * Ported from: Thread::to_markdown() in thread.rs
   *
   * Format:
   * ```markdown
   * ## User
   *
   * user message content
   *
   * ## Assistant
   *
   * assistant response content
   * ```
   */
  toMarkdown(): string {
    let markdown = '';

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i]!;
      if (i > 0) markdown += '\n';

      switch (msg.type) {
        case 'user':
          markdown += '## User\n\n';
          markdown += userMessageToMarkdown(msg.message);
          break;
        case 'agent':
          markdown += '## Assistant\n\n';
          markdown += agentMessageToMarkdown(msg.message);
          break;
        case 'resume':
          // Resume messages are internal, skip in export
          break;
      }
    }

    if (this.pendingMessage) {
      markdown += '\n## Assistant\n\n';
      markdown += agentMessageToMarkdown(this.pendingMessage);
    }

    return markdown;
  }
}

// ---------------------------------------------------------------------------
// ThreadOptions
// ---------------------------------------------------------------------------

export interface ThreadOptions {
  id?: SessionId;
  host: BackendHost;
  settings: AgentSettings;
  model?: LanguageModel;
  thinkingEnabled?: boolean;
  thinkingEffort?: string;
  systemPromptBuilder?: (tools: string[], modelName?: string) => string;
  /**
   * Whether to use StreamingEditFileTool instead of EditFileTool.
   * When true, the StreamingEditFileTool is exposed as "edit_file" and
   * the regular EditFileTool is excluded.
   * Ported from: use_streaming_edit_tool flag in thread.rs
   */
  useStreamingEditTool?: boolean;
}

// ---------------------------------------------------------------------------
// Retry strategy — ported from Thread::retry_strategy_for()
// ---------------------------------------------------------------------------

interface RetryStrategyResult {
  type: 'exponential_backoff' | 'fixed';
  initialDelayMs: number;
  delayMs: number;
  maxAttempts: number;
}

function retryStrategyFor(error: CompletionError): RetryStrategyResult | null {
  switch (error.code) {
    case 'rate_limit_exceeded':
      return {
        type: 'fixed',
        initialDelayMs: BASE_RETRY_DELAY_MS,
        delayMs: error.retryAfter ?? BASE_RETRY_DELAY_MS,
        maxAttempts: MAX_RETRY_ATTEMPTS,
      };

    case 'server_overloaded':
      return {
        type: 'fixed',
        initialDelayMs: BASE_RETRY_DELAY_MS,
        delayMs: error.retryAfter ?? BASE_RETRY_DELAY_MS,
        maxAttempts: MAX_RETRY_ATTEMPTS,
      };

    case 'upstream_provider_error': {
      const upe = error as UpstreamProviderError;
      if (upe.statusCode === 429 || upe.statusCode === 503) {
        return {
          type: 'fixed',
          initialDelayMs: BASE_RETRY_DELAY_MS,
          delayMs: error.retryAfter ?? BASE_RETRY_DELAY_MS,
          maxAttempts: MAX_RETRY_ATTEMPTS,
        };
      }
      if (upe.statusCode === 500) {
        return {
          type: 'fixed',
          initialDelayMs: BASE_RETRY_DELAY_MS,
          delayMs: error.retryAfter ?? BASE_RETRY_DELAY_MS,
          maxAttempts: 3,
        };
      }
      if (upe.statusCode === 529) {
        return {
          type: 'fixed',
          initialDelayMs: BASE_RETRY_DELAY_MS,
          delayMs: error.retryAfter ?? BASE_RETRY_DELAY_MS,
          maxAttempts: MAX_RETRY_ATTEMPTS,
        };
      }
      return {
        type: 'fixed',
        initialDelayMs: BASE_RETRY_DELAY_MS,
        delayMs: error.retryAfter ?? BASE_RETRY_DELAY_MS,
        maxAttempts: 2,
      };
    }

    case 'api_internal_server_error':
      return {
        type: 'fixed',
        initialDelayMs: BASE_RETRY_DELAY_MS,
        delayMs: BASE_RETRY_DELAY_MS,
        maxAttempts: 3,
      };

    case 'api_read_response_error':
    case 'http_send':
    case 'deserialize_response':
    case 'bad_request_format':
      return {
        type: 'fixed',
        initialDelayMs: BASE_RETRY_DELAY_MS,
        delayMs: BASE_RETRY_DELAY_MS,
        maxAttempts: 3,
      };

    // Non-retryable errors
    case 'prompt_too_large':
    case 'no_api_key':
    case 'authentication_error':
    case 'permission_error':
    case 'api_endpoint_not_found':
    case 'payment_required':
      return null;

    case 'http_response_error': {
      const hre = error as HttpResponseError;
      if (hre.statusCode === 429) {
        return {
          type: 'exponential_backoff',
          initialDelayMs: BASE_RETRY_DELAY_MS,
          delayMs: BASE_RETRY_DELAY_MS,
          maxAttempts: MAX_RETRY_ATTEMPTS,
        };
      }
      if (hre.statusCode >= 400 && hre.statusCode < 600) {
        return {
          type: 'fixed',
          initialDelayMs: BASE_RETRY_DELAY_MS,
          delayMs: BASE_RETRY_DELAY_MS,
          maxAttempts: 3,
        };
      }
      return {
        type: 'fixed',
        initialDelayMs: BASE_RETRY_DELAY_MS,
        delayMs: BASE_RETRY_DELAY_MS,
        maxAttempts: 2,
      };
    }

    case 'serialize_request':
    case 'build_request_body':
      return {
        type: 'fixed',
        initialDelayMs: BASE_RETRY_DELAY_MS,
        delayMs: BASE_RETRY_DELAY_MS,
        maxAttempts: 1,
      };

    default:
      return {
        type: 'fixed',
        initialDelayMs: BASE_RETRY_DELAY_MS,
        delayMs: BASE_RETRY_DELAY_MS,
        maxAttempts: 2,
      };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Context tag helpers — ported from thread.rs
// ---------------------------------------------------------------------------

/**
 * Build a code block tag with optional line range.
 * Ported from: codeblock_tag() in thread.rs
 */
function codeblockTag(fullPath: string, lineRange?: [number, number]): string {
  let result = '';
  const ext = fullPath.split('.').pop();
  if (ext && ext !== fullPath) {
    result += `${ext} `;
  }
  result += fullPath;
  if (lineRange) {
    if (lineRange[0] === lineRange[1]) {
      result += `:${lineRange[0] + 1}`;
    } else {
      result += `:${lineRange[0] + 1}-${lineRange[1] + 1}`;
    }
  }
  return result;
}

/**
 * Convert a MentionUri to a link string.
 * Ported from: MentionUri::as_link() in mention.rs
 */
function mentionUriAsLink(uri: import('../types/thread.js').MentionUri): string {
  switch (uri.type) {
    case 'file':
      return `[@${uri.absPath.split('/').pop() ?? uri.absPath}](file://${uri.absPath})`;
    case 'directory':
      return `[@${uri.absPath.split('/').pop() ?? uri.absPath}](file://${uri.absPath})`;
    case 'symbol':
      return `[@${uri.symbolName}](symbol://${uri.absPath}#${uri.lineRange[0]}-${uri.lineRange[1]})`;
    case 'selection':
      return `[@selection](selection://${uri.absPath ?? 'untitled'}#${uri.lineRange[0]}-${uri.lineRange[1]})`;
    case 'thread':
    case 'text_thread':
      return `[@thread](thread://${uri.sessionId})`;
    case 'rule':
      return `[@rule](rule://${uri.id})`;
    case 'fetch':
      return `[@${uri.url}](${uri.url})`;
    case 'diagnostics':
      return `[@diagnostics](diagnostics://${uri.absPath ?? 'all'})`;
    case 'terminal_selection':
      return `[@terminal](terminal://${uri.terminalId})`;
    case 'pasted_image':
      return '[image]';
  }
}

// ---------------------------------------------------------------------------
// Markdown export helpers — ported from thread.rs to_markdown methods
// ---------------------------------------------------------------------------

function userMessageToMarkdown(msg: import('../types/thread.js').UserMessage): string {
  let md = '';
  for (const c of msg.content) {
    switch (c.type) {
      case 'text':
        md += c.text + '\n';
        break;
      case 'image':
        md += '<image />\n';
        break;
      case 'mention':
        if (c.content) {
          md += `${mentionUriAsLink(c.uri)}\n\n${c.content}\n`;
        } else {
          md += `${mentionUriAsLink(c.uri)}\n`;
        }
        break;
    }
  }
  md += '\n';
  return md;
}

function agentMessageToMarkdown(msg: import('../types/thread.js').AgentMessage): string {
  let md = '';
  for (const c of msg.content) {
    switch (c.type) {
      case 'text':
        md += c.text + '\n';
        break;
      case 'thinking':
        md += `<think>${c.text}</think>\n`;
        break;
      case 'redacted_thinking':
        md += '<redacted_thinking />\n';
        break;
      case 'tool_use':
        md += `**Tool Use**: ${c.toolUse.name} (ID: ${c.toolUse.id})\n`;
        md += `\`\`\`json\n${JSON.stringify(c.toolUse.input, null, 2)}\n\`\`\`\n`;
        break;
    }
  }

  for (const [, result] of msg.toolResults) {
    md += `**Tool Result**: ${result.toolName} (ID: ${result.toolUseId})\n\n`;
    if (result.isError) md += '**ERROR:**\n';
    if (result.content.type === 'text') {
      md += result.content.text + '\n\n';
    } else {
      md += '<image />\n\n';
    }
  }

  md += '\n';
  return md;
}
