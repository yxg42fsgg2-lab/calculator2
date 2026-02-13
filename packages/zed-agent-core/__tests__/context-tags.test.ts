/**
 * Tests for context tag formatting in user messages.
 * Ported from: crates/agent/src/thread.rs UserMessage::to_request() tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { agentProfileId, userMessageId } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import type { UserMessageContent } from '../src/types/thread.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

describe('Context tag formatting', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
  });

  function getSystemPromptFromRequest(): string {
    const request = model.receivedRequests[0];
    if (!request) return '';
    const systemMsg = request.messages.find(m => m.role === 'system');
    if (!systemMsg) return '';
    return systemMsg.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('');
  }

  function getUserMessageFromRequest(): string {
    const request = model.receivedRequests[0];
    if (!request) return '';
    const userMsgs = request.messages.filter(m => m.role === 'user');
    const lastUser = userMsgs[userMsgs.length - 1];
    if (!lastUser) return '';
    return lastUser.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('\n');
  }

  it('formats plain text without context tags', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Hello world' }]);

    const userMsg = getUserMessageFromRequest();
    expect(userMsg).toContain('Hello world');
    expect(userMsg).not.toContain('<context>');
  });

  it('formats file mentions with context tags', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });

    const content: UserMessageContent[] = [
      { type: 'text', text: 'What does this do?' },
      {
        type: 'mention',
        uri: { type: 'file', absPath: '/project/src/main.rs' },
        content: 'fn main() {\n  println!("hello");\n}\n',
      },
    ];
    await thread.send(content);

    const userMsg = getUserMessageFromRequest();
    expect(userMsg).toContain('<context>');
    expect(userMsg).toContain('<files>');
    expect(userMsg).toContain('</files>');
    expect(userMsg).toContain('fn main()');
    expect(userMsg).toContain('/project/src/main.rs');
  });

  it('formats directory mentions', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });

    const content: UserMessageContent[] = [
      { type: 'text', text: 'List this' },
      {
        type: 'mention',
        uri: { type: 'directory', absPath: '/project/src' },
        content: 'main.rs\nlib.rs\nutils.rs',
      },
    ];
    await thread.send(content);

    const userMsg = getUserMessageFromRequest();
    expect(userMsg).toContain('<directories>');
    expect(userMsg).toContain('main.rs');
  });

  it('formats symbol mentions', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });

    const content: UserMessageContent[] = [
      { type: 'text', text: 'Explain this function' },
      {
        type: 'mention',
        uri: {
          type: 'symbol',
          absPath: '/project/src/lib.rs',
          symbolName: 'process_data',
          lineRange: [10, 25] as [number, number],
        },
        content: 'fn process_data(input: &str) -> Result<Data> {\n  // ...\n}\n',
      },
    ];
    await thread.send(content);

    const userMsg = getUserMessageFromRequest();
    expect(userMsg).toContain('<symbols>');
    expect(userMsg).toContain('process_data');
  });

  it('formats fetch mentions', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });

    const content: UserMessageContent[] = [
      { type: 'text', text: 'What does this page say?' },
      {
        type: 'mention',
        uri: { type: 'fetch', url: 'https://example.com' },
        content: '# Example Domain\n\nThis is an example.',
      },
    ];
    await thread.send(content);

    const userMsg = getUserMessageFromRequest();
    expect(userMsg).toContain('<fetched_urls>');
    expect(userMsg).toContain('https://example.com');
    expect(userMsg).toContain('Example Domain');
  });

  it('groups multiple mention types correctly', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });

    const content: UserMessageContent[] = [
      { type: 'text', text: 'Review these' },
      {
        type: 'mention',
        uri: { type: 'file', absPath: '/project/a.rs' },
        content: 'fn a() {}',
      },
      {
        type: 'mention',
        uri: { type: 'file', absPath: '/project/b.rs' },
        content: 'fn b() {}',
      },
      {
        type: 'mention',
        uri: { type: 'directory', absPath: '/project/tests' },
        content: 'test_a.rs\ntest_b.rs',
      },
    ];
    await thread.send(content);

    const userMsg = getUserMessageFromRequest();
    // Should have both file and directory tags
    expect(userMsg).toContain('<files>');
    expect(userMsg).toContain('<directories>');
    expect(userMsg).toContain('</context>');
    // Should have both files
    expect(userMsg).toContain('fn a()');
    expect(userMsg).toContain('fn b()');
  });
});
