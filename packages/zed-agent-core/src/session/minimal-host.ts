/**
 * Minimal BackendHost for quick prototyping.
 *
 * Creates a BackendHost with sensible defaults that works immediately
 * for prototyping new UIs. File system operations work on the real
 * file system, terminal runs real commands, and permissions auto-allow.
 *
 * Usage:
 * ```typescript
 * const host = createMinimalHost('/path/to/project', (event) => {
 *   if (event.type === 'agent_text') process.stdout.write(event.text);
 * });
 * const session = createAgentSession(host, { model });
 * await session.send('Hello!');
 * ```
 */

import type {
  BackendHost,
  EventSink,
  FileSystem,
  TerminalProvider,
  ProjectInfo,
  PermissionHandler,
  HttpClient,
  TerminalHandle,
  TerminalExitStatus,
  TerminalOutput,
  DirectoryEntry,
  GrepResult,
  FindPathResult,
  FileOutline,
  FileBuffer,
  PermissionDecision,
  PermissionResponse,
  ToolPermissionRules,
} from '../types/host.js';
import type { AgentEvent } from '../types/events.js';

/**
 * Create a minimal BackendHost for quick prototyping.
 *
 * This is the simplest way to get a working host. It uses:
 * - Real file system (Node.js fs)
 * - Real terminal (child_process)
 * - Auto-allow permissions
 * - Native fetch for HTTP
 *
 * @param workspacePath Absolute path to the project root
 * @param onEvent Callback for agent events (or EventSink object)
 */
export function createMinimalHost(
  workspacePath: string,
  onEvent: ((event: AgentEvent) => void) | EventSink,
): BackendHost {
  const eventSink: EventSink = typeof onEvent === 'function'
    ? { emit: onEvent }
    : onEvent;

  const rootName = workspacePath.split('/').pop() ?? workspacePath;

  return {
    fileSystem: createStubFileSystem(),
    terminal: createStubTerminal(),
    project: {
      workspaceRoots: [{ name: rootName, absolutePath: workspacePath }],
      os: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
      shell: process.env['SHELL'] ?? '/bin/bash',
      resolveProjectPath(relativePath: string): string | null {
        if (relativePath.startsWith(rootName + '/')) {
          return workspacePath + relativePath.slice(rootName.length);
        }
        if (relativePath.startsWith(rootName)) {
          return workspacePath;
        }
        return workspacePath + '/' + relativePath;
      },
      getShortPath(absolutePath: string): string {
        if (absolutePath.startsWith(workspacePath)) {
          return rootName + absolutePath.slice(workspacePath.length);
        }
        return absolutePath;
      },
      getRootForPath(): null { return null; },
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
      async fetch(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }): Promise<{ status: number; headers: Record<string, string>; body: string; url: string }> {
        const response = await globalThis.fetch(url, {
          method: options?.method ?? 'GET',
          headers: options?.headers,
          body: options?.body,
        });
        const body = await response.text();
        const headers: Record<string, string> = {};
        response.headers.forEach((v, k) => { headers[k] = v; });
        return { status: response.status, headers, body, url: response.url };
      },
    },
  };
}

/**
 * Stub file system that uses Node.js fs.
 * Imported dynamically to avoid issues in non-Node environments.
 */
function createStubFileSystem(): FileSystem {
  // Lazy-load Node.js modules
  let _fs: typeof import('node:fs/promises') | null = null;
  let _path: typeof import('node:path') | null = null;

  const getFs = async () => {
    if (!_fs) _fs = await import('node:fs/promises');
    return _fs;
  };
  const getPath = async () => {
    if (!_path) _path = await import('node:path');
    return _path;
  };

  return {
    async readFile(p) { return (await getFs()).readFile(p, 'utf-8'); },
    async readFileRange(p, start, end) {
      const content = await (await getFs()).readFile(p, 'utf-8');
      return content.split('\n').slice(start - 1, end).join('\n') + '\n';
    },
    async writeFile(p, content) {
      const pathMod = await getPath();
      const fs = await getFs();
      await fs.mkdir(pathMod.dirname(p), { recursive: true });
      await fs.writeFile(p, content, 'utf-8');
    },
    async fileExists(p) {
      try { const s = await (await getFs()).stat(p); return s.isFile(); } catch { return false; }
    },
    async isDirectory(p) {
      try { const s = await (await getFs()).stat(p); return s.isDirectory(); } catch { return false; }
    },
    async listDirectory(p) {
      const entries = await (await getFs()).readdir(p, { withFileTypes: false });
      const fs = await getFs();
      const pathMod = await getPath();
      const result: DirectoryEntry[] = [];
      for (const name of entries as string[]) {
        try {
          const stat = await fs.stat(pathMod.join(p, name));
          result.push({ name, isDirectory: stat.isDirectory(), isSymlink: false });
        } catch { /* skip */ }
      }
      return result;
    },
    async createDirectory(p) { await (await getFs()).mkdir(p, { recursive: true }); },
    async deletePath(p) { await (await getFs()).rm(p, { recursive: true, force: true }); },
    async movePath(src, dst) {
      const pathMod = await getPath();
      const fs = await getFs();
      await fs.mkdir(pathMod.dirname(dst), { recursive: true });
      await fs.rename(src, dst);
    },
    async copyPath(src, dst) {
      const pathMod = await getPath();
      const fs = await getFs();
      await fs.mkdir(pathMod.dirname(dst), { recursive: true });
      await fs.cp(src, dst, { recursive: true });
    },
    async grep(): Promise<GrepResult> { return { matches: [], totalMatches: 0, truncated: false }; },
    async findPath(): Promise<FindPathResult> { return { paths: [], totalMatches: 0 }; },
    async getFileOutline(): Promise<FileOutline | null> { return null; },
    async getMTime(p) {
      try { return (await (await getFs()).stat(p)).mtimeMs; } catch { return null; }
    },
    async getFileSize(p) { return (await (await getFs()).stat(p)).size; },
    isPathExcluded() { return false; },
    isPathPrivate() { return false; },
    isImageFile(p) { return /\.(png|jpg|jpeg|gif|webp|bmp|tiff|svg)$/i.test(p); },
    async readImageFile(p) {
      const buf = await (await getFs()).readFile(p);
      return { data: buf.toString('base64'), mimeType: 'image/png' };
    },
    async openBuffer(p): Promise<FileBuffer> {
      const fs = await getFs();
      let content = await fs.readFile(p, 'utf-8');
      return {
        path: p,
        getContent() { return content; },
        getRange(s, e) { return content.split('\n').slice(s - 1, e).join('\n'); },
        getLineCount() { return content.split('\n').length; },
        getIndentAt(line) {
          const l = content.split('\n')[line - 1] ?? '';
          const m = l.match(/^(\s*)/);
          return { size: m?.[1]?.length ?? 0, text: m?.[1] ?? '' };
        },
        applyEdit(s, e, newText) {
          const lines = content.split('\n');
          lines.splice(s - 1, e - s + 1, ...newText.split('\n'));
          content = lines.join('\n');
        },
        async save() { await fs.writeFile(p, content, 'utf-8'); },
        async reloadFromDisk() { content = await fs.readFile(p, 'utf-8'); },
        snapshot() { return content; },
      };
    },
  };
}

function createStubTerminal(): TerminalProvider {
  return {
    async createTerminal(options): Promise<TerminalHandle> {
      const { spawn } = await import('node:child_process');
      const shell = process.env['SHELL'] ?? '/bin/bash';
      let output = '';
      let exitStatus: TerminalExitStatus | null = null;
      const resolvers: Array<(s: TerminalExitStatus) => void> = [];

      const child = spawn(shell, ['-c', options.command], {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
      child.on('exit', (code, signal) => {
        exitStatus = { exitCode: code, signal: signal ?? undefined };
        resolvers.forEach(r => r(exitStatus!));
      });
      child.on('error', () => {
        exitStatus = { exitCode: 1 };
        resolvers.forEach(r => r(exitStatus!));
      });

      return {
        id: `t-${Date.now()}`,
        waitForExit() {
          if (exitStatus) return Promise.resolve(exitStatus);
          return new Promise(r => resolvers.push(r));
        },
        currentOutput(): TerminalOutput {
          return { output, truncated: false, exitStatus };
        },
        kill() { if (!child.killed) child.kill('SIGTERM'); },
        wasStoppedByUser() { return false; },
      };
    },
  };
}
