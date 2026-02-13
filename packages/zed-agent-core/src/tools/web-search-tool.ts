/**
 * WebSearchTool — searches the web for information.
 * Ported from: crates/agent/src/tools/web_search_tool.rs (167 LOC)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import type { WebSearchResult } from '../types/host.js';
import { textToolResult } from '../types/language-model.js';

export interface WebSearchToolInput {
  /** The search term or question. */
  query: string;
}

export interface WebSearchToolOutput {
  results: WebSearchResult[];
}

export const WEB_SEARCH_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Search the web for information using your query. ' +
    'Use this when you need real-time information, facts, or data that might not be in your training. ' +
    'Results will include snippets and links from relevant web pages.',
  properties: {
    query: {
      type: 'string',
      description: 'The search term or question to query on the web.',
    },
  },
  required: ['query'],
} as const;

export class WebSearchTool implements AgentTool<WebSearchToolInput, WebSearchToolOutput> {
  readonly name = 'web_search';
  readonly kind: ToolKind = 'fetch';

  description(): string {
    return WEB_SEARCH_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return WEB_SEARCH_TOOL_SCHEMA;
  }

  initialTitle(): string {
    return 'Searching the Web';
  }

  async run(input: WebSearchToolInput, context: ToolContext): Promise<AgentToolOutput> {
    if (!context.host.webSearch) {
      throw new Error('Web search is not available');
    }

    // Check permissions
    const decision = context.host.permissions.checkAutoPermission('web_search', [input.query]);
    if (decision.type === 'deny') {
      throw new Error(decision.reason);
    }
    if (decision.type === 'confirm') {
      await context.eventStream.authorize(
        this.initialTitle(),
        { toolName: 'web_search', inputValues: [input.query] },
      );
    }

    const results = await context.host.webSearch.search(input.query);
    const output: WebSearchToolOutput = { results };

    return {
      llmOutput: textToolResult(JSON.stringify(output)),
      rawOutput: output,
    };
  }
}
