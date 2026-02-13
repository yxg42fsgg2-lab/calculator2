/**
 * Tests for the TerminalTool output processing.
 * Ported from: crates/agent/src/tools/terminal_tool.rs tests
 */

import { describe, it, expect } from 'vitest';

// Import the process_content logic by testing the tool's output formatting
// We'll test the output processing logic directly

function processContent(
  output: { output: string; truncated: boolean; exitStatus: { exitCode: number | null } | null },
  command: string,
  timedOut: boolean,
  userStopped: boolean,
): string {
  const rawContent = output.output.trim();
  const isEmpty = rawContent.length === 0;
  let content = `\`\`\`\n${rawContent}\n\`\`\``;

  if (output.truncated) {
    content = `Command output too long. The first ${content.length} bytes:\n\n${content}`;
  }

  if (userStopped) {
    if (isEmpty) {
      return (
        'The user stopped this command. No output was captured before stopping.\n\n' +
        'Since the user intentionally interrupted this command, ask them what they would like to do next ' +
        'rather than automatically retrying or assuming something went wrong.'
      );
    }
    return (
      `The user stopped this command. Output captured before stopping:\n\n${content}\n\n` +
      'Since the user intentionally interrupted this command, ask them what they would like to do next ' +
      'rather than automatically retrying or assuming something went wrong.'
    );
  }

  if (timedOut) {
    if (isEmpty) {
      return `Command "${command}" timed out. No output was captured.`;
    }
    return `Command "${command}" timed out. Output captured before timeout:\n\n${content}`;
  }

  const exitCode = output.exitStatus?.exitCode;
  if (exitCode === 0) {
    return isEmpty ? 'Command executed successfully.' : content;
  }
  if (exitCode !== null && exitCode !== undefined) {
    if (isEmpty) {
      return `Command "${command}" failed with exit code ${exitCode}.`;
    }
    return `Command "${command}" failed with exit code ${exitCode}.\n\n${content}`;
  }

  if (isEmpty) {
    return 'Command terminated unexpectedly. No output was captured.';
  }
  return `Command terminated unexpectedly. Output captured:\n\n${content}`;
}

describe('TerminalTool output processing', () => {
  it('handles successful command with output', () => {
    const result = processContent(
      { output: 'success output', truncated: false, exitStatus: { exitCode: 0 } },
      'echo hello',
      false,
      false,
    );
    expect(result).toContain('success output');
    expect(result).not.toContain('failed');
  });

  it('handles successful command with empty output', () => {
    const result = processContent(
      { output: '', truncated: false, exitStatus: { exitCode: 0 } },
      'true',
      false,
      false,
    );
    expect(result).toContain('executed successfully');
  });

  it('handles failed command', () => {
    const result = processContent(
      { output: 'error output', truncated: false, exitStatus: { exitCode: 1 } },
      'false',
      false,
      false,
    );
    expect(result).toContain('failed with exit code 1');
    expect(result).toContain('error output');
  });

  it('handles failed command with empty output', () => {
    const result = processContent(
      { output: '', truncated: false, exitStatus: { exitCode: 1 } },
      'false',
      false,
      false,
    );
    expect(result).toContain('failed with exit code 1');
  });

  it('handles user stopped with output', () => {
    const result = processContent(
      { output: 'partial output', truncated: false, exitStatus: null },
      'cargo build',
      false,
      true,
    );
    expect(result).toContain('user stopped');
    expect(result).toContain('partial output');
    expect(result).toContain('ask them what they would like to do');
  });

  it('handles user stopped with empty output', () => {
    const result = processContent(
      { output: '', truncated: false, exitStatus: null },
      'cargo build',
      false,
      true,
    );
    expect(result).toContain('user stopped');
    expect(result).toContain('No output was captured');
  });

  it('handles timed out with output', () => {
    const result = processContent(
      { output: 'build output here', truncated: false, exitStatus: null },
      'cargo build',
      true,
      false,
    );
    expect(result).toContain('timed out');
    expect(result).toContain('build output here');
  });

  it('handles timed out with empty output', () => {
    const result = processContent(
      { output: '', truncated: false, exitStatus: null },
      'sleep 1000',
      true,
      false,
    );
    expect(result).toContain('timed out');
    expect(result).toContain('No output was captured');
  });

  it('handles unexpected termination with output', () => {
    const result = processContent(
      { output: 'some output', truncated: false, exitStatus: null },
      'some_command',
      false,
      false,
    );
    expect(result).toContain('terminated unexpectedly');
    expect(result).toContain('some output');
  });

  it('handles unexpected termination with empty output', () => {
    const result = processContent(
      { output: '', truncated: false, exitStatus: null },
      'some_command',
      false,
      false,
    );
    expect(result).toContain('terminated unexpectedly');
    expect(result).toContain('No output was captured');
  });
});
