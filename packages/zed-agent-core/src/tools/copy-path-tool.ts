/**
 * CopyPathTool — copies a file or directory.
 * Ported from: crates/agent/src/tools/copy_path_tool.rs (162 LOC)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface CopyPathToolInput {
  /** The source relative path. */
  source: string;
  /** The destination relative path. */
  destination: string;
}

export const COPY_PATH_TOOL_SCHEMA = {
  type: 'object',
  description: 'Copies a file or directory within the project.',
  properties: {
    source: {
      type: 'string',
      description: 'The relative path of the file or directory to copy.',
    },
    destination: {
      type: 'string',
      description: 'The destination relative path for the copy.',
    },
  },
  required: ['source', 'destination'],
} as const;

export class CopyPathTool implements AgentTool<CopyPathToolInput, string> {
  readonly name = 'copy_path';
  readonly kind: ToolKind = 'write';

  description(): string {
    return COPY_PATH_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return COPY_PATH_TOOL_SCHEMA;
  }

  initialTitle(input: CopyPathToolInput | null): string {
    if (input) {
      return `Copy \`${input.source}\` → \`${input.destination}\``;
    }
    return 'Copy path';
  }

  async run(input: CopyPathToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const srcAbs = context.host.project.resolveProjectPath(input.source);
    const dstAbs = context.host.project.resolveProjectPath(input.destination);
    if (!srcAbs) {
      throw new Error(`Source path ${input.source} not found in project`);
    }
    if (!dstAbs) {
      throw new Error(`Destination path ${input.destination} not found in project`);
    }

    await context.host.fileSystem.copyPath(srcAbs, dstAbs);

    const text = `Copied: ${input.source} → ${input.destination}`;
    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
