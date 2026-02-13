/**
 * Tests for the shell command parser.
 * Ported from: crates/shell_command_parser/src/shell_command_parser.rs tests
 */

import { describe, it, expect } from 'vitest';
import {
  extractCommands,
  extractBaseCommand,
} from '../src/permissions/shell-command-parser.js';

describe('extractCommands', () => {
  it('handles simple command', () => {
    expect(extractCommands('cargo build')).toEqual(['cargo build']);
  });

  it('splits on &&', () => {
    expect(extractCommands('cargo build && cargo test')).toEqual([
      'cargo build',
      'cargo test',
    ]);
  });

  it('splits on ||', () => {
    expect(extractCommands('cargo build || echo failed')).toEqual([
      'cargo build',
      'echo failed',
    ]);
  });

  it('splits on ;', () => {
    expect(extractCommands('ls; pwd; echo done')).toEqual([
      'ls',
      'pwd',
      'echo done',
    ]);
  });

  it('splits on |', () => {
    expect(extractCommands('ls | grep foo')).toEqual(['ls', 'grep foo']);
  });

  it('handles mixed operators', () => {
    expect(
      extractCommands('cargo build && cargo test; echo done'),
    ).toEqual(['cargo build', 'cargo test', 'echo done']);
  });

  it('respects single quotes', () => {
    expect(extractCommands("echo 'a && b'")).toEqual(["echo 'a && b'"]);
  });

  it('respects double quotes', () => {
    expect(extractCommands('echo "a && b"')).toEqual(['echo "a && b"']);
  });

  it('handles parentheses', () => {
    expect(extractCommands('(cd dir && make) && echo done')).toEqual([
      '(cd dir && make)',
      'echo done',
    ]);
  });

  it('handles empty input', () => {
    expect(extractCommands('')).toEqual([]);
  });

  it('handles dangerous commands', () => {
    const cmds = extractCommands('cargo build && rm -rf /');
    expect(cmds).toEqual(['cargo build', 'rm -rf /']);
  });
});

describe('extractBaseCommand', () => {
  it('extracts simple command', () => {
    expect(extractBaseCommand('cargo build')).toBe('cargo');
  });

  it('extracts command with flags', () => {
    expect(extractBaseCommand('npm run test')).toBe('npm');
  });

  it('handles leading env vars', () => {
    expect(extractBaseCommand('FOO=bar cargo build')).toBe('cargo');
  });

  it('handles empty input', () => {
    expect(extractBaseCommand('')).toBe(null);
  });
});
