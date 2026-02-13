/**
 * Tests for the CreateFileParser.
 * Ported from: crates/agent/src/edit_agent/create_file_parser.rs tests
 */

import { describe, it, expect } from 'vitest';
import { CreateFileParser } from '../src/edit-agent/create-file-parser.js';

function parseAll(input: string): string {
  const parser = new CreateFileParser();
  let result = '';
  for (const event of parser.push(input)) {
    result += event.chunk;
  }
  for (const event of parser.push(null)) {
    result += event.chunk;
  }
  return result;
}

function parseChunked(input: string, chunkSize: number): string {
  const parser = new CreateFileParser();
  let result = '';
  for (let i = 0; i < input.length; i += chunkSize) {
    for (const event of parser.push(input.slice(i, i + chunkSize))) {
      result += event.chunk;
    }
  }
  for (const event of parser.push(null)) {
    result += event.chunk;
  }
  return result;
}

describe('CreateFileParser', () => {
  it('extracts content from code fences', () => {
    expect(parseAll('```\nHello world\n```')).toBe('Hello world');
  });

  it('handles language annotation on fences', () => {
    expect(parseAll('```rust\nHello world\n```')).toBe('Hello world');
  });

  it('handles prefix text before fences', () => {
    expect(
      parseAll('Let me write this file for you:\n\n```\nHello world\n```\n'),
    ).toBe('Hello world');
  });

  it('handles streaming in small chunks', () => {
    const result = parseChunked(
      '```\nHello world\n```',
      3,
    );
    expect(result).toContain('Hello world');
  });

  it('handles empty file content', () => {
    expect(parseAll('```\n```')).toBe('');
  });
});
