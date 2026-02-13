/**
 * FetchTool — fetches a URL and returns content as Markdown.
 * Ported from: crates/agent/src/tools/fetch_tool.rs (193 LOC)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface FetchToolInput {
  /** The URL to fetch. */
  url: string;
}

export const FETCH_TOOL_SCHEMA = {
  type: 'object',
  description: 'Fetches a URL and returns the content as Markdown.',
  properties: {
    url: {
      type: 'string',
      description: 'The URL to fetch.',
    },
  },
  required: ['url'],
} as const;

export class FetchTool implements AgentTool<FetchToolInput, string> {
  readonly name = 'fetch';
  readonly kind: ToolKind = 'fetch';

  description(): string {
    return FETCH_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return FETCH_TOOL_SCHEMA;
  }

  initialTitle(input: FetchToolInput | null): string {
    if (input?.url) {
      return `Fetch \`${input.url}\``;
    }
    return 'Fetch URL';
  }

  async run(input: FetchToolInput, context: ToolContext): Promise<AgentToolOutput> {
    let url = input.url;
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      url = `https://${url}`;
    }

    // Check permissions
    const decision = context.host.permissions.checkAutoPermission('fetch', [url]);
    if (decision.type === 'deny') {
      throw new Error(decision.reason);
    }
    if (decision.type === 'confirm') {
      await context.eventStream.authorize(
        this.initialTitle(input),
        { toolName: 'fetch', inputValues: [url] },
      );
    }

    const response = await context.host.http.fetch(url, {
      followRedirects: true,
      timeoutMs: 30000,
    });

    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    // Determine content type and process
    const contentType = detectContentType(response.headers, response.body);
    let content: string;

    switch (contentType) {
      case 'html':
        content = htmlToSimpleMarkdown(response.body);
        break;
      case 'json':
        content = formatJsonContent(response.body);
        break;
      default:
        content = response.body;
    }

    // Truncate if too long
    const maxLength = 100_000;
    if (content.length > maxLength) {
      content = content.slice(0, maxLength) + '\n\n[Content truncated]';
    }

    return {
      llmOutput: textToolResult(content),
      rawOutput: content,
    };
  }
}

type ContentType = 'html' | 'json' | 'plaintext';

function detectContentType(headers: Record<string, string>, body: string): ContentType {
  const ct = (headers['content-type'] ?? '').toLowerCase();
  if (ct.includes('html')) return 'html';
  if (ct.includes('json')) return 'json';

  // Heuristic: check if body looks like HTML
  const trimmed = body.trimStart().toLowerCase();
  if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
    return 'html';
  }

  // Check if body looks like JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(body);
      return 'json';
    } catch {
      // Not JSON
    }
  }

  return 'plaintext';
}

/**
 * Very basic HTML to Markdown conversion.
 * A full port would use the html_to_markdown crate's logic,
 * but for now we strip tags and do basic formatting.
 */
function htmlToSimpleMarkdown(html: string): string {
  let result = html;

  // Remove script and style tags
  result = result.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  result = result.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');

  // Convert headings
  result = result.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  result = result.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  result = result.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  result = result.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  result = result.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  result = result.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');

  // Convert links
  result = result.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Convert emphasis
  result = result.replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gi, '**$2**');
  result = result.replace(/<(em|i)[^>]*>(.*?)<\/\1>/gi, '*$2*');

  // Convert code
  result = result.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  result = result.replace(/<pre[^>]*>(.*?)<\/pre>/gis, '```\n$1\n```\n\n');

  // Convert lists
  result = result.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  result = result.replace(/<\/?[uo]l[^>]*>/gi, '\n');

  // Convert paragraphs and line breaks
  result = result.replace(/<p[^>]*>(.*?)<\/p>/gis, '$1\n\n');
  result = result.replace(/<br\s*\/?>/gi, '\n');
  result = result.replace(/<hr\s*\/?>/gi, '\n---\n\n');

  // Remove remaining tags
  result = result.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  result = result.replace(/&amp;/g, '&');
  result = result.replace(/&lt;/g, '<');
  result = result.replace(/&gt;/g, '>');
  result = result.replace(/&quot;/g, '"');
  result = result.replace(/&#39;/g, "'");
  result = result.replace(/&nbsp;/g, ' ');

  // Clean up whitespace
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trim();

  return result;
}

function formatJsonContent(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
  } catch {
    return body;
  }
}
