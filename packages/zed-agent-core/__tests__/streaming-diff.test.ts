/**
 * Tests for the streaming diff engine.
 */

import { describe, it, expect } from 'vitest';
import { computeLineDiff, formatDiff } from '../src/edit-agent/streaming-diff.js';

describe('computeLineDiff', () => {
  it('handles identical texts', () => {
    const ops = computeLineDiff('hello\nworld', 'hello\nworld');
    const equalOps = ops.filter((o) => o.type === 'equal');
    expect(equalOps.length).toBeGreaterThan(0);
    expect(ops.filter((o) => o.type !== 'equal').length).toBe(0);
  });

  it('detects insertions', () => {
    const ops = computeLineDiff('a\nc', 'a\nb\nc');
    const insertOps = ops.filter((o) => o.type === 'insert');
    expect(insertOps.length).toBeGreaterThan(0);
    expect(insertOps.some((o) => o.text.includes('b'))).toBe(true);
  });

  it('detects deletions', () => {
    const ops = computeLineDiff('a\nb\nc', 'a\nc');
    const deleteOps = ops.filter((o) => o.type === 'delete');
    expect(deleteOps.length).toBeGreaterThan(0);
    expect(deleteOps.some((o) => o.text.includes('b'))).toBe(true);
  });

  it('detects replacements', () => {
    const ops = computeLineDiff('hello', 'world');
    expect(ops.length).toBeGreaterThan(0);
    const hasDelete = ops.some((o) => o.type === 'delete');
    const hasInsert = ops.some((o) => o.type === 'insert');
    expect(hasDelete).toBe(true);
    expect(hasInsert).toBe(true);
  });

  it('handles empty inputs', () => {
    expect(computeLineDiff('', '').length).toBe(1); // One empty equal op
    expect(computeLineDiff('', 'new').some((o) => o.type === 'insert')).toBe(true);
    expect(computeLineDiff('old', '').some((o) => o.type === 'delete')).toBe(true);
  });
});

describe('formatDiff', () => {
  it('formats a simple diff', () => {
    const ops = computeLineDiff('hello\nworld', 'hello\nearth');
    const diff = formatDiff(ops);
    expect(diff).toContain(' hello');
    expect(diff).toContain('-world');
    expect(diff).toContain('+earth');
  });
});
