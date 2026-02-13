/**
 * GrepTool — searches file contents with a regex pattern.
 * Ported from: crates/agent/src/tools/grep_tool.rs (~330 LOC production)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface GrepToolInput {
  /** A regex pattern to search for in the entire project. */
  regex: string;
  /** A glob pattern for paths of files to include. */
  include_pattern?: string;
  /** Starting position for paginated results (0-based). */
  offset?: number;
  /** Whether the regex is case-sensitive. Defaults to false. */
  case_sensitive?: boolean;
}

export const GREP_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Searches the contents of files in the project with a regular expression.\n\n' +
    '- Prefer this tool to path search when searching for symbols in the project, because you won\'t need to guess what path it\'s in.\n' +
    '- Supports full regex syntax (eg. "log.*Error", "function\\\\s+\\\\w+", etc.)\n' +
    '- Pass an `include_pattern` if you know how to narrow your search on the files system\n' +
    '- Never use this tool to search for paths. Only search file contents with this tool.\n' +
    '- Use this tool when you need to find files containing specific patterns\n' +
    "- Results are paginated with 20 matches per page. Use the optional 'offset' parameter to request subsequent pages.\n" +
    '- DO NOT use HTML entities solely to escape characters in the tool parameters.',
  properties: {
    regex: {
      type: 'string',
      description:
        'A regex pattern to search for in the entire project. ' +
        'Do NOT specify a path here! This will only be matched against the code **content**.',
    },
    include_pattern: {
      type: 'string',
      description:
        'A glob pattern for the paths of files to include in the search. ' +
        'Supports standard glob patterns like "**/*.rs" or "frontend/src/**/*.ts".',
    },
    offset: {
      type: 'number',
      description: 'Optional starting position for paginated results (0-based).',
    },
    case_sensitive: {
      type: 'boolean',
      description: 'Whether the regex is case-sensitive. Defaults to false (case-insensitive).',
    },
  },
  required: ['regex'],
} as const;

const RESULTS_PER_PAGE = 20;

export class GrepTool implements AgentTool<GrepToolInput, string> {
  readonly name = 'grep';
  readonly kind: ToolKind = 'read';

  description(): string {
    return GREP_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return GREP_TOOL_SCHEMA;
  }

  initialTitle(input: GrepToolInput | null): string {
    if (input?.regex) {
      return `Grep \`${input.regex}\``;
    }
    return 'Grep';
  }

  async run(input: GrepToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const offset = input.offset ?? 0;

    const result = await context.host.fileSystem.grep({
      pattern: input.regex,
      includePattern: input.include_pattern,
      offset,
      caseSensitive: input.case_sensitive ?? false,
    });

    const page = result.matches.slice(0, RESULTS_PER_PAGE);

    if (page.length === 0) {
      const text = `No matches found for pattern: ${input.regex}`;
      return { llmOutput: textToolResult(text), rawOutput: text };
    }

    const pageNum = 1 + Math.floor(offset / RESULTS_PER_PAGE);
    let text = '';

    if (result.totalMatches > RESULTS_PER_PAGE) {
      text += `Found ${result.totalMatches} total matches (page ${pageNum}).\n\n`;
    } else {
      text += `Found ${result.totalMatches} matches.\n\n`;
    }

    // Group matches by file
    const byFile = new Map<string, typeof page>();
    for (const match of page) {
      const existing = byFile.get(match.path);
      if (existing) {
        existing.push(match);
      } else {
        byFile.set(match.path, [match]);
      }
    }

    for (const [filePath, matches] of byFile) {
      text += `## ${filePath}\n`;
      for (const match of matches) {
        text += `L${match.lineNumber}: ${match.lineContent}\n`;
      }
      text += '\n';
    }

    if (result.totalMatches > offset + RESULTS_PER_PAGE) {
      text += `Use offset: ${offset + RESULTS_PER_PAGE} to see more results.\n`;
    }

    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
