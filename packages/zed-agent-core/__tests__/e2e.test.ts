/**
 * Full-stack end-to-end test.
 * Exercises the complete flow: session → thread → tools → persist → reload → replay → export.
 *
 * This is the single test that proves the entire library works together.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createAgentSession,
  Thread,
  loadSettingsFromJson,
  eraseToolType,
  type AgentEvent,
  type UserMessageContent,
} from '../src/index.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

describe('End-to-end', () => {
  let dbPath: string;

  afterEach(() => {
    if (dbPath) {
      try { fs.unlinkSync(dbPath); } catch {}
      try { fs.unlinkSync(dbPath + '-wal'); } catch {}
      try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    }
  });

  it('complete lifecycle: create → send → tool → persist → reload → replay → export', async () => {
    dbPath = path.join(os.tmpdir(), `zed-e2e-${Date.now()}.db`);

    // --- Step 1: Set up model with scripted responses ---
    // Response queue order matters: title gen fires async after first completion.
    // Flow: tool_call → title_gen → text_response → title_gen
    const model = new MockLanguageModel();
    model.addToolCallResponse('read_file', { path: 'project/hello.txt' }); // 1st: tool call
    model.addTextResponse('File Discussion'); // 2nd: consumed by title gen (async)
    model.addTextResponse('The file says hello!'); // 3rd: response after tool result
    model.addTextResponse('T'); // 4th: title gen after 2nd turn (if needed)

    const { host, events, fs: mockFs } = createMockHost({
      files: {
        '/project/hello.txt': 'Hello, World!\n',
        '/project/src/main.ts': 'console.log("hi");\n',
      },
    });

    // --- Step 2: Load settings from JSON (like a real config file) ---
    const settings = loadSettingsFromJson(JSON.stringify({
      agent: {
        default_model: { provider: 'mock', model: 'mock' },
        tool_permission_mode: 'auto',
      },
    }));

    // --- Step 3: Create session with persistence ---
    const session = createAgentSession(host, {
      model,
      settings,
      databasePath: dbPath,
    });

    // --- Step 4: Send a message (triggers tool call + response) ---
    const thread = session.getOrCreateActiveThread();
    const threadId = thread.id;

    // Verify 18 tools registered (17 default + subagent)
    expect(thread.registeredToolNames().length).toBe(18);
    expect(thread.registeredToolNames()).toContain('read_file');
    expect(thread.registeredToolNames()).toContain('subagent');

    const stopReason = await thread.send([
      { type: 'text', text: 'Read the hello.txt file and tell me what it says' },
    ]);
    expect(stopReason).toBe('end_turn');

    // --- Step 5: Verify events were emitted ---
    const userMsgEvents = events.getByType('user_message');
    expect(userMsgEvents.length).toBe(1);

    const toolCallEvents = events.getByType('tool_call');
    expect(toolCallEvents.length).toBe(1);
    expect(toolCallEvents[0]!.toolName).toBe('read_file');

    const toolUpdateEvents = events.getByType('tool_call_update');
    expect(toolUpdateEvents.some(e => e.fields.status === 'completed')).toBe(true);

    const textEvents = events.getByType('agent_text');
    const allText = textEvents.map(e => e.text).join('');
    expect(allText).toContain('hello');

    const stopEvents = events.getByType('stop');
    expect(stopEvents.length).toBeGreaterThanOrEqual(1);

    // --- Step 6: Verify thread state ---
    expect(thread.messageCount).toBeGreaterThanOrEqual(2); // user + agent (+ tool messages)
    expect(thread.isTurnComplete).toBe(true);
    expect(thread.isEmpty).toBe(false);

    // --- Step 7: Verify token usage ---
    const usage = thread.latestTokenUsage();
    expect(usage).not.toBeNull();
    expect(usage!.inputTokens).toBeGreaterThan(0);

    // --- Step 8: Explicitly save and verify persistence ---
    session.saveThread(thread);
    const threadList = session.listThreads();
    expect(threadList.length).toBe(1);
    expect(threadList[0]!.id).toEqual(threadId);

    // --- Step 9: Export as markdown ---
    const markdown = thread.toMarkdown();
    expect(markdown).toContain('## User');
    expect(markdown).toContain('## Assistant');
    expect(markdown).toContain('hello.txt');

    // --- Step 10: Close and reopen ---
    session.close();

    // --- Step 11: Reload from fresh session ---
    const session2 = createAgentSession(host, {
      model,
      settings,
      databasePath: dbPath,
    });

    // Thread should be listed
    const list2 = session2.listThreads();
    expect(list2.length).toBe(1);
    expect(list2[0]!.id).toEqual(threadId);

    // Load the thread
    const reloadedThread = session2.getThread(threadId);
    expect(reloadedThread).toBeDefined();
    expect(reloadedThread!.messageCount).toBeGreaterThanOrEqual(2);

    // --- Step 12: Replay events ---
    const replayEvents = reloadedThread!.replay();
    expect(replayEvents.length).toBeGreaterThanOrEqual(2);
    expect(replayEvents.some(e => e.type === 'user_message')).toBe(true);
    expect(replayEvents.some(e => e.type === 'agent_text')).toBe(true);

    // --- Step 13: Export reloaded thread markdown matches ---
    const reloadedMarkdown = reloadedThread!.toMarkdown();
    expect(reloadedMarkdown).toBe(markdown);

    // --- Step 14: Continue the conversation in the reloaded thread ---
    model.addTextResponse('Sure, the source code logs "hi".');
    model.addTextResponse('T2');
    await reloadedThread!.send([
      { type: 'text', text: 'What about main.ts?' },
    ]);
    expect(reloadedThread!.messageCount).toBeGreaterThan(thread.messageCount);

    // --- Step 15: Clean up ---
    session2.close();
  });

  it('handles multi-thread session with different models', async () => {
    dbPath = path.join(os.tmpdir(), `zed-e2e-multi-${Date.now()}.db`);

    const model1 = new MockLanguageModel();
    model1.addTextResponse('Response from model 1');
    model1.addTextResponse('T1');

    const model2 = new MockLanguageModel();
    model2.addTextResponse('Response from model 2');
    model2.addTextResponse('T2');

    const { host, events } = createMockHost({ files: {} });

    const session = createAgentSession(host, {
      model: model1,
      databasePath: dbPath,
    });

    // Thread 1 with model 1
    const t1 = session.createThread();
    await t1.send([{ type: 'text', text: 'Hello thread 1' }]);

    // Switch model and create thread 2
    session.setModel(model2);
    const t2 = session.createThread();
    await t2.send([{ type: 'text', text: 'Hello thread 2' }]);

    // Both threads should exist
    expect(session.listThreads().length).toBe(2);

    // Delete thread 1
    session.deleteThread(t1.id);
    expect(session.listThreads().length).toBe(1);

    session.close();
  });

  it('settings-driven tool filtering works end-to-end', async () => {
    const model = new MockLanguageModel();
    model.addTextResponse('ok');
    model.addTextResponse('T');

    const { host } = createMockHost({ files: {} });

    const settings = loadSettingsFromJson(JSON.stringify({
      agent: {
        tool_permission_mode: 'auto',
        profiles: {
          restricted: {
            tools: {
              terminal: false,
              web_search: false,
              delete_path: false,
            },
          },
        },
        default_profile: 'restricted',
      },
    }));

    const session = createAgentSession(host, { model, settings });
    const thread = session.createThread();

    // Tools should be registered but filtered in request
    await thread.send([{ type: 'text', text: 'test' }]);

    const request = model.receivedRequests[0]!;
    const toolNames = request.tools.map(t => t.name);

    // These should be filtered out by the profile
    expect(toolNames).not.toContain('terminal');
    expect(toolNames).not.toContain('web_search');
    expect(toolNames).not.toContain('delete_path');

    // These should still be present
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('grep');
    expect(toolNames).toContain('now');

    session.close();
  });
});
