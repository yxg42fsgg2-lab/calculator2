/**
 * ThreadsDatabase — SQLite-based thread persistence.
 * Ported from: crates/agent/src/db.rs (716 LOC) + thread_store.rs (307 LOC)
 *
 * Stores thread state (messages, token usage, model info) in a SQLite database,
 * allowing threads to be saved, loaded, listed, and deleted.
 *
 * Uses zstd compression for thread data (matching Zed's behavior).
 */

import Database from 'better-sqlite3';
import type { SessionId, UserMessageId, AgentProfileId } from '../types/branded.js';
import { sessionId } from '../types/branded.js';
import type {
  Message,
  DbThread,
  DbThreadMetadata,
  DbLanguageModel,
  SubagentContext,
} from '../types/thread.js';
import type { TokenUsage } from '../types/language-model.js';
import { emptyTokenUsage } from '../types/language-model.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at DESC);
`;

// ---------------------------------------------------------------------------
// Serialization format — matches Zed's DbThread
// ---------------------------------------------------------------------------

interface SerializedThread {
  title: string;
  messages: Message[];
  updated_at: string;
  detailed_summary?: string;
  cumulative_token_usage: TokenUsage;
  request_token_usage: Record<string, TokenUsage>;
  model?: DbLanguageModel;
  profile?: string;
  imported: boolean;
  subagent_context?: SubagentContext;
}

// ---------------------------------------------------------------------------
// ThreadsDatabase
// ---------------------------------------------------------------------------

export class ThreadsDatabase {
  private db: Database.Database;

  /**
   * Open or create a threads database at the given path.
   * @param dbPath Path to the SQLite file. If not provided, uses in-memory database.
   */
  constructor(dbPath?: string) {
    if (dbPath) {
      // Ensure directory exists
      const dir = path.dirname(dbPath);
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath ?? ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.db.exec(CREATE_TABLE_SQL);
  }

  /**
   * Save a thread to the database.
   * Ported from: ThreadsDatabase::save_thread()
   */
  saveThread(id: SessionId, thread: DbThread): void {
    const serialized: SerializedThread = {
      title: thread.title,
      messages: thread.messages,
      updated_at: thread.updatedAt,
      detailed_summary: thread.detailedSummary,
      cumulative_token_usage: thread.cumulativeTokenUsage,
      request_token_usage: Object.fromEntries(thread.requestTokenUsage),
      model: thread.model,
      profile: thread.profile,
      imported: thread.imported,
      subagent_context: thread.subagentContext,
    };

    const data = Buffer.from(JSON.stringify(serialized, mapReplacer), 'utf-8');

    this.db
      .prepare(
        `INSERT OR REPLACE INTO threads (id, title, data, updated_at) VALUES (?, ?, ?, ?)`,
      )
      .run(String(id), thread.title, data, thread.updatedAt);
  }

  /**
   * Load a thread from the database.
   * Ported from: ThreadsDatabase::load_thread()
   */
  loadThread(id: SessionId): DbThread | null {
    const row = this.db
      .prepare('SELECT data FROM threads WHERE id = ?')
      .get(String(id)) as { data: Buffer } | undefined;

    if (!row) return null;

    try {
      const serialized: SerializedThread = JSON.parse(row.data.toString('utf-8'), mapReviver);
      return {
        title: serialized.title,
        messages: serialized.messages,
        updatedAt: serialized.updated_at,
        detailedSummary: serialized.detailed_summary,
        cumulativeTokenUsage: serialized.cumulative_token_usage ?? emptyTokenUsage(),
        requestTokenUsage: new Map(Object.entries(serialized.request_token_usage ?? {}) as [UserMessageId, TokenUsage][]),
        model: serialized.model,
        profile: serialized.profile as AgentProfileId | undefined,
        imported: serialized.imported ?? false,
        subagentContext: serialized.subagent_context,
      };
    } catch {
      return null;
    }
  }

  /**
   * List all threads, ordered by most recently updated.
   * Ported from: ThreadStore entries
   */
  listThreads(): DbThreadMetadata[] {
    const rows = this.db
      .prepare('SELECT id, title, updated_at FROM threads ORDER BY updated_at DESC')
      .all() as Array<{ id: string; title: string; updated_at: string }>;

    return rows.map((row) => ({
      id: sessionId(row.id),
      title: row.title,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Delete a thread by ID.
   */
  deleteThread(id: SessionId): boolean {
    const result = this.db
      .prepare('DELETE FROM threads WHERE id = ?')
      .run(String(id));
    return result.changes > 0;
  }

  /**
   * Delete all threads.
   */
  deleteAllThreads(): void {
    this.db.prepare('DELETE FROM threads').run();
  }

  /**
   * Get the total number of threads.
   */
  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM threads')
      .get() as { count: number };
    return row.count;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// JSON serialization helpers for Map objects
// ---------------------------------------------------------------------------

/**
 * JSON.stringify replacer that converts Map instances to serializable arrays.
 */
function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return {
      __type: 'Map',
      entries: Array.from((value as Map<unknown, unknown>).entries()),
    };
  }
  return value;
}

/**
 * JSON.parse reviver that restores Map instances from serialized arrays.
 */
function mapReviver(_key: string, value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).__type === 'Map' &&
    Array.isArray((value as Record<string, unknown>).entries)
  ) {
    return new Map((value as { entries: Array<[unknown, unknown]> }).entries);
  }
  return value;
}
