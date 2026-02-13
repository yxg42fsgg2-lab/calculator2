/**
 * Tests for token budget tracking.
 * Ported from: Thread::tokens_before_message() tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { agentProfileId, userMessageId } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

describe('Token budget tracking', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
  });

  it('returns null for empty thread', () => {
    const thread = new Thread({ host, settings, model });
    expect(thread.latestTokenUsage()).toBeNull();
  });

  it('tracks usage after a message', async () => {
    model.addTextResponse('Hi');
    model.addTextResponse('T');
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Hello' }]);

    const usage = thread.latestTokenUsage();
    expect(usage).not.toBeNull();
    expect(usage!.inputTokens).toBe(100); // From mock model
    expect(usage!.outputTokens).toBe(50);
    expect(usage!.maxTokens).toBe(100_000);
  });

  it('getTokenUsageForMessage returns usage for specific message', async () => {
    model.addTextResponse('First');
    model.addTextResponse('T');
    const thread = new Thread({ host, settings, model });
    const msgId = userMessageId('msg-1');
    await thread.send([{ type: 'text', text: 'Hello' }], msgId);

    const usage = thread.getTokenUsageForMessage(msgId);
    expect(usage).toBeDefined();
    expect(usage!.inputTokens).toBe(100);
  });

  it('getTokenUsageForMessage returns undefined for unknown message', () => {
    const thread = new Thread({ host, settings, model });
    expect(thread.getTokenUsageForMessage(userMessageId('nonexistent'))).toBeUndefined();
  });

  it('getTokensBeforeMessage returns tokens from previous message', async () => {
    model.addTextResponse('R1');
    model.addTextResponse('T');
    const thread = new Thread({ host, settings, model });
    const msg1 = userMessageId('msg-1');
    await thread.send([{ type: 'text', text: 'First' }], msg1);

    model.addTextResponse('R2');
    model.addTextResponse('T');
    const msg2 = userMessageId('msg-2');
    await thread.send([{ type: 'text', text: 'Second' }], msg2);

    const tokensBefore = thread.getTokensBeforeMessage(msg2);
    expect(tokensBefore).toBe(100); // Input tokens from first request
  });

  it('getTokensBeforeMessage returns undefined for first message', async () => {
    model.addTextResponse('R');
    model.addTextResponse('T');
    const thread = new Thread({ host, settings, model });
    const msg1 = userMessageId('msg-1');
    await thread.send([{ type: 'text', text: 'First' }], msg1);

    expect(thread.getTokensBeforeMessage(msg1)).toBeUndefined();
  });

  it('allTokenUsage returns all entries', async () => {
    model.addTextResponse('R1');
    model.addTextResponse('T');
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'First' }]);

    model.addTextResponse('R2');
    model.addTextResponse('T');
    await thread.send([{ type: 'text', text: 'Second' }]);

    const all = thread.allTokenUsage;
    expect(all.size).toBeGreaterThanOrEqual(2);
  });
});
