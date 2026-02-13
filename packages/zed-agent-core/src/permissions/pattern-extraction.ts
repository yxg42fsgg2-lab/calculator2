/**
 * Pattern extraction for tool permission rules.
 * Ported from: crates/agent/src/pattern_extraction.rs (272 LOC)
 *
 * Extracts patterns from tool inputs for "always allow/deny" rules.
 */

import { extractBaseCommand } from './shell-command-parser.js';

/**
 * Extract a regex pattern from a terminal command for "always allow" rules.
 * Example: "cargo build --release" → "^cargo"
 *          "npm run test" → "^npm"
 *
 * Returns null if no meaningful pattern can be extracted.
 */
export function extractTerminalPattern(command: string): string | null {
  const base = extractBaseCommand(command);
  if (!base) return null;
  // Escape regex special characters in the base command
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped}`;
}

/**
 * Extract a human-readable display string for a terminal pattern.
 * Example: "cargo build --release" → "cargo"
 */
export function extractTerminalPatternDisplay(command: string): string | null {
  return extractBaseCommand(command);
}

/**
 * Extract a regex pattern from a file path for "always allow" rules.
 * Example: "src/main.rs" → "^src/"
 *          "tests/integration/test.rs" → "^tests/"
 *
 * Returns the first path component as a pattern.
 */
export function extractPathPattern(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const firstSlash = normalized.indexOf('/');
  if (firstSlash <= 0) return null;
  const firstComponent = normalized.slice(0, firstSlash);
  const escaped = firstComponent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped}/`;
}

/**
 * Extract a display string for a path pattern.
 * Example: "src/main.rs" → "src/"
 */
export function extractPathPatternDisplay(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const firstSlash = normalized.indexOf('/');
  if (firstSlash <= 0) return null;
  return normalized.slice(0, firstSlash + 1);
}

/**
 * Extract a regex pattern from a URL for "always allow" rules.
 * Example: "https://example.com/api/v1" → "^https://example\\.com"
 */
export function extractUrlPattern(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const escaped = parsed.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `^${escaped}`;
  } catch {
    return null;
  }
}

/**
 * Extract a display string for a URL pattern.
 * Example: "https://example.com/api/v1" → "example.com"
 */
export function extractUrlPatternDisplay(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname;
  } catch {
    return null;
  }
}
