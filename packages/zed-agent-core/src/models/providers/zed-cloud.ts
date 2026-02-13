/**
 * Zed Cloud language model provider.
 * Ported from: crates/language_models/src/provider/cloud.rs (~1,361 LOC)
 *              crates/cloud_llm_client/ (~410 LOC)
 *
 * Routes requests through Zed's API, which proxies to upstream providers
 * (Anthropic, OpenAI, Google). This allows Zed to manage billing and
 * provide models without users needing individual API keys.
 *
 * In the standalone library context, this provider can be used when
 * a user has a Zed account with an active plan.
 */

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
  completionErrorFromCloudFailure,
  OtherCompletionError,
} from '../../types/completion-error.js';
import type { LanguageModel } from '../language-model.js';
import type { LanguageModelProvider } from '../provider.js';

export const ZED_CLOUD_PROVIDER_ID = languageModelProviderId('zed.dev');
export const ZED_CLOUD_PROVIDER_NAME = languageModelProviderName('Zed');

// ---------------------------------------------------------------------------
// Model definitions available through Zed Cloud
// ---------------------------------------------------------------------------

interface ZedCloudModelDef {
  id: string;
  name: string;
  upstreamProviderId: string;
  upstreamProviderName: string;
  maxTokens: number;
  maxOutputTokens: number;
  supportsThinking: boolean;
  supportsImages: boolean;
}

const ZED_CLOUD_MODELS: ZedCloudModelDef[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    upstreamProviderId: 'anthropic',
    upstreamProviderName: 'Anthropic',
    maxTokens: 200_000,
    maxOutputTokens: 16_384,
    supportsThinking: true,
    supportsImages: true,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    upstreamProviderId: 'anthropic',
    upstreamProviderName: 'Anthropic',
    maxTokens: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsImages: true,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    upstreamProviderId: 'openai',
    upstreamProviderName: 'OpenAI',
    maxTokens: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsImages: true,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    upstreamProviderId: 'google',
    upstreamProviderName: 'Google AI',
    maxTokens: 1_000_000,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsImages: true,
  },
];

// ---------------------------------------------------------------------------
// ZedCloudLanguageModel
// ---------------------------------------------------------------------------

class ZedCloudLanguageModel implements LanguageModel {
  readonly id: LanguageModelId;
  readonly name: LanguageModelName;
  readonly providerId = ZED_CLOUD_PROVIDER_ID;
  readonly providerName = ZED_CLOUD_PROVIDER_NAME;
  readonly upstreamProviderId: LanguageModelProviderId;
  readonly upstreamProviderName: LanguageModelProviderName;
  readonly isLatest = true;
  readonly telemetryId: string;
  readonly supportsThinking: boolean;
  readonly supportedEffortLevels: LanguageModelEffortLevel[] = [];
  readonly supportsImages: boolean;
  readonly supportsTools = true;
  readonly supportsStreamingTools = true;
  readonly supportsSplitTokenDisplay = true;
  readonly toolInputFormat: LanguageModelToolSchemaFormat = 'json_schema';
  readonly maxTokenCount: number;
  readonly maxOutputTokens: number;

  private def: ZedCloudModelDef;
  private apiUrl: string;
  private token: string;

  constructor(def: ZedCloudModelDef, apiUrl: string, token: string) {
    this.def = def;
    this.apiUrl = apiUrl;
    this.token = token;
    this.id = languageModelId(def.id);
    this.name = languageModelName(def.name);
    this.upstreamProviderId = languageModelProviderId(def.upstreamProviderId);
    this.upstreamProviderName = languageModelProviderName(def.upstreamProviderName);
    this.telemetryId = def.id;
    this.supportsThinking = def.supportsThinking;
    this.supportsImages = def.supportsImages;
    this.maxTokenCount = def.maxTokens;
    this.maxOutputTokens = def.maxOutputTokens;
  }

  supportsToolChoice(choice: LanguageModelToolChoice): boolean {
    return choice === 'auto' || choice === 'any';
  }

  /**
   * Stream completion through Zed's Cloud API.
   * Ported from: cloud_llm_client streaming logic
   *
   * The Zed Cloud API accepts requests in a normalized format and routes
   * them to the appropriate upstream provider (Anthropic, OpenAI, Google).
   */
  async *streamCompletion(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelCompletionEvent> {
    const body = {
      model: this.def.id,
      provider: this.def.upstreamProviderId,
      intent: request.intent,
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content.map((c) => {
          if (c.type === 'text') return { type: 'text', text: c.text };
          if (c.type === 'tool_use') return { type: 'tool_use', ...c.toolUse };
          if (c.type === 'tool_result') return { type: 'tool_result', ...c.toolResult };
          return c;
        }),
      })),
      tools: request.tools,
      temperature: request.temperature,
      thinking_allowed: request.thinkingAllowed,
      thinking_effort: request.thinkingEffort,
    };

    const response = await fetch(`${this.apiUrl}/v1/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorJson: { code?: string; message?: string } = {};
      try { errorJson = JSON.parse(errorBody); } catch { /* ignore */ }
      throw completionErrorFromCloudFailure(
        this.upstreamProviderName,
        errorJson.code ?? `http_${response.status}`,
        errorJson.message ?? errorBody,
      );
    }

    if (!response.body) {
      throw new OtherCompletionError('No response body');
    }

    yield { type: 'start_message', messageId: '' };

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;

          try {
            const event = JSON.parse(data) as Record<string, unknown>;
            yield* this.mapCloudEvent(event);
          } catch {
            // Skip unparseable events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private *mapCloudEvent(
    event: Record<string, unknown>,
  ): Iterable<LanguageModelCompletionEvent> {
    const type = event['type'] as string | undefined;

    switch (type) {
      case 'text':
        yield { type: 'text', text: event['text'] as string };
        break;
      case 'thinking':
        yield {
          type: 'thinking',
          text: event['text'] as string,
          signature: event['signature'] as string | undefined,
        };
        break;
      case 'tool_use':
        yield {
          type: 'tool_use',
          toolUse: {
            id: toolUseId(event['id'] as string),
            name: event['name'] as string,
            rawInput: JSON.stringify(event['input']),
            input: event['input'],
            isInputComplete: (event['is_input_complete'] as boolean) ?? true,
          },
        };
        break;
      case 'stop':
        yield { type: 'stop', reason: (event['reason'] as string ?? 'end_turn') as LanguageModelCompletionEvent extends { type: 'stop' } ? LanguageModelCompletionEvent['reason'] : never };
        break;
      case 'usage':
        yield {
          type: 'usage_update',
          usage: {
            inputTokens: (event['input_tokens'] as number) ?? 0,
            outputTokens: (event['output_tokens'] as number) ?? 0,
            cacheCreationInputTokens: (event['cache_creation_input_tokens'] as number) ?? 0,
            cacheReadInputTokens: (event['cache_read_input_tokens'] as number) ?? 0,
          },
        };
        break;
      case 'status': {
        const status = event['status'] as string;
        if (status === 'queued') {
          yield { type: 'queued', position: (event['position'] as number) ?? 0 };
        } else if (status === 'started') {
          yield { type: 'started' };
        } else if (status === 'failed') {
          const upstreamName = this.upstreamProviderName;
          throw completionErrorFromCloudFailure(
            upstreamName,
            (event['code'] as string) ?? 'unknown',
            (event['message'] as string) ?? 'Unknown error',
            (event['retry_after'] as number) ? (event['retry_after'] as number) * 1000 : undefined,
          );
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ZedCloudProvider
// ---------------------------------------------------------------------------

export interface ZedCloudProviderOptions {
  /** Zed authentication token. */
  token: string;
  /** Zed Cloud API URL (default: https://api.zed.dev). */
  apiUrl?: string;
}

export class ZedCloudProvider implements LanguageModelProvider {
  readonly id = ZED_CLOUD_PROVIDER_ID;
  readonly name = ZED_CLOUD_PROVIDER_NAME;
  readonly icon = 'zed';

  private apiUrl: string;
  private token: string;

  constructor(options: ZedCloudProviderOptions) {
    this.token = options.token;
    this.apiUrl = options.apiUrl ?? 'https://api.zed.dev';
  }

  providedModels(): LanguageModel[] {
    return ZED_CLOUD_MODELS.map(
      (def) => new ZedCloudLanguageModel(def, this.apiUrl, this.token),
    );
  }

  recommendedModels(): LanguageModel[] {
    return this.providedModels();
  }

  isAuthenticated(): boolean {
    return !!this.token;
  }

  async authenticate(): Promise<void> {
    if (!this.token) throw new Error('Zed Cloud authentication token not set');
  }
}
