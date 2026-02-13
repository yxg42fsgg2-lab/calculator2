/**
 * Tests for createMinimalHost.
 */

import { describe, it, expect } from 'vitest';
import { createMinimalHost } from '../src/session/minimal-host.js';
import type { AgentEvent } from '../src/types/events.js';

describe('createMinimalHost', () => {
  it('creates a working host with function callback', () => {
    const events: AgentEvent[] = [];
    const host = createMinimalHost('/tmp/test-project', (event) => {
      events.push(event);
    });

    expect(host.fileSystem).toBeDefined();
    expect(host.terminal).toBeDefined();
    expect(host.project).toBeDefined();
    expect(host.permissions).toBeDefined();
    expect(host.events).toBeDefined();
    expect(host.http).toBeDefined();
  });

  it('creates a working host with EventSink object', () => {
    const events: AgentEvent[] = [];
    const host = createMinimalHost('/tmp/test-project', {
      emit: (event) => events.push(event),
    });

    host.events.emit({ type: 'agent_text', text: 'hello' });
    expect(events).toHaveLength(1);
  });

  it('sets correct project info', () => {
    const host = createMinimalHost('/home/user/myproject', () => {});

    expect(host.project.workspaceRoots).toHaveLength(1);
    expect(host.project.workspaceRoots[0]!.name).toBe('myproject');
    expect(host.project.workspaceRoots[0]!.absolutePath).toBe('/home/user/myproject');
    expect(host.project.os).toBeTruthy();
    expect(host.project.shell).toBeTruthy();
  });

  it('resolves project paths', () => {
    const host = createMinimalHost('/home/user/proj', () => {});

    expect(host.project.resolveProjectPath('proj/src/main.ts'))
      .toBe('/home/user/proj/src/main.ts');
    expect(host.project.resolveProjectPath('src/main.ts'))
      .toBe('/home/user/proj/src/main.ts');
  });

  it('auto-allows all permissions', () => {
    const host = createMinimalHost('/tmp', () => {});
    expect(host.permissions.checkAutoPermission('terminal', ['rm -rf /'])).toEqual({ type: 'allow' });
  });

  it('reads real files', async () => {
    const host = createMinimalHost('/tmp', () => {});
    // /tmp should exist on all Unix systems
    const isDir = await host.fileSystem.isDirectory('/tmp');
    expect(isDir).toBe(true);
  });
});
