/**
 * StreamingDiff — character-level diff computation for streaming edits.
 * Ported from: crates/streaming_diff/src/streaming_diff.rs (~804 LOC production)
 *
 * Computes the diff between two strings incrementally as new characters arrive.
 */

export type DiffOperation =
  | { type: 'equal'; text: string }
  | { type: 'insert'; text: string }
  | { type: 'delete'; text: string };

/**
 * Compute the diff operations between two strings.
 * This is a simplified version — the full Zed implementation uses a
 * character-level streaming diff with a rolling window.
 *
 * For the purposes of edit operations, we use a line-level diff.
 */
export function computeLineDiff(oldText: string, newText: string): DiffOperation[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const ops: DiffOperation[] = [];

  // Simple LCS-based diff
  const lcs = longestCommonSubsequence(oldLines, newLines);

  let oldIdx = 0;
  let newIdx = 0;

  for (const [oldLcsIdx, newLcsIdx] of lcs) {
    // Deletions: lines in old before this LCS element
    while (oldIdx < oldLcsIdx) {
      ops.push({ type: 'delete', text: oldLines[oldIdx]! + '\n' });
      oldIdx++;
    }
    // Insertions: lines in new before this LCS element
    while (newIdx < newLcsIdx) {
      ops.push({ type: 'insert', text: newLines[newIdx]! + '\n' });
      newIdx++;
    }
    // Equal
    ops.push({ type: 'equal', text: oldLines[oldIdx]! + '\n' });
    oldIdx++;
    newIdx++;
  }

  // Remaining deletions
  while (oldIdx < oldLines.length) {
    ops.push({ type: 'delete', text: oldLines[oldIdx]! + '\n' });
    oldIdx++;
  }
  // Remaining insertions
  while (newIdx < newLines.length) {
    ops.push({ type: 'insert', text: newLines[newIdx]! + '\n' });
    newIdx++;
  }

  return mergeConsecutiveOps(ops);
}

/**
 * Merge consecutive operations of the same type.
 */
function mergeConsecutiveOps(ops: DiffOperation[]): DiffOperation[] {
  const merged: DiffOperation[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) {
      (last as { text: string }).text += op.text;
    } else {
      merged.push({ ...op });
    }
  }
  return merged;
}

/**
 * Compute the longest common subsequence of two arrays.
 * Returns pairs of (index in a, index in b) for matching elements.
 */
function longestCommonSubsequence(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length;
  const n = b.length;

  // DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0) as number[],
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Trace back
  const result: Array<[number, number]> = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/**
 * Format a diff as a unified diff string.
 */
export function formatDiff(ops: DiffOperation[]): string {
  let result = '';
  for (const op of ops) {
    switch (op.type) {
      case 'equal':
        for (const line of op.text.split('\n').filter((l) => l.length > 0 || op.text.endsWith('\n'))) {
          if (line.length > 0) result += ` ${line}\n`;
        }
        break;
      case 'insert':
        for (const line of op.text.split('\n').filter((l) => l.length > 0)) {
          result += `+${line}\n`;
        }
        break;
      case 'delete':
        for (const line of op.text.split('\n').filter((l) => l.length > 0)) {
          result += `-${line}\n`;
        }
        break;
    }
  }
  return result;
}
