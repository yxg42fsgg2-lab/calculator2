/**
 * Mock BackendHost for testing.
 * Provides in-memory file system, mock terminal, and event capture.
 */

import type {
  BackendHost,
  FileSystem,
  TerminalProvider,
  TerminalHandle,
  TerminalOptions,
  TerminalExitStatus,
  TerminalOutput,
  ProjectInfo,
  WorkspaceRoot,
  PermissionHandler,
  PermissionRequest,
  PermissionResponse,
  PermissionDecision,
  ToolPermissionRules,
  EventSink,
  HttpClient,
  HttpOptions,
  HttpResponse,
  DirectoryEntry,
  GrepOptions,
  GrepResult,
  FindPathOptions,
  FindPathResult,
  FileOutline,
  FileBuffer,
} from '../src/types/host.js';
import type { AgentEvent } from '../src/types/events.js';

/**
 * In-memory file system for testing.
 */
export class MockFileSystem implements FileSystem {
  files: Map<string, string> = new Map();
  directories: Set<string> = new Set();

  constructor(initialFiles?: Record<string, string>) {
    if (initialFiles) {
      for (const [path, content] of Object.entries(initialFiles)) {
        this.files.set(path, content);
        // Add parent directories
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
          this.directories.add(parts.slice(0, i).join('/'));
        }
      }
    }
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }
  async readFileRange(path: string, startLine: number, endLine: number): Promise<string> {
    const content = await this.readFile(path);
    return content.split('\n').slice(startLine - 1, endLine).join('\n') + '\n';
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async isDirectory(path: string): Promise<boolean> {
    return this.directories.has(path);
  }
  async listDirectory(path: string): Promise<DirectoryEntry[]> {
    const entries: DirectoryEntry[] = [];
    const prefix = path.endsWith('/') ? path : path + '/';
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const name = rest.split('/')[0]!;
        if (!entries.find(e => e.name === name)) {
          entries.push({
            name,
            isDirectory: rest.includes('/'),
            isSymlink: false,
          });
        }
      }
    }
    return entries;
  }
  async createDirectory(path: string): Promise<void> {
    this.directories.add(path);
  }
  async deletePath(path: string): Promise<void> {
    this.files.delete(path);
    this.directories.delete(path);
  }
  async movePath(source: string, destination: string): Promise<void> {
    const content = this.files.get(source);
    if (content !== undefined) {
      this.files.set(destination, content);
      this.files.delete(source);
    }
  }
  async copyPath(source: string, destination: string): Promise<void> {
    const content = this.files.get(source);
    if (content !== undefined) {
      this.files.set(destination, content);
    }
  }
  async grep(_options: GrepOptions): Promise<GrepResult> {
    return { matches: [], totalMatches: 0, truncated: false };
  }
  async findPath(_glob: string, _options?: FindPathOptions): Promise<FindPathResult> {
    return { paths: [], totalMatches: 0 };
  }
  async getFileOutline(_path: string): Promise<FileOutline | null> {
    return null;
  }
  async getMTime(_path: string): Promise<number | null> {
    return Date.now();
  }
  async getFileSize(path: string): Promise<number> {
    return (this.files.get(path) ?? '').length;
  }
  isPathExcluded(): boolean { return false; }
  isPathPrivate(): boolean { return false; }
  isImageFile(): boolean { return false; }
  async readImageFile(): Promise<{ data: string; mimeType: string }> {
    throw new Error('Not an image');
  }
  async openBuffer(path: string): Promise<FileBuffer> {
    const content = this.files.get(path) ?? '';
    const fs = this;
    return {
      path,
      getContent() { return fs.files.get(path) ?? content; },
      getRange(startLine: number, endLine: number) {
        return (fs.files.get(path) ?? content).split('\n').slice(startLine - 1, endLine).join('\n');
      },
      getLineCount() { return (fs.files.get(path) ?? content).split('\n').length; },
      getIndentAt() { return { size: 0, text: '' }; },
      applyEdit(startLine: number, endLine: number, newText: string) {
        const lines = (fs.files.get(path) ?? content).split('\n');
        const newLines = newText.split('\n');
        lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
        fs.files.set(path, lines.join('\n'));
      },
      async save() { /* already in memory */ },
      async reloadFromDisk() { /* noop */ },
      snapshot() { return fs.files.get(path) ?? content; },
    };
  }
}

export class MockTerminalProvider implements TerminalProvider {
  lastCommand?: string;
  commandOutput: string = '';
  exitCode: number = 0;

  async createTerminal(options: TerminalOptions): Promise<TerminalHandle> {
    this.lastCommand = options.command;
    const self = this;
    return {
      id: `mock-terminal-${Date.now()}`,
      async waitForExit(): Promise<TerminalExitStatus> {
        return { exitCode: self.exitCode };
      },
      currentOutput(): TerminalOutput {
        return { output: self.commandOutput, truncated: false, exitStatus: { exitCode: self.exitCode } };
      },
      kill() {},
      wasStoppedByUser() { return false; },
    };
  }
}

export class MockEventSink implements EventSink {
  events: AgentEvent[] = [];

  emit(event: AgentEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events = [];
  }

  getByType<T extends AgentEvent['type']>(type: T): Extract<AgentEvent, { type: T }>[] {
    return this.events.filter(e => e.type === type) as Extract<AgentEvent, { type: T }>[];
  }
}

export function createMockHost(options?: {
  files?: Record<string, string>;
  workspaceRoots?: string[];
}): {
  host: BackendHost;
  events: MockEventSink;
  fs: MockFileSystem;
  terminal: MockTerminalProvider;
} {
  const eventSink = new MockEventSink();
  const fileSystem = new MockFileSystem(options?.files);
  const terminal = new MockTerminalProvider();
  const roots = (options?.workspaceRoots ?? ['/project']).map(p => ({
    name: p.split('/').pop()!,
    absolutePath: p,
  }));

  const host: BackendHost = {
    fileSystem,
    terminal,
    project: {
      workspaceRoots: roots,
      os: 'linux',
      shell: '/bin/bash',
      resolveProjectPath(relativePath: string): string | null {
        for (const root of roots) {
          if (relativePath.startsWith(root.name)) {
            const rest = relativePath.slice(root.name.length);
            return rest.startsWith('/') ? root.absolutePath + rest : root.absolutePath;
          }
        }
        if (roots.length === 1) return roots[0]!.absolutePath + '/' + relativePath;
        return null;
      },
      getShortPath(absolutePath: string): string {
        for (const root of roots) {
          if (absolutePath.startsWith(root.absolutePath)) {
            return root.name + absolutePath.slice(root.absolutePath.length);
          }
        }
        return absolutePath;
      },
      getRootForPath(path: string) {
        return roots.find(r => path.startsWith(r.absolutePath) || path.startsWith(r.name)) ?? null;
      },
    },
    permissions: {
      async requestPermission(): Promise<PermissionResponse> {
        return { type: 'approved', optionId: 'allow' };
      },
      checkAutoPermission(): PermissionDecision {
        return { type: 'allow' };
      },
      getToolPermissionRules(): ToolPermissionRules {
        return { mode: 'auto' };
      },
    },
    events: eventSink,
    http: {
      async fetch(): Promise<HttpResponse> {
        return { status: 200, headers: {}, body: 'mock response', url: '' };
      },
    },
  };

  return { host, events: eventSink, fs: fileSystem, terminal };
}
