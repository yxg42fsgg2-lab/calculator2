#!/usr/bin/env node

/**
 * @module @anthropic/zed-agent-demo
 *
 * CLI demo for the zed-agent-core library.
 *
 * With API key:
 *   ANTHROPIC_API_KEY=sk-... node dist/index.js [workspace-path]
 *
 * Without API key (mock mode):
 *   node dist/index.js [workspace-path]
 *   → Demonstrates tool execution with scripted responses
 */

import * as readline from 'node:readline';
import * as path from 'node:path';
import { createNodeHost } from '@anthropic/zed-agent-host-node';
import {
  createAgentSession,
  AnthropicProvider,
  OpenAIProvider,
  LanguageModelRegistry,
  agentProfileId,
  type AgentEvent,
  type AgentSettings,
  type EventSink,
  type LanguageModel,
  type LanguageModelCompletionEvent,
  type LanguageModelRequest,
  type LanguageModelId,
  type LanguageModelName,
  type LanguageModelProviderId,
  type LanguageModelProviderName,
  type LanguageModelToolChoice,
  type LanguageModelToolSchemaFormat,
  type LanguageModelEffortLevel,
  languageModelId,
  languageModelName,
  languageModelProviderId,
  languageModelProviderName,
  toolUseId,
} from '@anthropic/zed-agent-core';

// ANSI colors
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
};
const c = (color: keyof typeof C, t: string) => `${C[color]}${t}${C.reset}`;

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

class CliEventSink implements EventSink {
  private currentTool = '';
  emit(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_text':
        process.stdout.write(event.text);
        break;
      case 'agent_thinking':
        process.stdout.write(c('dim', event.text));
        break;
      case 'tool_call':
        this.currentTool = event.toolName;
        console.log(`\n${c('cyan', '┌')} ${c('bold', `Tool: ${event.toolName}`)} — ${event.title}`);
        break;
      case 'tool_call_update':
        if (event.fields.status === 'completed') {
          console.log(`${c('green', '└ ✓')} ${this.currentTool} completed`);
        } else if (event.fields.status === 'failed') {
          console.log(`${c('red', '└ ✗')} ${this.currentTool} failed`);
        }
        break;
      case 'tool_call_authorization':
        console.log(`${c('yellow', '│')} Auto-approving: ${event.toolName}`);
        event.respond('allow');
        break;
      case 'retry':
        console.log(`\n${c('yellow', '⟳')} Retrying (${event.status.attempt}/${event.status.maxAttempts}): ${event.status.lastError}`);
        break;
      case 'stop':
        if (event.reason !== 'end_turn') {
          console.log(`\n${c('gray', `[Stop: ${event.reason}]`)}`);
        }
        break;
      case 'error':
        console.error(`\n${c('red', '✗ Error:')} ${event.error.message}`);
        break;
      case 'token_usage_updated':
        if (event.usage) {
          process.stdout.write(c('gray', `\n[Tokens: ${event.usage.inputTokens} in, ${event.usage.outputTokens} out]`));
        }
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Mock model for demo mode
// ---------------------------------------------------------------------------

class DemoMockModel implements LanguageModel {
  readonly id = languageModelId('demo-mock');
  readonly name = languageModelName('Demo Mock');
  readonly providerId = languageModelProviderId('demo');
  readonly providerName = languageModelProviderName('Demo');
  readonly isLatest = true;
  readonly telemetryId = 'demo-mock';
  readonly supportsThinking = false;
  readonly supportedEffortLevels: LanguageModelEffortLevel[] = [];
  readonly supportsImages = false;
  readonly supportsTools = true;
  readonly supportsStreamingTools = true;
  readonly supportsSplitTokenDisplay = false;
  readonly toolInputFormat: LanguageModelToolSchemaFormat = 'json_schema';
  readonly maxTokenCount = 100_000;
  readonly maxOutputTokens = 4096;

  private turnCount = 0;

  supportsToolChoice(): boolean { return true; }

  async *streamCompletion(request: LanguageModelRequest): AsyncIterable<LanguageModelCompletionEvent> {
    this.turnCount++;
    yield { type: 'start_message', messageId: `demo-${this.turnCount}` };

    // Check if this is a title generation request
    const lastMsg = request.messages[request.messages.length - 1];
    const lastText = lastMsg?.content.find(c => c.type === 'text');
    if (lastText && 'text' in lastText && (lastText.text as string).includes('concise title')) {
      yield { type: 'text', text: 'Demo Conversation' };
      yield { type: 'stop', reason: 'end_turn' };
      return;
    }

    // Check if this is a tool result turn
    const hasToolResult = request.messages.some(m =>
      m.content.some(c => c.type === 'tool_result')
    );

    if (hasToolResult) {
      yield { type: 'text', text: 'I\'ve executed the tool. Here are the results above. ' };
      yield { type: 'text', text: 'Is there anything else you\'d like me to do?' };
      yield { type: 'stop', reason: 'end_turn' };
      return;
    }

    // Check what tools are available and demonstrate one
    const hasTools = request.tools.length > 0;
    const userText = (lastText && 'text' in lastText) ? lastText.text as string : '';

    if (hasTools && userText.toLowerCase().includes('list')) {
      yield { type: 'text', text: 'Let me list the directory for you.\n\n' };
      yield {
        type: 'tool_use',
        toolUse: {
          id: toolUseId(`demo-tc-${this.turnCount}`),
          name: 'list_directory',
          rawInput: '{"path": "."}',
          input: { path: '.' },
          isInputComplete: true,
        },
      };
      yield { type: 'stop', reason: 'tool_use' };
    } else if (hasTools && userText.toLowerCase().includes('time')) {
      yield { type: 'text', text: 'Let me check the current time.\n\n' };
      yield {
        type: 'tool_use',
        toolUse: {
          id: toolUseId(`demo-tc-${this.turnCount}`),
          name: 'now',
          rawInput: '{"timezone": "local"}',
          input: { timezone: 'local' },
          isInputComplete: true,
        },
      };
      yield { type: 'stop', reason: 'tool_use' };
    } else if (hasTools && (userText.toLowerCase().includes('read') || userText.toLowerCase().includes('show'))) {
      yield { type: 'text', text: 'Let me read that file for you.\n\n' };
      yield {
        type: 'tool_use',
        toolUse: {
          id: toolUseId(`demo-tc-${this.turnCount}`),
          name: 'read_file',
          rawInput: '{"path": "README.md"}',
          input: { path: 'README.md' },
          isInputComplete: true,
        },
      };
      yield { type: 'stop', reason: 'tool_use' };
    } else {
      yield { type: 'text', text: `Hello! I'm the Zed Agent running in demo mode. ` };
      yield { type: 'text', text: `I have ${request.tools.length} tools available: ` };
      yield { type: 'text', text: request.tools.map(t => `\`${t.name}\``).join(', ') };
      yield { type: 'text', text: `.\n\nTry asking me to:\n` };
      yield { type: 'text', text: `- "list the current directory"\n` };
      yield { type: 'text', text: `- "what time is it?"\n` };
      yield { type: 'text', text: `- "read the README"\n` };
      yield { type: 'stop', reason: 'end_turn' };
    }

    yield { type: 'usage_update', usage: { inputTokens: 150, outputTokens: 75, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const workspacePath = process.argv[2] ?? process.cwd();
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? process.env['OPENAI_API_KEY'];
  const provider = process.env['OPENAI_API_KEY'] ? 'openai' : 'anthropic';

  console.log(c('bold', '\n🤖 Zed Agent Demo'));
  console.log(c('gray', `Workspace: ${path.resolve(workspacePath)}`));

  const eventSink = new CliEventSink();
  const host = createNodeHost({
    workspaceRoots: [workspacePath],
    eventSink,
    permissionOptions: { autoAllow: true },
  });

  // Set up model
  let model: LanguageModel | undefined;
  const registry = new LanguageModelRegistry();

  if (apiKey) {
    if (provider === 'openai') {
      const p = new OpenAIProvider({ apiKey });
      registry.registerProvider(p);
    } else {
      const p = new AnthropicProvider({ apiKey });
      registry.registerProvider(p);
    }
    const models = Array.from(registry.availableModels());
    model = models[0];
    console.log(c('green', `Model: ${model?.name ?? 'none'}`));
  } else {
    model = new DemoMockModel();
    console.log(c('magenta', 'Mode: Demo (mock model — no API key needed)'));
    console.log(c('gray', 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY for real completions.'));
  }

  const session = createAgentSession(host, { model });

  const thread = session.createThread();
  console.log(c('gray', `Tools: ${thread.registeredToolNames().join(', ')}`));
  console.log(c('gray', '\nType your message and press Enter. Type "quit" to exit.\n'));

  // REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let closed = false;
  rl.on('close', () => { closed = true; });

  const prompt = () => {
    if (closed) {
      session.close();
      return;
    }
    rl.question(c('green', '\n> '), async (input) => {
      if (closed) { session.close(); return; }
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'quit' || trimmed === 'exit') {
        session.close();
        console.log(c('gray', '\nGoodbye! 👋\n'));
        rl.close();
        return;
      }

      console.log('');
      try {
        await thread.send([{ type: 'text', text: trimmed }]);
        console.log('');
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
