/**
 * SaveFileTool — saves a file buffer to disk.
 * Ported from: crates/agent/src/tools/save_file_tool.rs (~240 LOC production)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface SaveFileToolInput {
  /** The relative path of the file to save. */
  path: string;
}

export const SAVE_FILE_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Saves the current in-memory buffer of a file to disk. ' +
    'Use this after making edits to persist them.',
  properties: {
    path: {
      type: 'string',
      description: 'The relative path of the file to save.',
    },
  },
  required: ['path'],
} as const;

export class SaveFileTool implements AgentTool<SaveFileToolInput, string> {
  readonly name = 'save_file';
  readonly kind: ToolKind = 'write';

  description(): string {
    return SAVE_FILE_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return SAVE_FILE_TOOL_SCHEMA;
  }

  initialTitle(input: SaveFileToolInput | null): string {
    if (input?.path) {
      return `Save file \`${input.path}\``;
    }
    return 'Save file';
  }

  async run(input: SaveFileToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const absPath = context.host.project.resolveProjectPath(input.path);
    if (!absPath) {
      throw new Error(`Path ${input.path} not found in project`);
    }

    // Check permissions
    const decision = context.host.permissions.checkAutoPermission('save_file', [input.path]);
    if (decision.type === 'deny') {
      throw new Error(decision.reason);
    }
    if (decision.type === 'confirm') {
      await context.eventStream.authorize(
        this.initialTitle(input),
        { toolName: 'save_file', inputValues: [input.path] },
      );
    }

    const buffer = await context.host.fileSystem.openBuffer(absPath);
    await buffer.save();

    const text = `Saved: ${input.path}`;
    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
