/**
 * Web search provider implementations.
 *
 * Provides ready-to-use WebSearchProvider implementations for the web_search tool.
 */

import type { WebSearchProvider, WebSearchResult } from '@anthropic/zed-agent-core';

/**
 * Tavily web search provider.
 * Uses the Tavily API (https://tavily.com/) for web search.
 *
 * Get an API key at https://app.tavily.com/
 */
export class TavilySearchProvider implements WebSearchProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(options: { apiKey: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.tavily.com';
  }

  async search(query: string): Promise<WebSearchResult[]> {
    const response = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: 5,
        include_answer: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily search failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      results: Array<{
        title: string;
        url: string;
        content: string;
      }>;
    };

    return data.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));
  }
}

/**
 * SearxNG web search provider.
 * Uses a SearxNG instance (self-hosted or public) for web search.
 *
 * SearxNG is a free, open-source metasearch engine.
 * See: https://github.com/searxng/searxng
 */
export class SearxNGSearchProvider implements WebSearchProvider {
  private baseUrl: string;

  constructor(options: { baseUrl: string }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async search(query: string): Promise<WebSearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      categories: 'general',
    });

    const response = await fetch(`${this.baseUrl}/search?${params}`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`SearxNG search failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      results: Array<{
        title: string;
        url: string;
        content: string;
      }>;
    };

    return data.results.slice(0, 10).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));
  }
}

/**
 * Simple web scraping search provider.
 * Uses DuckDuckGo HTML scraping as a fallback when no API key is available.
 *
 * Note: This is a basic implementation and may break if DuckDuckGo changes their HTML.
 * Prefer TavilySearchProvider or SearxNGSearchProvider for production use.
 */
export class BasicSearchProvider implements WebSearchProvider {
  async search(query: string): Promise<WebSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    const response = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; zed-agent/1.0)',
      },
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const results: WebSearchResult[] = [];

    // Very basic HTML extraction
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/g;

    let match;
    const urls: string[] = [];
    const titles: string[] = [];

    while ((match = resultRegex.exec(html)) !== null) {
      urls.push(match[1] ?? '');
      titles.push((match[2] ?? '').replace(/<[^>]*>/g, '').trim());
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push((match[1] ?? '').replace(/<[^>]*>/g, '').trim());
    }

    for (let i = 0; i < Math.min(urls.length, 5); i++) {
      results.push({
        title: titles[i] ?? '',
        url: urls[i] ?? '',
        snippet: snippets[i] ?? '',
      });
    }

    return results;
  }
}
