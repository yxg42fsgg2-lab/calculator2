#!/usr/bin/env node

/**
 * @module @anthropic/zed-agent-demo
 *
 * Minimal CLI demo proving zed-agent-core works end-to-end.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx ts-node src/index.ts [workspace-path]
 *
 * Or after building:
 *   ANTHROPIC_API_KEY=sk-... node dist/index.js [workspace-path]
 */

import * as readline from 'node:readline';
import * as path from 'node:path';
import { createNodeHost } from '@anthropic/zed-agent-host-node';
import {
  Thread,
  AnthropicProvider,
  LanguageModelRegistry,
  createDefaultTools,
  eraseToolType,
  buildSystemPrompt,
  systemPromptDataFromHost,
  agentProfileId,
  type AgentEvent,
  type AgentSettings,
  type BackendHost,
  type EventSink,
  type UserMessageContent,
} from '@anthropic/zed-agent-core';

// ANSI colors for terminal output
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function c(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

// ---------------------------------------------------------------------------
// Event handler — renders agent events to the terminal
// ---------------------------------------------------------------------------

class CliEventSink implements EventSink {
  private currentToolName = '';

  emit(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_text':
        process.stdout.write(event.text);
        break;

      case 'agent_thinking':
        process.stdout.write(c('dim', event.text));
        break;

      case 'tool_call':
        this.currentToolName = event.toolName;
        console.log(`\n${c('cyan', '┌')} ${c('bold', `Tool: ${event.toolName}`)} — ${event.title}`);
        break;

      case 'tool_call_update':
        if (event.fields.status === 'completed') {
          console.log(`${c('green', '└')} ${c('green', '✓')} ${this.currentToolName} completed`);
        } else if (event.fields.status === 'failed') {
          console.log(`${c('red', '└')} ${c('red', '✗')} ${this.currentToolName} failed`);
        }
        break;

      case 'tool_call_authorization':
        // Auto-approve in demo mode
        console.log(`${c('yellow', '│')} Auto-approving: ${event.toolName}`);
        event.respond('allow');
        break;

      case 'retry':
        console.log(
          `\n${c('yellow', '⟳')} Retrying (attempt ${event.status.attempt}/${event.status.maxAttempts}): ${event.status.lastError}`,
        );
        break;

      case 'stop':
        if (event.reason !== 'end_turn') {
          console.log(`\n${c('gray', `[Stop: ${event.reason}]`)}`);
        }
        break;

      case 'error':
        console.error(`\n${c('red', '✗ Error:')} ${event.error.message}`);
        break;

      case 'title_updated':
        // Show thread title
        break;

      case 'token_usage_updated':
        if (event.usage) {
          process.stdout.write(
            c('gray', `\n[Tokens: ${event.usage.inputTokens} in, ${event.usage.outputTokens} out]`),
          );
        }
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const workspacePath = process.argv[2] ?? process.cwd();
  const apiKey = process.env['ANTHROPIC_API_KEY'];

  console.log(c('bold', '\n🤖 Zed Agent Demo'));
  console.log(c('gray', `Workspace: ${path.resolve(workspacePath)}`));

  if (!apiKey) {
    console.log(c('yellow', '\nNo ANTHROPIC_API_KEY set. Running in demo mode (no real LLM calls).'));
    console.log(c('gray', 'Set ANTHROPIC_API_KEY environment variable to enable real completions.\n'));
  }

  // Create the event sink
  const eventSink = new CliEventSink();

  // Create the host
  const host = createNodeHost({
    workspaceRoots: [workspacePath],
    eventSink,
    permissionOptions: { autoAllow: true },
  });

  // Set up the model registry
  const registry = new LanguageModelRegistry();
  if (apiKey) {
    const anthropic = new AnthropicProvider({ apiKey });
    registry.registerProvider(anthropic);
  }

  // Get the first available model
  const models = Array.from(registry.availableModels());
  const model = models[0];

  if (model) {
    console.log(c('green', `Model: ${model.name}`));
  }

  // Create settings
  const settings: AgentSettings = {
    defaultProfile: agentProfileId('default'),
    profiles: new Map(),
    toolPermissionMode: 'auto',
  };

  // Create the system prompt builder
  const systemPromptBuilder = (toolNames: string[], modelName?: string) => {
    const data = systemPromptDataFromHost(host, toolNames, modelName);
    return buildSystemPrompt(data);
  };

  // Create a thread
  const thread = new Thread({
    host,
    settings,
    model,
    systemPromptBuilder,
  });

  // Register default tools
  const tools = createDefaultTools();
  for (const tool of tools) {
    thread.addTool(tool);
  }

  console.log(c('gray', `Tools: ${thread.registeredToolNames().join(', ')}`));
  console.log(c('gray', '\nType your message and press Enter. Type "quit" to exit.\n'));

  // REPL loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(c('green', '\n> '), async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'quit' || trimmed === 'exit') {
        console.log(c('gray', '\nGoodbye! 👋\n'));
        rl.close();
        return;
      }

      const content: UserMessageContent[] = [{ type: 'text', text: trimmed }];

      console.log(''); // Blank line before response

      try {
        if (model) {
          const stopReason = await thread.send(content);
          console.log(''); // Blank line after response
        } else {
          console.log(
            c('yellow', 'No model available. Set ANTHROPIC_API_KEY to enable completions.'),
          );
          console.log(
            c('gray', `Would send: "${trimmed}" with ${thread.registeredToolNames().length} tools available.`),
          );
        }
      } catch (err) {
        console.error(c('red', `Error: ${err instanceof Error ? err.message : String(err)}`));
      }

      prompt();
    });
  };

  prompt();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
