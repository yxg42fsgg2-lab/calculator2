/**
 * @module tools
 * All 18 built-in tools, ported 1:1 from Zed's agent crate.
 */

export { ToolRegistry } from './tool-registry.js';

// Individual tools
export { NowTool } from './now-tool.js';
export type { NowToolInput } from './now-tool.js';

export { FetchTool } from './fetch-tool.js';
export type { FetchToolInput } from './fetch-tool.js';

export { WebSearchTool } from './web-search-tool.js';
export type { WebSearchToolInput, WebSearchToolOutput } from './web-search-tool.js';

export { ReadFileTool } from './read-file-tool.js';
export type { ReadFileToolInput } from './read-file-tool.js';

export { ListDirectoryTool } from './list-directory-tool.js';
export type { ListDirectoryToolInput } from './list-directory-tool.js';

export { FindPathTool } from './find-path-tool.js';
export type { FindPathToolInput, FindPathToolOutput } from './find-path-tool.js';

export { GrepTool } from './grep-tool.js';
export type { GrepToolInput } from './grep-tool.js';

export { EditFileTool } from './edit-file-tool.js';
export type { EditFileToolInput, EditFileMode } from './edit-file-tool.js';

export { CreateDirectoryTool } from './create-directory-tool.js';
export type { CreateDirectoryToolInput } from './create-directory-tool.js';

export { DeletePathTool } from './delete-path-tool.js';
export type { DeletePathToolInput } from './delete-path-tool.js';

export { MovePathTool } from './move-path-tool.js';
export type { MovePathToolInput } from './move-path-tool.js';

export { CopyPathTool } from './copy-path-tool.js';
export type { CopyPathToolInput } from './copy-path-tool.js';

export { SaveFileTool } from './save-file-tool.js';
export type { SaveFileToolInput } from './save-file-tool.js';

export { RestoreFileTool } from './restore-file-tool.js';
export type { RestoreFileToolInput } from './restore-file-tool.js';

export { TerminalTool } from './terminal-tool.js';
export type { TerminalToolInput } from './terminal-tool.js';

export { DiagnosticsTool } from './diagnostics-tool.js';
export type { DiagnosticsToolInput } from './diagnostics-tool.js';

export { OpenTool } from './open-tool.js';
export type { OpenToolInput } from './open-tool.js';

export { SubagentTool } from './subagent-tool.js';
export type { SubagentToolInput } from './subagent-tool.js';

// --- Factory function ---

import type { AnyAgentTool } from '../types/tools.js';
import { eraseToolType } from '../types/tools.js';
import { CopyPathTool as _CopyPathTool } from './copy-path-tool.js';
import { CreateDirectoryTool as _CreateDirectoryTool } from './create-directory-tool.js';
import { DeletePathTool as _DeletePathTool } from './delete-path-tool.js';
import { DiagnosticsTool as _DiagnosticsTool } from './diagnostics-tool.js';
import { EditFileTool as _EditFileTool } from './edit-file-tool.js';
import { FetchTool as _FetchTool } from './fetch-tool.js';
import { FindPathTool as _FindPathTool } from './find-path-tool.js';
import { GrepTool as _GrepTool } from './grep-tool.js';
import { ListDirectoryTool as _ListDirectoryTool } from './list-directory-tool.js';
import { MovePathTool as _MovePathTool } from './move-path-tool.js';
import { NowTool as _NowTool } from './now-tool.js';
import { OpenTool as _OpenTool } from './open-tool.js';
import { ReadFileTool as _ReadFileTool } from './read-file-tool.js';
import { RestoreFileTool as _RestoreFileTool } from './restore-file-tool.js';
import { SaveFileTool as _SaveFileTool } from './save-file-tool.js';
import { SubagentTool as _SubagentTool } from './subagent-tool.js';
import { TerminalTool as _TerminalTool } from './terminal-tool.js';
import { WebSearchTool as _WebSearchTool } from './web-search-tool.js';

/**
 * Create all 18 default tools.
 * Ported from: Thread::add_default_tools() in thread.rs
 *
 * Returns an array of type-erased tools ready for registration.
 */
export function createDefaultTools(): AnyAgentTool[] {
  return [
    eraseToolType(new _CopyPathTool()),
    eraseToolType(new _CreateDirectoryTool()),
    eraseToolType(new _DeletePathTool()),
    eraseToolType(new _DiagnosticsTool()),
    eraseToolType(new _EditFileTool()),
    eraseToolType(new _FetchTool()),
    eraseToolType(new _FindPathTool()),
    eraseToolType(new _GrepTool()),
    eraseToolType(new _ListDirectoryTool()),
    eraseToolType(new _MovePathTool()),
    eraseToolType(new _NowTool()),
    eraseToolType(new _OpenTool()),
    eraseToolType(new _ReadFileTool()),
    eraseToolType(new _RestoreFileTool()),
    eraseToolType(new _SaveFileTool()),
    eraseToolType(new _SubagentTool()),
    eraseToolType(new _TerminalTool()),
    eraseToolType(new _WebSearchTool()),
  ];
}

/**
 * All built-in tool names.
 * Ported from: ALL_TOOL_NAMES in tools.rs
 */
export const ALL_TOOL_NAMES: readonly string[] = [
  'copy_path',
  'create_directory',
  'delete_path',
  'diagnostics',
  'edit_file',
  'fetch',
  'find_path',
  'grep',
  'list_directory',
  'move_path',
  'now',
  'open',
  'read_file',
  'restore_file_from_disk',
  'save_file',
  'subagent',
  'terminal',
  'web_search',
] as const;
