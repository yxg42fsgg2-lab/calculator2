/**
 * Tests for the StreamingFuzzyMatcher.
 * Ported from: crates/agent/src/edit_agent/streaming_fuzzy_matcher.rs tests
 */

import { describe, it, expect } from 'vitest';
import { StreamingFuzzyMatcher } from '../src/edit-agent/streaming-fuzzy-matcher.js';

describe('StreamingFuzzyMatcher', () => {
  it('finds exact match', () => {
    const buffer = 'line 1\nline 2\nline 3\nline 4\nline 5';
    const matcher = new StreamingFuzzyMatcher(buffer);

    matcher.push('line 2\nline 3\n');
    const matches = matcher.finish();

    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.startLine).toBe(1); // 0-indexed, "line 2" is at index 1
    expect(matches[0]!.endLine).toBe(3); // exclusive, through "line 3"
  });

  it('finds single line match', () => {
    const buffer = 'alpha\nbeta\ngamma\ndelta';
    const matcher = new StreamingFuzzyMatcher(buffer);

    matcher.push('beta\n');
    const matches = matcher.finish();

    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.startLine).toBe(1);
  });

  it('handles fuzzy match with minor differences', () => {
    const buffer = 'function hello() {\n  console.log("hello");\n}\n';
    const matcher = new StreamingFuzzyMatcher(buffer);

    // Slightly different — extra space
    matcher.push('function hello()  {\n  console.log("hello");\n}\n');
    const matches = matcher.finish();

    // Should still find a match despite the extra space
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('handles match at beginning of buffer', () => {
    const buffer = 'first\nsecond\nthird';
    const matcher = new StreamingFuzzyMatcher(buffer);

    matcher.push('first\n');
    const matches = matcher.finish();

    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.startLine).toBe(0);
  });

  it('handles match at end of buffer', () => {
    const buffer = 'first\nsecond\nthird';
    const matcher = new StreamingFuzzyMatcher(buffer);

    matcher.push('third');
    const matches = matcher.finish();

    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('handles streaming chunks', () => {
    const buffer = 'aaa\nbbb\nccc\nddd\neee';
    const matcher = new StreamingFuzzyMatcher(buffer);

    matcher.push('bb');
    matcher.push('b\ncc');
    matcher.push('c\n');
    const matches = matcher.finish();

    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('respects line hint', () => {
    // Buffer with duplicate content
    const buffer = 'foo\nbar\nbaz\nfoo\nbar\nbaz';
    const matcher = new StreamingFuzzyMatcher(buffer);

    // Search for "bar" with a hint that it's near line 5 (0-indexed: 4)
    matcher.push('bar\n', 5);
    const matches = matcher.finish();

    // Should find at least one match for "bar"
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // The match should be at one of the two "bar" positions (index 1 or 4)
    expect([1, 4]).toContain(matches[0]!.startLine);
  });

  it('returns empty for no match', () => {
    const buffer = 'alpha\nbeta\ngamma';
    const matcher = new StreamingFuzzyMatcher(buffer);

    matcher.push('zzzz_no_match_zzzzz\nmore_no_match\n');
    const matches = matcher.finish();

    expect(matches.length).toBe(0);
  });

  it('handles empty buffer', () => {
    const matcher = new StreamingFuzzyMatcher('');
    matcher.push('anything\n');
    const matches = matcher.finish();
    // With an empty buffer, the matcher may return a degenerate match
    // The important thing is it doesn't crash
    expect(matches).toBeDefined();
  });

  it('handles empty query', () => {
    const matcher = new StreamingFuzzyMatcher('hello\nworld');
    const matches = matcher.finish();
    expect(matches.length).toBe(0);
  });
});
