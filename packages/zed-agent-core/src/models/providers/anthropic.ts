/**
 * Anthropic language model provider.
 * Ported from: crates/language_models/src/provider/anthropic.rs (~1,257 LOC)
 *              crates/anthropic/src/ (~1,462 LOC)
 *
 * Uses the @anthropic-ai/sdk npm package for HTTP transport,
 * with full mapping of requests/responses to our internal types.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LanguageModelId,
  LanguageModelName,
  LanguageModelProviderId,
  LanguageModelProviderName,
} from '../../types/branded.js';
import {
  languageModelId,
  languageModelName,
  languageModelProviderId,
  languageModelProviderName,
  toolUseId,
} from '../../types/branded.js';
import type {
  LanguageModelCompletionEvent,
  LanguageModelEffortLevel,
  LanguageModelRequest,
  LanguageModelRequestMessage,
  LanguageModelToolChoice,
  LanguageModelToolSchemaFormat,
  TokenUsage,
} from '../../types/language-model.js';
import {
  CompletionError,
  RateLimitExceededError,
  ServerOverloadedError,
  PromptTooLargeError,
  BadRequestFormatError,
  AuthenticationError as AuthCompletionError,
  PermissionError as PermCompletionError,
  ApiEndpointNotFoundError,
  ApiInternalServerError,
  HttpResponseError,
  OtherCompletionError,
  parsePromptTooLong,
} from '../../types/completion-error.js';
import type { LanguageModel } from '../language-model.js';
import type { LanguageModelProvider } from '../provider.js';

// ---------------------------------------------------------------------------
// Provider constants
// ---------------------------------------------------------------------------

export const ANTHROPIC_PROVIDER_ID = languageModelProviderId('anthropic');
export const ANTHROPIC_PROVIDER_NAME = languageModelProviderName('Anthropic');

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------

interface AnthropicModelDef {
  id: string;
  name: string;
  maxTokens: number;
  maxOutputTokens: number;
  supportsThinking: boolean;
  supportsImages: boolean;
  isLatest: boolean;
  effortLevels?: LanguageModelEffortLevel[];
}

const ANTHROPIC_MODELS: AnthropicModelDef[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    maxTokens: 200_000,
    maxOutputTokens: 16_384,
    supportsThinking: true,
    supportsImages: true,
    isLatest: true,
    effortLevels: [
      { name: 'Low', value: 'low', isDefault: false },
      { name: 'Medium', value: 'medium', isDefault: true },
      { name: 'High', value: 'high', isDefault: false },
    ],
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    maxTokens: 200_000,
    maxOutputTokens: 32_000,
    supportsThinking: true,
    supportsImages: true,
    isLatest: true,
    effortLevels: [
      { name: 'Low', value: 'low', isDefault: false },
      { name: 'Medium', value: 'medium', isDefault: true },
      { name: 'High', value: 'high', isDefault: false },
    ],
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    maxTokens: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsImages: true,
    isLatest: true,
  },
];

// ---------------------------------------------------------------------------
// AnthropicLanguageModel
// ---------------------------------------------------------------------------

export class AnthropicLanguageModel implements LanguageModel {
  readonly id: LanguageModelId;
  readonly name: LanguageModelName;
  readonly providerId = ANTHROPIC_PROVIDER_ID;
  readonly providerName = ANTHROPIC_PROVIDER_NAME;
  readonly isLatest: boolean;
  readonly telemetryId: string;
  readonly supportsThinking: boolean;
  readonly supportedEffortLevels: LanguageModelEffortLevel[];
  readonly defaultEffortLevel?: LanguageModelEffortLevel;
  readonly supportsImages: boolean;
  readonly supportsTools = true;
  readonly supportsStreamingTools = true;
  readonly supportsSplitTokenDisplay = true;
  readonly toolInputFormat: LanguageModelToolSchemaFormat = 'json_schema';
  readonly maxTokenCount: number;
  readonly maxOutputTokens: number;

  private client: Anthropic;
  private modelDef: AnthropicModelDef;

  constructor(
    modelDef: AnthropicModelDef,
    client: Anthropic,
  ) {
    this.modelDef = modelDef;
    this.client = client;
    this.id = languageModelId(modelDef.id);
    this.name = languageModelName(modelDef.name);
    this.isLatest = modelDef.isLatest;
    this.telemetryId = modelDef.id;
    this.supportsThinking = modelDef.supportsThinking;
    this.supportedEffortLevels = modelDef.effortLevels ?? [];
    this.defaultEffortLevel = this.supportedEffortLevels.find((e) => e.isDefault);
    this.supportsImages = modelDef.supportsImages;
    this.maxTokenCount = modelDef.maxTokens;
    this.maxOutputTokens = modelDef.maxOutputTokens;
  }

  supportsToolChoice(choice: LanguageModelToolChoice): boolean {
    return choice === 'auto' || choice === 'any' || choice === 'none';
  }

  apiKey(): string | undefined {
    return this.client.apiKey ?? undefined;
  }

  /**
   * Count tokens in a request using Anthropic's token counting API.
   * Ported from: crates/language_models/src/provider/anthropic.rs count_tokens
   */
  async countTokens(request: LanguageModelRequest): Promise<number> {
    const { systemPrompt, messages } = this.buildMessages(request);

    try {
      const result = await this.client.messages.countTokens({
        model: this.modelDef.id,
        system: systemPrompt,
        messages,
      });
      return result.input_tokens;
    } catch {
      // Fall back to rough estimate: ~4 chars per token
      let charCount = systemPrompt.length;
      for (const msg of messages) {
        if (typeof msg.content === 'string') {
          charCount += msg.content.length;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if ('text' in block) charCount += (block as { text: string }).text.length;
          }
        }
      }
      return Math.ceil(charCount / 4);
    }
  }

  /**
   * Stream a completion from Anthropic.
   * Ported from: crates/anthropic/ streaming logic + crates/language_models/src/provider/anthropic.rs
   */
  async *streamCompletion(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelCompletionEvent> {
    const { systemPrompt, messages } = this.buildMessages(request);

    const tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }));

    // Build the request params
    const params: Anthropic.MessageCreateParams = {
      model: this.modelDef.id,
      max_tokens: this.maxOutputTokens,
      system: systemPrompt,
      messages,
      stream: true,
    };

    if (tools.length > 0) {
      params.tools = tools;
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (request.stop && request.stop.length > 0) {
      params.stop_sequences = request.stop;
    }

    // Thinking / extended thinking support
    if (request.thinkingAllowed && this.supportsThinking) {
      const budgetTokens = request.thinkingEffort === 'high'
        ? Math.min(32_000, this.maxOutputTokens)
        : request.thinkingEffort === 'low'
          ? 1024
          : Math.min(10_000, this.maxOutputTokens);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (params as any)['thinking'] = {
        type: 'enabled',
        budget_tokens: budgetTokens,
      };
      // Extended thinking requires removing temperature
      delete params.temperature;
    }

    // Cache control: mark the last message as cacheable
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1]!;
      if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0) {
        const lastBlock = lastMsg.content[lastMsg.content.length - 1]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (lastBlock as any)['cache_control'] = { type: 'ephemeral' };
      }
    }

    yield { type: 'start_message', messageId: '' };

    try {
      const stream = this.client.messages.stream(params);

      // Track in-progress tool calls for input accumulation
      const activeToolCalls = new Map<number, { id: string; name: string; inputJson: string }>();

      for await (const event of stream) {
        yield* this.mapStreamEvent(event, activeToolCalls);
      }

      // Get final message for usage
      const finalMessage = await stream.finalMessage();
      if (finalMessage.usage) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usageAny = finalMessage.usage as any;
        const usage: TokenUsage = {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
          cacheCreationInputTokens: usageAny['cache_creation_input_tokens'] ?? 0,
          cacheReadInputTokens: usageAny['cache_read_input_tokens'] ?? 0,
        };
        yield { type: 'usage_update', usage };
      }

      // Map stop reason
      const stopReason = finalMessage.stop_reason;
      if (stopReason === 'end_turn') {
        yield { type: 'stop', reason: 'end_turn' };
      } else if (stopReason === 'tool_use') {
        yield { type: 'stop', reason: 'tool_use' };
      } else if (stopReason === 'max_tokens') {
        yield { type: 'stop', reason: 'max_tokens' };
      }
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Map Anthropic SDK stream events to our internal event type.
   * Properly accumulates tool call input from input_json_delta events
   * and emits the complete tool_use when content_block_stop fires.
   *
   * Ported from: crates/anthropic/ streaming event handling
   */
  private *mapStreamEvent(
    event: Anthropic.MessageStreamEvent,
    activeToolCalls: Map<number, { id: string; name: string; inputJson: string }>,
  ): Iterable<LanguageModelCompletionEvent> {
    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          // Start tracking this tool call's input accumulation
          activeToolCalls.set(event.index, {
            id: block.id,
            name: block.name,
            inputJson: '',
          });
          // Emit initial tool_use with isInputComplete=false
          yield {
            type: 'tool_use',
            toolUse: {
              id: toolUseId(block.id),
              name: block.name,
              rawInput: '',
              input: {},
              isInputComplete: false,
            },
          };
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text', text: delta.text };
        } else if (delta.type === 'thinking_delta') {
          yield {
            type: 'thinking',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            text: (delta as any)['thinking'] ?? '',
          };
        } else if (delta.type === 'input_json_delta') {
          // Accumulate tool input JSON from streaming deltas
          const tc = activeToolCalls.get(event.index);
          if (tc) {
            tc.inputJson += (delta as { type: 'input_json_delta'; partial_json: string }).partial_json;
          }
        }
        break;
      }

      case 'content_block_stop': {
        // Finalize any tool call at this index
        const tc = activeToolCalls.get(event.index);
        if (tc) {
          activeToolCalls.delete(event.index);
          // Parse the accumulated JSON and emit complete tool_use
          let parsedInput: unknown = {};
          try {
            if (tc.inputJson) {
              parsedInput = JSON.parse(tc.inputJson);
            }
          } catch (e) {
            // Emit parse error
            yield {
              type: 'tool_use_json_parse_error',
              id: toolUseId(tc.id),
              toolName: tc.name,
              rawInput: tc.inputJson,
              jsonParseError: e instanceof Error ? e.message : 'Invalid JSON',
            };
            break;
          }
          // Emit the final tool_use with isInputComplete=true
          yield {
            type: 'tool_use',
            toolUse: {
              id: toolUseId(tc.id),
              name: tc.name,
              rawInput: tc.inputJson,
              input: parsedInput,
              isInputComplete: true,
            },
          };
        }
        break;
      }

      case 'message_start': {
        if (event.message.id) {
          yield { type: 'start_message', messageId: event.message.id };
        }
        break;
      }
    }
  }

  /**
   * Build Anthropic message format from our internal format.
   */
  private buildMessages(request: LanguageModelRequest): {
    systemPrompt: string;
    messages: Anthropic.MessageParam[];
  } {
    let systemPrompt = '';
    const messages: Anthropic.MessageParam[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { type: 'text'; text: string }).text)
          .join('\n');
        continue;
      }

      const content = this.mapMessageContent(msg);
      if (content.length > 0) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content,
        });
      }
    }

    return { systemPrompt, messages };
  }

  /**
   * Map our internal message content to Anthropic content blocks.
   */
  private mapMessageContent(
    msg: LanguageModelRequestMessage,
  ): Anthropic.ContentBlockParam[] {
    const blocks: Anthropic.ContentBlockParam[] = [];

    for (const content of msg.content) {
      switch (content.type) {
        case 'text':
          if (content.text.length > 0) {
            blocks.push({ type: 'text', text: content.text });
          }
          break;
        case 'image':
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: content.image.source,
            },
          });
          break;
        case 'tool_use':
          blocks.push({
            type: 'tool_use',
            id: String(content.toolUse.id),
            name: content.toolUse.name,
            input: content.toolUse.input as Record<string, unknown>,
          });
          break;
        case 'tool_result': {
          const resultContent =
            content.toolResult.content.type === 'text'
              ? content.toolResult.content.text
              : '[image result]';
          blocks.push({
            type: 'tool_result',
            tool_use_id: String(content.toolResult.toolUseId),
            content: resultContent,
            is_error: content.toolResult.isError || undefined,
          });
          break;
        }
        case 'thinking':
          blocks.push({
            type: 'thinking' as 'text',
            text: content.text,
          } as Anthropic.ContentBlockParam);
          break;
      }
    }

    return blocks;
  }

  /**
   * Map Anthropic SDK errors to our internal error types.
   * Ported from: crates/anthropic/ error handling
   */
  private mapError(error: unknown): CompletionError {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AnthropicAPIError = (Anthropic as any).APIError ?? (Anthropic as any).default?.APIError;
    if (AnthropicAPIError && error instanceof AnthropicAPIError) {
      const apiErr = error as { status?: number; message: string; headers?: Record<string, string> };
      const status = apiErr.status;
      const message = apiErr.message;

      switch (status) {
        case 400: {
          const tokens = parsePromptTooLong(message);
          if (tokens !== undefined) {
            return new PromptTooLargeError(tokens);
          }
          return new BadRequestFormatError(ANTHROPIC_PROVIDER_NAME, message);
        }
        case 401:
          return new AuthCompletionError(ANTHROPIC_PROVIDER_NAME, message);
        case 403:
          return new PermCompletionError(ANTHROPIC_PROVIDER_NAME, message);
        case 404:
          return new ApiEndpointNotFoundError(ANTHROPIC_PROVIDER_NAME);
        case 413:
          return new PromptTooLargeError(parsePromptTooLong(message));
        case 429:
          return new RateLimitExceededError(
            ANTHROPIC_PROVIDER_NAME,
            parseRetryAfter(error),
          );
        case 500:
          return new ApiInternalServerError(ANTHROPIC_PROVIDER_NAME, message);
        case 503:
          return new ServerOverloadedError(
            ANTHROPIC_PROVIDER_NAME,
            parseRetryAfter(error),
          );
        case 529:
          return new ServerOverloadedError(
            ANTHROPIC_PROVIDER_NAME,
            parseRetryAfter(error),
          );
        default:
          return new HttpResponseError(ANTHROPIC_PROVIDER_NAME, status ?? 0, message);
      }
    }

    if (error instanceof Error) {
      return new OtherCompletionError(error.message, error);
    }

    return new OtherCompletionError(String(error));
  }
}

function parseRetryAfter(error: unknown): number | undefined {
  const headers = (error as { headers?: Record<string, string> }).headers;
  if (!headers) return undefined;
  const retryAfter = headers['retry-after'];
  if (!retryAfter) return undefined;
  const seconds = parseInt(retryAfter, 10);
  if (isNaN(seconds)) return undefined;
  return seconds * 1000; // Convert to ms
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseURL?: string;
}

export class AnthropicProvider implements LanguageModelProvider {
  readonly id = ANTHROPIC_PROVIDER_ID;
  readonly name = ANTHROPIC_PROVIDER_NAME;
  readonly icon = 'anthropic';

  private client: Anthropic;
  private _apiKey?: string;

  constructor(options: AnthropicProviderOptions = {}) {
    this._apiKey = options.apiKey;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  providedModels(): LanguageModel[] {
    return ANTHROPIC_MODELS.map(
      (def) => new AnthropicLanguageModel(def, this.client),
    );
  }

  recommendedModels(): LanguageModel[] {
    return this.providedModels().filter((m) => m.isLatest);
  }

  isAuthenticated(): boolean {
    return !!this._apiKey;
  }

  async authenticate(): Promise<void> {
    if (!this._apiKey) {
      throw new Error('Anthropic API key not set');
    }
  }
}
