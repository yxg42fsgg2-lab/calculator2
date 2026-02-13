/**
 * CreateDirectoryTool — creates a new directory.
 * Ported from: crates/agent/src/tools/create_directory_tool.rs (128 LOC)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface CreateDirectoryToolInput {
  /** The relative path of the directory to create. */
  path: string;
}

export const CREATE_DIRECTORY_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Creates a new directory (and any necessary parent directories) in the project.',
  properties: {
    path: {
      type: 'string',
      description: 'The relative path of the directory to create.',
    },
  },
  required: ['path'],
} as const;

export class CreateDirectoryTool implements AgentTool<CreateDirectoryToolInput, string> {
  readonly name = 'create_directory';
  readonly kind: ToolKind = 'write';

  description(): string {
    return CREATE_DIRECTORY_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return CREATE_DIRECTORY_TOOL_SCHEMA;
  }

  initialTitle(input: CreateDirectoryToolInput | null): string {
    if (input?.path) {
      return `Create directory \`${input.path}\``;
    }
    return 'Create directory';
  }

  async run(input: CreateDirectoryToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const absPath = context.host.project.resolveProjectPath(input.path);
    if (!absPath) {
      throw new Error(`Path ${input.path} not found in project`);
    }

    await context.host.fileSystem.createDirectory(absPath);

    const text = `Created directory: ${input.path}`;
    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
