/**
 * DeletePathTool — deletes a file or directory.
 * Ported from: crates/agent/src/tools/delete_path_tool.rs (190 LOC)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface DeletePathToolInput {
  /** The relative path to delete. */
  path: string;
}

export const DELETE_PATH_TOOL_SCHEMA = {
  type: 'object',
  description: 'Deletes the specified file or directory from the project.',
  properties: {
    path: {
      type: 'string',
      description: 'The relative path of the file or directory to delete.',
    },
  },
  required: ['path'],
} as const;

export class DeletePathTool implements AgentTool<DeletePathToolInput, string> {
  readonly name = 'delete_path';
  readonly kind: ToolKind = 'write';

  description(): string {
    return DELETE_PATH_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return DELETE_PATH_TOOL_SCHEMA;
  }

  initialTitle(input: DeletePathToolInput | null): string {
    if (input?.path) {
      return `Delete \`${input.path}\``;
    }
    return 'Delete path';
  }

  async run(input: DeletePathToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const absPath = context.host.project.resolveProjectPath(input.path);
    if (!absPath) {
      throw new Error(`Path ${input.path} not found in project`);
    }

    // Check permissions
    const decision = context.host.permissions.checkAutoPermission('delete_path', [input.path]);
    if (decision.type === 'deny') {
      throw new Error(decision.reason);
    }
    if (decision.type === 'confirm') {
      await context.eventStream.authorize(
        this.initialTitle(input),
        { toolName: 'delete_path', inputValues: [input.path] },
      );
    }

    await context.host.fileSystem.deletePath(absPath);

    const text = `Deleted: ${input.path}`;
    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
