/**
 * Integration tests for AgentSession.
 * Ported from: crates/agent/src/agent.rs tests (session lifecycle, persistence)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentSession, createAgentSession } from '../src/session/agent-session.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';
import type { AgentEvent } from '../src/types/events.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

describe('AgentSession', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];
  let events: ReturnType<typeof createMockHost>['events'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({
      files: {
        '/project/hello.txt': 'Hello World',
      },
    });
    host = mocked.host;
    events = mocked.events;
  });

  it('creates a session with createAgentSession factory', () => {
    const session = createAgentSession(host, { model });
    expect(session).toBeInstanceOf(AgentSession);
  });

  it('creates threads', () => {
    const session = createAgentSession(host, { model });
    const thread = session.createThread();
    expect(thread).toBeDefined();
    expect(thread.isEmpty).toBe(true);
  });

  it('sends messages via convenience method', async () => {
    model.addTextResponse('Hello!');
    model.addTextResponse('Chat title'); // For title generation
    const session = createAgentSession(host, { model });
    const result = await session.send('Hi there');
    expect(result).toBe('end_turn');

    const textEvents = events.getByType('agent_text');
    expect(textEvents.length).toBeGreaterThan(0);
  });

  it('manages multiple threads', () => {
    const session = createAgentSession(host, { model });
    const t1 = session.createThread();
    const t2 = session.createThread();

    expect(session.listThreads().length).toBe(0); // Empty threads not listed
    expect(session.getThread(t1.id)).toBeDefined();
    expect(session.getThread(t2.id)).toBeDefined();
  });

  it('closes threads', async () => {
    model.addTextResponse('Response');
    const session = createAgentSession(host, { model });
    const thread = session.createThread();
    await session.send('Hello', { threadId: thread.id });

    session.closeThread(thread.id);
    expect(session.getThread(thread.id)).toBeUndefined();
  });

  it('switches models', () => {
    const session = createAgentSession(host, { model });
    const newModel = new MockLanguageModel();
    session.setModel(newModel);
    expect(session.getModel()).toBe(newModel);
  });

  it('registers 18 tools (17 default + subagent)', () => {
    const session = createAgentSession(host, { model });
    const thread = session.createThread();
    const names = thread.registeredToolNames();
    // 17 default + 1 subagent (auto-wired since depth=0 < MAX_SUBAGENT_DEPTH)
    expect(names.length).toBe(18);
    expect(names).toContain('read_file');
    expect(names).toContain('terminal');
    expect(names).toContain('edit_file');
    expect(names).toContain('subagent');
  });

  it('cancels active thread', async () => {
    model.addTextResponse('Response');
    const session = createAgentSession(host, { model });

    const sendPromise = session.send('Hello');
    await new Promise(r => setTimeout(r, 0));
    session.cancel();
    await sendPromise;
    // Should not throw
  });
});

describe('AgentSession with persistence', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];
  let events: ReturnType<typeof createMockHost>['events'];
  let dbPath: string;

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
    events = mocked.events;
    dbPath = path.join(os.tmpdir(), `zed-agent-test-${Date.now()}.db`);
  });

  afterEach(() => {
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('persists threads to database', async () => {
    model.addTextResponse('Response 1');
    const session = createAgentSession(host, {
      model,
      databasePath: dbPath,
    });

    await session.send('Hello');

    // Check the thread was saved
    const list = session.listThreads();
    expect(list.length).toBe(1);

    session.close();
  });

  it('loads threads from database across sessions', async () => {
    // Session 1: create and send
    model.addTextResponse('Response from session 1');
    model.addTextResponse('Title'); // For title generation
    const session1 = createAgentSession(host, {
      model,
      databasePath: dbPath,
    });
    const thread = session1.getOrCreateActiveThread();
    await thread.send([{ type: 'text', text: 'Hello from session 1' }]);
    // Wait for async title generation
    await new Promise(r => setTimeout(r, 50));
    // Verify messages before save
    expect(thread.messageCount).toBeGreaterThanOrEqual(2); // user + agent (+ possibly resume from title gen)
    // Explicitly save
    session1.saveThread(thread);
    const threads1 = session1.listThreads();
    expect(threads1.length).toBe(1);
    const threadId = threads1[0]!.id;
    session1.close();

    // Session 2: load the thread
    const session2 = createAgentSession(host, {
      model,
      databasePath: dbPath,
    });
    const threads2 = session2.listThreads();
    expect(threads2.length).toBe(1);
    expect(threads2[0]!.id).toBe(threadId);

    // Load and verify content
    const loadedThread = session2.getThread(threadId);
    expect(loadedThread).toBeDefined();
    expect(loadedThread!.messageCount).toBeGreaterThanOrEqual(2); // user + agent

    session2.close();
  });

  it('deletes threads from database', async () => {
    model.addTextResponse('Will be deleted');
    const session = createAgentSession(host, {
      model,
      databasePath: dbPath,
    });
    await session.send('Hello');
    const threads = session.listThreads();
    expect(threads.length).toBe(1);

    session.deleteThread(threads[0]!.id);
    expect(session.listThreads().length).toBe(0);
    session.close();
  });

  it('deletes all threads', async () => {
    model.addTextResponse('A');
    const session = createAgentSession(host, {
      model,
      databasePath: dbPath,
    });
    await session.send('First');

    // Create another thread
    model.addTextResponse('B');
    const t2 = session.createThread();
    await t2.send([{ type: 'text', text: 'Second' }]);

    expect(session.listThreads().length).toBe(2);
    session.deleteAllThreads();
    expect(session.listThreads().length).toBe(0);
    session.close();
  });
});
