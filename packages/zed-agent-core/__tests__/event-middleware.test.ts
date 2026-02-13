/**
 * Tests for event middleware.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAgentSession } from '../src/session/agent-session.js';
import type { AgentEvent } from '../src/types/events.js';
import { MockLanguageModel } from './mock-model.js';
import { createMockHost } from './mock-host.js';

describe('Event middleware', () => {
  let model: MockLanguageModel;
  let host: ReturnType<typeof createMockHost>['host'];
  let events: ReturnType<typeof createMockHost>['events'];

  beforeEach(() => {
    model = new MockLanguageModel();
    const mocked = createMockHost({ files: {} });
    host = mocked.host;
    events = mocked.events;
  });

  it('passes events through without middleware', async () => {
    model.addTextResponse('Hello');
    model.addTextResponse('T');

    const session = createAgentSession(host, { model });
    await session.send('Hi');

    const textEvents = events.getByType('agent_text');
    expect(textEvents.length).toBeGreaterThan(0);
    session.close();
  });

  it('logging middleware sees all events', async () => {
    model.addTextResponse('Hello');
    model.addTextResponse('T');

    const logged: string[] = [];
    const session = createAgentSession(host, {
      model,
      middleware: [
        (event) => { logged.push(event.type); return event; },
      ],
    });
    await session.send('Hi');

    expect(logged).toContain('user_message');
    expect(logged).toContain('agent_text');
    expect(logged).toContain('stop');
    session.close();
  });

  it('filtering middleware suppresses events', async () => {
    model.addTextResponse('Hello');
    model.addTextResponse('T');

    const session = createAgentSession(host, {
      model,
      middleware: [
        // Filter out token usage events
        (event) => event.type === 'token_usage_updated' ? null : event,
      ],
    });
    await session.send('Hi');

    const usageEvents = events.getByType('token_usage_updated');
    expect(usageEvents.length).toBe(0); // Filtered out
    session.close();
  });

  it('transforming middleware modifies events', async () => {
    model.addTextResponse('Hello');
    model.addTextResponse('T');

    const session = createAgentSession(host, {
      model,
      middleware: [
        (event) => {
          if (event.type === 'agent_text') {
            return { ...event, text: event.text.toUpperCase() };
          }
          return event;
        },
      ],
    });
    await session.send('Hi');

    const textEvents = events.getByType('agent_text');
    expect(textEvents.length).toBeGreaterThan(0);
    expect(textEvents.every(e => e.text === e.text.toUpperCase())).toBe(true);
    session.close();
  });

  it('multiple middleware chain in order', async () => {
    model.addTextResponse('Hello');
    model.addTextResponse('T');

    const order: string[] = [];
    const session = createAgentSession(host, {
      model,
      middleware: [
        (event) => { order.push('first'); return event; },
        (event) => { order.push('second'); return event; },
        (event) => { order.push('third'); return event; },
      ],
    });
    await session.send('Hi');

    // Each event passes through all 3 middleware in order
    const firstIdx = order.indexOf('first');
    const secondIdx = order.indexOf('second');
    const thirdIdx = order.indexOf('third');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
    session.close();
  });

  it('middleware that returns null stops the chain', async () => {
    model.addTextResponse('Hello');
    model.addTextResponse('T');

    let secondCalled = false;
    const session = createAgentSession(host, {
      model,
      middleware: [
        (event) => event.type === 'agent_text' ? null : event, // block text
        (event) => { if (event.type === 'agent_text') secondCalled = true; return event; },
      ],
    });
    await session.send('Hi');

    expect(secondCalled).toBe(false); // Second middleware never saw agent_text
    session.close();
  });
});
