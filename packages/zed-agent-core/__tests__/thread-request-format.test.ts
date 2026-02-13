/**
 * Tests for Thread completion request format.
 * Verifies the request built by Thread has correct structure.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { NowTool } from '../src/tools/now-tool.js';
import { ReadFileTool } from '../src/tools/read-file-tool.js';
import { eraseToolType } from '../src/types/tools.js';
import { agentProfileId } from '../src/types/branded.js';
import { defaultAgentProfileSettings } from '../src/types/settings.js';
import type { AgentSettings } from '../src/types/settings.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

describe('Thread request format', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
  });

  it('includes system prompt as first message', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Hello' }]);

    const request = model.receivedRequests[0]!;
    expect(request.messages.length).toBeGreaterThanOrEqual(2);
    expect(request.messages[0]!.role).toBe('system');
  });

  it('system prompt contains tool names when tools registered', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });
    thread.addTool(eraseToolType(new NowTool()));
    thread.addTool(eraseToolType(new ReadFileTool()));
    await thread.send([{ type: 'text', text: 'Hello' }]);

    const systemMsg = model.receivedRequests[0]!.messages[0]!;
    const systemText = systemMsg.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('');
    expect(systemText).toContain('now');
    expect(systemText).toContain('read_file');
  });

  it('includes tool definitions in request', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });
    thread.addTool(eraseToolType(new NowTool()));
    await thread.send([{ type: 'text', text: 'Hello' }]);

    const request = model.receivedRequests[0]!;
    expect(request.tools.length).toBe(1);
    expect(request.tools[0]!.name).toBe('now');
    expect(request.tools[0]!.description).toBeTruthy();
    expect(request.tools[0]!.inputSchema).toBeTruthy();
  });

  it('user message is last non-system message', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Hello world' }]);

    const request = model.receivedRequests[0]!;
    const userMsgs = request.messages.filter(m => m.role === 'user');
    expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    const lastUser = userMsgs[userMsgs.length - 1]!;
    const text = lastUser.content.find(c => c.type === 'text');
    expect(text).toBeDefined();
    expect((text as { text: string }).text).toContain('Hello world');
  });

  it('marks last message for caching', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Test' }]);

    const request = model.receivedRequests[0]!;
    const lastMsg = request.messages[request.messages.length - 1]!;
    expect(lastMsg.cache).toBe(true);
  });

  it('includes thread and prompt IDs', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({ host, settings, model });
    await thread.send([{ type: 'text', text: 'Test' }]);

    const request = model.receivedRequests[0]!;
    expect(request.threadId).toBeTruthy();
    expect(request.promptId).toBeTruthy();
  });

  it('includes thinking settings', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');
    const thread = new Thread({
      host, settings, model,
      thinkingEnabled: true,
      thinkingEffort: 'high',
    });
    await thread.send([{ type: 'text', text: 'Think hard' }]);

    const request = model.receivedRequests[0]!;
    expect(request.thinkingAllowed).toBe(true);
    expect(request.thinkingEffort).toBe('high');
  });

  it('filters tools by profile', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');

    const profileSettings = defaultAgentProfileSettings({
      tools: { now: false }, // Disable the now tool
    });
    const settingsWithProfile: AgentSettings = {
      defaultProfile: agentProfileId('test'),
      profiles: new Map([[agentProfileId('test'), profileSettings]]),
      toolPermissionMode: 'auto',
    };

    const thread = new Thread({ host, settings: settingsWithProfile, model });
    thread.addTool(eraseToolType(new NowTool()));
    thread.addTool(eraseToolType(new ReadFileTool()));
    await thread.send([{ type: 'text', text: 'Test' }]);

    const request = model.receivedRequests[0]!;
    const toolNames = request.tools.map(t => t.name);
    expect(toolNames).not.toContain('now'); // Disabled by profile
    expect(toolNames).toContain('read_file'); // Not disabled
  });

  it('second request includes tool results', async () => {
    model.addToolCallResponse('now', { timezone: 'utc' });
    model.addTextResponse('Done.');
    model.addTextResponse('title');
    model.addTextResponse('title2');

    const thread = new Thread({ host, settings, model });
    thread.addTool(eraseToolType(new NowTool()));
    await thread.send([{ type: 'text', text: 'Time?' }]);

    // The second request should include tool_result content
    expect(model.receivedRequests.length).toBeGreaterThanOrEqual(2);
    const secondReq = model.receivedRequests[1]!;
    const hasToolResult = secondReq.messages.some(m =>
      m.content.some(c => c.type === 'tool_result'),
    );
    expect(hasToolResult).toBe(true);
  });
});
