/**
 * Tests for the ActionLog.
 */

import { describe, it, expect } from 'vitest';
import { ActionLog } from '../src/utils/action-log.js';

describe('ActionLog', () => {
  it('starts empty', () => {
    const log = new ActionLog();
    expect(log.size).toBe(0);
    expect(log.getEntries()).toEqual([]);
  });

  it('records file reads', () => {
    const log = new ActionLog();
    log.fileRead('/project/main.ts');
    log.fileRead('/project/utils.ts');

    expect(log.size).toBe(2);
    expect(log.filesRead()).toEqual(['/project/main.ts', '/project/utils.ts']);
  });

  it('records file writes', () => {
    const log = new ActionLog();
    log.fileWrite('/project/output.ts', 'new content');
    log.fileCreate('/project/new-file.ts');
    log.fileEdit('/project/main.ts', 'fixed bug');
    log.fileDelete('/project/old.ts');

    expect(log.filesModified()).toContain('/project/output.ts');
    expect(log.filesModified()).toContain('/project/new-file.ts');
    expect(log.filesModified()).toContain('/project/main.ts');
    expect(log.filesModified()).toContain('/project/old.ts');
  });

  it('records terminal commands', () => {
    const log = new ActionLog();
    log.terminalCommand('npm test', '/project');
    log.terminalCommand('cargo build');

    const cmds = log.getByType('terminal_command');
    expect(cmds).toHaveLength(2);
    expect(cmds[0]!.command).toBe('npm test');
    expect(cmds[0]!.path).toBe('/project');
  });

  it('records tool calls and errors', () => {
    const log = new ActionLog();
    log.toolCall('read_file', 'main.ts');
    log.toolCall('grep', 'pattern: /todo/i');
    log.toolError('edit_file', 'File not found');

    expect(log.getByType('tool_call')).toHaveLength(2);
    expect(log.getByType('tool_error')).toHaveLength(1);
  });

  it('provides summary counts', () => {
    const log = new ActionLog();
    log.fileRead('/a');
    log.fileRead('/b');
    log.fileWrite('/c');
    log.terminalCommand('ls');

    const summary = log.summary();
    expect(summary['file_read']).toBe(2);
    expect(summary['file_write']).toBe(1);
    expect(summary['terminal_command']).toBe(1);
  });

  it('returns recent entries', () => {
    const log = new ActionLog();
    for (let i = 0; i < 10; i++) {
      log.fileRead(`/file-${i}`);
    }

    const recent = log.getRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0]!.path).toBe('/file-7');
    expect(recent[2]!.path).toBe('/file-9');
  });

  it('deduplicates file lists', () => {
    const log = new ActionLog();
    log.fileRead('/same-file.ts');
    log.fileRead('/same-file.ts');
    log.fileRead('/same-file.ts');

    expect(log.filesRead()).toEqual(['/same-file.ts']);
  });

  it('respects max entries limit', () => {
    const log = new ActionLog(5);
    for (let i = 0; i < 10; i++) {
      log.fileRead(`/file-${i}`);
    }

    expect(log.size).toBe(5);
    expect(log.getEntries()[0]!.path).toBe('/file-5'); // First 5 evicted
  });

  it('clears all entries', () => {
    const log = new ActionLog();
    log.fileRead('/a');
    log.fileWrite('/b');
    expect(log.size).toBe(2);

    log.clear();
    expect(log.size).toBe(0);
  });

  it('includes timestamps', () => {
    const before = Date.now();
    const log = new ActionLog();
    log.fileRead('/test');
    const after = Date.now();

    const entry = log.getEntries()[0]!;
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
  });
});
