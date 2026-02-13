/**
 * Node.js HttpClient implementation using native fetch.
 */

import type { HttpClient, HttpOptions, HttpResponse } from '@anthropic/zed-agent-core';

export class NodeHttpClient implements HttpClient {
  async fetch(url: string, options?: HttpOptions): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? 30000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await globalThis.fetch(url, {
        method: options?.method ?? 'GET',
        headers: options?.headers,
        body: options?.body,
        signal: controller.signal,
        redirect: options?.followRedirects !== false ? 'follow' : 'manual',
      });

      const body = await response.text();

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        headers,
        body,
        url: response.url,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
