/**
 * OpenAI language model provider.
 * Ported from: crates/language_models/src/provider/open_ai.rs (~1,967 LOC)
 *              crates/open_ai/src/ (~1,208 LOC)
 *
 * Uses the openai npm package for HTTP transport.
 */

import OpenAI from 'openai';
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
} from '../../types/completion-error.js';
import type { LanguageModel } from '../language-model.js';
import type { LanguageModelProvider } from '../provider.js';

// ---------------------------------------------------------------------------
// Provider constants
// ---------------------------------------------------------------------------

export const OPENAI_PROVIDER_ID = languageModelProviderId('openai');
export const OPENAI_PROVIDER_NAME = languageModelProviderName('OpenAI');

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------

interface OpenAIModelDef {
  id: string;
  name: string;
  maxTokens: number;
  maxOutputTokens?: number;
  supportsThinking: boolean;
  supportsImages: boolean;
  isLatest: boolean;
}

const OPENAI_MODELS: OpenAIModelDef[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    maxTokens: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsImages: true,
    isLatest: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    maxTokens: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsImages: true,
    isLatest: true,
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    maxTokens: 200_000,
    maxOutputTokens: 100_000,
    supportsThinking: true,
    supportsImages: false,
    isLatest: true,
  },
  {
    id: 'o3',
    name: 'o3',
    maxTokens: 200_000,
    maxOutputTokens: 100_000,
    supportsThinking: true,
    supportsImages: true,
    isLatest: true,
  },
];

// ---------------------------------------------------------------------------
// OpenAILanguageModel
// ---------------------------------------------------------------------------

export class OpenAILanguageModel implements LanguageModel {
  readonly id: LanguageModelId;
  readonly name: LanguageModelName;
  readonly providerId = OPENAI_PROVIDER_ID;
  readonly providerName = OPENAI_PROVIDER_NAME;
  readonly isLatest: boolean;
  readonly telemetryId: string;
  readonly supportsThinking: boolean;
  readonly supportedEffortLevels: LanguageModelEffortLevel[] = [];
  readonly defaultEffortLevel?: LanguageModelEffortLevel;
  readonly supportsImages: boolean;
  readonly supportsTools = true;
  readonly supportsStreamingTools = true;
  readonly supportsSplitTokenDisplay = true;
  readonly toolInputFormat: LanguageModelToolSchemaFormat = 'json_schema';
  readonly maxTokenCount: number;
  readonly maxOutputTokens?: number;

  private client: OpenAI;
  private modelDef: OpenAIModelDef;

  constructor(modelDef: OpenAIModelDef, client: OpenAI) {
    this.modelDef = modelDef;
    this.client = client;
    this.id = languageModelId(modelDef.id);
    this.name = languageModelName(modelDef.name);
    this.isLatest = modelDef.isLatest;
    this.telemetryId = modelDef.id;
    this.supportsThinking = modelDef.supportsThinking;
    this.supportsImages = modelDef.supportsImages;
    this.maxTokenCount = modelDef.maxTokens;
    this.maxOutputTokens = modelDef.maxOutputTokens;
  }

  supportsToolChoice(choice: LanguageModelToolChoice): boolean {
    return choice === 'auto' || choice === 'none';
  }

  apiKey(): string | undefined {
    return this.client.apiKey ?? undefined;
  }

  async *streamCompletion(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelCompletionEvent> {
    const messages = this.buildMessages(request);
    const tools = request.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as Record<string, unknown>,
      },
    }));

    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: this.modelDef.id,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools.length > 0) {
      params.tools = tools;
    }

    if (request.temperature !== undefined && !this.supportsThinking) {
      params.temperature = request.temperature;
    }

    if (this.maxOutputTokens) {
      params.max_completion_tokens = this.maxOutputTokens;
    }

    if (request.thinkingAllowed && this.supportsThinking) {
      // OpenAI reasoning models use the reasoning_effort parameter
      if (request.thinkingEffort) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (params as any)['reasoning_effort'] = request.thinkingEffort;
      }
    }

    yield { type: 'start_message', messageId: '' };

    try {
      const stream = await this.client.chat.completions.create(params);

      // Track tool call accumulation
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Text content
        if (delta.content) {
          yield { type: 'text', text: delta.content };
        }

        // Tool calls (streaming)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCalls.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments;
              }
            } else {
              toolCalls.set(tc.index, {
                id: tc.id ?? '',
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '',
              });
            }
          }
        }

        // Check finish reason
        if (choice.finish_reason === 'stop') {
          yield { type: 'stop', reason: 'end_turn' };
        } else if (choice.finish_reason === 'tool_calls') {
          // Emit all accumulated tool calls
          for (const [, tc] of toolCalls) {
            let parsedInput: unknown = {};
            try {
              parsedInput = JSON.parse(tc.arguments);
            } catch {
              yield {
                type: 'tool_use_json_parse_error',
                id: toolUseId(tc.id),
                toolName: tc.name,
                rawInput: tc.arguments,
                jsonParseError: 'Failed to parse tool call arguments',
              };
              continue;
            }
            yield {
              type: 'tool_use',
              toolUse: {
                id: toolUseId(tc.id),
                name: tc.name,
                rawInput: tc.arguments,
                input: parsedInput,
                isInputComplete: true,
              },
            };
          }
          yield { type: 'stop', reason: 'tool_use' };
        } else if (choice.finish_reason === 'length') {
          yield { type: 'stop', reason: 'max_tokens' };
        }

        // Usage
        if (chunk.usage) {
          const usage: TokenUsage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          };
          yield { type: 'usage_update', usage };
        }
      }
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private buildMessages(
    request: LanguageModelRequest,
  ): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        const text = msg.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { type: 'text'; text: string }).text)
          .join('\n');
        messages.push({ role: 'system', content: text });
        continue;
      }

      if (msg.role === 'assistant') {
        const text = msg.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { type: 'text'; text: string }).text)
          .join('');

        const toolCalls = msg.content
          .filter((c) => c.type === 'tool_use')
          .map((c) => {
            const tu = (c as { type: 'tool_use'; toolUse: { id: string; name: string; input: unknown } }).toolUse;
            return {
              id: String(tu.id),
              type: 'function' as const,
              function: {
                name: tu.name,
                arguments: JSON.stringify(tu.input),
              },
            };
          });

        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: text || null,
        };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        messages.push(assistantMsg);
        continue;
      }

      // User role
      const parts: OpenAI.ChatCompletionContentPart[] = [];
      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

      for (const content of msg.content) {
        switch (content.type) {
          case 'text':
            parts.push({ type: 'text', text: content.text });
            break;
          case 'image':
            parts.push({
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${content.image.source}`,
              },
            });
            break;
          case 'tool_result':
            toolResults.push({
              role: 'tool',
              tool_call_id: String(content.toolResult.toolUseId),
              content: content.toolResult.content.type === 'text'
                ? content.toolResult.content.text
                : '[image]',
            });
            break;
        }
      }

      // Tool results go as separate messages in OpenAI format
      for (const tr of toolResults) {
        messages.push(tr);
      }

      if (parts.length > 0) {
        messages.push({ role: 'user', content: parts });
      }
    }

    return messages;
  }

  private mapError(error: unknown): CompletionError {
    if (error instanceof OpenAI.APIError) {
      const status = error.status;
      const message = error.message;

      switch (status) {
        case 400:
          return new BadRequestFormatError(OPENAI_PROVIDER_NAME, message);
        case 401:
          return new AuthCompletionError(OPENAI_PROVIDER_NAME, message);
        case 403:
          return new PermCompletionError(OPENAI_PROVIDER_NAME, message);
        case 404:
          return new ApiEndpointNotFoundError(OPENAI_PROVIDER_NAME);
        case 429:
          return new RateLimitExceededError(OPENAI_PROVIDER_NAME);
        case 500:
          return new ApiInternalServerError(OPENAI_PROVIDER_NAME, message);
        case 503:
          return new ServerOverloadedError(OPENAI_PROVIDER_NAME);
        default:
          return new HttpResponseError(OPENAI_PROVIDER_NAME, status ?? 0, message);
      }
    }

    if (error instanceof Error) {
      return new OtherCompletionError(error.message, error);
    }

    return new OtherCompletionError(String(error));
  }
}

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

export interface OpenAIProviderOptions {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
}

export class OpenAIProvider implements LanguageModelProvider {
  readonly id = OPENAI_PROVIDER_ID;
  readonly name = OPENAI_PROVIDER_NAME;
  readonly icon = 'openai';

  private client: OpenAI;
  private _apiKey?: string;

  constructor(options: OpenAIProviderOptions = {}) {
    this._apiKey = options.apiKey;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      organization: options.organization,
    });
  }

  providedModels(): LanguageModel[] {
    return OPENAI_MODELS.map(
      (def) => new OpenAILanguageModel(def, this.client),
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
      throw new Error('OpenAI API key not set');
    }
  }
}
