/**
 * Node.js FileSystem implementation.
 * Provides file system operations using Node.js built-in modules.
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  FileSystem,
  DirectoryEntry,
  GrepOptions,
  GrepMatch,
  GrepResult,
  FindPathOptions,
  FindPathResult,
  FileOutline,
  FileBuffer,
} from '@anthropic/zed-agent-core';

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg',
]);

export interface NodeFileSystemOptions {
  /** Glob patterns to exclude from file access. */
  excludePatterns?: string[];
  /** Glob patterns for private files. */
  privatePatterns?: string[];
}

export class NodeFileSystem implements FileSystem {
  private excludePatterns: string[];
  private privatePatterns: string[];

  constructor(options: NodeFileSystemOptions = {}) {
    this.excludePatterns = options.excludePatterns ?? ['**/node_modules/**', '**/.git/**'];
    this.privatePatterns = options.privatePatterns ?? ['**/.env', '**/.env.*'];
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  async readFileRange(filePath: string, startLine: number, endLine: number): Promise<string> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    // startLine and endLine are 1-indexed, inclusive
    const start = Math.max(0, startLine - 1);
    const end = Math.min(lines.length, endLine);
    return lines.slice(start, end).join('\n') + '\n';
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async isDirectory(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
    }));
  }

  async createDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async deletePath(filePath: string): Promise<void> {
    await fs.rm(filePath, { recursive: true, force: true });
  }

  async movePath(source: string, destination: string): Promise<void> {
    const destDir = path.dirname(destination);
    await fs.mkdir(destDir, { recursive: true });
    await fs.rename(source, destination);
  }

  async copyPath(source: string, destination: string): Promise<void> {
    const destDir = path.dirname(destination);
    await fs.mkdir(destDir, { recursive: true });
    await fs.cp(source, destination, { recursive: true });
  }

  async grep(options: GrepOptions): Promise<GrepResult> {
    // Try ripgrep first, fall back to Node.js grep
    try {
      return await this.grepWithRg(options);
    } catch {
      return await this.grepWithNode(options);
    }
  }

  private async grepWithRg(options: GrepOptions): Promise<GrepResult> {
    const args = ['--json', '--line-number'];

    if (!options.caseSensitive) {
      args.push('-i');
    }

    if (options.includePattern) {
      args.push('--glob', options.includePattern);
    }

    args.push('--', options.pattern, '.');

    try {
      const { stdout } = await execFileAsync('rg', args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      });

      const matches: GrepMatch[] = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
          if (entry.type === 'match' && entry.data) {
            matches.push({
              path: entry.data.path?.text ?? '',
              lineNumber: entry.data.line_number ?? 0,
              lineContent: (entry.data.lines?.text ?? '').trimEnd(),
            });
          }
        } catch {
          // Skip unparseable lines
        }
      }

      const offset = options.offset ?? 0;
      return {
        matches: matches.slice(offset),
        totalMatches: matches.length,
        truncated: false,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw err; // rg not found, let caller fall back
      }
      // rg returns exit code 1 when no matches found
      return { matches: [], totalMatches: 0, truncated: false };
    }
  }

  /**
   * Pure Node.js grep fallback when ripgrep is not available.
   * Walks the file tree, reads each file, and searches with regex.
   */
  private async grepWithNode(options: GrepOptions): Promise<GrepResult> {
    const regex = new RegExp(options.pattern, options.caseSensitive ? '' : 'i');
    const includeGlob = options.includePattern;
    const matches: GrepMatch[] = [];
    const maxMatches = 500; // Cap to prevent runaway searches

    const walkDir = async (dirPath: string): Promise<void> => {
      if (matches.length >= maxMatches) return;

      let entryNames: string[];
      try {
        entryNames = await fs.readdir(dirPath);
      } catch {
        return; // Permission denied or not a directory
      }

      for (const entryName of entryNames) {
        if (matches.length >= maxMatches) break;
        const fullPath = path.join(dirPath, entryName);

        // Skip common exclusions
        if (entryName === 'node_modules' || entryName === '.git' ||
            entryName === 'dist' || entryName === '__pycache__' ||
            entryName === '.next' || entryName === 'target') {
          continue;
        }

        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          await walkDir(fullPath);
        } else if (stat.isFile()) {
          // Check include pattern
          if (includeGlob && !simpleGlobMatch(includeGlob, fullPath)) {
            continue;
          }

          // Skip large files
          if (stat.size > 1024 * 1024) continue; // Skip files > 1MB

          // Read and search
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
              if (regex.test(lines[i]!)) {
                matches.push({
                  path: fullPath,
                  lineNumber: i + 1,
                  lineContent: lines[i]!.trimEnd(),
                });
              }
            }
          } catch {
            // Skip unreadable files (binary, encoding issues)
          }
        }
      }
    };

    // Walk from current directory
    await walkDir(process.cwd());

    const offset = options.offset ?? 0;
    return {
      matches: matches.slice(offset),
      totalMatches: matches.length,
      truncated: matches.length >= maxMatches,
    };
  }

  async findPath(glob: string, options?: FindPathOptions): Promise<FindPathResult> {
    try {
      const fg = await import('fast-glob');
      const paths = await fg.default(glob, {
        onlyFiles: true,
        dot: false,
      });
      const offset = options?.offset ?? 0;
      return {
        paths: paths.slice(offset),
        totalMatches: paths.length,
      };
    } catch {
      return { paths: [], totalMatches: 0 };
    }
  }

  async getFileOutline(filePath: string): Promise<FileOutline | null> {
    // Basic regex-based outline extraction
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const entries: import('@anthropic/zed-agent-core').FileOutlineEntry[] = [];

    const ext = path.extname(filePath).toLowerCase();
    const patterns = getOutlinePatterns(ext);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const { pattern, kind } of patterns) {
        const match = line.match(pattern);
        if (match) {
          entries.push({
            name: match[1] ?? match[0] ?? '',
            kind,
            startLine: i + 1,
            endLine: i + 1, // Simplified — would need scope analysis for real ranges
          });
          break;
        }
      }
    }

    if (entries.length === 0) return null;

    const text = entries.map((e) =>
      `${e.name} [L${e.startLine}${e.endLine !== e.startLine ? `-${e.endLine}` : ''}]`
    ).join('\n');

    return { entries, text };
  }

  async getMTime(filePath: string): Promise<number | null> {
    try {
      const stat = await fs.stat(filePath);
      return stat.mtimeMs;
    } catch {
      return null;
    }
  }

  async getFileSize(filePath: string): Promise<number> {
    const stat = await fs.stat(filePath);
    return stat.size;
  }

  isPathExcluded(filePath: string): boolean {
    return this.excludePatterns.some((p) => simpleGlobMatch(p, filePath));
  }

  isPathPrivate(filePath: string): boolean {
    return this.privatePatterns.some((p) => simpleGlobMatch(p, filePath));
  }

  isImageFile(filePath: string): boolean {
    return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  }

  async readImageFile(filePath: string): Promise<{ data: string; mimeType: string }> {
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.gif' ? 'image/gif'
      : ext === '.webp' ? 'image/webp'
      : 'application/octet-stream';
    return {
      data: buffer.toString('base64'),
      mimeType,
    };
  }

  async openBuffer(filePath: string): Promise<FileBuffer> {
    const content = await fs.readFile(filePath, 'utf-8');
    return new NodeFileBuffer(filePath, content);
  }
}

/**
 * In-memory file buffer implementation.
 */
class NodeFileBuffer implements FileBuffer {
  readonly path: string;
  readonly language?: string;
  private content: string;

  constructor(filePath: string, content: string) {
    this.path = filePath;
    this.content = content;
    this.language = detectLanguage(filePath);
  }

  getContent(): string {
    return this.content;
  }

  getRange(startLine: number, endLine: number): string {
    const lines = this.content.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  getLineCount(): number {
    return this.content.split('\n').length;
  }

  getIndentAt(line: number): { size: number; text: string } {
    const lines = this.content.split('\n');
    const l = lines[line - 1] ?? '';
    const match = l.match(/^(\s*)/);
    const indent = match?.[1] ?? '';
    return { size: indent.length, text: indent };
  }

  applyEdit(startLine: number, endLine: number, newText: string): void {
    const lines = this.content.split('\n');
    const newLines = newText.split('\n');
    lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
    this.content = lines.join('\n');
  }

  async save(): Promise<void> {
    await fs.writeFile(this.path, this.content, 'utf-8');
  }

  async reloadFromDisk(): Promise<void> {
    this.content = await fs.readFile(this.path, 'utf-8');
  }

  snapshot(): string {
    return this.content;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescriptreact',
    '.js': 'javascript', '.jsx': 'javascriptreact',
    '.py': 'python', '.rs': 'rust',
    '.go': 'go', '.java': 'java',
    '.rb': 'ruby', '.c': 'c', '.cpp': 'cpp',
    '.h': 'c', '.hpp': 'cpp',
    '.css': 'css', '.html': 'html',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.md': 'markdown', '.sh': 'shellscript',
    '.sql': 'sql', '.swift': 'swift',
    '.kt': 'kotlin', '.dart': 'dart',
  };
  return map[ext];
}

function getOutlinePatterns(ext: string): Array<{ pattern: RegExp; kind: string }> {
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
      return [
        { pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: 'function' },
        { pattern: /^\s*(?:export\s+)?class\s+(\w+)/, kind: 'class' },
        { pattern: /^\s*(?:export\s+)?interface\s+(\w+)/, kind: 'interface' },
        { pattern: /^\s*(?:export\s+)?type\s+(\w+)/, kind: 'type' },
        { pattern: /^\s*(?:export\s+)?const\s+(\w+)/, kind: 'constant' },
      ];
    case '.py':
      return [
        { pattern: /^\s*def\s+(\w+)/, kind: 'function' },
        { pattern: /^\s*class\s+(\w+)/, kind: 'class' },
      ];
    case '.rs':
      return [
        { pattern: /^\s*(?:pub\s+)?fn\s+(\w+)/, kind: 'function' },
        { pattern: /^\s*(?:pub\s+)?struct\s+(\w+)/, kind: 'struct' },
        { pattern: /^\s*(?:pub\s+)?enum\s+(\w+)/, kind: 'enum' },
        { pattern: /^\s*(?:pub\s+)?trait\s+(\w+)/, kind: 'trait' },
        { pattern: /^\s*impl\s+(\w+)/, kind: 'impl' },
      ];
    case '.go':
      return [
        { pattern: /^func\s+(\w+)/, kind: 'function' },
        { pattern: /^type\s+(\w+)\s+struct/, kind: 'struct' },
        { pattern: /^type\s+(\w+)\s+interface/, kind: 'interface' },
      ];
    default:
      return [
        { pattern: /^\s*(?:pub\s+)?(?:fn|function|def|func)\s+(\w+)/, kind: 'function' },
        { pattern: /^\s*(?:pub\s+)?(?:class|struct)\s+(\w+)/, kind: 'class' },
      ];
  }
}

function simpleGlobMatch(pattern: string, filePath: string): boolean {
  // Very simplified glob matching
  const regex = pattern
    .replace(/\*\*/g, '§DOUBLESTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DOUBLESTAR§/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${regex}$`).test(filePath) ||
    new RegExp(regex).test(filePath);
}
