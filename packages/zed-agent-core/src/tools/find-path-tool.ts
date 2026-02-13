/**
 * FindPathTool — finds files matching a glob pattern.
 * Ported from: crates/agent/src/tools/find_path_tool.rs (~190 LOC production)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface FindPathToolInput {
  /** The glob pattern to match against every path in the project. */
  glob: string;
  /** Optional starting position for paginated results (0-based). */
  offset?: number;
}

export interface FindPathToolOutput {
  offset: number;
  currentMatchesPage: string[];
  allMatchesLen: number;
}

export const FIND_PATH_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Fast file path pattern matching tool that works with any codebase size.\n\n' +
    '- Supports glob patterns like "**/*.js" or "src/**/*.ts"\n' +
    '- Returns matching file paths sorted alphabetically\n' +
    '- Prefer the `grep` tool to this tool when searching for symbols unless you have specific information about paths.\n' +
    '- Use this tool when you need to find files by name patterns\n' +
    "- Results are paginated with 50 matches per page. Use the optional 'offset' parameter to request subsequent pages.",
  properties: {
    glob: {
      type: 'string',
      description: 'The glob to match against every path in the project.',
    },
    offset: {
      type: 'number',
      description: 'Optional starting position for paginated results (0-based).',
    },
  },
  required: ['glob'],
} as const;

const RESULTS_PER_PAGE = 50;

export class FindPathTool implements AgentTool<FindPathToolInput, FindPathToolOutput> {
  readonly name = 'find_path';
  readonly kind: ToolKind = 'read';

  description(): string {
    return FIND_PATH_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return FIND_PATH_TOOL_SCHEMA;
  }

  initialTitle(input: FindPathToolInput | null): string {
    if (input?.glob) {
      return `Find path \`${input.glob}\``;
    }
    return 'Find path';
  }

  async run(input: FindPathToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const offset = input.offset ?? 0;

    const result = await context.host.fileSystem.findPath(input.glob, { offset });

    const page = result.paths.slice(0, RESULTS_PER_PAGE);
    const output: FindPathToolOutput = {
      offset,
      currentMatchesPage: page,
      allMatchesLen: result.totalMatches,
    };

    let text: string;
    if (page.length === 0) {
      text = 'No matches found';
    } else {
      text = `Found ${result.totalMatches} total matches.`;
      if (result.totalMatches > RESULTS_PER_PAGE) {
        text += `\nShowing results ${offset + 1}-${offset + page.length} (provide 'offset' parameter for more results):`;
      }
      text += '\n' + page.join('\n');
    }

    return {
      llmOutput: textToolResult(text),
      rawOutput: output,
    };
  }
}
