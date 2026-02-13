/**
 * Tests for the ThreadsDatabase.
 * Ported from: crates/agent/src/agent.rs test_save_load_thread
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadsDatabase } from '../src/persistence/threads-database.js';
import { sessionId, userMessageId } from '../src/types/branded.js';
import { emptyTokenUsage } from '../src/types/language-model.js';
import type { DbThread, Message } from '../src/types/thread.js';

describe('ThreadsDatabase', () => {
  let db: ThreadsDatabase;

  beforeEach(() => {
    db = new ThreadsDatabase(); // in-memory
  });

  afterEach(() => {
    db.close();
  });

  function makeThread(overrides: Partial<DbThread> = {}): DbThread {
    return {
      title: 'Test Thread',
      messages: [],
      updatedAt: new Date().toISOString(),
      cumulativeTokenUsage: emptyTokenUsage(),
      requestTokenUsage: new Map(),
      imported: false,
      ...overrides,
    };
  }

  it('saves and loads a thread', () => {
    const id = sessionId('test-1');
    const thread = makeThread({ title: 'Hello World' });
    db.saveThread(id, thread);

    const loaded = db.loadThread(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe('Hello World');
  });

  it('preserves messages', () => {
    const id = sessionId('test-2');
    const msgId = userMessageId('msg-1');
    const messages: Message[] = [
      {
        type: 'user',
        message: {
          id: msgId,
          content: [{ type: 'text', text: 'Hello' }],
        },
      },
      {
        type: 'agent',
        message: {
          content: [{ type: 'text', text: 'Hi there!' }],
          toolResults: new Map(),
        },
      },
    ];

    const thread = makeThread({ messages });
    db.saveThread(id, thread);

    const loaded = db.loadThread(id);
    expect(loaded!.messages.length).toBe(2);
    expect(loaded!.messages[0]!.type).toBe('user');
    expect(loaded!.messages[1]!.type).toBe('agent');
  });

  it('preserves model info', () => {
    const id = sessionId('test-3');
    const thread = makeThread({
      model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    });
    db.saveThread(id, thread);

    const loaded = db.loadThread(id);
    expect(loaded!.model).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('lists threads ordered by updated_at', () => {
    db.saveThread(sessionId('old'), makeThread({
      title: 'Old Thread',
      updatedAt: '2024-01-01T00:00:00Z',
    }));
    db.saveThread(sessionId('new'), makeThread({
      title: 'New Thread',
      updatedAt: '2025-01-01T00:00:00Z',
    }));

    const list = db.listThreads();
    expect(list.length).toBe(2);
    expect(list[0]!.title).toBe('New Thread');
    expect(list[1]!.title).toBe('Old Thread');
  });

  it('deletes a thread', () => {
    const id = sessionId('del-1');
    db.saveThread(id, makeThread());
    expect(db.count()).toBe(1);

    db.deleteThread(id);
    expect(db.count()).toBe(0);
    expect(db.loadThread(id)).toBeNull();
  });

  it('deletes all threads', () => {
    db.saveThread(sessionId('a'), makeThread());
    db.saveThread(sessionId('b'), makeThread());
    db.saveThread(sessionId('c'), makeThread());
    expect(db.count()).toBe(3);

    db.deleteAllThreads();
    expect(db.count()).toBe(0);
  });

  it('returns null for non-existent thread', () => {
    expect(db.loadThread(sessionId('nope'))).toBeNull();
  });

  it('updates thread on re-save', () => {
    const id = sessionId('update-1');
    db.saveThread(id, makeThread({ title: 'Version 1' }));
    db.saveThread(id, makeThread({ title: 'Version 2' }));

    expect(db.count()).toBe(1);
    const loaded = db.loadThread(id);
    expect(loaded!.title).toBe('Version 2');
  });

  it('preserves token usage', () => {
    const id = sessionId('tokens-1');
    const msgId = userMessageId('msg-1');
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 5,
    };
    const thread = makeThread({
      cumulativeTokenUsage: usage,
      requestTokenUsage: new Map([[msgId, usage]]),
    });

    db.saveThread(id, thread);
    const loaded = db.loadThread(id);
    expect(loaded!.cumulativeTokenUsage).toEqual(usage);
  });
});
