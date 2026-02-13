/**
 * ActionLog — tracks agent operations for observability.
 * Ported from: crates/action_log/ (~150 LOC)
 *
 * Records what the agent has done: files read, files edited, commands run.
 * Useful for auditing, debugging, and telemetry.
 */

export interface ActionLogEntry {
  timestamp: number;
  type: ActionType;
  path?: string;
  command?: string;
  toolName?: string;
  details?: string;
}

export type ActionType =
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'file_create'
  | 'file_delete'
  | 'directory_create'
  | 'terminal_command'
  | 'tool_call'
  | 'tool_error';

/**
 * A log of agent actions for observability.
 */
export class ActionLog {
  private entries: ActionLogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  /** Record a file read. */
  fileRead(path: string): void {
    this.add({ type: 'file_read', path });
  }

  /** Record a file write/edit. */
  fileWrite(path: string, details?: string): void {
    this.add({ type: 'file_write', path, details });
  }

  /** Record a file creation. */
  fileCreate(path: string): void {
    this.add({ type: 'file_create', path });
  }

  /** Record a file edit. */
  fileEdit(path: string, details?: string): void {
    this.add({ type: 'file_edit', path, details });
  }

  /** Record a file/directory deletion. */
  fileDelete(path: string): void {
    this.add({ type: 'file_delete', path });
  }

  /** Record a directory creation. */
  directoryCreate(path: string): void {
    this.add({ type: 'directory_create', path });
  }

  /** Record a terminal command execution. */
  terminalCommand(command: string, cwd?: string): void {
    this.add({ type: 'terminal_command', command, path: cwd });
  }

  /** Record a tool call. */
  toolCall(toolName: string, details?: string): void {
    this.add({ type: 'tool_call', toolName, details });
  }

  /** Record a tool error. */
  toolError(toolName: string, error: string): void {
    this.add({ type: 'tool_error', toolName, details: error });
  }

  /** Get all entries. */
  getEntries(): readonly ActionLogEntry[] {
    return this.entries;
  }

  /** Get entries of a specific type. */
  getByType(type: ActionType): ActionLogEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  /** Get the most recent N entries. */
  getRecent(count: number): ActionLogEntry[] {
    return this.entries.slice(-count);
  }

  /** Get a summary of all actions. */
  summary(): Record<ActionType, number> {
    const counts: Partial<Record<ActionType, number>> = {};
    for (const entry of this.entries) {
      counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    }
    return counts as Record<ActionType, number>;
  }

  /** Get all unique file paths that were read. */
  filesRead(): string[] {
    return [...new Set(this.entries.filter(e => e.type === 'file_read' && e.path).map(e => e.path!))];
  }

  /** Get all unique file paths that were modified. */
  filesModified(): string[] {
    const modTypes: ActionType[] = ['file_write', 'file_edit', 'file_create', 'file_delete'];
    return [...new Set(this.entries.filter(e => modTypes.includes(e.type) && e.path).map(e => e.path!))];
  }

  /** Clear the log. */
  clear(): void {
    this.entries = [];
  }

  /** Number of entries. */
  get size(): number {
    return this.entries.length;
  }

  private add(entry: Omit<ActionLogEntry, 'timestamp'>): void {
    this.entries.push({ ...entry, timestamp: Date.now() });
    // Evict old entries if over limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }
}
