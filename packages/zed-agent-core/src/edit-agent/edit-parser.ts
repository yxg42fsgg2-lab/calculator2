/**
 * EditParser — parses streaming edit instructions from the model.
 * Ported from: crates/agent/src/edit_agent/edit_parser.rs (~448 LOC production)
 *
 * Supports two formats:
 * - XmlTags: <old_text>...</old_text> <new_text>...</new_text>
 * - DiffFenced: <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditFormat = 'xml_tags' | 'diff_fenced';

export interface EditParserEvent {
  type: 'old_text' | 'new_text';
  chunk: string;
  done: boolean;
  lineHint?: number;
}

export interface EditParserMetrics {
  tags: number;
  mismatchedTags: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OLD_TEXT_END_TAG = '</old_text>';
const NEW_TEXT_END_TAG = '</new_text>';
const EDITS_END_TAG = '</edits>';
const SEARCH_MARKER = '<<<<<<< SEARCH';
const SEPARATOR_MARKER = '=======';
const REPLACE_MARKER = '>>>>>>> REPLACE';

// ---------------------------------------------------------------------------
// EditParser
// ---------------------------------------------------------------------------

type ParserState =
  | 'idle'
  | 'in_old_text'
  | 'in_new_text'
  | 'done';

/**
 * Streaming edit parser that processes text chunks and emits edit events.
 * Ported from: EditParser in edit_parser.rs
 */
export class EditParser {
  private format: EditFormat;
  private state: ParserState = 'idle';
  private buffer = '';
  private metrics: EditParserMetrics = { tags: 0, mismatchedTags: 0 };

  constructor(format: EditFormat) {
    this.format = format;
  }

  /**
   * Push a chunk of text and get any edit events.
   * Pass null to signal end of input.
   */
  push(chunk: string | null): EditParserEvent[] {
    if (chunk === null) {
      return this.finish();
    }

    this.buffer += chunk;

    if (this.format === 'xml_tags') {
      return this.parseXml();
    } else {
      return this.parseDiffFenced();
    }
  }

  getMetrics(): EditParserMetrics {
    return { ...this.metrics };
  }

  // --- XML format parser ---

  private parseXml(): EditParserEvent[] {
    const events: EditParserEvent[] = [];

    while (true) {
      if (this.state === 'idle') {
        // Look for <old_text> tag
        const oldIdx = this.buffer.indexOf('<old_text>');
        if (oldIdx >= 0) {
          this.buffer = this.buffer.slice(oldIdx + '<old_text>'.length);
          this.state = 'in_old_text';
          this.metrics.tags++;
          continue;
        }
        break;
      }

      if (this.state === 'in_old_text') {
        const endIdx = this.buffer.indexOf(OLD_TEXT_END_TAG);
        if (endIdx >= 0) {
          const text = this.buffer.slice(0, endIdx);
          this.buffer = this.buffer.slice(endIdx + OLD_TEXT_END_TAG.length);
          events.push({ type: 'old_text', chunk: text, done: true });
          this.metrics.tags++;

          // Look for <new_text> tag
          const newIdx = this.buffer.indexOf('<new_text>');
          if (newIdx >= 0) {
            this.buffer = this.buffer.slice(newIdx + '<new_text>'.length);
            this.state = 'in_new_text';
            this.metrics.tags++;
          } else {
            this.state = 'idle';
          }
          continue;
        }

        // Check for end tags that indicate premature termination
        for (const endTag of [EDITS_END_TAG, '</parameter>']) {
          if (this.buffer.includes(endTag)) {
            const text = this.buffer.slice(0, this.buffer.indexOf(endTag));
            this.buffer = '';
            events.push({ type: 'old_text', chunk: text, done: true });
            this.state = 'done';
            this.metrics.mismatchedTags++;
            return events;
          }
        }

        // Emit partial content if we have enough buffered
        if (this.buffer.length > OLD_TEXT_END_TAG.length * 2) {
          const safe = this.buffer.length - OLD_TEXT_END_TAG.length;
          const text = this.buffer.slice(0, safe);
          this.buffer = this.buffer.slice(safe);
          events.push({ type: 'old_text', chunk: text, done: false });
        }
        break;
      }

      if (this.state === 'in_new_text') {
        const endIdx = this.buffer.indexOf(NEW_TEXT_END_TAG);
        if (endIdx >= 0) {
          const text = this.buffer.slice(0, endIdx);
          this.buffer = this.buffer.slice(endIdx + NEW_TEXT_END_TAG.length);
          events.push({ type: 'new_text', chunk: text, done: true });
          this.metrics.tags++;
          this.state = 'idle';
          continue;
        }

        // Check for end tags
        for (const endTag of [EDITS_END_TAG, '</parameter>']) {
          if (this.buffer.includes(endTag)) {
            const text = this.buffer.slice(0, this.buffer.indexOf(endTag));
            this.buffer = '';
            events.push({ type: 'new_text', chunk: text, done: true });
            this.state = 'done';
            this.metrics.mismatchedTags++;
            return events;
          }
        }

        // Emit partial
        if (this.buffer.length > NEW_TEXT_END_TAG.length * 2) {
          const safe = this.buffer.length - NEW_TEXT_END_TAG.length;
          const text = this.buffer.slice(0, safe);
          this.buffer = this.buffer.slice(safe);
          events.push({ type: 'new_text', chunk: text, done: false });
        }
        break;
      }

      break;
    }

    return events;
  }

  // --- Diff-fenced format parser ---

  private parseDiffFenced(): EditParserEvent[] {
    const events: EditParserEvent[] = [];

    while (true) {
      if (this.state === 'idle') {
        // Look for <<<<<<< SEARCH
        const searchIdx = this.buffer.indexOf(SEARCH_MARKER);
        if (searchIdx >= 0) {
          // Extract optional line hint from "<<<<<<< SEARCH line=42"
          const lineEnd = this.buffer.indexOf('\n', searchIdx);
          if (lineEnd >= 0) {
            const markerLine = this.buffer.slice(searchIdx, lineEnd);
            const lineMatch = markerLine.match(/line=(\d+)/);
            const lineHint = lineMatch ? parseInt(lineMatch[1]!, 10) : undefined;

            this.buffer = this.buffer.slice(lineEnd + 1);
            this.state = 'in_old_text';

            // Emit any initial old_text
            events.push({
              type: 'old_text',
              chunk: '',
              done: false,
              lineHint,
            });
            continue;
          }
        }
        break;
      }

      if (this.state === 'in_old_text') {
        // Look for =======
        const sepIdx = this.buffer.indexOf(SEPARATOR_MARKER);
        if (sepIdx >= 0) {
          // Check it's on its own line
          const lineStart = this.buffer.lastIndexOf('\n', sepIdx - 1);
          const before = this.buffer.slice(lineStart + 1, sepIdx).trim();
          if (before.length === 0) {
            const text = this.buffer.slice(0, lineStart >= 0 ? lineStart : 0);
            this.buffer = this.buffer.slice(sepIdx + SEPARATOR_MARKER.length);
            // Skip the newline after separator
            if (this.buffer.startsWith('\n')) {
              this.buffer = this.buffer.slice(1);
            }
            events.push({ type: 'old_text', chunk: text, done: true });
            this.state = 'in_new_text';
            continue;
          }
        }

        // Emit partial
        if (this.buffer.length > SEPARATOR_MARKER.length * 2) {
          const safe = this.buffer.length - SEPARATOR_MARKER.length - 1;
          if (safe > 0) {
            const text = this.buffer.slice(0, safe);
            this.buffer = this.buffer.slice(safe);
            events.push({ type: 'old_text', chunk: text, done: false });
          }
        }
        break;
      }

      if (this.state === 'in_new_text') {
        // Look for >>>>>>> REPLACE
        const replaceIdx = this.buffer.indexOf(REPLACE_MARKER);
        if (replaceIdx >= 0) {
          const lineStart = this.buffer.lastIndexOf('\n', replaceIdx - 1);
          const text = this.buffer.slice(0, lineStart >= 0 ? lineStart : 0);
          this.buffer = this.buffer.slice(replaceIdx + REPLACE_MARKER.length);
          // Skip trailing newline
          if (this.buffer.startsWith('\n')) {
            this.buffer = this.buffer.slice(1);
          }
          events.push({ type: 'new_text', chunk: text, done: true });
          this.state = 'idle';
          continue;
        }

        // Emit partial
        if (this.buffer.length > REPLACE_MARKER.length * 2) {
          const safe = this.buffer.length - REPLACE_MARKER.length - 1;
          if (safe > 0) {
            const text = this.buffer.slice(0, safe);
            this.buffer = this.buffer.slice(safe);
            events.push({ type: 'new_text', chunk: text, done: false });
          }
        }
        break;
      }

      break;
    }

    return events;
  }

  // --- Finish ---

  private finish(): EditParserEvent[] {
    const events: EditParserEvent[] = [];

    if (this.state === 'in_old_text' && this.buffer.length > 0) {
      events.push({ type: 'old_text', chunk: this.buffer, done: true });
      this.buffer = '';
      this.metrics.mismatchedTags++;
    }

    if (this.state === 'in_new_text' && this.buffer.length > 0) {
      events.push({ type: 'new_text', chunk: this.buffer, done: true });
      this.buffer = '';
      this.metrics.mismatchedTags++;
    }

    this.state = 'done';
    return events;
  }
}

/**
 * Determine the best edit format for a model.
 * Ported from: EditFormat::from_model()
 */
export function editFormatForModel(providerId: string, modelId: string): EditFormat {
  if (providerId === 'google' || modelId.toLowerCase().includes('gemini')) {
    return 'diff_fenced';
  }
  return 'xml_tags';
}
