/**
 * SubagentTool — spawns a child agent thread for sub-tasks.
 * Ported from: crates/agent/src/tools/subagent_tool.rs (~204 LOC production)
 *
 * This tool creates a child agent session that inherits the parent's model and tools,
 * executes a specific task, and returns a summary of the results.
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface SubagentToolInput {
  /** A short label for the subagent task (shown in UI). */
  label: string;
  /** The initial prompt/task description for the subagent. */
  prompt: string;
  /** Optional timeout in milliseconds. */
  timeout_ms?: number;
  /** Optional list of tool names the subagent is allowed to use. */
  allowed_tools?: string[];
}

export const SUBAGENT_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Spawns a sub-agent to handle a specific task independently. ' +
    'The sub-agent has access to the same tools and context, ' +
    'executes the task, and returns a summary of what it did. ' +
    'Use this for parallelizable tasks or when you want to delegate a specific piece of work.',
  properties: {
    label: {
      type: 'string',
      description: 'A short label for the subagent task.',
    },
    prompt: {
      type: 'string',
      description: 'The initial prompt/task description for the subagent.',
    },
    timeout_ms: {
      type: 'number',
      description: 'Optional timeout in milliseconds.',
    },
    allowed_tools: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional list of tool names the subagent is allowed to use.',
    },
  },
  required: ['label', 'prompt'],
} as const;

export class SubagentTool implements AgentTool<SubagentToolInput, string> {
  readonly name = 'subagent';
  readonly kind: ToolKind = 'other';

  description(): string {
    return SUBAGENT_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return SUBAGENT_TOOL_SCHEMA;
  }

  initialTitle(input: SubagentToolInput | null): string {
    if (input?.label) {
      return input.label;
    }
    return 'Subagent';
  }

  async run(input: SubagentToolInput, _context: ToolContext): Promise<AgentToolOutput> {
    // Subagent execution requires the full Thread/Session infrastructure
    // which will be implemented in Phase 5.
    // For now, return a placeholder indicating the subagent would be spawned.

    const text =
      `Subagent "${input.label}" would be spawned with prompt: "${input.prompt}". ` +
      'Note: Full subagent implementation requires Thread infrastructure (Phase 5).';

    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
