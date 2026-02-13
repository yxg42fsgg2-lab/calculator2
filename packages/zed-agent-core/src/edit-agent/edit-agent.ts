/**
 * EditAgent — orchestrates file editing via secondary LLM calls.
 * Ported from: crates/agent/src/edit_agent.rs (~600 LOC production)
 *
 * The EditAgent handles three modes:
 * - create: Generate new file content
 * - edit: Make granular edits using search/replace blocks
 * - overwrite: Replace entire file content
 *
 * For edit mode, it:
 * 1. Reads the current file content
 * 2. Constructs a prompt with the file content and edit description
 * 3. Streams the model's response through the EditParser
 * 4. Uses the StreamingFuzzyMatcher to find where search blocks match
 * 5. Applies the replacements
 */

import type { LanguageModel } from '../models/language-model.js';
import type { LanguageModelRequest } from '../types/language-model.js';
import type { FileBuffer } from '../types/host.js';
import { EditParser, type EditFormat, type EditParserEvent, type EditParserMetrics, editFormatForModel } from './edit-parser.js';
import { CreateFileParser, type CreateFileParserEvent } from './create-file-parser.js';
import { StreamingFuzzyMatcher } from './streaming-fuzzy-matcher.js';
import { computeLineDiff, formatDiff, type DiffOperation } from './streaming-diff.js';
import {
  buildXmlEditPrompt,
  buildDiffFencedEditPrompt,
  buildCreateFilePrompt,
} from '../templates/edit-prompts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditAgentOutput {
  /** The raw edit instructions from the model. */
  rawEdits: string;
  /** Parser metrics (tag counts, mismatched tags). */
  parserMetrics: EditParserMetrics;
  /** The diff of changes applied. */
  diff?: string;
}

export interface EditAgentOptions {
  model: LanguageModel;
  editFormat?: EditFormat;
}

// ---------------------------------------------------------------------------
// EditAgent
// ---------------------------------------------------------------------------

export class EditAgent {
  private model: LanguageModel;
  private editFormat: EditFormat;

  constructor(options: EditAgentOptions) {
    this.model = options.model;
    this.editFormat = options.editFormat ??
      editFormatForModel(String(options.model.providerId), String(options.model.id));
  }

  /**
   * Create a new file with generated content.
   * Ported from: EditAgent::create_file()
   */
  async createFile(
    description: string,
    filePath?: string,
    signal?: AbortSignal,
  ): Promise<{ content: string; rawOutput: string }> {
    const prompt = this.buildCreatePrompt(description, filePath);
    const parser = new CreateFileParser();
    let content = '';
    let rawOutput = '';

    for await (const event of this.model.streamCompletion(prompt)) {
      if (signal?.aborted) break;

      if (event.type === 'text') {
        rawOutput += event.text;
        const events = parser.push(event.text);
        for (const e of events) {
          content += e.chunk;
        }
      }
    }

    // Finish parsing
    const finalEvents = parser.push(null);
    for (const e of finalEvents) {
      content += e.chunk;
    }

    return { content, rawOutput };
  }

  /**
   * Edit an existing file with granular edits.
   * Ported from: EditAgent::edit_file()
   */
  async editFile(
    buffer: FileBuffer,
    description: string,
    signal?: AbortSignal,
  ): Promise<EditAgentOutput> {
    const currentContent = buffer.getContent();
    const prompt = this.buildEditPrompt(description, buffer.path, currentContent);
    const parser = new EditParser(this.editFormat);
    const matcher = new StreamingFuzzyMatcher(currentContent);

    let rawEdits = '';
    let currentOldText = '';
    let currentNewText = '';
    let matchRange: { startLine: number; endLine: number } | null = null;

    // Accumulate edits to apply
    const edits: Array<{
      startLine: number;
      endLine: number;
      newText: string;
    }> = [];

    for await (const event of this.model.streamCompletion(prompt)) {
      if (signal?.aborted) break;

      if (event.type === 'text') {
        rawEdits += event.text;
        const parseEvents = parser.push(event.text);

        for (const pe of parseEvents) {
          if (pe.type === 'old_text') {
            currentOldText += pe.chunk;
            if (!pe.done) {
              // Stream to fuzzy matcher
              matchRange = matcher.push(pe.chunk, pe.lineHint);
            } else {
              // Old text complete — finalize match
              const matches = matcher.finish();
              if (matches.length > 0) {
                matchRange = matches[0]!;
              }
            }
          } else if (pe.type === 'new_text') {
            currentNewText += pe.chunk;
            if (pe.done && matchRange) {
              // Collect this edit
              edits.push({
                startLine: matchRange.startLine + 1, // Convert to 1-indexed
                endLine: matchRange.endLine,
                newText: currentNewText,
              });
              // Reset for next edit
              currentOldText = '';
              currentNewText = '';
              matchRange = null;
            }
          }
        }
      }
    }

    // Finish parsing
    const finalEvents = parser.push(null);
    for (const pe of finalEvents) {
      if (pe.type === 'new_text' && pe.done && matchRange) {
        currentNewText += pe.chunk;
        edits.push({
          startLine: matchRange.startLine + 1,
          endLine: matchRange.endLine,
          newText: currentNewText,
        });
      }
    }

    // Apply edits in reverse order (so line numbers don't shift)
    const sortedEdits = edits.sort((a, b) => b.startLine - a.startLine);
    const beforeContent = buffer.getContent();

    for (const edit of sortedEdits) {
      buffer.applyEdit(edit.startLine, edit.endLine, edit.newText);
    }

    const afterContent = buffer.getContent();
    const diffOps = computeLineDiff(beforeContent, afterContent);
    const diff = formatDiff(diffOps);

    return {
      rawEdits,
      parserMetrics: parser.getMetrics(),
      diff: diff || undefined,
    };
  }

  /**
   * Overwrite entire file content.
   */
  async overwriteFile(
    buffer: FileBuffer,
    description: string,
    signal?: AbortSignal,
  ): Promise<EditAgentOutput> {
    const result = await this.createFile(description, buffer.path, signal);

    const beforeContent = buffer.getContent();
    buffer.applyEdit(1, buffer.getLineCount(), result.content);
    const afterContent = buffer.getContent();

    const diffOps = computeLineDiff(beforeContent, afterContent);
    const diff = formatDiff(diffOps);

    return {
      rawEdits: result.rawOutput,
      parserMetrics: { tags: 0, mismatchedTags: 0 },
      diff: diff || undefined,
    };
  }

  // --- Prompt builders ---

  /**
   * Build a prompt for creating a new file.
   * Uses the ported Handlebars template from create_file_prompt.hbs.
   */
  private buildCreatePrompt(description: string, filePath?: string): LanguageModelRequest {
    const prompt = buildCreateFilePrompt({
      path: filePath,
      edit_description: description,
    });

    return {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          cache: false,
        },
      ],
      tools: [],
    };
  }

  /**
   * Build a prompt for editing an existing file.
   * Uses the ported Handlebars templates from edit_file_prompt_xml.hbs
   * or edit_file_prompt_diff_fenced.hbs depending on the edit format.
   */
  private buildEditPrompt(
    description: string,
    filePath: string,
    currentContent: string,
  ): LanguageModelRequest {
    // Build the edit prompt using the appropriate template
    const editPromptData = {
      path: filePath,
      edit_description: description,
    };

    const editInstructions = this.editFormat === 'xml_tags'
      ? buildXmlEditPrompt(editPromptData)
      : buildDiffFencedEditPrompt(editPromptData);

    // Include current file content as context
    const prompt = `Current file content:\n\`\`\`\n${currentContent}\n\`\`\`\n\n${editInstructions}`;

    return {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          cache: false,
        },
      ],
      tools: [],
    };
  }
}
