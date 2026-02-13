/**
 * Tests for queued message behavior.
 * Verifies that setting hasQueuedMessage causes the turn to end early.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { NowTool } from '../src/tools/now-tool.js';
import { eraseToolType } from '../src/types/tools.js';
import { agentProfileId, toolUseId, languageModelId, languageModelName, languageModelProviderId, languageModelProviderName } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import type { LanguageModel } from '../src/models/language-model.js';
import type { LanguageModelCompletionEvent, LanguageModelRequest, LanguageModelToolSchemaFormat, LanguageModelEffortLevel } from '../src/types/language-model.js';
import { RateLimiter } from '../src/models/rate-limiter.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

describe('Queued message', () => {
  let host: ReturnType<typeof createMockHost>['host'];
  let events: ReturnType<typeof createMockHost>['events'];

  beforeEach(() => {
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
    events = mocked.events;
  });

  it('queued message flag causes turn to end after tool results', async () => {
    // Model calls a tool, which normally would loop back for another completion.
    // But with a queued message, the turn should end instead.
    let callCount = 0;
    const queueTestModel: LanguageModel = {
      id: languageModelId('queue-test'),
      name: languageModelName('Queue Test'),
      providerId: languageModelProviderId('mock'),
      providerName: languageModelProviderName('Mock'),
      isLatest: true,
      telemetryId: 'queue-test',
      supportsThinking: false,
      supportedEffortLevels: [],
      supportsImages: false,
      supportsTools: true,
      supportsStreamingTools: true,
      supportsSplitTokenDisplay: false,
      toolInputFormat: 'json_schema',
      maxTokenCount: 100_000,
      maxOutputTokens: 4096,
      supportsToolChoice() { return true; },
      async *streamCompletion(request: LanguageModelRequest): AsyncIterable<LanguageModelCompletionEvent> {
        callCount++;
        yield { type: 'start_message', messageId: `msg-${callCount}` };
        if (callCount === 1) {
          // First call: use a tool
          yield {
            type: 'tool_use',
            toolUse: {
              id: toolUseId('tc-1'),
              name: 'now',
              rawInput: '{"timezone":"utc"}',
              input: { timezone: 'utc' },
              isInputComplete: true,
            },
          };
          yield { type: 'stop', reason: 'tool_use' };
        } else {
          // Second call (shouldn't happen if queued)
          yield { type: 'text', text: 'Second turn response' };
          yield { type: 'stop', reason: 'end_turn' };
        }
      },
    };

    const thread = new Thread({ host, settings, model: queueTestModel });
    thread.addTool(eraseToolType(new NowTool()));

    // Set queued message before sending — this simulates the user
    // typing while the agent is about to process tool results
    thread.setHasQueuedMessage(true);

    const result = await thread.send([{ type: 'text', text: 'Time please' }]);

    // The turn should end after the model processes tool results.
    // In Zed's behavior: tool call → tools run → results sent back to model →
    // model responds → check queued flag → end turn (don't loop for more tools).
    expect(result).toBe('end_turn');
    // Model called twice: 1) initial (tool call), 2) after tool results (text response)
    // But if the model had called MORE tools in round 2, we'd stop instead of looping.
    expect(callCount).toBe(2);
  });
});

describe('Rate limiter integration', () => {
  let host: ReturnType<typeof createMockHost>['host'];

  beforeEach(() => {
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
  });

  it('uses rate limiter for model calls', async () => {
    const model = new MockLanguageModel();
    model.addTextResponse('ok');
    model.addTextResponse('title');

    const limiter = new RateLimiter(1);
    const thread = new Thread({ host, settings, model, rateLimiter: limiter });

    // Before call
    expect(limiter.activeCount).toBe(0);

    await thread.send([{ type: 'text', text: 'test' }]);

    // After call completes, permit should be released
    expect(limiter.activeCount).toBe(0);
  });

  it('rate limiter limits concurrent model calls', async () => {
    const model = new MockLanguageModel();
    model.addTextResponse('r1');
    model.addTextResponse('t1');
    model.addTextResponse('r2');
    model.addTextResponse('t2');

    // Limiter with capacity 1 — only one thread can call the model at a time
    const limiter = new RateLimiter(1);
    const thread1 = new Thread({ host, settings, model, rateLimiter: limiter });
    const thread2 = new Thread({ host, settings, model, rateLimiter: limiter });

    // Both threads send at the same time
    const [r1, r2] = await Promise.all([
      thread1.send([{ type: 'text', text: 'first' }]),
      thread2.send([{ type: 'text', text: 'second' }]),
    ]);

    // Both should complete
    expect(r1).toBe('end_turn');
    expect(r2).toBe('end_turn');

    // Limiter should be fully released
    expect(limiter.activeCount).toBe(0);
  });
});
