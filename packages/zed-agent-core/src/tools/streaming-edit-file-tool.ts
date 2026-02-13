/**
 * StreamingEditFileTool — alternative edit tool where the model provides edits directly.
 * Ported from: crates/agent/src/tools/streaming_edit_file_tool.rs (~705 LOC production)
 *
 * Unlike EditFileTool which uses a secondary LLM call (EditAgent) to generate edits,
 * this tool expects the model to provide search/replace blocks directly in the tool input.
 * This is more efficient but requires the model to produce accurate edits.
 *
 * Three modes:
 * - 'edit': Model provides {old_text, new_text} edit pairs
 * - 'create': Model provides full file content
 * - 'overwrite': Model provides full replacement content
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';
import { StreamingFuzzyMatcher } from '../edit-agent/streaming-fuzzy-matcher.js';
import { computeLineDiff, formatDiff } from '../edit-agent/streaming-diff.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type StreamingEditFileMode = 'edit' | 'create' | 'overwrite';

export interface StreamingEditPair {
  /** The text to search for in the file. */
  old_text: string;
  /** The replacement text. */
  new_text: string;
}

export interface StreamingEditFileToolInput {
  /** A one-line description of the edit (shown in UI). */
  display_description: string;
  /** The file path to create or modify. */
  path: string;
  /** The mode: 'edit', 'create', or 'overwrite'. */
  mode: StreamingEditFileMode;
  /** File content for 'create' and 'overwrite' modes. */
  content?: string;
  /** Edit pairs for 'edit' mode. */
  edits?: StreamingEditPair[];
}

export const STREAMING_EDIT_FILE_TOOL_SCHEMA = {
  type: 'object',
  description:
    'This is a tool for creating a new file or editing an existing file. ' +
    'For moving or renaming files, you should generally use the `move_path` tool instead.\n\n' +
    'Before using this tool:\n' +
    '1. Use the `read_file` tool to understand the file\'s contents and context\n' +
    '2. Verify the directory path is correct (only when creating new files)',
  properties: {
    display_description: {
      type: 'string',
      description:
        'A one-line, user-friendly markdown description of the edit. ' +
        'NEVER mention the file path in this description.',
    },
    path: {
      type: 'string',
      description:
        'The full path of the file to create or modify. ' +
        'Must start with one of the project\'s root directories.',
    },
    mode: {
      type: 'string',
      enum: ['edit', 'create', 'overwrite'],
      description:
        "The mode of operation.\n" +
        "- 'create': Create a new file. Requires 'content' field.\n" +
        "- 'overwrite': Replace entire file. Requires 'content' field.\n" +
        "- 'edit': Make granular edits. Requires 'edits' field.",
    },
    content: {
      type: 'string',
      description: "The complete content for 'create' and 'overwrite' modes.",
    },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          old_text: {
            type: 'string',
            description: 'The exact text to find in the file (whitespace-sensitive).',
          },
          new_text: {
            type: 'string',
            description: 'The replacement text.',
          },
        },
        required: ['old_text', 'new_text'],
      },
      description: "Array of search/replace pairs for 'edit' mode.",
    },
  },
  required: ['display_description', 'path', 'mode'],
} as const;

// ---------------------------------------------------------------------------
// StreamingEditFileTool
// ---------------------------------------------------------------------------

export class StreamingEditFileTool implements AgentTool<StreamingEditFileToolInput, string> {
  readonly name = 'edit_file'; // Same name — Zed swaps between the two
  readonly kind: ToolKind = 'write';

  description(): string {
    return STREAMING_EDIT_FILE_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return STREAMING_EDIT_FILE_TOOL_SCHEMA;
  }

  initialTitle(input: StreamingEditFileToolInput | null): string {
    return input?.display_description ?? 'Editing file';
  }

  async run(input: StreamingEditFileToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const { host } = context;
    const absPath = host.project.resolveProjectPath(input.path);
    if (!absPath) {
      throw new Error(`Path ${input.path} not found in project`);
    }

    // Check permissions
    const decision = host.permissions.checkAutoPermission('edit_file', [input.path]);
    if (decision.type === 'deny') {
      throw new Error(decision.reason);
    }
    if (decision.type === 'confirm') {
      await context.eventStream.authorize(
        this.initialTitle(input),
        { toolName: 'edit_file', inputValues: [input.path] },
      );
    }

    context.eventStream.updateFields({
      locations: [{ path: absPath }],
    });

    switch (input.mode) {
      case 'create':
        return this.createFile(input, absPath, context);
      case 'overwrite':
        return this.overwriteFile(input, absPath, context);
      case 'edit':
        return this.editFile(input, absPath, context);
      default:
        throw new Error(`Unknown mode: ${input.mode}`);
    }
  }

  private async createFile(
    input: StreamingEditFileToolInput,
    absPath: string,
    context: ToolContext,
  ): Promise<AgentToolOutput> {
    const exists = await context.host.fileSystem.fileExists(absPath);
    if (exists) {
      throw new Error(
        `File ${input.path} already exists. Use 'edit' or 'overwrite' mode.`,
      );
    }

    const content = input.content ?? '';
    await context.host.fileSystem.writeFile(absPath, content);

    const diff = formatDiff(computeLineDiff('', content));
    if (diff) {
      context.eventStream.updateFields({
        content: [{ type: 'diff', path: absPath, diff }],
      });
    }

    return {
      llmOutput: textToolResult(`Created file: ${input.path}`),
      rawOutput: { mode: 'create', path: input.path },
    };
  }

  private async overwriteFile(
    input: StreamingEditFileToolInput,
    absPath: string,
    context: ToolContext,
  ): Promise<AgentToolOutput> {
    const before = await context.host.fileSystem.readFile(absPath).catch(() => '');
    const content = input.content ?? '';
    await context.host.fileSystem.writeFile(absPath, content);

    const diff = formatDiff(computeLineDiff(before, content));
    if (diff) {
      context.eventStream.updateFields({
        content: [{ type: 'diff', path: absPath, diff }],
      });
    }

    return {
      llmOutput: textToolResult(`Overwrote file: ${input.path}`),
      rawOutput: { mode: 'overwrite', path: input.path },
    };
  }

  /**
   * Apply granular edits using fuzzy matching.
   * Ported from: StreamingEditFileTool edit mode logic
   */
  private async editFile(
    input: StreamingEditFileToolInput,
    absPath: string,
    context: ToolContext,
  ): Promise<AgentToolOutput> {
    if (!input.edits || input.edits.length === 0) {
      throw new Error("Edit mode requires 'edits' array with at least one entry.");
    }

    const buffer = await context.host.fileSystem.openBuffer(absPath);
    const beforeContent = buffer.getContent();

    // Apply each edit using fuzzy matching
    let currentContent = beforeContent;
    let appliedCount = 0;
    let failedCount = 0;

    for (const edit of input.edits) {
      const matcher = new StreamingFuzzyMatcher(currentContent);
      matcher.push(edit.old_text + '\n');
      const matches = matcher.finish();

      if (matches.length > 0) {
        const match = matches[0]!;
        // Replace the matched range
        const lines = currentContent.split('\n');
        const newLines = edit.new_text.split('\n');
        lines.splice(match.startLine, match.endLine - match.startLine, ...newLines);
        currentContent = lines.join('\n');
        appliedCount++;
      } else {
        // Fallback: try exact string replacement
        if (currentContent.includes(edit.old_text)) {
          currentContent = currentContent.replace(edit.old_text, edit.new_text);
          appliedCount++;
        } else {
          failedCount++;
        }
      }
    }

    // Write the result
    await context.host.fileSystem.writeFile(absPath, currentContent);

    // Report diff
    const diff = formatDiff(computeLineDiff(beforeContent, currentContent));
    if (diff) {
      context.eventStream.updateFields({
        content: [{ type: 'diff', path: absPath, diff }],
      });
    }

    let text = `Edited file: ${input.path} (${appliedCount} edits applied`;
    if (failedCount > 0) {
      text += `, ${failedCount} failed`;
    }
    text += ')';

    return {
      llmOutput: textToolResult(text),
      rawOutput: {
        mode: 'edit',
        path: input.path,
        appliedCount,
        failedCount,
        diff,
      },
    };
  }
}
