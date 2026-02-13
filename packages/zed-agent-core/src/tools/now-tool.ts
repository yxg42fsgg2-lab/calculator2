/**
 * NowTool — returns the current datetime.
 * Ported from: crates/agent/src/tools/now_tool.rs (62 LOC)
 */

import type { AgentTool, AgentToolOutput, ToolContext } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface NowToolInput {
  /** The timezone to use: "utc" or "local". */
  timezone: 'utc' | 'local';
}

export const NOW_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Returns the current datetime in RFC 3339 format. ' +
    'Only use this tool when the user specifically asks for it or the current task would benefit from knowing the current datetime.',
  properties: {
    timezone: {
      type: 'string',
      enum: ['utc', 'local'],
      description: 'The timezone to use for the datetime.',
    },
  },
  required: ['timezone'],
} as const;

export class NowTool implements AgentTool<NowToolInput, string> {
  readonly name = 'now';
  readonly kind = 'other' as const;

  description(): string {
    return NOW_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return NOW_TOOL_SCHEMA;
  }

  initialTitle(): string {
    return 'Get current time';
  }

  async run(input: NowToolInput): Promise<AgentToolOutput> {
    const now =
      input.timezone === 'utc'
        ? new Date().toISOString()
        : new Date().toString();

    const text = `The current datetime is ${now}.`;
    return {
      llmOutput: textToolResult(text),
      rawOutput: text,
    };
  }
}
