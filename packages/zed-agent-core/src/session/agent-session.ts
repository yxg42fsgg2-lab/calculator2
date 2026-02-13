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
 * - Thread persistence (save/load to database)
 */

import { EventEmitter } from 'eventemitter3';
import type { LanguageModel } from '../models/language-model.js';
import type { LanguageModelRegistry } from '../models/registry.js';
import { Thread, type ThreadOptions } from '../thread/thread.js';
import { createDefaultTools } from '../tools/index.js';
import { EditFileTool } from '../tools/edit-file-tool.js';
import { buildSystemPrompt, systemPromptDataFromHost } from '../templates/system-prompt.js';
import { ThreadsDatabase } from '../persistence/threads-database.js';
import type { BackendHost } from '../types/host.js';
import type { AgentSettings } from '../types/settings.js';
import type { SessionId } from '../types/branded.js';
import { agentProfileId } from '../types/branded.js';
import type { StopReason, UserMessageContent, DbThreadMetadata } from '../types/index.js';
import { eraseToolType } from '../types/tools.js';

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
  /** Path to SQLite database for thread persistence. If not provided, no persistence. */
  databasePath?: string;
  /** Whether to auto-save threads after each turn. Default: true if databasePath is set. */
  autoSave?: boolean;
}

export interface AgentSessionEvents {
  /** Thread was created. */
  thread_created: [Thread];
  /** Thread was destroyed. */
  thread_destroyed: [SessionId];
  /** Model was changed. */
  model_changed: [LanguageModel];
  /** Thread list was updated (saved, deleted). */
  thread_list_updated: [];
}

// ---------------------------------------------------------------------------
// AgentSession
// ---------------------------------------------------------------------------

/**
 * An agent session that manages threads, model state, and persistence.
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
  private db?: ThreadsDatabase;
  private autoSave: boolean;

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

    // Set up default tools, configuring EditFileTool with the edit model
    if (options.registerDefaultTools !== false) {
      this.defaultTools = createDefaultTools();
      // Replace the default EditFileTool with one configured with the edit model
      if (options.model) {
        this.defaultTools = this.defaultTools.filter(t => t.name !== 'edit_file');
        this.defaultTools.push(eraseToolType(new EditFileTool({ editModel: options.model })));
      }
    } else {
      this.defaultTools = [];
    }
    this.customTools = options.customTools ?? [];

    // Set up persistence
    if (options.databasePath) {
      this.db = new ThreadsDatabase(options.databasePath);
    }
    this.autoSave = options.autoSave ?? !!options.databasePath;
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

    // Set up auto-save on state changes
    if (this.autoSave && this.db) {
      const db = this.db;
      thread.on('event', () => {
        if (thread.isTurnComplete && !thread.isEmpty) {
          this.saveThread(thread);
        }
      });
      thread.on('title_updated', () => {
        if (!thread.isEmpty) {
          this.saveThread(thread);
        }
      });
    }

    this.threads.set(thread.id, thread);
    this.activeThread = thread;
    this.emit('thread_created', thread);

    return thread;
  }

  /**
   * Load a thread from the database.
   * Ported from: NativeAgent::load_thread() / open_thread()
   */
  loadThread(id: SessionId): Thread | null {
    if (!this.db) return null;

    // Check if already loaded
    const existing = this.threads.get(id);
    if (existing) return existing;

    const dbThread = this.db.loadThread(id);
    if (!dbThread) return null;

    // Resolve the model from the saved selection
    let model = this.model;
    if (dbThread.model && this.registry) {
      const configured = this.registry.selectModel({
        provider: dbThread.model.provider,
        model: dbThread.model.model,
      });
      if (configured) {
        model = configured.model;
      }
    }

    const thread = Thread.fromDb(id, dbThread, {
      host: this.host,
      settings: this.settings,
      model,
      systemPromptBuilder: this.buildSystemPrompt.bind(this),
    });

    // Register tools
    for (const tool of this.defaultTools) {
      thread.addTool(tool);
    }
    for (const tool of this.customTools) {
      thread.addTool(tool);
    }

    // Set up auto-save
    if (this.autoSave && this.db) {
      thread.on('event', () => {
        if (thread.isTurnComplete && !thread.isEmpty) {
          this.saveThread(thread);
        }
      });
      thread.on('title_updated', () => {
        if (!thread.isEmpty) {
          this.saveThread(thread);
        }
      });
    }

    this.threads.set(thread.id, thread);
    this.emit('thread_created', thread);

    return thread;
  }

  /**
   * Save a thread to the database.
   */
  saveThread(thread: Thread): void {
    if (!this.db) return;
    if (thread.isEmpty) return;
    this.db.saveThread(thread.id, thread.toDb());
    this.emit('thread_list_updated');
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
   * Get a thread by ID (from memory or database).
   */
  getThread(id: SessionId): Thread | undefined {
    return this.threads.get(id) ?? this.loadThread(id) ?? undefined;
  }

  /**
   * Close a thread.
   */
  closeThread(id: SessionId): void {
    const thread = this.threads.get(id);
    if (thread) {
      thread.cancel();
      // Save before closing
      if (this.autoSave && !thread.isEmpty) {
        this.saveThread(thread);
      }
      this.threads.delete(id);
      if (this.activeThread === thread) {
        this.activeThread = undefined;
      }
      this.emit('thread_destroyed', id);
    }
  }

  /**
   * List all threads (from database if available, otherwise from memory).
   */
  listThreads(): DbThreadMetadata[] {
    if (this.db) {
      return this.db.listThreads();
    }
    // Fall back to in-memory threads
    const result: DbThreadMetadata[] = [];
    for (const thread of this.threads.values()) {
      if (!thread.isEmpty) {
        result.push({
          id: thread.id,
          title: thread.title,
          updatedAt: thread.updatedAt.toISOString(),
        });
      }
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Delete a thread from memory and database.
   */
  deleteThread(id: SessionId): void {
    this.closeThread(id);
    this.db?.deleteThread(id);
    this.emit('thread_list_updated');
  }

  /**
   * Delete all threads.
   */
  deleteAllThreads(): void {
    for (const id of Array.from(this.threads.keys())) {
      this.closeThread(id);
    }
    this.db?.deleteAllThreads();
    this.emit('thread_list_updated');
  }

  // --- Model management ---

  /**
   * Set the current model.
   */
  setModel(model: LanguageModel): void {
    this.model = model;

    // Update EditFileTool for all threads
    for (const thread of this.threads.values()) {
      if (!thread.model) {
        thread.setModel(model);
      }
    }

    // Update the default EditFileTool config
    this.defaultTools = this.defaultTools.filter(t => t.name !== 'edit_file');
    this.defaultTools.push(eraseToolType(new EditFileTool({ editModel: model })));

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
    const result = await thread.send(content);

    // Save after turn completes
    if (this.autoSave) {
      this.saveThread(thread);
    }

    return result;
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

  /**
   * Close the session and clean up resources.
   */
  close(): void {
    for (const thread of this.threads.values()) {
      thread.cancel();
      if (this.autoSave && !thread.isEmpty) {
        this.saveThread(thread);
      }
    }
    this.threads.clear();
    this.activeThread = undefined;
    this.db?.close();
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
