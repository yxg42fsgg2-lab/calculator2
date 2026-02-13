/**
 * Markdown formatting utilities.
 * Ported from: crates/util/src/markdown.rs
 *
 * Zed uses a specific code block format with paths instead of language names:
 *   ```path/to/file.ts#L10-20
 *   code content
 *   ```
 *
 * This module provides utilities for formatting code blocks and inline code
 * in this Zed-specific format.
 */

/**
 * Format a code block with Zed's path-based syntax.
 * Ported from: MarkdownCodeBlock in util/src/markdown.rs
 *
 * @param tag The file path (optionally with #L1-10 line range)
 * @param text The code content
 */
export function markdownCodeBlock(tag: string, text: string): string {
  return `\`\`\`${tag}\n${text}\n\`\`\``;
}

/**
 * Format a code block with file path and optional line range.
 *
 * @param filePath The file path
 * @param text The code content
 * @param lineRange Optional [startLine, endLine] (1-indexed)
 */
export function markdownFileBlock(
  filePath: string,
  text: string,
  lineRange?: [number, number],
): string {
  let tag = filePath;
  if (lineRange) {
    tag += `#L${lineRange[0]}-${lineRange[1]}`;
  }
  return markdownCodeBlock(tag, text);
}

/**
 * Format inline code.
 * Ported from: MarkdownInlineCode in util/src/markdown.rs
 */
export function markdownInlineCode(text: string): string {
  return `\`${text}\``;
}

/**
 * Escape text for safe inclusion in Markdown.
 * Ported from: MarkdownEscaped in util/src/markdown.rs
 */
export function markdownEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
}

/**
 * Build a code block tag with file extension and optional line range.
 * Ported from: codeblock_tag() in thread.rs
 *
 * Example: "ts path/to/file.ts:10-20"
 */
export function codeblockTag(
  fullPath: string,
  lineRange?: [number, number],
): string {
  let result = '';
  const lastDot = fullPath.lastIndexOf('.');
  if (lastDot >= 0) {
    const ext = fullPath.slice(lastDot + 1);
    result += `${ext} `;
  }
  result += fullPath;
  if (lineRange) {
    if (lineRange[0] === lineRange[1]) {
      result += `:${lineRange[0] + 1}`;
    } else {
      result += `:${lineRange[0] + 1}-${lineRange[1] + 1}`;
    }
  }
  return result;
}
