/**
 * OpenTool — opens a file in the editor.
 * Ported from: crates/agent/src/tools/open_tool.rs (~100 LOC production)
 *
 * This tool emits an event requesting the UI to open/focus a file.
 * The actual opening is handled by the UI.
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface OpenToolInput {
  /** The relative path of the file to open. */
  path: string;
  /** Optional line number to navigate to (1-based). */
  line?: number;
}

export const OPEN_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Opens a file in the editor at an optional line number. ' +
    'Use this to show the user a specific file or location.',
  properties: {
    path: {
      type: 'string',
      description: 'The relative path of the file to open.',
    },
    line: {
      type: 'number',
      description: 'Optional line number to navigate to (1-based).',
    },
  },
  required: ['path'],
} as const;

export class OpenTool implements AgentTool<OpenToolInput, string> {
  readonly name = 'open';
  readonly kind: ToolKind = 'other';

  description(): string {
    return OPEN_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return OPEN_TOOL_SCHEMA;
  }

  initialTitle(input: OpenToolInput | null): string {
    if (input?.path) {
      return `Open \`${input.path}\``;
    }
    return 'Open file';
  }

  async run(input: OpenToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const absPath = context.host.project.resolveProjectPath(input.path);
    if (!absPath) {
      throw new Error(`Path ${input.path} not found in project`);
    }

    context.eventStream.updateFields({
      locations: [{ path: absPath, line: input.line ? input.line - 1 : undefined }],
    });

    const text = input.line
      ? `Opened ${input.path} at line ${input.line}`
      : `Opened ${input.path}`;

    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
