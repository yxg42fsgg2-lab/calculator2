/**
 * Validation utilities for better error messages.
 * Checks BackendHost implementation for common mistakes.
 */

import type { BackendHost } from '../types/host.js';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  field: string;
}

/**
 * Validate a BackendHost implementation.
 * Returns a list of issues found. Empty list means the host is valid.
 *
 * Use this during development to catch misconfigurations early:
 * ```typescript
 * const issues = validateHost(myHost);
 * if (issues.length > 0) {
 *   console.error('Host validation failed:', issues);
 * }
 * ```
 */
export function validateHost(host: BackendHost): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Required sub-interfaces
  if (!host.fileSystem) {
    issues.push({ severity: 'error', field: 'fileSystem', message: 'BackendHost.fileSystem is required. Implement the FileSystem interface for file operations.' });
  } else {
    if (typeof host.fileSystem.readFile !== 'function') {
      issues.push({ severity: 'error', field: 'fileSystem.readFile', message: 'FileSystem.readFile must be a function.' });
    }
    if (typeof host.fileSystem.writeFile !== 'function') {
      issues.push({ severity: 'error', field: 'fileSystem.writeFile', message: 'FileSystem.writeFile must be a function.' });
    }
    if (typeof host.fileSystem.grep !== 'function') {
      issues.push({ severity: 'error', field: 'fileSystem.grep', message: 'FileSystem.grep must be a function. It can return empty results if not implemented.' });
    }
  }

  if (!host.terminal) {
    issues.push({ severity: 'error', field: 'terminal', message: 'BackendHost.terminal is required. Implement TerminalProvider for command execution.' });
  } else if (typeof host.terminal.createTerminal !== 'function') {
    issues.push({ severity: 'error', field: 'terminal.createTerminal', message: 'TerminalProvider.createTerminal must be a function.' });
  }

  if (!host.project) {
    issues.push({ severity: 'error', field: 'project', message: 'BackendHost.project is required. Provide workspace roots, OS, and shell info.' });
  } else {
    if (!host.project.workspaceRoots || !Array.isArray(host.project.workspaceRoots)) {
      issues.push({ severity: 'error', field: 'project.workspaceRoots', message: 'ProjectInfo.workspaceRoots must be an array of WorkspaceRoot objects.' });
    } else if (host.project.workspaceRoots.length === 0) {
      issues.push({ severity: 'warning', field: 'project.workspaceRoots', message: 'No workspace roots configured. Tools like read_file and grep will not work.' });
    }
    if (!host.project.os) {
      issues.push({ severity: 'warning', field: 'project.os', message: 'ProjectInfo.os not set. Defaulting to "linux". Set to "macos", "linux", or "windows".' });
    }
    if (!host.project.shell) {
      issues.push({ severity: 'warning', field: 'project.shell', message: 'ProjectInfo.shell not set. System prompt will not include shell information.' });
    }
    if (typeof host.project.resolveProjectPath !== 'function') {
      issues.push({ severity: 'error', field: 'project.resolveProjectPath', message: 'ProjectInfo.resolveProjectPath must be a function. It converts relative paths (like "rootname/src/file.ts") to absolute paths.' });
    }
  }

  if (!host.permissions) {
    issues.push({ severity: 'error', field: 'permissions', message: 'BackendHost.permissions is required. Implement PermissionHandler for tool authorization.' });
  }

  if (!host.events) {
    issues.push({ severity: 'error', field: 'events', message: 'BackendHost.events is required. Implement EventSink to receive AgentEvents.' });
  } else if (typeof host.events.emit !== 'function') {
    issues.push({ severity: 'error', field: 'events.emit', message: 'EventSink.emit must be a function that receives AgentEvent objects.' });
  }

  if (!host.http) {
    issues.push({ severity: 'error', field: 'http', message: 'BackendHost.http is required. Implement HttpClient for the fetch tool.' });
  }

  // Optional but useful
  if (!host.diagnostics) {
    issues.push({ severity: 'warning', field: 'diagnostics', message: 'No DiagnosticsProvider. The diagnostics tool will return empty results.' });
  }
  if (!host.webSearch) {
    issues.push({ severity: 'warning', field: 'webSearch', message: 'No WebSearchProvider. The web_search tool will be unavailable.' });
  }

  return issues;
}

/**
 * Validate and throw if there are errors.
 * Useful as a guard at session creation time.
 */
export function assertValidHost(host: BackendHost): void {
  const issues = validateHost(host);
  const errors = issues.filter(i => i.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `BackendHost validation failed:\n` +
      errors.map(e => `  - ${e.field}: ${e.message}`).join('\n') +
      '\n\nSee docs/ARCHITECTURE.md for the BackendHost interface guide.',
    );
  }
}
