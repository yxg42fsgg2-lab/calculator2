/**
 * Tests for the NodeHttpClient.
 */

import { describe, it, expect } from 'vitest';
import { NodeHttpClient } from '../src/http-client.js';

describe('NodeHttpClient', () => {
  const client = new NodeHttpClient();

  it('fetches a URL', async () => {
    // Use a reliable test endpoint
    const response = await client.fetch('https://httpbin.org/get');
    expect(response.status).toBe(200);
    expect(response.body).toBeTruthy();
    expect(response.url).toContain('httpbin.org');
  }, 10000);

  it('handles POST requests', async () => {
    const response = await client.fetch('https://httpbin.org/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });
    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.body);
    expect(parsed.json).toEqual({ test: true });
  }, 10000);

  it('returns headers', async () => {
    const response = await client.fetch('https://httpbin.org/get');
    expect(response.headers['content-type']).toContain('application/json');
  }, 10000);

  it('handles 404', async () => {
    const response = await client.fetch('https://httpbin.org/status/404');
    expect(response.status).toBe(404);
  }, 10000);

  it('follows redirects by default', async () => {
    const response = await client.fetch('https://httpbin.org/redirect/1');
    expect(response.status).toBe(200);
    expect(response.url).toContain('httpbin.org/get');
  }, 10000);
});
