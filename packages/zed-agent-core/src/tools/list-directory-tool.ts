/**
 * ListDirectoryTool — lists contents of a directory.
 * Ported from: crates/agent/src/tools/list_directory_tool.rs (~200 LOC production)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface ListDirectoryToolInput {
  /** The relative path of the directory to list. */
  path: string;
}

export const LIST_DIRECTORY_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Lists the contents of a directory in the project. ' +
    'Returns file names, indicating which are directories with a trailing `/`. ' +
    'Use this to understand directory structure before reading or editing files.',
  properties: {
    path: {
      type: 'string',
      description:
        'The relative path of the directory to list. ' +
        'The first component should be a root directory of the project.',
    },
  },
  required: ['path'],
} as const;

export class ListDirectoryTool implements AgentTool<ListDirectoryToolInput, string> {
  readonly name = 'list_directory';
  readonly kind: ToolKind = 'read';

  description(): string {
    return LIST_DIRECTORY_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return LIST_DIRECTORY_TOOL_SCHEMA;
  }

  initialTitle(input: ListDirectoryToolInput | null): string {
    if (input?.path) {
      return `List directory \`${input.path}\``;
    }
    return 'List directory';
  }

  async run(input: ListDirectoryToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const { host } = context;
    const absPath = host.project.resolveProjectPath(input.path);
    if (!absPath) {
      throw new Error(`Path ${input.path} not found in project`);
    }

    const isDir = await host.fileSystem.isDirectory(absPath);
    if (!isDir) {
      throw new Error(`${input.path} is not a directory`);
    }

    const entries = await host.fileSystem.listDirectory(absPath);

    // Filter hidden files (starting with .) and format output
    const filtered = entries
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

    if (filtered.length === 0) {
      const text = `Directory \`${input.path}\` is empty.`;
      return { llmOutput: textToolResult(text), rawOutput: text };
    }

    const lines = filtered.map((entry) => {
      if (entry.isDirectory) {
        return `${entry.name}/`;
      }
      return entry.name;
    });

    const text = lines.join('\n');
    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
