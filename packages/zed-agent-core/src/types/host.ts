/**
 * BackendHost — the single interface any UI must implement to use the agent backend.
 *
 * This replaces Zed's GPUI App/Context, Project entity, Fs trait, ThreadEnvironment,
 * and all other framework-specific infrastructure with a clean, framework-agnostic API.
 *
 * A minimal implementation for prototyping requires ~200-300 lines of code.
 */

import type { AgentEvent } from './events.js';

// ---------------------------------------------------------------------------
// BackendHost — the top-level interface
// ---------------------------------------------------------------------------

/**
 * The host environment that the agent backend runs within.
 * Implement this interface to plug the agent into any UI.
 */
export interface BackendHost {
  /** File system access (read, write, search, etc.). */
  fileSystem: FileSystem;

  /** Terminal/shell execution. */
  terminal: TerminalProvider;

  /** Project metadata (workspace roots, OS, shell). */
  project: ProjectInfo;

  /** Permission handling for tool authorization. */
  permissions: PermissionHandler;

  /** Event sink — receives all agent events for UI rendering. */
  events: EventSink;

  /** HTTP client for the fetch tool. */
  http: HttpClient;

  /** Diagnostics provider (optional — LSP integration). */
  diagnostics?: DiagnosticsProvider;

  /** Web search provider (optional — enables web_search tool). */
  webSearch?: WebSearchProvider;
}

// ---------------------------------------------------------------------------
// FileSystem
// ---------------------------------------------------------------------------

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
  /** File size in bytes (for files). */
  size?: number;
}

export interface GrepOptions {
  /** Regex pattern to search for. */
  pattern: string;
  /** Glob pattern to filter files (e.g., `**\/*.rs`). */
  includePattern?: string;
  /** Starting offset for paginated results. */
  offset?: number;
  /** Whether the regex is case-sensitive (default: false). */
  caseSensitive?: boolean;
}

export interface GrepMatch {
  path: string;
  lineNumber: number;
  lineContent: string;
  /** Context lines before the match. */
  contextBefore?: string[];
  /** Context lines after the match. */
  contextAfter?: string[];
}

export interface GrepResult {
  matches: GrepMatch[];
  totalMatches: number;
  truncated: boolean;
}

export interface FindPathOptions {
  /** Starting offset for paginated results. */
  offset?: number;
}

export interface FindPathResult {
  paths: string[];
  totalMatches: number;
}

/**
 * A simplified file outline for large file handling.
 * When a file is too large to include inline, the outline is shown instead.
 */
export interface FileOutlineEntry {
  name: string;
  kind: string; // 'function' | 'class' | 'method' | 'struct' | 'interface' | etc.
  startLine: number;
  endLine: number;
  children?: FileOutlineEntry[];
}

export interface FileOutline {
  entries: FileOutlineEntry[];
  /** Rendered text representation (with line numbers like "[L100-150]"). */
  text: string;
}

/**
 * A file buffer — an in-memory representation of a file for editing.
 * Ported from Zed's Buffer concept needed for the EditAgent.
 */
export interface FileBuffer {
  readonly path: string;
  readonly language?: string;

  /** Get the full content. */
  getContent(): string;

  /** Get content for a line range (1-indexed, inclusive). */
  getRange(startLine: number, endLine: number): string;

  /** Get the total number of lines. */
  getLineCount(): number;

  /** Get indentation info at a given line (1-indexed). */
  getIndentAt(line: number): { size: number; text: string };

  /** Apply an edit: replace the given line range with new text. */
  applyEdit(startLine: number, endLine: number, newText: string): void;

  /** Save the buffer contents to disk. */
  save(): Promise<void>;

  /** Reload content from disk, discarding changes. */
  reloadFromDisk(): Promise<void>;

  /** Get a snapshot of the current content for diffing. */
  snapshot(): string;
}

/**
 * File system interface.
 * Ported from: Zed's Project + Fs trait + Worktree operations.
 */
export interface FileSystem {
  // --- Core file operations ---

  /** Read the full contents of a file. */
  readFile(path: string): Promise<string>;

  /**
   * Read a range of lines from a file.
   * @param startLine 1-indexed start line.
   * @param endLine 1-indexed end line (inclusive).
   */
  readFileRange(path: string, startLine: number, endLine: number): Promise<string>;

  /** Write content to a file, creating it if necessary. */
  writeFile(path: string, content: string): Promise<void>;

  /** Check if a path exists and is a file. */
  fileExists(path: string): Promise<boolean>;

  /** Check if a path exists and is a directory. */
  isDirectory(path: string): Promise<boolean>;

  /** List entries in a directory. */
  listDirectory(path: string): Promise<DirectoryEntry[]>;

  /** Create a directory (and parents if necessary). */
  createDirectory(path: string): Promise<void>;

  /** Delete a file or directory. */
  deletePath(path: string): Promise<void>;

  /** Move/rename a file or directory. */
  movePath(source: string, destination: string): Promise<void>;

  /** Copy a file or directory. */
  copyPath(source: string, destination: string): Promise<void>;

  // --- Search operations ---

  /** Search file contents with a regex pattern. */
  grep(options: GrepOptions): Promise<GrepResult>;

  /** Find files matching a glob pattern. */
  findPath(glob: string, options?: FindPathOptions): Promise<FindPathResult>;

  // --- Metadata ---

  /** Get a file outline (for large file handling). Returns null if no outline can be generated. */
  getFileOutline(path: string): Promise<FileOutline | null>;

  /** Get the modification time of a file (ms since epoch). Returns null if file doesn't exist. */
  getMTime(path: string): Promise<number | null>;

  /** Get the file size in bytes. */
  getFileSize(path: string): Promise<number>;

  // --- Security ---

  /**
   * Check if a path is excluded from agent access (file_scan_exclusions).
   * @param path Path relative to a workspace root.
   */
  isPathExcluded(path: string): boolean;

  /**
   * Check if a path is private (private_files setting).
   * @param path Path relative to a workspace root.
   */
  isPathPrivate(path: string): boolean;

  // --- Image support ---

  /** Check if a file is an image based on extension. */
  isImageFile(path: string): boolean;

  /** Read an image file and return base64-encoded data. */
  readImageFile(path: string): Promise<{ data: string; mimeType: string }>;

  // --- Buffer management ---

  /**
   * Open a file buffer for editing.
   * The buffer holds the file content in memory and supports incremental edits.
   */
  openBuffer(path: string): Promise<FileBuffer>;
}

// ---------------------------------------------------------------------------
// TerminalProvider
// ---------------------------------------------------------------------------

export interface TerminalOptions {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Maximum bytes of output to capture. */
  outputByteLimit?: number;
}

export interface TerminalExitStatus {
  exitCode: number | null;
  signal?: string;
}

export interface TerminalOutput {
  output: string;
  truncated: boolean;
  exitStatus: TerminalExitStatus | null;
}

export interface TerminalHandle {
  readonly id: string;
  waitForExit(): Promise<TerminalExitStatus>;
  currentOutput(): TerminalOutput;
  kill(): void;
  wasStoppedByUser(): boolean;
}

export interface TerminalProvider {
  createTerminal(options: TerminalOptions): Promise<TerminalHandle>;
}

// ---------------------------------------------------------------------------
// ProjectInfo
// ---------------------------------------------------------------------------

export interface RulesFile {
  /** Path within the worktree (e.g., ".rules"). */
  pathInWorktree: string;
  /** Content of the rules file. */
  text: string;
}

export interface WorkspaceRoot {
  /** The display name (last path component). */
  name: string;
  /** Absolute path on disk. */
  absolutePath: string;
  /** Project rules file, if found. */
  rulesFile?: RulesFile;
}

export interface UserRules {
  id?: string;
  title?: string;
  contents: string;
}

export interface ProjectInfo {
  /** All workspace root directories. */
  workspaceRoots: WorkspaceRoot[];

  /** Operating system. */
  os: 'macos' | 'linux' | 'windows';

  /** Default shell path (e.g., "/bin/bash"). */
  shell: string;

  /** User-configured global rules. */
  userRules?: UserRules[];

  /**
   * Resolve a relative project path to an absolute path.
   * The relative path should start with a workspace root name.
   * Returns null if the path doesn't match any workspace root.
   */
  resolveProjectPath(relativePath: string): string | null;

  /**
   * Get a short display path for an absolute path.
   * Strips the common workspace root prefix.
   */
  getShortPath(absolutePath: string): string;

  /**
   * Get the workspace root that contains the given path.
   */
  getRootForPath(path: string): WorkspaceRoot | null;
}

// ---------------------------------------------------------------------------
// PermissionHandler
// ---------------------------------------------------------------------------

export type PermissionDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason: string }
  | { type: 'confirm' };

export interface PermissionRequest {
  toolCallId: string;
  toolName: string;
  title: string;
  options: import('./tools.js').PermissionOptions;
  context: import('./tools.js').ToolPermissionContext;
}

export type PermissionResponse =
  | { type: 'approved'; optionId: string }
  | { type: 'denied'; optionId: string };

export interface ToolPermissionRules {
  mode: 'always_ask' | 'auto' | 'custom';
  alwaysAllow?: Array<{ toolName: string; pattern?: string }>;
  alwaysDeny?: Array<{ toolName: string; pattern?: string }>;
}

export interface PermissionHandler {
  /**
   * Request permission from the user for a tool call.
   * Returns the user's choice.
   */
  requestPermission(request: PermissionRequest): Promise<PermissionResponse>;

  /**
   * Check if a tool call should be auto-allowed or auto-denied based on settings.
   */
  checkAutoPermission(toolName: string, inputs: string[]): PermissionDecision;

  /**
   * Get the current tool permission rules.
   */
  getToolPermissionRules(): ToolPermissionRules;
}

// ---------------------------------------------------------------------------
// EventSink
// ---------------------------------------------------------------------------

/**
 * The event sink receives all events from the agent backend.
 * Implement this to render the agent experience in your UI.
 */
export interface EventSink {
  emit(event: AgentEvent): void;
}

// ---------------------------------------------------------------------------
// HttpClient
// ---------------------------------------------------------------------------

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  followRedirects?: boolean;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  url: string;
}

export interface HttpClient {
  fetch(url: string, options?: HttpOptions): Promise<HttpResponse>;
}

// ---------------------------------------------------------------------------
// DiagnosticsProvider (optional)
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
  path: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  code?: string;
}

export interface DiagnosticsProvider {
  getDiagnostics(options?: {
    paths?: string[];
    severity?: DiagnosticSeverity[];
  }): Promise<Diagnostic[]>;
}

// ---------------------------------------------------------------------------
// WebSearchProvider (optional)
// ---------------------------------------------------------------------------

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProvider {
  search(query: string): Promise<WebSearchResult[]>;
}

// ---------------------------------------------------------------------------
// Disposable utility
// ---------------------------------------------------------------------------

export interface Disposable {
  dispose(): void;
}
