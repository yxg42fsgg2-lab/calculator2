/**
 * Tests for thread export/import.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import {
  exportThread,
  importThread,
  exportThreadToJson,
  importThreadFromJson,
} from '../src/thread/export.js';
import type { ThreadExport } from '../src/thread/export.js';
import { agentProfileId } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

describe('Thread export', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
  });

  it('exports an empty thread', () => {
    const thread = new Thread({ host, settings, model });
    const exported = exportThread(thread);

    expect(exported.version).toBe(1);
    expect(exported.messages).toEqual([]);
    expect(exported.metadata.title).toBe('New Thread');
    expect(exported.exportedAt).toBeTruthy();
  });

  it('exports a conversation', async () => {
    model.addTextResponse('Hello back!');
    model.addTextResponse('Title');

    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Hello' }]);

    const exported = exportThread(thread);
    expect(exported.messages.length).toBeGreaterThanOrEqual(2);

    const userMsg = exported.messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content.some(c => c.type === 'text' && c.text.includes('Hello'))).toBe(true);

    const assistantMsg = exported.messages.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
  });

  it('includes model info', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('t');

    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'test' }]);

    const exported = exportThread(thread);
    expect(exported.metadata.model).toBeDefined();
    expect(exported.metadata.model!.provider).toBe('mock');
    expect(exported.metadata.model!.model).toBe('mock');
  });

  it('exports to JSON string', async () => {
    model.addTextResponse('response');
    model.addTextResponse('t');

    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'hello' }]);

    const json = exportThreadToJson(thread);
    expect(typeof json).toBe('string');
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.messages.length).toBeGreaterThan(0);
  });
});

describe('Thread import', () => {
  it('imports a minimal export', () => {
    const data: ThreadExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      metadata: {
        id: 'test-id',
        title: 'Test Thread',
        updatedAt: new Date().toISOString(),
      },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
      ],
    };

    const result = importThread(data);
    expect(result.title).toBe('Test Thread');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.type).toBe('user');
    expect(result.messages[1]!.type).toBe('agent');
  });

  it('imports resume messages', () => {
    const data: ThreadExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      metadata: { id: 'x', title: 'T', updatedAt: '' },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Start' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Ok' }] },
        { role: 'resume' },
        { role: 'assistant', content: [{ type: 'text', text: 'Continuing' }] },
      ],
    };

    const result = importThread(data);
    expect(result.messages).toHaveLength(4);
    expect(result.messages[2]!.type).toBe('resume');
  });

  it('round-trips through JSON', async () => {
    const model = new MockLanguageModel();
    model.addTextResponse('World');
    model.addTextResponse('T');

    const { host } = createMockHost({ files: {} });
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Hello' }]);

    const json = exportThreadToJson(thread);
    const imported = importThreadFromJson(json);

    expect(imported.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects unknown version', () => {
    const data = { version: 99, exportedAt: '', metadata: { id: 'x', title: '', updatedAt: '' }, messages: [] } as unknown as ThreadExport;
    expect(() => importThread(data)).toThrow('Unsupported thread export version');
  });

  it('handles thinking content', () => {
    const data: ThreadExport = {
      version: 1,
      exportedAt: '',
      metadata: { id: 'x', title: 'T', updatedAt: '' },
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'Let me consider...' },
            { type: 'text', text: 'Here is my answer.' },
          ],
        },
      ],
    };

    const result = importThread(data);
    const agent = result.messages[0];
    expect(agent!.type).toBe('agent');
    if (agent!.type === 'agent') {
      expect(agent!.message.content.some(c => c.type === 'thinking')).toBe(true);
      expect(agent!.message.content.some(c => c.type === 'text')).toBe(true);
    }
  });
});
