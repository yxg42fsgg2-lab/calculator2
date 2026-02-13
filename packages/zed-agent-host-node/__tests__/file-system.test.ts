/**
 * Tests for the Node.js FileSystem implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeFileSystem } from '../src/file-system.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('NodeFileSystem', () => {
  let nfs: NodeFileSystem;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zed-agent-test-'));
    nfs = new NodeFileSystem();

    // Create test files
    await fs.writeFile(path.join(tmpDir, 'hello.txt'), 'Hello World\n');
    await fs.writeFile(path.join(tmpDir, 'multi.txt'), 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n');
    await fs.mkdir(path.join(tmpDir, 'subdir'));
    await fs.writeFile(path.join(tmpDir, 'subdir', 'nested.ts'), 'export const x = 1;\n');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // --- Read ---

  it('reads a file', async () => {
    const content = await nfs.readFile(path.join(tmpDir, 'hello.txt'));
    expect(content).toBe('Hello World\n');
  });

  it('reads a file range', async () => {
    const content = await nfs.readFileRange(path.join(tmpDir, 'multi.txt'), 2, 4);
    expect(content).toBe('Line 2\nLine 3\nLine 4\n');
  });

  it('throws on nonexistent file', async () => {
    await expect(nfs.readFile(path.join(tmpDir, 'nope.txt'))).rejects.toThrow();
  });

  // --- Write ---

  it('writes a file', async () => {
    const filePath = path.join(tmpDir, 'new.txt');
    await nfs.writeFile(filePath, 'New content');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('New content');
  });

  it('creates parent directories', async () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'file.txt');
    await nfs.writeFile(filePath, 'Deep content');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('Deep content');
  });

  // --- Existence ---

  it('checks file existence', async () => {
    expect(await nfs.fileExists(path.join(tmpDir, 'hello.txt'))).toBe(true);
    expect(await nfs.fileExists(path.join(tmpDir, 'nope.txt'))).toBe(false);
    expect(await nfs.fileExists(path.join(tmpDir, 'subdir'))).toBe(false); // directory, not file
  });

  it('checks directory existence', async () => {
    expect(await nfs.isDirectory(path.join(tmpDir, 'subdir'))).toBe(true);
    expect(await nfs.isDirectory(path.join(tmpDir, 'hello.txt'))).toBe(false);
    expect(await nfs.isDirectory(path.join(tmpDir, 'nope'))).toBe(false);
  });

  // --- List ---

  it('lists directory contents', async () => {
    const entries = await nfs.listDirectory(tmpDir);
    const names = entries.map(e => e.name).sort();
    expect(names).toEqual(['hello.txt', 'multi.txt', 'subdir'].sort());
    expect(entries.find(e => e.name === 'subdir')!.isDirectory).toBe(true);
    expect(entries.find(e => e.name === 'hello.txt')!.isDirectory).toBe(false);
  });

  // --- Create/Delete ---

  it('creates directories', async () => {
    const dirPath = path.join(tmpDir, 'new', 'deep', 'dir');
    await nfs.createDirectory(dirPath);
    expect(await nfs.isDirectory(dirPath)).toBe(true);
  });

  it('deletes files', async () => {
    const filePath = path.join(tmpDir, 'hello.txt');
    await nfs.deletePath(filePath);
    expect(await nfs.fileExists(filePath)).toBe(false);
  });

  it('deletes directories recursively', async () => {
    await nfs.deletePath(path.join(tmpDir, 'subdir'));
    expect(await nfs.isDirectory(path.join(tmpDir, 'subdir'))).toBe(false);
  });

  // --- Move/Copy ---

  it('moves files', async () => {
    const src = path.join(tmpDir, 'hello.txt');
    const dst = path.join(tmpDir, 'moved.txt');
    await nfs.movePath(src, dst);
    expect(await nfs.fileExists(src)).toBe(false);
    expect(await nfs.fileExists(dst)).toBe(true);
    expect(await nfs.readFile(dst)).toBe('Hello World\n');
  });

  it('copies files', async () => {
    const src = path.join(tmpDir, 'hello.txt');
    const dst = path.join(tmpDir, 'copy.txt');
    await nfs.copyPath(src, dst);
    expect(await nfs.fileExists(src)).toBe(true);
    expect(await nfs.fileExists(dst)).toBe(true);
    expect(await nfs.readFile(dst)).toBe('Hello World\n');
  });

  // --- Metadata ---

  it('gets file mtime', async () => {
    const mtime = await nfs.getMTime(path.join(tmpDir, 'hello.txt'));
    expect(mtime).toBeTypeOf('number');
    expect(mtime!).toBeGreaterThan(0);
  });

  it('returns null mtime for nonexistent', async () => {
    expect(await nfs.getMTime(path.join(tmpDir, 'nope.txt'))).toBeNull();
  });

  it('gets file size', async () => {
    const size = await nfs.getFileSize(path.join(tmpDir, 'hello.txt'));
    expect(size).toBe(12); // "Hello World\n"
  });

  // --- Security ---

  it('detects excluded paths', () => {
    const nfsWithExclusions = new NodeFileSystem({
      excludePatterns: ['**/node_modules/**', '**/.secret/**'],
    });
    expect(nfsWithExclusions.isPathExcluded('project/node_modules/pkg')).toBe(true);
    expect(nfsWithExclusions.isPathExcluded('project/src/main.ts')).toBe(false);
  });

  it('detects private paths', () => {
    const nfsWithPrivate = new NodeFileSystem({
      privatePatterns: ['**/.env', '**/.env.*'],
    });
    expect(nfsWithPrivate.isPathPrivate('project/.env')).toBe(true);
    expect(nfsWithPrivate.isPathPrivate('project/src/main.ts')).toBe(false);
  });

  // --- Image ---

  it('detects image files', () => {
    expect(nfs.isImageFile('/path/photo.png')).toBe(true);
    expect(nfs.isImageFile('/path/photo.jpg')).toBe(true);
    expect(nfs.isImageFile('/path/photo.webp')).toBe(true);
    expect(nfs.isImageFile('/path/code.ts')).toBe(false);
  });

  // --- Buffer ---

  it('opens and uses a file buffer', async () => {
    const filePath = path.join(tmpDir, 'multi.txt');
    const buffer = await nfs.openBuffer(filePath);

    expect(buffer.path).toBe(filePath);
    expect(buffer.getContent()).toBe('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n');
    expect(buffer.getLineCount()).toBe(6); // 5 lines + trailing newline
    expect(buffer.getRange(2, 3)).toBe('Line 2\nLine 3');

    // Apply edit
    buffer.applyEdit(2, 2, 'Modified Line 2');
    expect(buffer.getContent()).toContain('Modified Line 2');

    // Save
    await buffer.save();
    const saved = await fs.readFile(filePath, 'utf-8');
    expect(saved).toContain('Modified Line 2');
  });
});
