/**
 * CreateFileParser — parses streaming file creation output.
 * Ported from: crates/agent/src/edit_agent/create_file_parser.rs (237 LOC)
 *
 * Detects code fences in the model output and extracts the file content.
 */

export interface CreateFileParserEvent {
  type: 'new_text';
  chunk: string;
}

type ParserState = 'pending' | 'within_text' | 'finishing' | 'finished';

/**
 * Streaming parser for file creation output.
 * The model wraps new file content in code fences (```...```).
 * This parser extracts the content from within the fences.
 */
export class CreateFileParser {
  private state: ParserState = 'pending';
  private buffer = '';

  /**
   * Push a chunk of text and get any events.
   * Pass null to signal end of input.
   */
  push(chunk: string | null): CreateFileParserEvent[] {
    if (chunk === null) {
      this.state = 'finishing';
    } else {
      this.buffer += chunk;
    }

    const events: CreateFileParserEvent[] = [];
    const startMarker = /\n?```\S*\n/;
    const endMarker = /(^|\n)```\s*$/;

    while (true) {
      switch (this.state) {
        case 'pending': {
          const match = this.buffer.match(startMarker);
          if (match && match.index !== undefined) {
            this.buffer = this.buffer.slice(match.index + match[0].length);
            this.state = 'within_text';
            continue;
          }
          return events;
        }

        case 'within_text': {
          // Trim trailing backticks and whitespace that might be the end marker
          const text = this.buffer.replace(/[`\n\s]+$/, '');
          if (text.length > 0) {
            events.push({ type: 'new_text', chunk: this.buffer.slice(0, text.length) });
            this.buffer = this.buffer.slice(text.length);
          }
          return events;
        }

        case 'finishing': {
          // Remove trailing end marker
          const endMatch = this.buffer.match(endMarker);
          if (endMatch && endMatch.index !== undefined) {
            this.buffer = this.buffer.slice(0, endMatch.index);
          }

          if (this.buffer.length > 0) {
            if (!this.buffer.endsWith('\n')) {
              this.buffer += '\n';
            }
            events.push({ type: 'new_text', chunk: this.buffer });
            this.buffer = '';
          }
          this.state = 'finished';
          return events;
        }

        case 'finished':
          return events;
      }
    }
  }
}
