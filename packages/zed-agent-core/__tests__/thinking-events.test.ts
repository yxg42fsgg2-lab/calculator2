/**
 * Tests for thinking/reasoning events.
 * Verifies that the Thread properly handles models with thinking capabilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { agentProfileId, toolUseId, languageModelId, languageModelName, languageModelProviderId, languageModelProviderName } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import type { LanguageModel } from '../src/models/language-model.js';
import type { LanguageModelCompletionEvent, LanguageModelRequest, LanguageModelToolSchemaFormat, LanguageModelEffortLevel, LanguageModelToolChoice } from '../src/types/language-model.js';
import { createMockHost } from './mock-host.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

/**
 * Mock model that emits thinking events.
 */
class ThinkingMockModel implements LanguageModel {
  readonly id = languageModelId('thinking-mock');
  readonly name = languageModelName('Thinking Mock');
  readonly providerId = languageModelProviderId('mock');
  readonly providerName = languageModelProviderName('Mock');
  readonly isLatest = true;
  readonly telemetryId = 'thinking-mock';
  readonly supportsThinking = true;
  readonly supportedEffortLevels: LanguageModelEffortLevel[] = [
    { name: 'Low', value: 'low', isDefault: false },
    { name: 'Medium', value: 'medium', isDefault: true },
    { name: 'High', value: 'high', isDefault: false },
  ];
  readonly defaultEffortLevel = { name: 'Medium', value: 'medium', isDefault: true };
  readonly supportsImages = true;
  readonly supportsTools = true;
  readonly supportsStreamingTools = true;
  readonly supportsSplitTokenDisplay = false;
  readonly toolInputFormat: LanguageModelToolSchemaFormat = 'json_schema';
  readonly maxTokenCount = 200_000;
  readonly maxOutputTokens = 16_384;

  private callCount = 0;

  supportsToolChoice(): boolean { return true; }

  async *streamCompletion(request: LanguageModelRequest): AsyncIterable<LanguageModelCompletionEvent> {
    this.callCount++;

    // Title generation requests get simple text
    const lastMsg = request.messages[request.messages.length - 1];
    const lastText = lastMsg?.content.find(c => c.type === 'text');
    if (lastText && 'text' in lastText && (lastText.text as string).includes('concise title')) {
      yield { type: 'start_message', messageId: 'title' };
      yield { type: 'text', text: 'Thinking Demo' };
      yield { type: 'stop', reason: 'end_turn' };
      return;
    }

    yield { type: 'start_message', messageId: `think-${this.callCount}` };

    // Emit thinking blocks first
    yield {
      type: 'thinking',
      text: 'Let me think about this carefully...',
      signature: 'sig-abc',
    };
    yield {
      type: 'thinking',
      text: ' I should consider the edge cases.',
    };

    // Then the actual response
    yield { type: 'text', text: 'After careful consideration, ' };
    yield { type: 'text', text: 'here is my answer.' };
    yield { type: 'stop', reason: 'end_turn' };
    yield { type: 'usage_update', usage: { inputTokens: 200, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
  }
}

describe('Thinking events', () => {
  let host: ReturnType<typeof createMockHost>['host'];
  let events: ReturnType<typeof createMockHost>['events'];

  beforeEach(() => {
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
    events = mocked.events;
  });

  it('enables thinking when model supports it', () => {
    const model = new ThinkingMockModel();
    const thread = new Thread({ host, settings, model });
    // Thread should auto-enable thinking for models that support it
    expect(thread.thinkingEnabled).toBe(true);
  });

  it('tracks effort level', () => {
    const model = new ThinkingMockModel();
    const thread = new Thread({ host, settings, model, thinkingEffort: 'high' });
    expect(thread.thinkingEffort).toBe('high');
  });

  it('emits thinking events before text', async () => {
    const model = new ThinkingMockModel();
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Think about this' }]);

    const thinkingEvents = events.getByType('agent_thinking');
    expect(thinkingEvents.length).toBeGreaterThan(0);

    const allThinkingText = thinkingEvents.map(e => e.text).join('');
    expect(allThinkingText).toContain('think about this carefully');
    expect(allThinkingText).toContain('edge cases');

    const textEvents = events.getByType('agent_text');
    expect(textEvents.length).toBeGreaterThan(0);
    const allText = textEvents.map(e => e.text).join('');
    expect(allText).toContain('careful consideration');
  });

  it('stores thinking in message history', async () => {
    const model = new ThinkingMockModel();
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Think' }]);

    const messages = thread.getMessages();
    const agentMsg = messages.find(m => m.type === 'agent');
    expect(agentMsg).toBeDefined();
    if (agentMsg?.type === 'agent') {
      const thinkingContent = agentMsg.message.content.filter(c => c.type === 'thinking');
      expect(thinkingContent.length).toBeGreaterThan(0);
      const textContent = agentMsg.message.content.filter(c => c.type === 'text');
      expect(textContent.length).toBeGreaterThan(0);
    }
  });

  it('serializes thinking in toDb', async () => {
    const model = new ThinkingMockModel();
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Think' }]);

    const db = thread.toDb();
    const agentMsg = db.messages.find(m => m.type === 'agent');
    expect(agentMsg).toBeDefined();
    if (agentMsg?.type === 'agent') {
      const thinking = agentMsg.message.content.filter(c => c.type === 'thinking');
      expect(thinking.length).toBeGreaterThan(0);
    }
  });

  it('replays thinking events', async () => {
    const model = new ThinkingMockModel();
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Think' }]);

    const db = thread.toDb();
    const restored = Thread.fromDb(thread.id, db, { host, settings, model });

    const replayEvents = restored.replay();
    const thinkingEvents = replayEvents.filter(e => e.type === 'agent_thinking');
    expect(thinkingEvents.length).toBeGreaterThan(0);
  });
});
