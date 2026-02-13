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

  // --- Token usage ---

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

    const context: ToolContext = {
      host: this.host,
      eventStream,
      signal,
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
  private buildCompletionRequest(intent: CompletionIntent): LanguageModelRequest {
    const model = this._model;
    if (!model) throw new Error('No language model configured');

    const toolDefs = Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description(),
      inputSchema: tool.inputSchema(model.toolInputFormat),
    }));

    const messages = this.buildRequestMessages();

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
   * Build request messages including system prompt.
   * Ported from: Thread::build_request_messages()
   */
  private buildRequestMessages(): LanguageModelRequestMessage[] {
    const toolNames = Array.from(this.tools.keys());
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

  private userMessageToRequest(msg: UserMessage): LanguageModelRequestMessage {
    const content = msg.content.map((c) => {
      switch (c.type) {
        case 'text':
          return { type: 'text' as const, text: c.text };
        case 'image':
          return { type: 'image' as const, image: c.image };
        case 'mention':
          return { type: 'text' as const, text: c.content };
      }
    });
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

  private generateTitleIfNeeded(model: LanguageModel): void {
    // Title generation is async and non-blocking
    // Will be fully implemented with summarization model support
    if (this._title || this.messages.length === 0) return;
    // Placeholder: use first user message as title
    const firstUser = this.messages.find((m) => m.type === 'user');
    if (firstUser && firstUser.type === 'user') {
      const text = firstUser.message.content
        .filter((c) => c.type === 'text')
        .map((c) => (c as { type: 'text'; text: string }).text)
        .join(' ');
      if (text.length > 0) {
        this._title = text.length > 50 ? text.slice(0, 50) + '...' : text;
        this.emit('title_updated', this._title);
      }
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
