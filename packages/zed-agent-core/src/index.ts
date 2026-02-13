/**
 * @module @anthropic/zed-agent-core
 *
 * Zed's AI coding agent backend — pluggable, framework-agnostic, complete 1:1 port.
 *
 * To use this library, implement the {@link BackendHost} interface and pass it
 * to {@link createAgentSession} to start an agent session.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createAgentSession } from '@anthropic/zed-agent-core';
 * import { createNodeHost } from '@anthropic/zed-agent-host-node';
 *
 * const host = createNodeHost({
 *   workspaceRoots: ['/path/to/project'],
 *   eventSink: { emit: (event) => console.log(event) },
 * });
 *
 * const session = await createAgentSession(host, {
 *   model: myLanguageModel,
 * });
 *
 * await session.send('Hello, agent!');
 * ```
 */

// Re-export all types
export * from './types/index.js';

// Re-export models
export * from './models/index.js';

// Re-export tools
export * from './tools/index.js';

// Re-export thread
export * from './thread/index.js';
