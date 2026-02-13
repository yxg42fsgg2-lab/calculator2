/**
 * Mock language model for testing.
 * Ported from: crates/language_model/src/fake_provider.rs
 */

import type {
  LanguageModelId,
  LanguageModelName,
  LanguageModelProviderId,
  LanguageModelProviderName,
} from '../src/types/branded.js';
import {
  languageModelId,
  languageModelName,
  languageModelProviderId,
  languageModelProviderName,
  toolUseId,
} from '../src/types/branded.js';
import type {
  LanguageModelCompletionEvent,
  LanguageModelEffortLevel,
  LanguageModelRequest,
  LanguageModelToolChoice,
  LanguageModelToolSchemaFormat,
} from '../src/types/language-model.js';
import type { LanguageModel } from '../src/models/language-model.js';

export interface MockResponse {
  text?: string;
  toolCalls?: Array<{ name: string; input: unknown }>;
}

/**
 * A mock language model that returns scripted responses.
 * Used for testing the Thread agentic loop without real API calls.
 */
export class MockLanguageModel implements LanguageModel {
  readonly id: LanguageModelId = languageModelId('mock');
  readonly name: LanguageModelName = languageModelName('Mock');
  readonly providerId: LanguageModelProviderId = languageModelProviderId('mock');
  readonly providerName: LanguageModelProviderName = languageModelProviderName('Mock');
  readonly isLatest = true;
  readonly telemetryId = 'mock';
  readonly supportsThinking = false;
  readonly supportedEffortLevels: LanguageModelEffortLevel[] = [];
  readonly supportsImages = false;
  readonly supportsTools = true;
  readonly supportsStreamingTools = true;
  readonly supportsSplitTokenDisplay = false;
  readonly toolInputFormat: LanguageModelToolSchemaFormat = 'json_schema';
  readonly maxTokenCount = 100_000;
  readonly maxOutputTokens = 4096;

  /** Queue of responses to return (FIFO). */
  private responses: MockResponse[] = [];
  /** Record of all requests received. */
  readonly receivedRequests: LanguageModelRequest[] = [];

  /** Add a response to the queue. */
  addResponse(response: MockResponse): void {
    this.responses.push(response);
  }

  /** Add a simple text response. */
  addTextResponse(text: string): void {
    this.responses.push({ text });
  }

  /** Add a tool call response. */
  addToolCallResponse(name: string, input: unknown): void {
    this.responses.push({ toolCalls: [{ name, input }] });
  }

  supportsToolChoice(): boolean {
    return true;
  }

  async *streamCompletion(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelCompletionEvent> {
    this.receivedRequests.push(request);

    const response = this.responses.shift();
    if (!response) {
      yield { type: 'start_message', messageId: 'mock-msg-1' };
      yield { type: 'text', text: 'No mock response configured.' };
      yield { type: 'stop', reason: 'end_turn' };
      return;
    }

    yield { type: 'start_message', messageId: `mock-msg-${Date.now()}` };

    if (response.text) {
      yield { type: 'text', text: response.text };
    }

    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        yield {
          type: 'tool_use',
          toolUse: {
            id: toolUseId(`mock-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`),
            name: tc.name,
            rawInput: JSON.stringify(tc.input),
            input: tc.input,
            isInputComplete: true,
          },
        };
      }
      yield { type: 'stop', reason: 'tool_use' };
    } else {
      yield { type: 'stop', reason: 'end_turn' };
    }

    yield {
      type: 'usage_update',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    };
  }
}
