/**
 * Integration test for createNodeHost() factory.
 */

import { describe, it, expect } from 'vitest';
import { createNodeHost } from '../src/index.js';
import type { AgentEvent } from '@anthropic/zed-agent-core';

describe('createNodeHost', () => {
  it('creates a complete BackendHost', () => {
    const events: AgentEvent[] = [];
    const host = createNodeHost({
      workspaceRoots: ['/tmp'],
      eventSink: { emit: (e) => events.push(e) },
    });

    // All required sub-interfaces should be present
    expect(host.fileSystem).toBeDefined();
    expect(host.terminal).toBeDefined();
    expect(host.project).toBeDefined();
    expect(host.permissions).toBeDefined();
    expect(host.events).toBeDefined();
    expect(host.http).toBeDefined();
  });

  it('has correct project info', () => {
    const host = createNodeHost({
      workspaceRoots: ['/tmp/myproject'],
      eventSink: { emit: () => {} },
    });

    expect(host.project.workspaceRoots).toHaveLength(1);
    expect(host.project.workspaceRoots[0]!.name).toBe('myproject');
    expect(host.project.workspaceRoots[0]!.absolutePath).toContain('myproject');
    expect(['macos', 'linux', 'windows']).toContain(host.project.os);
    expect(host.project.shell).toBeTruthy();
  });

  it('permissions auto-allow by default', () => {
    const host = createNodeHost({
      workspaceRoots: [],
      eventSink: { emit: () => {} },
    });

    const decision = host.permissions.checkAutoPermission('terminal', ['ls']);
    expect(decision.type).toBe('allow');
  });

  it('permissions can be configured to confirm', () => {
    const host = createNodeHost({
      workspaceRoots: [],
      eventSink: { emit: () => {} },
      permissionOptions: { autoAllow: false },
    });

    const decision = host.permissions.checkAutoPermission('terminal', ['rm -rf /']);
    expect(decision.type).toBe('confirm');
  });

  it('emits events through the sink', () => {
    const events: AgentEvent[] = [];
    const host = createNodeHost({
      workspaceRoots: [],
      eventSink: { emit: (e) => events.push(e) },
    });

    host.events.emit({ type: 'agent_text', text: 'hello' });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('agent_text');
  });

  it('resolves project paths', () => {
    const host = createNodeHost({
      workspaceRoots: ['/home/user/project'],
      eventSink: { emit: () => {} },
    });

    const resolved = host.project.resolveProjectPath('project/src/main.ts');
    expect(resolved).toBe('/home/user/project/src/main.ts');
  });
});
