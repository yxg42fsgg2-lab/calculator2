/**
 * Tests for Thread.toMarkdown() conversation export.
 * Ported from: crates/agent/src/thread.rs to_markdown tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { agentProfileId } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

describe('Thread.toMarkdown', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
  });

  it('exports empty thread as empty string', () => {
    const thread = new Thread({ host, settings, model });
    expect(thread.toMarkdown()).toBe('');
  });

  it('exports single exchange', async () => {
    model.addTextResponse('Hello! How can I help?');
    model.addTextResponse('Title');

    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Hi there' }]);

    const md = thread.toMarkdown();
    expect(md).toContain('## User');
    expect(md).toContain('Hi there');
    expect(md).toContain('## Assistant');
    expect(md).toContain('Hello! How can I help?');
  });

  it('exports multi-turn conversation', async () => {
    model.addTextResponse('First response.');
    model.addTextResponse('T');
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'First message' }]);

    model.addTextResponse('Second response.');
    model.addTextResponse('T');
    await thread.send([{ type: 'text', text: 'Second message' }]);

    const md = thread.toMarkdown();

    // Should have two user sections and two assistant sections
    const userSections = md.split('## User').length - 1;
    const assistantSections = md.split('## Assistant').length - 1;
    expect(userSections).toBe(2);
    expect(assistantSections).toBe(2);

    expect(md).toContain('First message');
    expect(md).toContain('First response.');
    expect(md).toContain('Second message');
    expect(md).toContain('Second response.');
  });

  it('exports mentions with links', async () => {
    model.addTextResponse('I see the file.');
    model.addTextResponse('T');

    const thread = new Thread({ host, settings, model });
    await thread.send([
      { type: 'text', text: 'What about this?' },
      {
        type: 'mention',
        uri: { type: 'file', absPath: '/project/main.rs' },
        content: 'fn main() {}',
      },
    ]);

    const md = thread.toMarkdown();
    expect(md).toContain('main.rs');
    expect(md).toContain('fn main() {}');
  });

  it('exports images as placeholder', async () => {
    model.addTextResponse('I see an image.');
    model.addTextResponse('T');

    const thread = new Thread({ host, settings, model });
    await thread.send([
      { type: 'text', text: 'Look at this' },
      { type: 'image', image: { source: 'base64data' } },
    ]);

    const md = thread.toMarkdown();
    expect(md).toContain('<image />');
  });

  it('round-trips through toDb/fromDb', async () => {
    model.addTextResponse('Response content.');
    model.addTextResponse('T');

    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Original message' }]);

    const originalMd = thread.toMarkdown();

    // Save and restore
    const db = thread.toDb();
    const restored = Thread.fromDb(thread.id, db, { host, settings, model });

    const restoredMd = restored.toMarkdown();
    expect(restoredMd).toBe(originalMd);
  });
});
