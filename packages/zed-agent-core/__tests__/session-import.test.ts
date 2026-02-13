/**
 * Tests for AgentSession.importThread().
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createAgentSession } from '../src/session/agent-session.js';
import { exportThread, type ThreadExport } from '../src/thread/export.js';
import { Thread } from '../src/thread/thread.js';
import { agentProfileId } from '../src/types/branded.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

describe('AgentSession.importThread', () => {
  let dbPath: string | undefined;

  afterEach(() => {
    if (dbPath) {
      try { fs.unlinkSync(dbPath); } catch {}
      try { fs.unlinkSync(dbPath + '-wal'); } catch {}
      try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    }
  });

  it('imports a thread from export data', () => {
    const model = new MockLanguageModel();
    const { host } = createMockHost({ files: {} });

    const exportData: ThreadExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      metadata: {
        id: 'imported-thread-1',
        title: 'Imported Conversation',
        updatedAt: new Date().toISOString(),
      },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello from import' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Welcome back!' }] },
      ],
    };

    const session = createAgentSession(host, { model });
    const thread = session.importThread(exportData);

    expect(thread).toBeDefined();
    expect(thread.title).toBe('Imported Conversation');
    expect(thread.messageCount).toBe(2);
    expect(thread.registeredToolNames().length).toBeGreaterThan(0); // Tools registered

    session.close();
  });

  it('imported thread can be continued', async () => {
    const model = new MockLanguageModel();
    model.addTextResponse('Continuing the conversation.');
    model.addTextResponse('Title');
    const { host } = createMockHost({ files: {} });

    const exportData: ThreadExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      metadata: { id: 'cont-1', title: 'To Continue', updatedAt: new Date().toISOString() },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Start' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Ok.' }] },
      ],
    };

    const session = createAgentSession(host, { model });
    const thread = session.importThread(exportData);
    const before = thread.messageCount;

    await thread.send([{ type: 'text', text: 'Continue please' }]);
    expect(thread.messageCount).toBeGreaterThan(before);

    session.close();
  });

  it('imported thread persists to database', async () => {
    dbPath = path.join(os.tmpdir(), `import-test-${Date.now()}.db`);
    const model = new MockLanguageModel();
    const { host } = createMockHost({ files: {} });

    const exportData: ThreadExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      metadata: { id: 'persist-1', title: 'Persisted Import', updatedAt: new Date().toISOString() },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Saved message' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Saved response.' }] },
      ],
    };

    const session1 = createAgentSession(host, { model, databasePath: dbPath });
    session1.importThread(exportData);
    session1.close();

    // Reopen and verify
    const session2 = createAgentSession(host, { model, databasePath: dbPath });
    const list = session2.listThreads();
    expect(list.length).toBe(1);
    expect(list[0]!.title).toBe('Persisted Import');
    session2.close();
  });

  it('round-trips through export → import', async () => {
    const model = new MockLanguageModel();
    model.addTextResponse('Original response');
    model.addTextResponse('Title');
    const { host } = createMockHost({ files: {} });

    // Create original thread
    const session1 = createAgentSession(host, { model });
    const original = session1.createThread();
    await original.send([{ type: 'text', text: 'Original message' }]);

    // Export
    const exported = exportThread(original);
    session1.close();

    // Import into new session
    const session2 = createAgentSession(host, { model });
    const imported = session2.importThread(exported);

    expect(imported.messageCount).toBe(original.messageCount);
    expect(imported.toMarkdown()).toBe(original.toMarkdown());

    session2.close();
  });
});
