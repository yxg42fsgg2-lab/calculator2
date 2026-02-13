/**
 * Tests for the Node.js ProjectInfo implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeProjectInfo } from '../src/project-info.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('NodeProjectInfo', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zed-agent-project-'));
    await fs.mkdir(path.join(tmpDir, 'myproject'));
    await fs.writeFile(path.join(tmpDir, 'myproject', '.rules'), 'Use strict mode.\n');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects workspace roots', () => {
    const info = new NodeProjectInfo({
      workspaceRoots: [path.join(tmpDir, 'myproject')],
    });
    expect(info.workspaceRoots).toHaveLength(1);
    expect(info.workspaceRoots[0]!.name).toBe('myproject');
  });

  it('detects rules files', () => {
    const info = new NodeProjectInfo({
      workspaceRoots: [path.join(tmpDir, 'myproject')],
    });
    expect(info.workspaceRoots[0]!.rulesFile).toBeDefined();
    expect(info.workspaceRoots[0]!.rulesFile!.text).toBe('Use strict mode.');
    expect(info.workspaceRoots[0]!.rulesFile!.pathInWorktree).toBe('.rules');
  });

  it('resolves project paths', () => {
    const info = new NodeProjectInfo({
      workspaceRoots: [path.join(tmpDir, 'myproject')],
    });
    const resolved = info.resolveProjectPath('myproject/src/main.ts');
    expect(resolved).toBe(path.join(tmpDir, 'myproject', 'src/main.ts'));
  });

  it('returns null for unresolvable paths', () => {
    const info = new NodeProjectInfo({
      workspaceRoots: [path.join(tmpDir, 'myproject')],
    });
    // With multiple roots, nonexistent root name returns null
    const info2 = new NodeProjectInfo({
      workspaceRoots: [
        path.join(tmpDir, 'myproject'),
        path.join(tmpDir, 'other'),
      ],
    });
    expect(info2.resolveProjectPath('nonexistent/file.ts')).toBeNull();
  });

  it('generates short paths', () => {
    const info = new NodeProjectInfo({
      workspaceRoots: [path.join(tmpDir, 'myproject')],
    });
    const short = info.getShortPath(path.join(tmpDir, 'myproject', 'src', 'main.ts'));
    expect(short).toContain('myproject');
    expect(short).toContain('src');
  });

  it('detects OS', () => {
    const info = new NodeProjectInfo({ workspaceRoots: [] });
    expect(['macos', 'linux', 'windows']).toContain(info.os);
  });

  it('detects shell', () => {
    const info = new NodeProjectInfo({ workspaceRoots: [] });
    expect(info.shell).toBeTruthy();
  });
});
