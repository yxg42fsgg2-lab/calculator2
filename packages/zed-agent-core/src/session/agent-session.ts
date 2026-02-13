/**
 * AgentSession — manages the lifecycle of an agent session.
 * Ported from: crates/agent/src/agent.rs — NativeAgent (~1,200 LOC production)
 *
 * This is the top-level entry point for using the agent backend.
 * It manages:
 * - Session creation and destruction
 * - Model management and switching
 * - Thread lifecycle
 * - Tool registration
 * - System prompt construction
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import type { LanguageModel } from '../models/language-model.js';
import type { LanguageModelRegistry } from '../models/registry.js';
import { Thread, type ThreadOptions } from '../thread/thread.js';
import { createDefaultTools } from '../tools/index.js';
import { buildSystemPrompt, systemPromptDataFromHost } from '../templates/system-prompt.js';
import type { BackendHost } from '../types/host.js';
import type { AgentSettings } from '../types/settings.js';
import type { SessionId, UserMessageId } from '../types/branded.js';
import { sessionId, agentProfileId } from '../types/branded.js';
import type { StopReason, UserMessageContent } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSessionOptions {
  /** The host environment. */
  host: BackendHost;
  /** Language model to use. */
  model?: LanguageModel;
  /** Model registry for model switching. */
  registry?: LanguageModelRegistry;
  /** Agent settings. */
  settings?: Partial<AgentSettings>;
  /** Whether to register default tools. */
  registerDefaultTools?: boolean;
  /** Additional custom tools to register. */
  customTools?: import('../types/tools.js').AnyAgentTool[];
}

export interface AgentSessionEvents {
  /** Thread was created. */
  thread_created: [Thread];
  /** Thread was destroyed. */
  thread_destroyed: [SessionId];
  /** Model was changed. */
  model_changed: [LanguageModel];
}

// ---------------------------------------------------------------------------
// AgentSession
// ---------------------------------------------------------------------------

/**
 * An agent session that manages threads and model state.
 * This is the top-level entry point for using the agent backend.
 *
 * ```typescript
 * const session = createAgentSession(host, { model: myModel });
 * const response = await session.send('Hello!');
 * ```
 */
export class AgentSession extends EventEmitter<AgentSessionEvents> {
  private host: BackendHost;
  private model?: LanguageModel;
  private registry?: LanguageModelRegistry;
  private settings: AgentSettings;
  private threads: Map<SessionId, Thread> = new Map();
  private activeThread?: Thread;
  private defaultTools: import('../types/tools.js').AnyAgentTool[];
  private customTools: import('../types/tools.js').AnyAgentTool[];

  constructor(options: AgentSessionOptions) {
    super();
    this.host = options.host;
    this.model = options.model;
    this.registry = options.registry;
    this.settings = {
      defaultProfile: agentProfileId('default'),
      profiles: new Map(),
      toolPermissionMode: 'auto',
      ...options.settings,
    };
    this.defaultTools = options.registerDefaultTools !== false
      ? createDefaultTools()
      : [];
    this.customTools = options.customTools ?? [];
  }

  // --- Thread management ---

  /**
   * Create a new thread.
   */
  createThread(): Thread {
    const thread = new Thread({
      host: this.host,
      settings: this.settings,
      model: this.model,
      systemPromptBuilder: this.buildSystemPrompt.bind(this),
    });

    // Register tools
    for (const tool of this.defaultTools) {
      thread.addTool(tool);
    }
    for (const tool of this.customTools) {
      thread.addTool(tool);
    }

    this.threads.set(thread.id, thread);
    this.activeThread = thread;
    this.emit('thread_created', thread);

    return thread;
  }

  /**
   * Get the active thread, creating one if needed.
   */
  getOrCreateActiveThread(): Thread {
    if (!this.activeThread) {
      return this.createThread();
    }
    return this.activeThread;
  }

  /**
   * Get a thread by ID.
   */
  getThread(id: SessionId): Thread | undefined {
    return this.threads.get(id);
  }

  /**
   * Close a thread.
   */
  closeThread(id: SessionId): void {
    const thread = this.threads.get(id);
    if (thread) {
      thread.cancel();
      this.threads.delete(id);
      if (this.activeThread === thread) {
        this.activeThread = undefined;
      }
      this.emit('thread_destroyed', id);
    }
  }

  /**
   * List all thread IDs.
   */
  listThreads(): SessionId[] {
    return Array.from(this.threads.keys());
  }

  // --- Model management ---

  /**
   * Set the current model.
   */
  setModel(model: LanguageModel): void {
    this.model = model;

    // Update all threads that don't have a model set
    for (const thread of this.threads.values()) {
      if (!thread.model) {
        thread.setModel(model);
      }
    }

    this.emit('model_changed', model);
  }

  /**
   * Get the current model.
   */
  getModel(): LanguageModel | undefined {
    return this.model;
  }

  // --- Convenience methods ---

  /**
   * Send a text message to the active thread.
   * Creates a thread if none exists.
   */
  async send(
    text: string,
    options?: { threadId?: SessionId },
  ): Promise<StopReason> {
    const thread = options?.threadId
      ? this.getThread(options.threadId) ?? this.createThread()
      : this.getOrCreateActiveThread();

    const content: UserMessageContent[] = [{ type: 'text', text }];
    return thread.send(content);
  }

  /**
   * Cancel the active thread's current turn.
   */
  cancel(threadId?: SessionId): void {
    const thread = threadId
      ? this.getThread(threadId)
      : this.activeThread;
    thread?.cancel();
  }

  // --- Private ---

  private buildSystemPrompt(toolNames: string[], modelName?: string): string {
    const data = systemPromptDataFromHost(this.host, toolNames, modelName);
    return buildSystemPrompt(data);
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create an agent session.
 * This is the primary entry point for using the agent backend.
 *
 * ```typescript
 * import { createAgentSession } from '@anthropic/zed-agent-core';
 * import { createNodeHost } from '@anthropic/zed-agent-host-node';
 *
 * const host = createNodeHost({ workspaceRoots: ['/project'], eventSink });
 * const session = createAgentSession(host, { model: myModel });
 * await session.send('Hello!');
 * ```
 */
export function createAgentSession(
  host: BackendHost,
  options: Omit<AgentSessionOptions, 'host'> = {},
): AgentSession {
  return new AgentSession({ host, ...options });
}
