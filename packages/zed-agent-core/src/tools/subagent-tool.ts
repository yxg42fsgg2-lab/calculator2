/**
 * SubagentTool — spawns a child agent thread for sub-tasks.
 * Ported from: crates/agent/src/tools/subagent_tool.rs (~204 LOC production)
 *              + NativeThreadEnvironment::create_subagent_thread (~100 LOC)
 *
 * This tool creates a child agent session that inherits the parent's model and tools,
 * executes a specific task, and returns a summary of the results.
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind, AnyAgentTool } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';
import type { LanguageModel } from '../models/language-model.js';
import { Thread } from '../thread/thread.js';
import { MAX_SUBAGENT_DEPTH, MAX_PARALLEL_SUBAGENTS } from '../types/thread.js';
import type { SessionId } from '../types/branded.js';
import type { AgentSettings } from '../types/settings.js';

export interface SubagentToolInput {
  /** A short label for the subagent task (shown in UI). */
  label: string;
  /** The initial prompt/task description for the subagent. */
  prompt: string;
  /** Optional timeout in milliseconds. */
  timeout_ms?: number;
  /** Optional list of tool names the subagent is allowed to use. */
  allowed_tools?: string[];
}

export const SUBAGENT_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Spawns a sub-agent to handle a specific task independently. ' +
    'The sub-agent has access to the same tools and context, ' +
    'executes the task, and returns a summary of what it did. ' +
    'Use this for parallelizable tasks or when you want to delegate a specific piece of work.',
  properties: {
    label: {
      type: 'string',
      description: 'A short label for the subagent task.',
    },
    prompt: {
      type: 'string',
      description: 'The initial prompt/task description for the subagent.',
    },
    timeout_ms: {
      type: 'number',
      description: 'Optional timeout in milliseconds.',
    },
    allowed_tools: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional list of tool names the subagent is allowed to use.',
    },
  },
  required: ['label', 'prompt'],
} as const;

/**
 * Configuration required by the SubagentTool to spawn child threads.
 */
export interface SubagentToolConfig {
  /** The parent thread's model. */
  model?: LanguageModel;
  /** The parent thread's registered tools (for inheritance). */
  parentTools: Map<string, AnyAgentTool>;
  /** The parent thread's depth (for enforcing MAX_SUBAGENT_DEPTH). */
  parentDepth: number;
  /** The parent thread's session ID. */
  parentSessionId: SessionId;
  /** Host and settings from the parent. */
  host: import('../types/host.js').BackendHost;
  settings: AgentSettings;
  systemPromptBuilder?: (tools: string[], modelName?: string) => string;
}

export class SubagentTool implements AgentTool<SubagentToolInput, string> {
  readonly name = 'subagent';
  readonly kind: ToolKind = 'other';

  private config: SubagentToolConfig;

  constructor(config: SubagentToolConfig) {
    this.config = config;
  }

  description(): string {
    return SUBAGENT_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return SUBAGENT_TOOL_SCHEMA;
  }

  initialTitle(input: SubagentToolInput | null): string {
    if (input?.label) {
      return input.label;
    }
    return 'Subagent';
  }

  async run(input: SubagentToolInput, context: ToolContext): Promise<AgentToolOutput> {
    // Check depth limit
    if (this.config.parentDepth >= MAX_SUBAGENT_DEPTH) {
      throw new Error(
        `Maximum subagent depth (${MAX_SUBAGENT_DEPTH}) reached`,
      );
    }

    // Create the subagent thread
    const childThread = new Thread({
      host: this.config.host,
      settings: this.config.settings,
      model: this.config.model,
      systemPromptBuilder: this.config.systemPromptBuilder,
    });

    // Filter tools based on allowed_tools
    const allowedToolNames = input.allowed_tools
      ? new Set(input.allowed_tools.filter(t => this.config.parentTools.has(t)))
      : null;

    for (const [name, tool] of this.config.parentTools) {
      // Don't add subagent tool to children at max depth
      if (name === 'subagent' && this.config.parentDepth + 1 >= MAX_SUBAGENT_DEPTH) {
        continue;
      }
      if (allowedToolNames && !allowedToolNames.has(name)) {
        continue;
      }
      childThread.addTool(tool);
    }

    // Emit subagent spawned event
    context.eventStream.updateFieldsWithMeta(
      { status: 'in_progress', title: input.label },
      { subagent_session_id: String(childThread.id) },
    );

    context.host.events.emit({
      type: 'subagent_spawned',
      sessionId: childThread.id,
    });

    // Run the initial prompt with optional timeout
    const timeoutMs = input.timeout_ms;
    let timedOut = false;

    const sendPromise = childThread.send([{ type: 'text', text: input.prompt }]);

    if (timeoutMs) {
      const result = await Promise.race([
        sendPromise.then(() => 'done' as const),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
        context.eventStream.cancelledByUser().then(() => 'cancel' as const),
      ]);

      if (result === 'timeout') {
        timedOut = true;
        childThread.cancel();
      } else if (result === 'cancel') {
        childThread.cancel();
        throw new Error('User cancelled');
      }
    } else {
      const result = await Promise.race([
        sendPromise.then(() => 'done' as const),
        context.eventStream.cancelledByUser().then(() => 'cancel' as const),
      ]);

      if (result === 'cancel') {
        childThread.cancel();
        throw new Error('User cancelled');
      }
    }

    // Generate summary
    let summaryPrompt = 'Summarize what you did, the results, and any important findings. Be concise.';
    if (timedOut) {
      summaryPrompt = 'The time to complete the task was exceeded. Stop with the task and follow the directions below: ' + summaryPrompt;
    }

    await childThread.send([{ type: 'text', text: summaryPrompt }]);

    // Get the last agent message as the summary
    const messages = childThread.getMessages();
    let summary = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      if (msg.type === 'agent') {
        for (const content of msg.message.content) {
          if (content.type === 'text') {
            summary += content.text;
          }
        }
        break;
      }
    }

    if (!summary) {
      summary = 'Subagent completed but produced no summary.';
    }

    return {
      llmOutput: textToolResult(summary),
      rawOutput: {
        sessionId: String(childThread.id),
        label: input.label,
        summary,
        timedOut,
      },
    };
  }
}
