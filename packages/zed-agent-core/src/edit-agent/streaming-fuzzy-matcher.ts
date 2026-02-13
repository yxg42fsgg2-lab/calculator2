/**
 * StreamingFuzzyMatcher — finds the best match for edit search blocks in source code.
 * Ported from: crates/agent/src/edit_agent/streaming_fuzzy_matcher.rs (~400 LOC production)
 *
 * Uses a dynamic programming approach with a cost model that penalizes
 * insertions (more expensive than replacements) and deletions (most expensive).
 * This allows fuzzy matching that handles minor model hallucinations in search blocks.
 */

// Cost model — same as Zed's
const REPLACEMENT_COST = 1;
const INSERTION_COST = 3;
const DELETION_COST = 10;

interface MatchRange {
  startLine: number; // 0-indexed
  endLine: number; // 0-indexed, exclusive
}

/**
 * Streaming fuzzy matcher that can process text chunks incrementally.
 * Ported from: StreamingFuzzyMatcher
 */
export class StreamingFuzzyMatcher {
  private bufferLines: string[];
  private queryLines: string[] = [];
  private incompleteLine = '';
  private lineHint?: number;
  private matrix: number[][] = [];
  private directions: number[][] = [];

  constructor(bufferContent: string) {
    this.bufferLines = bufferContent.split('\n');
    // Initialize the first row of the matrix
    this.matrix = [[0]];
    this.directions = [[0]];
    for (let col = 1; col <= this.bufferLines.length; col++) {
      this.matrix[0]!.push(0); // No cost for skipping buffer lines at start
      this.directions[0]!.push(1); // Left direction
    }
  }

  /**
   * Push a chunk of search text and get the best match found so far.
   * Returns a match range (0-indexed line numbers) or null if no match yet.
   */
  push(chunk: string, lineHint?: number): MatchRange | null {
    this.incompleteLine += chunk;
    this.lineHint = lineHint;

    // Process complete lines
    const lastNewline = this.incompleteLine.lastIndexOf('\n');
    if (lastNewline >= 0) {
      const completePart = this.incompleteLine.slice(0, lastNewline);
      this.incompleteLine = this.incompleteLine.slice(lastNewline + 1);

      for (const line of completePart.split('\n')) {
        this.queryLines.push(line);
        this.addQueryLine(line);
      }
    }

    return this.selectBestMatch();
  }

  /**
   * Finish processing and return all matches.
   */
  finish(): MatchRange[] {
    if (this.incompleteLine.length > 0) {
      this.queryLines.push(this.incompleteLine);
      this.addQueryLine(this.incompleteLine);
      this.incompleteLine = '';
    }
    return this.findAllMatches();
  }

  /**
   * Add a new query line to the DP matrix.
   */
  private addQueryLine(queryLine: string): void {
    const row = this.queryLines.length;
    const trimmedQuery = queryLine.trim();
    const newRow: number[] = [];
    const newDir: number[] = [];

    // First column: cost of deleting all query lines so far
    newRow.push(row * DELETION_COST);
    newDir.push(2); // Up direction

    for (let col = 1; col <= this.bufferLines.length; col++) {
      const bufferLine = this.bufferLines[col - 1]!.trim();

      // Three options: match/replace (diagonal), insert (left), delete (up)
      const replaceCost = this.lineCost(trimmedQuery, bufferLine);
      const diagonalCost = this.matrix[row - 1]![col - 1]! + replaceCost;
      const leftCost = newRow[col - 1]! + INSERTION_COST;
      const upCost = this.matrix[row - 1]![col]! + DELETION_COST;

      if (diagonalCost <= leftCost && diagonalCost <= upCost) {
        newRow.push(diagonalCost);
        newDir.push(0); // Diagonal
      } else if (leftCost <= upCost) {
        newRow.push(leftCost);
        newDir.push(1); // Left
      } else {
        newRow.push(upCost);
        newDir.push(2); // Up
      }
    }

    this.matrix.push(newRow);
    this.directions.push(newDir);
  }

  /**
   * Compute the cost of matching two trimmed lines.
   */
  private lineCost(queryLine: string, bufferLine: string): number {
    if (queryLine === bufferLine) return 0;
    if (queryLine.length === 0 && bufferLine.length === 0) return 0;
    if (queryLine.length === 0 || bufferLine.length === 0) return REPLACEMENT_COST;

    // Simple character-level edit distance ratio
    const maxLen = Math.max(queryLine.length, bufferLine.length);
    const editDist = this.simpleEditDistance(queryLine, bufferLine);
    const ratio = editDist / maxLen;

    // Low ratio = good match, high ratio = bad match
    if (ratio < 0.1) return 0; // Very close match
    if (ratio < 0.3) return REPLACEMENT_COST;
    return REPLACEMENT_COST * 3; // Poor match
  }

  /**
   * Simple edit distance (Levenshtein) for short strings.
   * For performance, we use a simplified version for longer strings.
   */
  private simpleEditDistance(a: string, b: string): number {
    if (a.length > 200 || b.length > 200) {
      // Simplified comparison for long lines
      return a === b ? 0 : Math.abs(a.length - b.length) + 1;
    }

    const m = a.length;
    const n = b.length;
    const dp: number[] = new Array(n + 1);

    for (let j = 0; j <= n; j++) dp[j] = j;

    for (let i = 1; i <= m; i++) {
      let prev = dp[0]!;
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j]!;
        if (a[i - 1] === b[j - 1]) {
          dp[j] = prev;
        } else {
          dp[j] = 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
        }
        prev = tmp;
      }
    }

    return dp[n]!;
  }

  /**
   * Select the best match from the current DP state.
   */
  private selectBestMatch(): MatchRange | null {
    const matches = this.findAllMatches();
    if (matches.length === 0) return null;

    // If we have a line hint, prefer matches near it
    if (this.lineHint !== undefined) {
      const hint = this.lineHint - 1; // Convert to 0-indexed
      matches.sort((a, b) => {
        const distA = Math.abs(a.startLine - hint);
        const distB = Math.abs(b.startLine - hint);
        return distA - distB;
      });
    }

    return matches[0] ?? null;
  }

  /**
   * Find all matches by tracing back through the DP matrix.
   */
  private findAllMatches(): MatchRange[] {
    if (this.queryLines.length === 0) return [];

    const lastRow = this.matrix.length - 1;
    if (lastRow === 0) return [];

    // Find the best ending column(s) in the last row
    let bestCost = Infinity;
    for (let col = 1; col <= this.bufferLines.length; col++) {
      const cost = this.matrix[lastRow]![col]!;
      if (cost < bestCost) {
        bestCost = cost;
      }
    }

    // Threshold: don't accept matches that are too costly
    const maxAcceptableCost = this.queryLines.length * REPLACEMENT_COST * 2;
    if (bestCost > maxAcceptableCost) return [];

    const matches: MatchRange[] = [];
    for (let col = 1; col <= this.bufferLines.length; col++) {
      if (this.matrix[lastRow]![col]! === bestCost) {
        // Trace back to find the start
        const match = this.traceBack(lastRow, col);
        if (match) matches.push(match);
      }
    }

    return matches;
  }

  /**
   * Trace back through the DP matrix to find the match range.
   */
  private traceBack(row: number, col: number): MatchRange | null {
    let endLine = col; // exclusive
    let r = row;
    let c = col;

    while (r > 0 && c > 0) {
      const dir = this.directions[r]![c]!;
      if (dir === 0) { // Diagonal
        r--;
        c--;
      } else if (dir === 1) { // Left (insertion in buffer)
        c--;
      } else { // Up (deletion from query)
        r--;
      }
    }

    const startLine = c;
    if (startLine >= endLine) return null;

    return { startLine, endLine };
  }
}
