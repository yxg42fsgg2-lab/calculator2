/**
 * ReadFileTool — reads file content with optional line ranges and outline fallback.
 * Ported from: crates/agent/src/tools/read_file_tool.rs (~310 LOC production)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult, imageToolResult } from '../types/language-model.js';

export interface ReadFileToolInput {
  /** The relative path of the file to read. */
  path: string;
  /** Optional 1-based start line number. */
  start_line?: number;
  /** Optional 1-based end line number (inclusive). */
  end_line?: number;
}

export const READ_FILE_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Reads the content of the given file in the project.\n\n' +
    '- Never attempt to read a path that hasn\'t been previously mentioned.\n' +
    '- For large files, this tool returns a file outline with symbol names and line numbers instead of the full content.\n' +
    '  This outline IS a successful response - use the line numbers to read specific sections with start_line/end_line.\n' +
    '  Do NOT retry reading the same file without line numbers if you receive an outline.\n' +
    '- This tool supports reading image files. Supported formats: PNG, JPEG, WebP, GIF, BMP, TIFF.\n' +
    '  Image files are returned as visual content that you can analyze directly.',
  properties: {
    path: {
      type: 'string',
      description:
        'The relative path of the file to read. ' +
        'This path should never be absolute, and the first component of the path should always be a root directory in a project.',
    },
    start_line: {
      type: 'number',
      description: 'Optional line number to start reading on (1-based index)',
    },
    end_line: {
      type: 'number',
      description: 'Optional line number to end reading on (1-based index, inclusive)',
    },
  },
  required: ['path'],
} as const;

/** Maximum file size (in characters) before we fall back to outline mode. */
const MAX_FILE_SIZE_FOR_INLINE = 40_000;

export class ReadFileTool implements AgentTool<ReadFileToolInput, string> {
  readonly name = 'read_file';
  readonly kind: ToolKind = 'read';

  description(): string {
    return READ_FILE_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return READ_FILE_TOOL_SCHEMA;
  }

  initialTitle(input: ReadFileToolInput | null): string {
    if (!input?.path) return 'Read file';

    if (input.start_line !== undefined && input.end_line !== undefined) {
      return `Read file \`${input.path}\` (lines ${input.start_line}-${input.end_line})`;
    }
    if (input.start_line !== undefined) {
      return `Read file \`${input.path}\` (from line ${input.start_line})`;
    }
    return `Read file \`${input.path}\``;
  }

  async run(input: ReadFileToolInput, context: ToolContext): Promise<AgentToolOutput> {
    const { host } = context;
    const fs = host.fileSystem;

    // Resolve project path
    const absPath = host.project.resolveProjectPath(input.path);
    if (!absPath) {
      throw new Error(`Path ${input.path} not found in project`);
    }

    // Security: check exclusions
    if (fs.isPathExcluded(input.path)) {
      throw new Error(
        `Cannot read file because its path matches the global \`file_scan_exclusions\` setting: ${input.path}`,
      );
    }
    if (fs.isPathPrivate(input.path)) {
      throw new Error(
        `Cannot read file because its path matches the global \`private_files\` setting: ${input.path}`,
      );
    }

    // Check if file exists
    const exists = await fs.fileExists(absPath);
    if (!exists) {
      throw new Error(`${input.path} not found`);
    }

    // Record file read time for stale detection
    // Ported from: ReadFileTool recording mtime in thread.file_read_times
    const mtime = await fs.getMTime(absPath);
    if (mtime !== null && context.recordFileRead) {
      context.recordFileRead(absPath, mtime);
    }

    // Update tool call with location
    context.eventStream.updateFields({
      locations: [{ path: absPath, line: input.start_line ? input.start_line - 1 : undefined }],
    });

    // Handle image files
    if (fs.isImageFile(absPath)) {
      const imageData = await fs.readImageFile(absPath);
      return {
        llmOutput: imageToolResult({
          source: imageData.data,
        }),
        rawOutput: { type: 'image', path: input.path },
      };
    }

    // Handle line ranges
    if (input.start_line !== undefined || input.end_line !== undefined) {
      const startLine = Math.max(1, input.start_line ?? 1);
      let endLine = input.end_line ?? Number.MAX_SAFE_INTEGER;
      if (endLine <= startLine) {
        endLine = startLine + 1; // Read at least one line
      }

      const content = await fs.readFileRange(absPath, startLine, endLine);

      // Update tool call with content display
      context.eventStream.updateFields({
        content: [{
          type: 'content',
          content: `\`\`\`${input.path}\n${content}\`\`\``,
        }],
      });

      return {
        llmOutput: textToolResult(content),
        rawOutput: content,
      };
    }

    // No line range — check file size for outline fallback
    const fileSize = await fs.getFileSize(absPath);
    const content = await fs.readFile(absPath);

    if (content.length > MAX_FILE_SIZE_FOR_INLINE) {
      // Try to get an outline
      const outline = await fs.getFileOutline(absPath);
      if (outline) {
        const outlineText =
          'SUCCESS: File outline retrieved. This file is too large to read all at once, ' +
          "so the outline below shows the file's structure with line numbers.\n\n" +
          'IMPORTANT: Do NOT retry this call without line numbers - you will get the same outline.\n' +
          'Instead, use the line numbers below to read specific sections by calling this tool again with start_line and end_line parameters.\n\n' +
          outline.text +
          '\n\nNEXT STEPS: To read a specific symbol\'s implementation, call read_file with the same path plus start_line and end_line from the outline above.\n' +
          'For example, to read a function shown as [L100-150], use start_line: 100 and end_line: 150.';

        return {
          llmOutput: textToolResult(outlineText),
          rawOutput: outlineText,
        };
      }
    }

    // Return full content
    context.eventStream.updateFields({
      content: [{
        type: 'content',
        content: `\`\`\`${input.path}\n${content}\`\`\``,
      }],
    });

    return {
      llmOutput: textToolResult(content),
      rawOutput: content,
    };
  }
}
