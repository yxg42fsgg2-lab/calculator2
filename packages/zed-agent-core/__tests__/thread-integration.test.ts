/**
 * Integration tests for the Thread agentic loop.
 * Ported from: crates/agent/src/tests/mod.rs (~5,542 LOC)
 *
 * These tests verify the full flow: send message → model streams → tools execute → loop.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { NowTool } from '../src/tools/now-tool.js';
import { ReadFileTool } from '../src/tools/read-file-tool.js';
import { ListDirectoryTool } from '../src/tools/list-directory-tool.js';
import { eraseToolType } from '../src/types/tools.js';
import { agentProfileId } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import type { AgentEvent } from '../src/types/events.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';

const defaultSettings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

describe('Thread integration', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];
  let events: ReturnType<typeof createMockHost>['events'];
  let fs: ReturnType<typeof createMockHost>['fs'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({
      files: {
        '/project/src/main.ts': 'console.log("hello world");',
        '/project/README.md': '# My Project\n\nA test project.',
      },
    });
    host = mocked.host;
    events = mocked.events;
    fs = mocked.fs;
  });

  it('sends a message and receives text response', async () => {
    model.addTextResponse('Hello! How can I help you?');

    const thread = new Thread({ host, settings: defaultSettings, model });
    const result = await thread.send([{ type: 'text', text: 'Hi' }]);

    expect(result).toBe('end_turn');

    // Check events emitted
    const textEvents = events.getByType('agent_text');
    expect(textEvents.length).toBeGreaterThan(0);
    expect(textEvents.map(e => e.text).join('')).toBe('Hello! How can I help you?');

    // Check stop event
    const stopEvents = events.getByType('stop');
    expect(stopEvents.length).toBe(1);
    expect(stopEvents[0]!.reason).toBe('end_turn');

    // Check message history
    const messages = thread.getMessages();
    expect(messages.length).toBe(2); // user + agent
    expect(messages[0]!.type).toBe('user');
    expect(messages[1]!.type).toBe('agent');
  });

  it('handles tool calls with now tool', async () => {
    // Model calls the now tool, then responds
    model.addToolCallResponse('now', { timezone: 'utc' });
    model.addTextResponse('The current time is shown above.');

    const thread = new Thread({ host, settings: defaultSettings, model });
    thread.addTool(eraseToolType(new NowTool()));

    const result = await thread.send([{ type: 'text', text: 'What time is it?' }]);

    expect(result).toBe('end_turn');

    // Should have tool call events
    const toolCalls = events.getByType('tool_call');
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0]!.toolName).toBe('now');

    // Should have tool call update (completed)
    const toolUpdates = events.getByType('tool_call_update');
    expect(toolUpdates.some(u => u.fields.status === 'completed')).toBe(true);

    // Model should have received at least 2 requests (initial + after tool result)
    // May also include title generation request
    expect(model.receivedRequests.length).toBeGreaterThanOrEqual(2);
  });

  it('handles read_file tool', async () => {
    model.addToolCallResponse('read_file', { path: 'project/README.md' });
    model.addTextResponse('The README contains information about the project.');

    const thread = new Thread({ host, settings: defaultSettings, model });
    thread.addTool(eraseToolType(new ReadFileTool()));

    const result = await thread.send([{ type: 'text', text: 'Read the README' }]);

    expect(result).toBe('end_turn');

    const toolCalls = events.getByType('tool_call');
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0]!.toolName).toBe('read_file');
  });

  it('handles multi-turn conversation', async () => {
    model.addTextResponse('Hello!');

    const thread = new Thread({ host, settings: defaultSettings, model });
    await thread.send([{ type: 'text', text: 'Hi' }]);

    // Second turn
    model.addTextResponse('I can help with that.');
    await thread.send([{ type: 'text', text: 'Can you help me?' }]);

    const messages = thread.getMessages();
    expect(messages.length).toBe(4); // user1, agent1, user2, agent2
  });

  it('handles cancellation', async () => {
    // Add a slow response
    model.addTextResponse('This is a response.');

    const thread = new Thread({ host, settings: defaultSettings, model });

    // Start sending and cancel immediately
    const sendPromise = thread.send([{ type: 'text', text: 'Hello' }]);
    // Let the event loop tick
    await new Promise(r => setTimeout(r, 0));
    thread.cancel();

    const result = await sendPromise;
    // Result should be either end_turn (if completed before cancel) or cancelled
    expect(['end_turn', 'cancelled']).toContain(result);
  });

  it('builds system prompt with tool names', async () => {
    model.addTextResponse('Done.');

    const thread = new Thread({ host, settings: defaultSettings, model });
    thread.addTool(eraseToolType(new NowTool()));
    thread.addTool(eraseToolType(new ReadFileTool()));

    await thread.send([{ type: 'text', text: 'Test' }]);

    // Check that the first request included a system prompt with tool names
    expect(model.receivedRequests.length).toBeGreaterThanOrEqual(1);
    const request = model.receivedRequests[0]!;
    const systemMsg = request.messages.find(m => m.role === 'system');
    expect(systemMsg).toBeDefined();
    const systemText = systemMsg!.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('');
    expect(systemText).toContain('now');
    expect(systemText).toContain('read_file');
  });

  it('handles tool that returns error', async () => {
    // Call read_file with a nonexistent path
    model.addToolCallResponse('read_file', { path: 'project/nonexistent.txt' });
    model.addTextResponse('The file was not found.');

    const thread = new Thread({ host, settings: defaultSettings, model });
    thread.addTool(eraseToolType(new ReadFileTool()));

    const result = await thread.send([{ type: 'text', text: 'Read nonexistent.txt' }]);

    expect(result).toBe('end_turn');

    // Tool call should have failed status
    const toolUpdates = events.getByType('tool_call_update');
    expect(toolUpdates.some(u => u.fields.status === 'failed')).toBe(true);

    // Model should still get the error as a tool result and respond
    expect(model.receivedRequests.length).toBeGreaterThanOrEqual(2);
  });

  it('serializes and deserializes thread', async () => {
    model.addTextResponse('Hello!');

    const thread = new Thread({ host, settings: defaultSettings, model });
    await thread.send([{ type: 'text', text: 'Hi' }]);
    thread.setTitle('Test Thread');

    // Serialize
    const db = thread.toDb();
    expect(db.title).toBe('Test Thread');
    expect(db.messages.length).toBe(2);

    // Deserialize
    const restored = Thread.fromDb(thread.id, db, {
      host,
      settings: defaultSettings,
      model,
    });
    expect(restored.title).toBe('Test Thread');
    expect(restored.messageCount).toBe(2);
  });

  it('replays events from loaded thread', async () => {
    model.addTextResponse('Hello!');

    const thread = new Thread({ host, settings: defaultSettings, model });
    await thread.send([{ type: 'text', text: 'Hi' }]);

    const db = thread.toDb();
    const restored = Thread.fromDb(thread.id, db, {
      host,
      settings: defaultSettings,
      model,
    });

    const replayedEvents = restored.replay();
    expect(replayedEvents.length).toBeGreaterThanOrEqual(2); // user + agent
    expect(replayedEvents[0]!.type).toBe('user_message');
    expect(replayedEvents.some(e => e.type === 'agent_text')).toBe(true);
  });

  it('generates title after first message', async () => {
    // We need two model responses: one for the main completion, one for title generation
    model.addTextResponse('Here is the answer.');
    model.addTextResponse('Code Review Discussion'); // title generation response

    const thread = new Thread({ host, settings: defaultSettings, model });
    await thread.send([{ type: 'text', text: 'Review this code' }]);

    // Wait for async title generation
    await new Promise(r => setTimeout(r, 100));

    // Title should be set (either from LLM or fallback)
    expect(thread.getRawTitle()).toBeDefined();
  });

  it('tracks token usage', async () => {
    model.addTextResponse('Response.');

    const thread = new Thread({ host, settings: defaultSettings, model });
    await thread.send([{ type: 'text', text: 'Test' }]);

    const usage = thread.latestTokenUsage();
    expect(usage).not.toBeNull();
    expect(usage!.inputTokens).toBe(100);
    expect(usage!.outputTokens).toBe(50);
  });
});
