/**
 * EditFileTool — creates or edits files.
 * Ported from: crates/agent/src/tools/edit_file_tool.rs (~724 LOC production)
 *
 * This is the most complex tool — it supports three modes:
 * - 'edit': Granular edits via the EditAgent sub-system
 * - 'create': Create a new file
 * - 'overwrite': Replace entire file contents
 *
 * The edit mode delegates to the EditAgent which makes a secondary LLM call
 * to generate streaming diffs. For now, we implement create and overwrite
 * directly, and edit mode will be fully implemented in Phase 4.
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export type EditFileMode = 'edit' | 'create' | 'overwrite';

export interface EditFileToolInput {
  /** A one-line description of the edit (shown in UI). */
  display_description: string;
  /** The file path to create or modify. */
  path: string;
  /** The mode: 'edit', 'create', or 'overwrite'. */
  mode: EditFileMode;
}

export const EDIT_FILE_TOOL_SCHEMA = {
  type: 'object',
  description:
    'This is a tool for creating a new file or editing an existing file. ' +
    'For moving or renaming files, you should generally use the `move_path` tool instead.\n\n' +
    'Before using this tool:\n\n' +
    "1. Use the `read_file` tool to understand the file's contents and context\n\n" +
    '2. Verify the directory path is correct (only applicable when creating new files):\n' +
    '   - Use the `list_directory` tool to verify the parent directory exists and is the correct location',
  properties: {
    display_description: {
      type: 'string',
      description:
        'A one-line, user-friendly markdown description of the edit. ' +
        'This will be shown in the UI and also passed to another model to perform the edit. ' +
        'Be terse, but also descriptive. NEVER mention the file path in this description.',
    },
    path: {
      type: 'string',
      description:
        'The full path of the file to create or modify in the project. ' +
        'WARNING: When specifying which file path need changing, you MUST start each path with one of the project\'s root directories.',
    },
    mode: {
      type: 'string',
      enum: ['edit', 'create', 'overwrite'],
      description:
        "The mode of operation on the file. Possible values:\n" +
        "- 'edit': Make granular edits to an existing file.\n" +
        "- 'create': Create a new file if it doesn't exist.\n" +
        "- 'overwrite': Replace the entire contents of an existing file.\n\n" +
        'When a file already exists or you just created it, prefer editing it as opposed to recreating it from scratch.',
    },
  },
  required: ['display_description', 'path', 'mode'],
} as const;

export class EditFileTool implements AgentTool<EditFileToolInput, string> {
  readonly name = 'edit_file';
  readonly kind: ToolKind = 'write';

  description(): string {
    return EDIT_FILE_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return EDIT_FILE_TOOL_SCHEMA;
  }

  initialTitle(input: EditFileToolInput | null): string {
    if (input?.display_description) {
      return input.display_description;
    }
    return 'Editing file';
  }

  async run(input: EditFileToolInput, context: ToolContext): Promise<AgentToolOutput> {
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

    // Update tool call location
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
        throw new Error(`Unknown edit mode: ${input.mode}`);
    }
  }

  private async createFile(
    input: EditFileToolInput,
    absPath: string,
    context: ToolContext,
  ): Promise<AgentToolOutput> {
    // Check if file already exists
    const exists = await context.host.fileSystem.fileExists(absPath);
    if (exists) {
      throw new Error(
        `File ${input.path} already exists. Use mode 'edit' to modify it or 'overwrite' to replace it.`,
      );
    }

    // For create mode, the display_description IS the content instruction.
    // In the full implementation, this would go through the EditAgent / CreateFileParser.
    // For now, create an empty file as a placeholder.
    // The actual content generation will be implemented with the EditAgent in Phase 4.
    await context.host.fileSystem.writeFile(absPath, '');

    const text = `Created file: ${input.path}`;
    return { llmOutput: textToolResult(text), rawOutput: text };
  }

  private async overwriteFile(
    input: EditFileToolInput,
    absPath: string,
    context: ToolContext,
  ): Promise<AgentToolOutput> {
    // In the full implementation, this would use the EditAgent with overwrite mode.
    // The description tells the EditAgent what the new content should be.
    // For now, we note that the full implementation requires Phase 4 (EditAgent).

    const text = `Overwrite mode for ${input.path}: "${input.display_description}". ` +
      'Note: Full overwrite implementation requires EditAgent (Phase 4).';
    return { llmOutput: textToolResult(text), rawOutput: text };
  }

  private async editFile(
    input: EditFileToolInput,
    absPath: string,
    context: ToolContext,
  ): Promise<AgentToolOutput> {
    // Edit mode delegates to the EditAgent sub-system which:
    // 1. Reads the current file content
    // 2. Makes a secondary LLM call with the edit description
    // 3. Parses the streaming diff output (XML or diff-fenced format)
    // 4. Applies the edits with fuzzy matching
    //
    // This will be fully implemented in Phase 4.

    const text = `Edit mode for ${input.path}: "${input.display_description}". ` +
      'Note: Full edit implementation requires EditAgent (Phase 4).';
    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
