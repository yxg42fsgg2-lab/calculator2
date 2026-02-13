/**
 * Tests for pattern extraction utilities.
 * Ported from: crates/agent/src/pattern_extraction.rs tests
 */

import { describe, it, expect } from 'vitest';
import {
  extractTerminalPattern,
  extractTerminalPatternDisplay,
  extractPathPattern,
  extractPathPatternDisplay,
  extractUrlPattern,
  extractUrlPatternDisplay,
} from '../src/permissions/pattern-extraction.js';

describe('extractTerminalPattern', () => {
  it('extracts base command', () => {
    expect(extractTerminalPattern('cargo build --release')).toBe('^cargo');
  });

  it('extracts npm', () => {
    expect(extractTerminalPattern('npm run test')).toBe('^npm');
  });

  it('handles single command', () => {
    expect(extractTerminalPattern('ls')).toBe('^ls');
  });

  it('returns null for empty', () => {
    expect(extractTerminalPattern('')).toBeNull();
  });
});

describe('extractTerminalPatternDisplay', () => {
  it('shows base command', () => {
    expect(extractTerminalPatternDisplay('cargo build --release')).toBe('cargo');
  });

  it('shows npm', () => {
    expect(extractTerminalPatternDisplay('npm run test')).toBe('npm');
  });
});

describe('extractPathPattern', () => {
  it('extracts first directory', () => {
    expect(extractPathPattern('src/main.rs')).toBe('^src/');
  });

  it('extracts tests directory', () => {
    expect(extractPathPattern('tests/integration/test.rs')).toBe('^tests/');
  });

  it('returns null for bare filename', () => {
    expect(extractPathPattern('file.txt')).toBeNull();
  });
});

describe('extractPathPatternDisplay', () => {
  it('shows first directory with slash', () => {
    expect(extractPathPatternDisplay('src/main.rs')).toBe('src/');
  });
});

describe('extractUrlPattern', () => {
  it('extracts origin', () => {
    expect(extractUrlPattern('https://example.com/api/v1')).toBe('^https://example\\.com');
  });

  it('handles URL without scheme', () => {
    expect(extractUrlPattern('example.com/path')).toBe('^https://example\\.com');
  });

  it('handles URL with port', () => {
    const pattern = extractUrlPattern('http://localhost:3000/api');
    expect(pattern).toContain('localhost');
  });
});

describe('extractUrlPatternDisplay', () => {
  it('shows hostname', () => {
    expect(extractUrlPatternDisplay('https://api.example.com/v2')).toBe('api.example.com');
  });
});
