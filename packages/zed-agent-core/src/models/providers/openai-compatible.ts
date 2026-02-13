/**
 * OpenAI-compatible language model provider.
 * Ported from: crates/language_models/src/provider/open_ai_compatible.rs (563 LOC)
 *              + ollama.rs (1,148 LOC), lmstudio.rs (775 LOC), deepseek.rs (647 LOC)
 *
 * This is a generic provider for any OpenAI-compatible API (Ollama, LM Studio,
 * DeepSeek, vLLM, text-generation-inference, etc.).
 *
 * Uses the openai npm package with a custom baseURL.
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
  OtherCompletionError,
  HttpResponseError,
  completionErrorFromHttpStatus,
} from '../../types/completion-error.js';
import type { CompletionError } from '../../types/completion-error.js';
import type { LanguageModel } from '../language-model.js';
import type { LanguageModelProvider } from '../provider.js';

// ---------------------------------------------------------------------------
// Model definition
// ---------------------------------------------------------------------------

export interface OpenAICompatibleModelDef {
  id: string;
  name: string;
  maxTokens: number;
  maxOutputTokens?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
  supportsThinking?: boolean;
}

// ---------------------------------------------------------------------------
// OpenAICompatibleLanguageModel
// ---------------------------------------------------------------------------

export class OpenAICompatibleLanguageModel implements LanguageModel {
  readonly id: LanguageModelId;
  readonly name: LanguageModelName;
  readonly providerId: LanguageModelProviderId;
  readonly providerName: LanguageModelProviderName;
  readonly isLatest = false;
  readonly telemetryId: string;
  readonly supportsThinking: boolean;
  readonly supportedEffortLevels: LanguageModelEffortLevel[] = [];
  readonly supportsImages: boolean;
  readonly supportsTools: boolean;
  readonly supportsStreamingTools = true;
  readonly supportsSplitTokenDisplay = false;
  readonly toolInputFormat: LanguageModelToolSchemaFormat = 'json_schema';
  readonly maxTokenCount: number;
  readonly maxOutputTokens?: number;

  private client: OpenAI;
  private modelId: string;

  constructor(
    def: OpenAICompatibleModelDef,
    client: OpenAI,
    providerId: LanguageModelProviderId,
    providerName: LanguageModelProviderName,
  ) {
    this.client = client;
    this.modelId = def.id;
    this.id = languageModelId(def.id);
    this.name = languageModelName(def.name);
    this.providerId = providerId;
    this.providerName = providerName;
    this.telemetryId = def.id;
    this.supportsThinking = def.supportsThinking ?? false;
    this.supportsImages = def.supportsImages ?? false;
    this.supportsTools = def.supportsTools ?? true;
    this.maxTokenCount = def.maxTokens;
    this.maxOutputTokens = def.maxOutputTokens;
  }

  supportsToolChoice(choice: LanguageModelToolChoice): boolean {
    return choice === 'auto' || choice === 'none';
  }

  async *streamCompletion(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelCompletionEvent> {
    const messages = buildOpenAIMessages(request);
    const tools = request.tools.length > 0 && this.supportsTools
      ? request.tools.map((tool) => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as Record<string, unknown>,
          },
        }))
      : undefined;

    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: this.modelId,
      messages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (this.maxOutputTokens) {
      params.max_completion_tokens = this.maxOutputTokens;
    }

    yield { type: 'start_message', messageId: '' };

    try {
      const stream = await this.client.chat.completions.create(params);
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.content) {
          yield { type: 'text', text: delta.content };
        }

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

        if (choice.finish_reason === 'stop') {
          yield { type: 'stop', reason: 'end_turn' };
        } else if (choice.finish_reason === 'tool_calls') {
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

        if (chunk.usage) {
          yield {
            type: 'usage_update',
            usage: {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0,
            },
          };
        }
      }
    } catch (error) {
      throw mapOpenAIError(error, this.providerName);
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAICompatibleProvider
// ---------------------------------------------------------------------------

export interface OpenAICompatibleProviderOptions {
  id: string;
  name: string;
  baseURL: string;
  apiKey?: string;
  models?: OpenAICompatibleModelDef[];
  /** Whether to auto-discover models via /v1/models API. */
  discoverModels?: boolean;
  defaultMaxTokens?: number;
}

export class OpenAICompatibleProvider implements LanguageModelProvider {
  readonly id: LanguageModelProviderId;
  readonly name: LanguageModelProviderName;
  readonly icon: string;

  private client: OpenAI;
  private modelDefs: OpenAICompatibleModelDef[];
  private discoverModels: boolean;
  private discoveredModels: OpenAICompatibleModelDef[] = [];
  private defaultMaxTokens: number;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.id = languageModelProviderId(options.id);
    this.name = languageModelProviderName(options.name);
    this.icon = options.id;
    this.client = new OpenAI({
      apiKey: options.apiKey ?? 'not-needed',
      baseURL: options.baseURL,
    });
    this.modelDefs = options.models ?? [];
    this.discoverModels = options.discoverModels ?? false;
    this.defaultMaxTokens = options.defaultMaxTokens ?? 128_000;
  }

  providedModels(): LanguageModel[] {
    const allDefs = [...this.modelDefs, ...this.discoveredModels];
    return allDefs.map(
      (def) => new OpenAICompatibleLanguageModel(def, this.client, this.id, this.name),
    );
  }

  recommendedModels(): LanguageModel[] {
    return this.providedModels();
  }

  isAuthenticated(): boolean {
    return true; // Local providers are always "authenticated"
  }

  async authenticate(): Promise<void> {
    if (this.discoverModels) {
      try {
        const models = await this.client.models.list();
        this.discoveredModels = [];
        for await (const model of models) {
          this.discoveredModels.push({
            id: model.id,
            name: model.id,
            maxTokens: this.defaultMaxTokens,
          });
        }
      } catch {
        // Model discovery failed — non-fatal for local providers
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-built providers for common services
// ---------------------------------------------------------------------------

/**
 * Create an Ollama provider.
 * Ported from: crates/language_models/src/provider/ollama.rs
 */
export function createOllamaProvider(options?: {
  baseURL?: string;
  models?: OpenAICompatibleModelDef[];
}): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'ollama',
    name: 'Ollama',
    baseURL: options?.baseURL ?? 'http://localhost:11434/v1',
    models: options?.models ?? [],
    discoverModels: true,
    defaultMaxTokens: 128_000,
  });
}

/**
 * Create an LM Studio provider.
 * Ported from: crates/language_models/src/provider/lmstudio.rs
 */
export function createLMStudioProvider(options?: {
  baseURL?: string;
  models?: OpenAICompatibleModelDef[];
}): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'lmstudio',
    name: 'LM Studio',
    baseURL: options?.baseURL ?? 'http://localhost:1234/v1',
    models: options?.models ?? [],
    discoverModels: true,
    defaultMaxTokens: 128_000,
  });
}

/**
 * Create a DeepSeek provider.
 * Ported from: crates/language_models/src/provider/deepseek.rs
 */
export function createDeepSeekProvider(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey,
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3', maxTokens: 64_000 },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1', maxTokens: 64_000, supportsThinking: true },
    ],
  });
}

/**
 * Create an OpenRouter provider.
 * Ported from: crates/language_models/src/provider/open_router.rs
 */
export function createOpenRouterProvider(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'open_router',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    discoverModels: true,
    defaultMaxTokens: 128_000,
  });
}

/**
 * Create an xAI (Grok) provider.
 * Ported from: crates/language_models/src/provider/x_ai.rs
 */
export function createXAIProvider(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'x_ai',
    name: 'xAI',
    baseURL: 'https://api.x.ai/v1',
    apiKey,
    models: [
      { id: 'grok-3', name: 'Grok 3', maxTokens: 131_072, supportsImages: true },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', maxTokens: 131_072 },
    ],
  });
}

/**
 * Create a Mistral provider.
 * Ported from: crates/language_models/src/provider/mistral.rs
 */
export function createMistralProvider(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'mistral',
    name: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    apiKey,
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', maxTokens: 128_000, supportsTools: true },
      { id: 'mistral-small-latest', name: 'Mistral Small', maxTokens: 128_000, supportsTools: true },
      { id: 'codestral-latest', name: 'Codestral', maxTokens: 256_000 },
    ],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildOpenAIMessages(
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
            image_url: { url: `data:image/png;base64,${content.image.source}` },
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

    for (const tr of toolResults) {
      messages.push(tr);
    }
    if (parts.length > 0) {
      messages.push({ role: 'user', content: parts });
    }
  }

  return messages;
}

function mapOpenAIError(error: unknown, providerName: LanguageModelProviderName): CompletionError {
  if (error instanceof OpenAI.APIError) {
    return completionErrorFromHttpStatus(
      providerName,
      error.status ?? 500,
      error.message,
    );
  }
  if (error instanceof Error) {
    return new OtherCompletionError(error.message, error);
  }
  return new OtherCompletionError(String(error));
}
