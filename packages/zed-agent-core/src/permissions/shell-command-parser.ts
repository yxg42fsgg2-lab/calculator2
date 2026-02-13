/**
 * Shell command parser — extracts individual commands from compound shell statements.
 * Ported from: crates/shell_command_parser/src/shell_command_parser.rs (~593 LOC production)
 *
 * Handles command chaining operators: &&, ||, ;, |
 * Used by the permission system to validate every sub-command in a compound command.
 */

/**
 * Extract individual commands from a compound shell command string.
 * Handles &&, ||, ;, and | operators.
 *
 * Example:
 *   "cargo build && cargo test" → ["cargo build", "cargo test"]
 *   "ls | grep foo" → ["ls", "grep foo"]
 */
export function extractCommands(command: string): string[] {
  const commands: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;
  let parenDepth = 0;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    const next = command[i + 1];

    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      escape = true;
      current += ch;
      continue;
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      current += ch;
      continue;
    }

    if (ch === '(') {
      parenDepth++;
      current += ch;
      continue;
    }

    if (ch === ')') {
      parenDepth--;
      current += ch;
      continue;
    }

    // Only split on operators at the top level (not inside parens)
    if (parenDepth > 0) {
      current += ch;
      continue;
    }

    // Check for && and ||
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      if (current.trim().length > 0) {
        commands.push(current.trim());
      }
      current = '';
      i++; // Skip the second character
      continue;
    }

    // Check for ; and |
    if (ch === ';' || ch === '|') {
      if (current.trim().length > 0) {
        commands.push(current.trim());
      }
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    commands.push(current.trim());
  }

  return commands;
}

/**
 * Extract the base command name from a command string.
 * Example: "cargo build --release" → "cargo"
 *          "npm run test" → "npm"
 *          "cd /path && ls" → "cd" (only first command)
 */
export function extractBaseCommand(command: string): string | null {
  const trimmed = command.trim();

  // Skip leading environment variable assignments
  let start = 0;
  while (start < trimmed.length) {
    const rest = trimmed.slice(start);
    const envMatch = rest.match(/^[A-Za-z_][A-Za-z0-9_]*=/);
    if (envMatch) {
      // Skip past the value
      start += envMatch[0].length;
      // Skip the value (handle quotes)
      if (trimmed[start] === '"') {
        const end = trimmed.indexOf('"', start + 1);
        start = end >= 0 ? end + 1 : trimmed.length;
      } else if (trimmed[start] === "'") {
        const end = trimmed.indexOf("'", start + 1);
        start = end >= 0 ? end + 1 : trimmed.length;
      } else {
        const spaceIdx = trimmed.indexOf(' ', start);
        start = spaceIdx >= 0 ? spaceIdx : trimmed.length;
      }
      // Skip whitespace
      while (start < trimmed.length && trimmed[start] === ' ') start++;
    } else {
      break;
    }
  }

  const cmdPart = trimmed.slice(start);
  const spaceIdx = cmdPart.indexOf(' ');
  return spaceIdx >= 0 ? cmdPart.slice(0, spaceIdx) : (cmdPart || null);
}
