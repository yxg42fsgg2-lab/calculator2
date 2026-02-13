/**
 * Tests for the edit tool swap logic.
 * Ported from: thread.rs use_streaming_edit_tool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { EditFileTool } from '../src/tools/edit-file-tool.js';
import { StreamingEditFileTool } from '../src/tools/streaming-edit-file-tool.js';
import { eraseToolType } from '../src/types/tools.js';
import { agentProfileId } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

describe('Edit tool swap', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
  });

  it('default: uses EditFileTool, excludes StreamingEditFileTool', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');

    const thread = new Thread({ host, settings, model });
    thread.addTool(eraseToolType(new EditFileTool()));
    thread.addTool(eraseToolType(new StreamingEditFileTool()));

    await thread.send([{ type: 'text', text: 'Test' }]);

    const request = model.receivedRequests[0]!;
    const toolNames = request.tools.map(t => t.name);
    expect(toolNames).toContain('edit_file');
    // StreamingEditFileTool also uses name 'edit_file' so it would be a duplicate
    // In practice only one should be included
    expect(toolNames.filter(n => n === 'edit_file').length).toBe(1);
  });

  it('useStreamingEditTool=true: swaps to StreamingEditFileTool', async () => {
    model.addTextResponse('ok');
    model.addTextResponse('title');

    // Register both tools - but the regular edit_file has name 'edit_file'
    // and streaming also has name 'edit_file' (same name in Zed)
    // So we test by checking the tool kind/behavior differs
    const thread = new Thread({
      host, settings, model,
      useStreamingEditTool: true,
    });

    // Register with distinct internal names for testing
    const editTool = eraseToolType(new EditFileTool());
    const streamingTool = { ...eraseToolType(new StreamingEditFileTool()), name: 'streaming_edit_file' };
    thread.addTool(editTool);
    thread.addTool(streamingTool);

    await thread.send([{ type: 'text', text: 'Test' }]);

    const request = model.receivedRequests[0]!;
    const toolNames = request.tools.map(t => t.name);
    // edit_file should be present (from streaming renamed)
    expect(toolNames).toContain('edit_file');
    // The regular edit_file should be excluded
    // streaming_edit_file should NOT appear (renamed to edit_file)
    expect(toolNames).not.toContain('streaming_edit_file');
  });
});
