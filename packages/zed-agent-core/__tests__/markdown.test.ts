/**
 * Tests for Markdown formatting utilities.
 * Ported from: crates/util/src/markdown.rs tests
 */

import { describe, it, expect } from 'vitest';
import {
  markdownCodeBlock,
  markdownFileBlock,
  markdownInlineCode,
  markdownEscape,
  codeblockTag,
} from '../src/utils/markdown.js';

describe('markdownCodeBlock', () => {
  it('formats a simple code block', () => {
    expect(markdownCodeBlock('path/to/file.ts', 'const x = 1;'))
      .toBe('```path/to/file.ts\nconst x = 1;\n```');
  });

  it('handles multi-line content', () => {
    const result = markdownCodeBlock('src/main.rs', 'fn main() {\n  println!("hello");\n}');
    expect(result).toBe('```src/main.rs\nfn main() {\n  println!("hello");\n}\n```');
  });
});

describe('markdownFileBlock', () => {
  it('formats without line range', () => {
    expect(markdownFileBlock('src/main.ts', 'code'))
      .toBe('```src/main.ts\ncode\n```');
  });

  it('formats with line range', () => {
    expect(markdownFileBlock('src/main.ts', 'code', [10, 20]))
      .toBe('```src/main.ts#L10-20\ncode\n```');
  });
});

describe('markdownInlineCode', () => {
  it('wraps text in backticks', () => {
    expect(markdownInlineCode('fileName')).toBe('`fileName`');
  });
});

describe('markdownEscape', () => {
  it('escapes special characters', () => {
    expect(markdownEscape('**bold**')).toBe('\\*\\*bold\\*\\*');
    expect(markdownEscape('[link](url)')).toBe('\\[link\\]\\(url\\)');
  });
});

describe('codeblockTag', () => {
  it('includes extension prefix', () => {
    expect(codeblockTag('/path/to/file.rs')).toBe('rs /path/to/file.rs');
  });

  it('includes line range', () => {
    expect(codeblockTag('/path/to/file.ts', [9, 19])).toBe('ts /path/to/file.ts:10-20');
  });

  it('handles single line', () => {
    expect(codeblockTag('/path/to/file.py', [4, 4])).toBe('py /path/to/file.py:5');
  });

  it('handles no extension', () => {
    expect(codeblockTag('Makefile')).toBe('Makefile');
  });
});
