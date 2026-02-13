/**
 * RestoreFileFromDiskTool — reloads file content from disk.
 * Ported from: crates/agent/src/tools/restore_file_from_disk_tool.rs (~245 LOC production)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface RestoreFileToolInput {
  /** The relative path of the file to restore. */
  path: string;
}

export const RESTORE_FILE_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Restores a file\'s content from disk, discarding any unsaved in-memory changes. ' +
    'Use this to undo edits that haven\'t been saved.',
  properties: {
    path: {
      type: 'string',
      description: 'The relative path of the file to restore.',
    },
  },
  required: ['path'],
} as const;

export class RestoreFileTool implements AgentTool<RestoreFileToolInput, string> {
  readonly name = 'restore_file_from_disk';
  readonly kind: ToolKind = 'write';

  description(): string {
    return RESTORE_FILE_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return RESTORE_FILE_TOOL_SCHEMA;
  }

  initialTitle(input: RestoreFileToolInput | null): string {
    if (input?.path) {
      return `Restore \`${input.path}\` from disk`;
    }
    return 'Restore file from disk';
  }

  async run(input: RestoreFileToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const absPath = context.host.project.resolveProjectPath(input.path);
    if (!absPath) {
      throw new Error(`Path ${input.path} not found in project`);
    }

    const buffer = await context.host.fileSystem.openBuffer(absPath);
    await buffer.reloadFromDisk();

    const text = `Restored from disk: ${input.path}`;
    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
