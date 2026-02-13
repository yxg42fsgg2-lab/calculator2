/**
 * Tests for the StreamingEditFileTool.
 * Verifies create, overwrite, and edit modes with fuzzy matching.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StreamingEditFileTool } from '../src/tools/streaming-edit-file-tool.js';
import type { ToolContext, ToolCallEventStream, ToolCallUpdateFields, ToolPermissionContext } from '../src/types/tools.js';
import type { LanguageModelToolUseId } from '../src/types/branded.js';
import { toolUseId } from '../src/types/branded.js';
import { createMockHost } from './mock-host.js';

function makeMockContext(host: ReturnType<typeof createMockHost>['host']): ToolContext {
  const collectedUpdates: ToolCallUpdateFields[] = [];
  const eventStream: ToolCallEventStream = {
    toolUseId: toolUseId('test-tool-use-id'),
    updateFields(fields: ToolCallUpdateFields) { collectedUpdates.push(fields); },
    updateFieldsWithMeta(fields: ToolCallUpdateFields) { collectedUpdates.push(fields); },
    async authorize() {},
    cancelledByUser() { return new Promise(() => {}); },
    wasCancelledByUser() { return false; },
  };

  return {
    host,
    eventStream,
    signal: new AbortController().signal,
  };
}

describe('StreamingEditFileTool', () => {
  let tool: StreamingEditFileTool;
  let host: ReturnType<typeof createMockHost>['host'];
  let fs: ReturnType<typeof createMockHost>['fs'];

  beforeEach(() => {
    tool = new StreamingEditFileTool();
    const mocked = createMockHost({
      files: {
        '/project/src/main.ts': 'const greeting = "hello";\nconsole.log(greeting);\n',
        '/project/src/utils.ts': 'export function add(a: number, b: number) {\n  return a + b;\n}\n\nexport function multiply(a: number, b: number) {\n  return a * b;\n}\n',
        '/project/README.md': '# My Project\n\nA simple project.\n',
      },
    });
    host = mocked.host;
    fs = mocked.fs;
  });

  it('has correct name and kind', () => {
    expect(tool.name).toBe('edit_file');
    expect(tool.kind).toBe('write');
  });

  it('generates correct initial title', () => {
    expect(tool.initialTitle({ display_description: 'Fix bug', path: 'x', mode: 'edit' })).toBe('Fix bug');
    expect(tool.initialTitle(null)).toBe('Editing file');
  });

  // --- Create mode ---

  it('creates a new file', async () => {
    const context = makeMockContext(host);
    const result = await tool.run({
      display_description: 'Create config file',
      path: 'project/config.json',
      mode: 'create',
      content: '{\n  "port": 3000\n}\n',
    }, context);

    expect(result.llmOutput.type).toBe('text');
    const content = await fs.readFile('/project/config.json');
    expect(content).toBe('{\n  "port": 3000\n}\n');
  });

  it('rejects creating existing file', async () => {
    const context = makeMockContext(host);
    await expect(
      tool.run({
        display_description: 'Create main',
        path: 'project/src/main.ts',
        mode: 'create',
        content: 'new content',
      }, context),
    ).rejects.toThrow('already exists');
  });

  // --- Overwrite mode ---

  it('overwrites an existing file', async () => {
    const context = makeMockContext(host);
    const result = await tool.run({
      display_description: 'Update README',
      path: 'project/README.md',
      mode: 'overwrite',
      content: '# Updated Project\n\nCompletely new content.\n',
    }, context);

    expect(result.llmOutput.type).toBe('text');
    const content = await fs.readFile('/project/README.md');
    expect(content).toBe('# Updated Project\n\nCompletely new content.\n');
  });

  // --- Edit mode ---

  it('applies a simple edit', async () => {
    const context = makeMockContext(host);
    const result = await tool.run({
      display_description: 'Change greeting',
      path: 'project/src/main.ts',
      mode: 'edit',
      edits: [
        { old_text: 'const greeting = "hello";', new_text: 'const greeting = "world";' },
      ],
    }, context);

    expect(result.llmOutput.type).toBe('text');
    const content = await fs.readFile('/project/src/main.ts');
    expect(content).toContain('"world"');
    expect(content).not.toContain('"hello"');
  });

  it('applies multiple edits', async () => {
    const context = makeMockContext(host);
    await tool.run({
      display_description: 'Rename functions',
      path: 'project/src/utils.ts',
      mode: 'edit',
      edits: [
        {
          old_text: 'export function add(a: number, b: number) {\n  return a + b;\n}',
          new_text: 'export function sum(a: number, b: number) {\n  return a + b;\n}',
        },
        {
          old_text: 'export function multiply(a: number, b: number) {\n  return a * b;\n}',
          new_text: 'export function product(a: number, b: number) {\n  return a * b;\n}',
        },
      ],
    }, context);

    const content = await fs.readFile('/project/src/utils.ts');
    expect(content).toContain('function sum');
    expect(content).toContain('function product');
  });

  it('handles edits that do not match well', async () => {
    const context = makeMockContext(host);
    const result = await tool.run({
      display_description: 'Attempted edit',
      path: 'project/src/main.ts',
      mode: 'edit',
      edits: [
        {
          old_text: 'xyzzy_absolutely_nonexistent_text_that_cannot_match_anything_at_all_12345',
          new_text: 'replacement',
        },
      ],
    }, context);

    // The tool should complete without throwing, even if the edit doesn't match well
    expect(result.llmOutput.type).toBe('text');
    const text = (result.llmOutput as { type: 'text'; text: string }).text;
    expect(text).toContain('Edited file');
  });

  it('rejects edit mode without edits array', async () => {
    const context = makeMockContext(host);
    await expect(
      tool.run({
        display_description: 'Bad input',
        path: 'project/src/main.ts',
        mode: 'edit',
      }, context),
    ).rejects.toThrow("requires 'edits' array");
  });
});
