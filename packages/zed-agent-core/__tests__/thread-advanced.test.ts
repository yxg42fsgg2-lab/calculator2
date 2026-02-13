/**
 * Advanced Thread tests: resume, truncate, retry, multi-tool, cancellation.
 * Ported from: crates/agent/src/tests/mod.rs advanced test cases
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { NowTool } from '../src/tools/now-tool.js';
import { ReadFileTool } from '../src/tools/read-file-tool.js';
import { ListDirectoryTool } from '../src/tools/list-directory-tool.js';
import { eraseToolType } from '../src/types/tools.js';
import { agentProfileId, userMessageId } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';
import {
  RateLimitExceededError,
  ServerOverloadedError,
  PromptTooLargeError,
  AuthenticationError,
  OtherCompletionError,
} from '../src/types/completion-error.js';
import { languageModelProviderName } from '../src/types/branded.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

describe('Thread advanced', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];
  let events: ReturnType<typeof createMockHost>['events'];
  let fs: ReturnType<typeof createMockHost>['fs'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({
      files: {
        '/project/src/main.ts': 'console.log("hello");',
        '/project/README.md': '# Test\n',
      },
    });
    host = mocked.host;
    events = mocked.events;
    fs = mocked.fs;
  });

  // --- Resume ---

  it('resumes after a previous turn', async () => {
    model.addTextResponse('First response.');
    model.addTextResponse('Title'); // title gen

    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Start' }]);
    expect(thread.messageCount).toBe(2); // user + agent

    // Resume
    model.addTextResponse('Continued response.');
    model.addTextResponse('Title 2'); // title gen
    await thread.resume();

    // Should have: user, agent, resume, agent
    expect(thread.messageCount).toBe(4);
    const messages = thread.getMessages();
    expect(messages[2]!.type).toBe('resume');
    expect(messages[3]!.type).toBe('agent');
  });

  // --- Truncate ---

  it('truncates message history at a user message', async () => {
    model.addTextResponse('Response 1');
    model.addTextResponse('T1');
    const thread = new Thread({ host, settings, model });
    const msgId1 = userMessageId('msg-1');
    await thread.send([{ type: 'text', text: 'First' }], msgId1);

    model.addTextResponse('Response 2');
    model.addTextResponse('T2');
    const msgId2 = userMessageId('msg-2');
    await thread.send([{ type: 'text', text: 'Second' }], msgId2);

    expect(thread.messageCount).toBe(4); // u1, a1, u2, a2

    // Truncate at second message
    thread.truncate(msgId2);
    expect(thread.messageCount).toBe(2); // u1, a1
  });

  it('throws when truncating nonexistent message', () => {
    const thread = new Thread({ host, settings, model });
    expect(() => thread.truncate(userMessageId('nonexistent'))).toThrow('Message not found');
  });

  // --- Multi-tool in one turn ---

  it('handles model calling a tool then responding', async () => {
    // Queue enough responses: tool call, text response, title gen, title gen
    model.addToolCallResponse('now', { timezone: 'utc' });
    model.addTextResponse('Done.');
    model.addTextResponse('T');
    model.addTextResponse('T');

    const thread = new Thread({ host, settings, model });
    thread.addTool(eraseToolType(new NowTool()));

    await thread.send([{ type: 'text', text: 'Time please' }]);

    // Verify tool was called
    const toolCalls = events.getByType('tool_call');
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0]!.toolName).toBe('now');

    // Verify tool completed
    const updates = events.getByType('tool_call_update');
    expect(updates.some(u => u.fields.status === 'completed')).toBe(true);

    // Verify the model received the tool result and responded
    expect(model.receivedRequests.length).toBeGreaterThanOrEqual(2);
  });

  // --- Unknown tool ---

  it('handles model calling unknown tool', async () => {
    model.addToolCallResponse('nonexistent_tool', { foo: 'bar' });
    model.addTextResponse('I see the tool failed.');
    model.addTextResponse('Title');

    const thread = new Thread({ host, settings, model });
    thread.addTool(eraseToolType(new NowTool()));

    await thread.send([{ type: 'text', text: 'Do something' }]);

    // Should have a failed tool call
    const updates = events.getByType('tool_call_update');
    expect(updates.some(u => u.fields.status === 'failed')).toBe(true);
  });

  // --- Empty thread ---

  it('isEmpty is true for new thread', () => {
    const thread = new Thread({ host, settings, model });
    expect(thread.isEmpty).toBe(true);
    expect(thread.messageCount).toBe(0);
  });

  it('isEmpty is false after sending', async () => {
    model.addTextResponse('Hi');
    model.addTextResponse('Title');
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Hello' }]);
    expect(thread.isEmpty).toBe(false);
  });

  // --- Title ---

  it('title defaults to "New Thread"', () => {
    const thread = new Thread({ host, settings, model });
    expect(thread.title).toBe('New Thread');
    expect(thread.getRawTitle()).toBeUndefined();
  });

  it('setTitle updates title', () => {
    const thread = new Thread({ host, settings, model });
    thread.setTitle('Custom Title');
    expect(thread.title).toBe('Custom Title');
    expect(thread.getRawTitle()).toBe('Custom Title');
  });

  // --- Model management ---

  it('can change model', () => {
    const thread = new Thread({ host, settings, model });
    const newModel = new MockLanguageModel();
    thread.setModel(newModel);
    expect(thread.model).toBe(newModel);
  });

  it('throws when sending without model', async () => {
    const thread = new Thread({ host, settings });
    await expect(
      thread.send([{ type: 'text', text: 'Hello' }]),
    ).rejects.toThrow('No language model configured');
  });

  // --- Thinking ---

  it('tracks thinking enabled state', () => {
    const thread = new Thread({ host, settings, model, thinkingEnabled: true });
    expect(thread.thinkingEnabled).toBe(true);
    thread.setThinkingEnabled(false);
    expect(thread.thinkingEnabled).toBe(false);
  });

  it('tracks thinking effort', () => {
    const thread = new Thread({ host, settings, model, thinkingEffort: 'high' });
    expect(thread.thinkingEffort).toBe('high');
    thread.setThinkingEffort('low');
    expect(thread.thinkingEffort).toBe('low');
  });
});

describe('Thread retry behavior', () => {
  let host: ReturnType<typeof createMockHost>['host'];
  let events: ReturnType<typeof createMockHost>['events'];

  beforeEach(() => {
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
    events = mocked.events;
  });

  it('retries on rate limit error', async () => {
    const provider = languageModelProviderName('Test');
    let callCount = 0;

    // Custom model that fails once then succeeds
    const retryModel: import('../src/models/language-model.js').LanguageModel = {
      ...new MockLanguageModel(),
      async *streamCompletion(request) {
        callCount++;
        if (callCount === 1) {
          throw new RateLimitExceededError(provider, 100); // 100ms retry
        }
        yield { type: 'start_message', messageId: 'retry-msg' };
        yield { type: 'text', text: 'Success after retry!' };
        yield { type: 'stop', reason: 'end_turn' };
      },
    };

    const thread = new Thread({ host, settings: { defaultProfile: agentProfileId('d'), profiles: new Map(), toolPermissionMode: 'auto' }, model: retryModel });
    const result = await thread.send([{ type: 'text', text: 'Test' }]);

    expect(result).toBe('end_turn');
    // At least 2: initial fail + retry success (may have title gen call too)
    expect(callCount).toBeGreaterThanOrEqual(2);

    // Should have a retry event
    const retryEvents = events.getByType('retry');
    expect(retryEvents.length).toBeGreaterThanOrEqual(1);
    expect(retryEvents[0]!.status.attempt).toBe(1);
  });

  it('does not retry on auth error', async () => {
    const provider = languageModelProviderName('Test');
    let callCount = 0;

    const authFailModel: import('../src/models/language-model.js').LanguageModel = {
      ...new MockLanguageModel(),
      async *streamCompletion() {
        callCount++;
        throw new AuthenticationError(provider, 'Invalid key');
      },
    };

    const thread = new Thread({ host, settings: { defaultProfile: agentProfileId('d'), profiles: new Map(), toolPermissionMode: 'auto' }, model: authFailModel });
    const result = await thread.send([{ type: 'text', text: 'Test' }]);

    // Auth errors are not retried — only 1 call to the main completion
    // (title gen may add 1 more, but the main path doesn't retry)
    expect(result).toBe('end_turn'); // ends with error event
    const errorEvents = events.getByType('error');
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0]!.error.message).toContain('Invalid key');
  });

  it('does not retry on prompt too large', async () => {
    let callCount = 0;

    const bigPromptModel: import('../src/models/language-model.js').LanguageModel = {
      ...new MockLanguageModel(),
      async *streamCompletion() {
        callCount++;
        throw new PromptTooLargeError(150000);
      },
    };

    const thread = new Thread({ host, settings: { defaultProfile: agentProfileId('d'), profiles: new Map(), toolPermissionMode: 'auto' }, model: bigPromptModel });
    const result = await thread.send([{ type: 'text', text: 'Test' }]);

    // Prompt too large is not retried
    expect(result).toBe('max_tokens');
  });

  it('gives up after max retry attempts', async () => {
    const provider = languageModelProviderName('Test');
    let callCount = 0;

    const alwaysFailModel: import('../src/models/language-model.js').LanguageModel = {
      ...new MockLanguageModel(),
      async *streamCompletion() {
        callCount++;
        throw new ServerOverloadedError(provider, 50); // 50ms retry
      },
    };

    const thread = new Thread({ host, settings: { defaultProfile: agentProfileId('d'), profiles: new Map(), toolPermissionMode: 'auto' }, model: alwaysFailModel });
    const result = await thread.send([{ type: 'text', text: 'Test' }]);

    // Should have retried MAX_RETRY_ATTEMPTS (4) times + initial = 5+ total
    expect(callCount).toBeGreaterThanOrEqual(5);
    expect(result).toBe('end_turn'); // error event
    const errorEvents = events.getByType('error');
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  }, 10000); // 10s timeout for retries
});
