/**
 * Google AI (Gemini) language model provider.
 * Ported from: crates/language_models/src/provider/google.rs (1,295 LOC)
 *              crates/google_ai/src/google_ai.rs (725 LOC)
 *
 * Uses the OpenAI-compatible endpoint that Google provides for Gemini models,
 * avoiding the need for a separate Google AI SDK dependency.
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
} from '../../types/language-model.js';
import {
  OtherCompletionError,
  completionErrorFromHttpStatus,
} from '../../types/completion-error.js';
import type { CompletionError } from '../../types/completion-error.js';
import type { LanguageModel } from '../language-model.js';
import type { LanguageModelProvider } from '../provider.js';

export const GOOGLE_PROVIDER_ID = languageModelProviderId('google');
export const GOOGLE_PROVIDER_NAME = languageModelProviderName('Google AI');

interface GoogleModelDef {
  id: string;
  name: string;
  maxTokens: number;
  maxOutputTokens: number;
  supportsThinking: boolean;
  supportsImages: boolean;
  isLatest: boolean;
}

const GOOGLE_MODELS: GoogleModelDef[] = [
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    maxTokens: 1_000_000,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsImages: true,
    isLatest: true,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    maxTokens: 1_000_000,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsImages: true,
    isLatest: true,
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    maxTokens: 1_000_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsImages: true,
    isLatest: true,
  },
];

class GoogleLanguageModel implements LanguageModel {
  readonly id: LanguageModelId;
  readonly name: LanguageModelName;
  readonly providerId = GOOGLE_PROVIDER_ID;
  readonly providerName = GOOGLE_PROVIDER_NAME;
  readonly isLatest: boolean;
  readonly telemetryId: string;
  readonly supportsThinking: boolean;
  readonly supportedEffortLevels: LanguageModelEffortLevel[] = [];
  readonly supportsImages: boolean;
  readonly supportsTools = true;
  readonly supportsStreamingTools = true;
  readonly supportsSplitTokenDisplay = true;
  readonly toolInputFormat: LanguageModelToolSchemaFormat = 'simplified';
  readonly maxTokenCount: number;
  readonly maxOutputTokens: number;

  private client: OpenAI;
  private modelDef: GoogleModelDef;

  constructor(def: GoogleModelDef, client: OpenAI) {
    this.modelDef = def;
    this.client = client;
    this.id = languageModelId(def.id);
    this.name = languageModelName(def.name);
    this.isLatest = def.isLatest;
    this.telemetryId = def.id;
    this.supportsThinking = def.supportsThinking;
    this.supportsImages = def.supportsImages;
    this.maxTokenCount = def.maxTokens;
    this.maxOutputTokens = def.maxOutputTokens;
  }

  supportsToolChoice(choice: LanguageModelToolChoice): boolean {
    return choice === 'auto' || choice === 'none';
  }

  async *streamCompletion(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelCompletionEvent> {
    // Build messages using OpenAI-compatible format
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        const text = msg.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { type: 'text'; text: string }).text)
          .join('\n');
        messages.push({ role: 'system', content: text });
      } else if (msg.role === 'assistant') {
        const text = msg.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { type: 'text'; text: string }).text)
          .join('');
        messages.push({ role: 'assistant', content: text || null });
      } else {
        const parts: OpenAI.ChatCompletionContentPart[] = [];
        for (const content of msg.content) {
          if (content.type === 'text') {
            parts.push({ type: 'text', text: content.text });
          } else if (content.type === 'image') {
            parts.push({
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${content.image.source}` },
            });
          } else if (content.type === 'tool_result') {
            messages.push({
              role: 'tool',
              tool_call_id: String(content.toolResult.toolUseId),
              content: content.toolResult.content.type === 'text'
                ? content.toolResult.content.text
                : '[image]',
            } satisfies OpenAI.ChatCompletionToolMessageParam);
          }
        }
        if (parts.length > 0) {
          messages.push({ role: 'user', content: parts });
        }
      }
    }

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
    };

    if (tools.length > 0) {
      params.tools = tools;
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
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
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
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
            try { parsedInput = JSON.parse(tc.arguments); } catch { /* skip */ }
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
      if (error instanceof OpenAI.APIError) {
        throw completionErrorFromHttpStatus(
          GOOGLE_PROVIDER_NAME,
          error.status ?? 500,
          error.message,
        );
      }
      throw new OtherCompletionError(
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined,
      );
    }
  }
}

export interface GoogleProviderOptions {
  apiKey: string;
}

export class GoogleProvider implements LanguageModelProvider {
  readonly id = GOOGLE_PROVIDER_ID;
  readonly name = GOOGLE_PROVIDER_NAME;
  readonly icon = 'google';

  private client: OpenAI;
  private _apiKey: string;

  constructor(options: GoogleProviderOptions) {
    this._apiKey = options.apiKey;
    // Google provides an OpenAI-compatible endpoint
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    });
  }

  providedModels(): LanguageModel[] {
    return GOOGLE_MODELS.map((def) => new GoogleLanguageModel(def, this.client));
  }

  recommendedModels(): LanguageModel[] {
    return this.providedModels().filter((m) => m.isLatest);
  }

  isAuthenticated(): boolean {
    return !!this._apiKey;
  }

  async authenticate(): Promise<void> {
    if (!this._apiKey) throw new Error('Google AI API key not set');
  }
}
