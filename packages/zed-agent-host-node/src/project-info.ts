/**
 * Node.js ProjectInfo implementation.
 * Provides workspace root detection and path resolution.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import * as fsSync from 'node:fs';
import type { ProjectInfo, WorkspaceRoot, UserRules, RulesFile } from '@anthropic/zed-agent-core';

const RULES_FILE_NAMES = ['.rules', '.cursorrules', '.clinerules', '.windsurfrules'];

export interface NodeProjectInfoOptions {
  /** Absolute paths to workspace roots. */
  workspaceRoots: string[];
  /** User-configured global rules. */
  userRules?: UserRules[];
}

export class NodeProjectInfo implements ProjectInfo {
  readonly workspaceRoots: WorkspaceRoot[];
  readonly os: 'macos' | 'linux' | 'windows';
  readonly shell: string;
  readonly userRules?: UserRules[];

  constructor(options: NodeProjectInfoOptions) {
    this.workspaceRoots = options.workspaceRoots.map((rootPath) => {
      const absPath = path.resolve(rootPath);
      const name = path.basename(absPath);
      const rulesFile = this.findRulesFile(absPath);
      return { name, absolutePath: absPath, rulesFile };
    });

    this.os = os.platform() === 'darwin' ? 'macos'
      : os.platform() === 'win32' ? 'windows'
      : 'linux';

    this.shell = process.env['SHELL'] ?? '/bin/bash';
    this.userRules = options.userRules;
  }

  resolveProjectPath(relativePath: string): string | null {
    // The path should start with a workspace root name
    const firstComponent = relativePath.split(/[/\\]/)[0];
    if (!firstComponent) return null;

    for (const root of this.workspaceRoots) {
      if (root.name === firstComponent) {
        const rest = relativePath.slice(firstComponent.length + 1);
        return rest ? path.join(root.absolutePath, rest) : root.absolutePath;
      }
    }

    // Also try matching as absolute path
    if (path.isAbsolute(relativePath)) {
      for (const root of this.workspaceRoots) {
        if (relativePath.startsWith(root.absolutePath)) {
          return relativePath;
        }
      }
    }

    // If there's only one root, try resolving relative to it
    if (this.workspaceRoots.length === 1) {
      const root = this.workspaceRoots[0]!;
      return path.join(root.absolutePath, relativePath);
    }

    return null;
  }

  getShortPath(absolutePath: string): string {
    for (const root of this.workspaceRoots) {
      if (absolutePath.startsWith(root.absolutePath)) {
        const rest = absolutePath.slice(root.absolutePath.length + 1);
        return rest ? `${root.name}/${rest}` : root.name;
      }
    }
    return absolutePath;
  }

  getRootForPath(filePath: string): WorkspaceRoot | null {
    for (const root of this.workspaceRoots) {
      if (filePath.startsWith(root.absolutePath) || filePath.startsWith(root.name)) {
        return root;
      }
    }
    return null;
  }

  private findRulesFile(rootPath: string): RulesFile | undefined {
    for (const name of RULES_FILE_NAMES) {
      const rulesPath = path.join(rootPath, name);
      try {
        const text = fsSync.readFileSync(rulesPath, 'utf-8').trim();
        return { pathInWorktree: name, text };
      } catch {
        // File doesn't exist, try next
      }
    }
    return undefined;
  }
}
