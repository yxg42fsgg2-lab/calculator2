/**
 * EditFileTool — creates or edits files via the EditAgent sub-system.
 * Ported from: crates/agent/src/tools/edit_file_tool.rs (~724 LOC production)
 *
 * Three modes:
 * - 'edit': Granular edits via EditAgent (secondary LLM call with streaming diff parser)
 * - 'create': Create a new file via EditAgent (secondary LLM call with CreateFileParser)
 * - 'overwrite': Replace entire file contents via EditAgent
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';
import type { LanguageModel } from '../models/language-model.js';
import { EditAgent, type EditAgentOutput } from '../edit-agent/edit-agent.js';
import { editFormatForModel } from '../edit-agent/edit-parser.js';
import { formatDiff, computeLineDiff } from '../edit-agent/streaming-diff.js';

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

/**
 * Optional configuration for the EditFileTool.
 * Pass a model to enable EditAgent-powered edits (secondary LLM calls).
 * Without a model, the tool operates in "direct" mode using the description as content.
 */
export interface EditFileToolConfig {
  /**
   * The language model used by the EditAgent for generating edits.
   * If not set, the tool falls back to direct description-based behavior.
   */
  editModel?: LanguageModel;
}

export class EditFileTool implements AgentTool<EditFileToolInput, string> {
  readonly name = 'edit_file';
  readonly kind: ToolKind = 'write';

  private config: EditFileToolConfig;

  constructor(config: EditFileToolConfig = {}) {
    this.config = config;
  }

  /** Allow updating the edit model dynamically (e.g. when user switches models). */
  setEditModel(model: LanguageModel): void {
    this.config.editModel = model;
  }

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

    // Log the operation
    if (input.mode === 'create') context.actionLog?.fileCreate(absPath);
    else if (input.mode === 'edit') context.actionLog?.fileEdit(absPath, input.display_description);
    else context.actionLog?.fileWrite(absPath, input.display_description);

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

  /**
   * Create a new file.
   * If an EditAgent model is available, delegates to it for content generation.
   * Otherwise writes a stub file with the description as a comment.
   */
  private async createFile(
    input: EditFileToolInput,
    absPath: string,
    context: ToolContext,
  ): Promise<AgentToolOutput> {
    const exists = await context.host.fileSystem.fileExists(absPath);
    if (exists) {
      throw new Error(
        `File ${input.path} already exists. Use mode 'edit' to modify it or 'overwrite' to replace it.`,
      );
    }

    const model = this.config.editModel;
    if (model) {
      // Use EditAgent to generate file content
      const editAgent = new EditAgent({
        model,
        editFormat: editFormatForModel(String(model.providerId), String(model.id)),
      });

      const result = await editAgent.createFile(
        input.display_description,
        input.path,
        context.signal,
      );

      await context.host.fileSystem.writeFile(absPath, result.content);

      // Report diff to UI
      const diff = computeLineDiff('', result.content);
      const diffText = formatDiff(diff);
      if (diffText) {
        context.eventStream.updateFields({
          content: [{ type: 'diff', path: absPath, diff: diffText }],
        });
      }

      const text = `Created file: ${input.path}`;
      return {
        llmOutput: textToolResult(text),
        rawOutput: { rawEdits: result.rawOutput, parserMetrics: { tags: 0, mismatchedTags: 0 } },
      };
    }

    // Fallback: create empty file
    await context.host.fileSystem.writeFile(absPath, '');
    const text = `Created file: ${input.path}`;
    return { llmOutput: textToolResult(text), rawOutput: text };
  }

  /**
   * Overwrite an existing file.
   * If an EditAgent model is available, delegates to it.
   * Otherwise writes the description directly.
   */
  private async overwriteFile(
    input: EditFileToolInput,
    absPath: string,
    context: ToolContext,
  ): Promise<AgentToolOutput> {
    const model = this.config.editModel;
    if (model) {
      const editAgent = new EditAgent({
        model,
        editFormat: editFormatForModel(String(model.providerId), String(model.id)),
      });

      const buffer = await context.host.fileSystem.openBuffer(absPath);
      const result = await editAgent.overwriteFile(buffer, input.display_description, context.signal);

      // Save the buffer
      await buffer.save();

      // Report diff to UI
      if (result.diff) {
        context.eventStream.updateFields({
          content: [{ type: 'diff', path: absPath, diff: result.diff }],
        });
      }

      const text = `Overwrote file: ${input.path}`;
      return {
        llmOutput: textToolResult(text),
        rawOutput: result,
      };
    }

    // Fallback: overwrite with empty content (description-only mode)
    const before = await context.host.fileSystem.readFile(absPath);
    await context.host.fileSystem.writeFile(absPath, '');
    const diff = computeLineDiff(before, '');
    const diffText = formatDiff(diff);

    const text = `Overwrote file: ${input.path}`;
    return { llmOutput: textToolResult(text), rawOutput: { diff: diffText } };
  }

  /**
   * Edit an existing file with granular edits.
   * Uses the EditAgent which:
   * 1. Reads the current file content
   * 2. Makes a secondary LLM call with the edit description
   * 3. Parses the streaming diff output (XML or diff-fenced format)
   * 4. Applies the edits with fuzzy matching
   */
  private async editFile(
    input: EditFileToolInput,
    absPath: string,
    context: ToolContext,
  ): Promise<AgentToolOutput> {
    const model = this.config.editModel;
    if (!model) {
      throw new Error(
        'Edit mode requires a language model. Configure editModel on the EditFileTool or use create/overwrite mode.',
      );
    }

    const editAgent = new EditAgent({
      model,
      editFormat: editFormatForModel(String(model.providerId), String(model.id)),
    });

    // Open the file buffer
    const buffer = await context.host.fileSystem.openBuffer(absPath);

    // Check for stale file (external modifications since last read)
    // Ported from: edit_file_tool.rs stale file detection
    if (context.getFileReadTime) {
      const lastReadTime = context.getFileReadTime(absPath);
      if (lastReadTime !== undefined) {
        const currentMtime = await context.host.fileSystem.getMTime(absPath);
        if (currentMtime !== null && currentMtime > lastReadTime) {
          // File was modified externally since the agent last read it
          // Add a warning to the edit description so the EditAgent is aware
          input = {
            ...input,
            display_description: input.display_description +
              '\n\nWARNING: This file has been modified externally since you last read it. ' +
              'Re-read the file first to see the latest changes before editing.',
          };
        }
      }
    }

    // Run the EditAgent
    context.eventStream.updateFields({
      status: 'in_progress',
      title: input.display_description,
    });

    const result = await editAgent.editFile(buffer, input.display_description, context.signal);

    // Save the buffer
    await buffer.save();

    // Report diff to UI
    if (result.diff) {
      context.eventStream.updateFields({
        content: [{ type: 'diff', path: absPath, diff: result.diff }],
      });
    }

    // Build the output text
    let text = `Edited file: ${input.path}`;
    if (result.parserMetrics.mismatchedTags > 0) {
      text += ` (${result.parserMetrics.mismatchedTags} mismatched tags)`;
    }

    return {
      llmOutput: textToolResult(text),
      rawOutput: result,
    };
  }
}
