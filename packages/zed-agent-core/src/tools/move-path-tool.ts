/**
 * MovePathTool — moves/renames a file or directory.
 * Ported from: crates/agent/src/tools/move_path_tool.rs (172 LOC)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface MovePathToolInput {
  /** The current relative path. */
  source: string;
  /** The target relative path. */
  destination: string;
}

export const MOVE_PATH_TOOL_SCHEMA = {
  type: 'object',
  description: 'Moves or renames a file or directory within the project.',
  properties: {
    source: {
      type: 'string',
      description: 'The relative path of the file or directory to move.',
    },
    destination: {
      type: 'string',
      description: 'The target relative path.',
    },
  },
  required: ['source', 'destination'],
} as const;

export class MovePathTool implements AgentTool<MovePathToolInput, string> {
  readonly name = 'move_path';
  readonly kind: ToolKind = 'write';

  description(): string {
    return MOVE_PATH_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return MOVE_PATH_TOOL_SCHEMA;
  }

  initialTitle(input: MovePathToolInput | null): string {
    if (input) {
      return `Move \`${input.source}\` → \`${input.destination}\``;
    }
    return 'Move path';
  }

  async run(input: MovePathToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const srcAbs = context.host.project.resolveProjectPath(input.source);
    const dstAbs = context.host.project.resolveProjectPath(input.destination);
    if (!srcAbs) {
      throw new Error(`Source path ${input.source} not found in project`);
    }
    if (!dstAbs) {
      throw new Error(`Destination path ${input.destination} not found in project`);
    }

    // Check permissions
    const decision = context.host.permissions.checkAutoPermission('move_path', [input.source, input.destination]);
    if (decision.type === 'deny') {
      throw new Error(decision.reason);
    }
    if (decision.type === 'confirm') {
      await context.eventStream.authorize(
        this.initialTitle(input),
        { toolName: 'move_path', inputValues: [input.source, input.destination] },
      );
    }

    await context.host.fileSystem.movePath(srcAbs, dstAbs);

    const text = `Moved: ${input.source} → ${input.destination}`;
    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
