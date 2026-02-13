/**
 * @module @anthropic/zed-agent-host-node
 *
 * Reference Node.js host implementation for zed-agent-core.
 * Provides all BackendHost sub-interfaces using Node.js built-in modules.
 *
 * ```typescript
 * import { createNodeHost } from '@anthropic/zed-agent-host-node';
 *
 * const host = createNodeHost({
 *   workspaceRoots: ['/path/to/project'],
 *   eventSink: { emit: (event) => console.log(event) },
 * });
 * ```
 */

import type { BackendHost, EventSink } from '@anthropic/zed-agent-core';
import { NodeFileSystem, type NodeFileSystemOptions } from './file-system.js';
import { NodeTerminalProvider } from './terminal.js';
import { NodeProjectInfo, type NodeProjectInfoOptions } from './project-info.js';
import { NodePermissionHandler, type NodePermissionHandlerOptions } from './permissions.js';
import { NodeHttpClient } from './http-client.js';

export interface NodeHostOptions extends NodeProjectInfoOptions {
  /** Event sink — receives all agent events for UI rendering. */
  eventSink: EventSink;
  /** File system options (exclude patterns, private patterns). */
  fileSystemOptions?: NodeFileSystemOptions;
  /** Permission handler options. */
  permissionOptions?: NodePermissionHandlerOptions;
  /** Default shell path. */
  shell?: string;
}

/**
 * Create a BackendHost using Node.js built-in modules.
 *
 * This is the main entry point for the Node.js host package.
 * It assembles all sub-interfaces into a complete BackendHost.
 */
export function createNodeHost(options: NodeHostOptions): BackendHost {
  const projectInfo = new NodeProjectInfo(options);

  return {
    fileSystem: new NodeFileSystem(options.fileSystemOptions),
    terminal: new NodeTerminalProvider(options.shell ?? projectInfo.shell),
    project: projectInfo,
    permissions: new NodePermissionHandler(options.permissionOptions),
    events: options.eventSink,
    http: new NodeHttpClient(),
  };
}

// Re-export individual implementations for customization
export { NodeFileSystem } from './file-system.js';
export type { NodeFileSystemOptions } from './file-system.js';
export { NodeTerminalProvider } from './terminal.js';
export { NodeProjectInfo } from './project-info.js';
export type { NodeProjectInfoOptions } from './project-info.js';
export { NodePermissionHandler } from './permissions.js';
export type { NodePermissionHandlerOptions } from './permissions.js';
export { NodeHttpClient } from './http-client.js';
