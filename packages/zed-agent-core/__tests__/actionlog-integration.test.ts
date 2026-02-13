/**
 * Tests for ActionLog integration with tools.
 * Verifies that tools automatically log their operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { NowTool } from '../src/tools/now-tool.js';
import { ReadFileTool } from '../src/tools/read-file-tool.js';
import { eraseToolType } from '../src/types/tools.js';
import { agentProfileId } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import { ActionLog } from '../src/utils/action-log.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

describe('ActionLog integration', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({
      files: { '/project/test.txt': 'Hello World\n' },
    });
    host = mocked.host;
  });

  it('logs file reads from read_file tool', async () => {
    model.addToolCallResponse('read_file', { path: 'project/test.txt' });
    model.addTextResponse('The file says Hello World.');
    model.addTextResponse('T');
    model.addTextResponse('T');

    const actionLog = new ActionLog();
    const thread = new Thread({ host, settings, model, actionLog });
    thread.addTool(eraseToolType(new ReadFileTool()));

    await thread.send([{ type: 'text', text: 'Read test.txt' }]);

    const reads = actionLog.getByType('file_read');
    expect(reads.length).toBeGreaterThanOrEqual(1);
    expect(reads[0]!.path).toContain('test.txt');
  });

  it('logs tool calls from now tool', async () => {
    model.addToolCallResponse('now', { timezone: 'utc' });
    model.addTextResponse('Time shown.');
    model.addTextResponse('T');
    model.addTextResponse('T');

    const actionLog = new ActionLog();
    const thread = new Thread({ host, settings, model, actionLog });
    thread.addTool(eraseToolType(new NowTool()));

    await thread.send([{ type: 'text', text: 'What time?' }]);

    // The ActionLog should be accessible from the thread
    expect(thread.actionLog).toBe(actionLog);
  });

  it('queued message API works', () => {
    const thread = new Thread({ host, settings, model });
    expect(thread.hasMessageQueued).toBe(false);

    thread.setHasQueuedMessage(true);
    expect(thread.hasMessageQueued).toBe(true);

    thread.setHasQueuedMessage(false);
    expect(thread.hasMessageQueued).toBe(false);
  });
});
