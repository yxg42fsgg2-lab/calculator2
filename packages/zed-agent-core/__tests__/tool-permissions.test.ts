/**
 * Tests for the tool permission engine.
 * Ported from: crates/agent/src/tool_permissions.rs tests
 */

import { describe, it, expect } from 'vitest';
import { decidePermissionFromSettings } from '../src/permissions/tool-permissions.js';
import { agentProfileId } from '../src/types/branded.js';
import type { AgentSettings } from '../src/types/settings.js';

function makeSettings(overrides: Partial<AgentSettings> = {}): AgentSettings {
  return {
    defaultProfile: agentProfileId('default'),
    profiles: new Map(),
    toolPermissionMode: 'custom',
    ...overrides,
  };
}

describe('decidePermissionFromSettings', () => {
  it('allows everything in auto mode', () => {
    const settings = makeSettings({ toolPermissionMode: 'auto' });
    const result = decidePermissionFromSettings('terminal', ['rm -rf /'], settings);
    expect(result.type).toBe('allow');
  });

  it('confirms everything in always_ask mode', () => {
    const settings = makeSettings({ toolPermissionMode: 'always_ask' });
    const result = decidePermissionFromSettings('terminal', ['ls'], settings);
    expect(result.type).toBe('confirm');
  });

  it('denies when tool matches always_deny', () => {
    const settings = makeSettings({
      alwaysDeny: [{ tool: 'terminal' }],
    });
    const result = decidePermissionFromSettings('terminal', ['ls'], settings);
    expect(result.type).toBe('deny');
  });

  it('allows when tool matches always_allow', () => {
    const settings = makeSettings({
      alwaysAllow: [{ tool: 'terminal' }],
    });
    const result = decidePermissionFromSettings('terminal', ['ls'], settings);
    expect(result.type).toBe('allow');
  });

  it('deny takes priority over allow', () => {
    const settings = makeSettings({
      alwaysAllow: [{ tool: 'terminal' }],
      alwaysDeny: [{ tool: 'terminal' }],
    });
    const result = decidePermissionFromSettings('terminal', ['ls'], settings);
    expect(result.type).toBe('deny');
  });

  it('matches patterns for terminal commands', () => {
    const settings = makeSettings({
      alwaysAllow: [{ tool: 'terminal', pattern: '^cargo' }],
    });
    expect(decidePermissionFromSettings('terminal', ['cargo build'], settings).type).toBe('allow');
    expect(decidePermissionFromSettings('terminal', ['npm run'], settings).type).toBe('confirm');
  });

  it('checks all sub-commands for terminal tools', () => {
    const settings = makeSettings({
      alwaysAllow: [{ tool: 'terminal', pattern: '^cargo' }],
    });
    // Compound command where second part doesn't match
    expect(
      decidePermissionFromSettings('terminal', ['cargo build && rm -rf /'], settings).type,
    ).toBe('confirm');
    // Both parts match
    expect(
      decidePermissionFromSettings('terminal', ['cargo build && cargo test'], settings).type,
    ).toBe('allow');
  });

  it('matches patterns for path-based tools', () => {
    const settings = makeSettings({
      alwaysAllow: [{ tool: 'edit_file', pattern: '^src/' }],
    });
    expect(decidePermissionFromSettings('edit_file', ['src/main.rs'], settings).type).toBe('allow');
    expect(decidePermissionFromSettings('edit_file', ['tests/test.rs'], settings).type).toBe('confirm');
  });

  it('confirms when no rules match', () => {
    const settings = makeSettings({
      alwaysAllow: [{ tool: 'fetch' }],
    });
    expect(decidePermissionFromSettings('terminal', ['ls'], settings).type).toBe('confirm');
  });
});
