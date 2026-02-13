/**
 * Tests for parallel tool execution.
 * Verifies that multiple tool calls in one turn run concurrently,
 * matching Zed's FuturesUnordered behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Thread } from '../src/thread/thread.js';
import { eraseToolType, type AgentTool, type AgentToolOutput, type ToolContext, type ToolKind } from '../src/types/tools.js';
import { textToolResult } from '../src/types/language-model.js';
import { agentProfileId, toolUseId } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';
import type { LanguageModel } from '../src/models/language-model.js';
import type { LanguageModelCompletionEvent, LanguageModelRequest, LanguageModelToolSchemaFormat, LanguageModelEffortLevel, LanguageModelToolChoice } from '../src/types/language-model.js';
import { languageModelId, languageModelName, languageModelProviderId, languageModelProviderName } from '../src/types/branded.js';
import { createMockHost } from './mock-host.js';

const settings: AgentSettings = {
  defaultProfile: agentProfileId('default'),
  profiles: new Map(),
  toolPermissionMode: 'auto',
};

/**
 * A slow tool that records when it starts and finishes.
 * Used to verify concurrent execution.
 */
class TimingTool implements AgentTool<{ id: string }, string> {
  readonly name: string;
  readonly kind: ToolKind = 'other';
  private delayMs: number;
  readonly log: Array<{ event: string; time: number }>;

  constructor(name: string, delayMs: number, log: Array<{ event: string; time: number }>) {
    this.name = name;
    this.delayMs = delayMs;
    this.log = log;
  }

  description() { return `Tool ${this.name}`; }
  inputSchema() { return { type: 'object', properties: { id: { type: 'string' } } }; }
  initialTitle() { return this.name; }

  async run(input: { id: string }): Promise<AgentToolOutput> {
    this.log.push({ event: `${this.name}_start`, time: Date.now() });
    await new Promise(r => setTimeout(r, this.delayMs));
    this.log.push({ event: `${this.name}_end`, time: Date.now() });
    return {
      llmOutput: textToolResult(`${this.name} done: ${input.id}`),
      rawOutput: `${this.name} done`,
    };
  }
}

/**
 * Model that calls multiple tools at once.
 */
class MultiToolModel implements LanguageModel {
  readonly id = languageModelId('multi');
  readonly name = languageModelName('Multi');
  readonly providerId = languageModelProviderId('mock');
  readonly providerName = languageModelProviderName('Mock');
  readonly isLatest = true;
  readonly telemetryId = 'multi';
  readonly supportsThinking = false;
  readonly supportedEffortLevels: LanguageModelEffortLevel[] = [];
  readonly supportsImages = false;
  readonly supportsTools = true;
  readonly supportsStreamingTools = true;
  readonly supportsSplitTokenDisplay = false;
  readonly toolInputFormat: LanguageModelToolSchemaFormat = 'json_schema';
  readonly maxTokenCount = 100_000;
  readonly maxOutputTokens = 4096;
  private callCount = 0;
  private toolNames: string[];

  constructor(toolNames: string[]) {
    this.toolNames = toolNames;
  }

  supportsToolChoice() { return true; }

  async *streamCompletion(request: LanguageModelRequest): AsyncIterable<LanguageModelCompletionEvent> {
    this.callCount++;
    yield { type: 'start_message', messageId: `m-${this.callCount}` };

    if (this.callCount === 1) {
      // First call: invoke all tools simultaneously
      for (const name of this.toolNames) {
        yield {
          type: 'tool_use',
          toolUse: {
            id: toolUseId(`tc-${name}-${this.callCount}`),
            name,
            rawInput: `{"id":"${name}"}`,
            input: { id: name },
            isInputComplete: true,
          },
        };
      }
      yield { type: 'stop', reason: 'tool_use' };
    } else {
      // Second call: respond with text
      yield { type: 'text', text: 'All tools completed.' };
      yield { type: 'stop', reason: 'end_turn' };
    }
  }
}

describe('Parallel tool execution', () => {
  let host: ReturnType<typeof createMockHost>['host'];

  beforeEach(() => {
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
  });

  it('runs multiple tools concurrently', async () => {
    const log: Array<{ event: string; time: number }> = [];
    const toolA = new TimingTool('tool_a', 50, log);
    const toolB = new TimingTool('tool_b', 50, log);

    const model = new MultiToolModel(['tool_a', 'tool_b']);
    const thread = new Thread({ host, settings, model });
    thread.addTool(eraseToolType(toolA));
    thread.addTool(eraseToolType(toolB));

    await thread.send([{ type: 'text', text: 'Run both tools' }]);

    // Both tools should have started
    expect(log.filter(e => e.event.endsWith('_start'))).toHaveLength(2);
    expect(log.filter(e => e.event.endsWith('_end'))).toHaveLength(2);

    // Key check: both tools should start before either finishes.
    // With parallel execution, tool_b_start should happen before tool_a_end
    // (or vice versa). With sequential, tool_a would fully finish before
    // tool_b starts.
    const aStart = log.find(e => e.event === 'tool_a_start')!.time;
    const bStart = log.find(e => e.event === 'tool_b_start')!.time;
    const aEnd = log.find(e => e.event === 'tool_a_end')!.time;
    const bEnd = log.find(e => e.event === 'tool_b_end')!.time;

    // Both should start within a very short window (parallel dispatch)
    expect(Math.abs(aStart - bStart)).toBeLessThan(30); // <30ms apart

    // Total time should be ~50ms (parallel), not ~100ms (sequential)
    const totalTime = Math.max(aEnd, bEnd) - Math.min(aStart, bStart);
    expect(totalTime).toBeLessThan(90); // Should be ~50ms, not ~100ms
  });

  it('collects all tool results after parallel execution', async () => {
    const log: Array<{ event: string; time: number }> = [];
    const toolA = new TimingTool('tool_a', 10, log);
    const toolB = new TimingTool('tool_b', 10, log);
    const toolC = new TimingTool('tool_c', 10, log);

    const model = new MultiToolModel(['tool_a', 'tool_b', 'tool_c']);
    const thread = new Thread({ host, settings, model });
    thread.addTool(eraseToolType(toolA));
    thread.addTool(eraseToolType(toolB));
    thread.addTool(eraseToolType(toolC));

    await thread.send([{ type: 'text', text: 'Run three tools' }]);

    // All three should have completed
    expect(log.filter(e => e.event.endsWith('_end'))).toHaveLength(3);

    // The thread should have messages including tool results
    const messages = thread.getMessages();
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });
});
