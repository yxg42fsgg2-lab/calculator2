/**
 * Thread export/import for sharing conversations.
 * Ported from: crates/agent/src/legacy_thread.rs (~396 LOC)
 *
 * Exports threads as a portable JSON format that can be shared between
 * users, saved to files, or embedded in documentation.
 */

import type { SessionId, UserMessageId } from '../types/branded.js';
import { sessionId, userMessageId } from '../types/branded.js';
import type { Message, UserMessage, AgentMessage, SubagentContext } from '../types/thread.js';
import type { TokenUsage } from '../types/language-model.js';
import { emptyTokenUsage } from '../types/language-model.js';
import type { Thread } from './thread.js';

// ---------------------------------------------------------------------------
// Export format
// ---------------------------------------------------------------------------

/**
 * Portable thread export format.
 * Designed to be JSON-serializable and human-readable.
 */
export interface ThreadExport {
  /** Format version for forward compatibility. */
  version: 1;
  /** When the export was created. */
  exportedAt: string;
  /** Thread metadata. */
  metadata: {
    id: string;
    title: string;
    createdAt?: string;
    updatedAt: string;
    model?: {
      provider: string;
      model: string;
    };
    tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
    };
  };
  /** The conversation messages. */
  messages: ExportedMessage[];
}

export type ExportedMessage =
  | { role: 'user'; content: ExportedContent[] }
  | { role: 'assistant'; content: ExportedContent[]; toolResults?: ExportedToolResult[] }
  | { role: 'resume' };

export type ExportedContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'image'; description: string }
  | { type: 'mention'; uri: string; text: string }
  | { type: 'tool_use'; name: string; input: unknown };

export interface ExportedToolResult {
  toolName: string;
  isError: boolean;
  content: string;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export a thread to the portable JSON format.
 */
export function exportThread(thread: Thread): ThreadExport {
  const messages = thread.getMessages();
  const usage = thread.latestTokenUsage();

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    metadata: {
      id: String(thread.id),
      title: thread.title,
      updatedAt: thread.updatedAt.toISOString(),
      model: thread.model ? {
        provider: String(thread.model.providerId),
        model: String(thread.model.id),
      } : undefined,
      tokenUsage: usage ? {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      } : undefined,
    },
    messages: messages.map(exportMessage),
  };
}

function exportMessage(msg: Message): ExportedMessage {
  switch (msg.type) {
    case 'user':
      return {
        role: 'user',
        content: msg.message.content.map((c): ExportedContent => {
          switch (c.type) {
            case 'text': return { type: 'text', text: c.text };
            case 'image': return { type: 'image', description: '[image]' };
            case 'mention': return {
              type: 'mention',
              uri: JSON.stringify(c.uri),
              text: c.content,
            };
          }
        }),
      };
    case 'agent':
      return {
        role: 'assistant',
        content: msg.message.content.map((c): ExportedContent => {
          switch (c.type) {
            case 'text': return { type: 'text', text: c.text };
            case 'thinking': return { type: 'thinking', text: c.text };
            case 'redacted_thinking': return { type: 'thinking', text: '[redacted]' };
            case 'tool_use': return {
              type: 'tool_use',
              name: c.toolUse.name,
              input: c.toolUse.input,
            };
          }
        }),
        toolResults: Array.from(msg.message.toolResults.values()).map((r) => ({
          toolName: r.toolName,
          isError: r.isError,
          content: r.content.type === 'text' ? r.content.text : '[image]',
        })),
      };
    case 'resume':
      return { role: 'resume' };
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Import a thread from the portable JSON format.
 * Returns messages that can be passed to Thread.fromDb or used to initialize a new thread.
 */
export function importThread(data: ThreadExport): {
  id: SessionId;
  title: string;
  messages: Message[];
} {
  if (data.version !== 1) {
    throw new Error(`Unsupported thread export version: ${data.version}`);
  }

  return {
    id: sessionId(data.metadata.id),
    title: data.metadata.title,
    messages: data.messages.map(importMessage),
  };
}

function importMessage(msg: ExportedMessage): Message {
  switch (msg.role) {
    case 'user':
      return {
        type: 'user',
        message: {
          id: userMessageId(crypto.randomUUID()),
          content: msg.content.map((c) => {
            switch (c.type) {
              case 'text': return { type: 'text' as const, text: c.text };
              case 'image': return { type: 'text' as const, text: '[imported image]' };
              case 'mention': return { type: 'text' as const, text: c.text };
              case 'tool_use': return { type: 'text' as const, text: `[tool: ${c.name}]` };
              case 'thinking': return { type: 'text' as const, text: '' };
            }
          }),
        },
      };
    case 'assistant':
      return {
        type: 'agent',
        message: {
          content: msg.content.map((c) => {
            switch (c.type) {
              case 'text': return { type: 'text' as const, text: c.text };
              case 'thinking': return { type: 'thinking' as const, text: c.text };
              default: return { type: 'text' as const, text: '' };
            }
          }),
          toolResults: new Map(),
        },
      };
    case 'resume':
      return { type: 'resume' };
  }
}

/**
 * Export a thread to JSON string.
 */
export function exportThreadToJson(thread: Thread): string {
  return JSON.stringify(exportThread(thread), null, 2);
}

/**
 * Import a thread from JSON string.
 */
export function importThreadFromJson(json: string): ReturnType<typeof importThread> {
  return importThread(JSON.parse(json) as ThreadExport);
}
