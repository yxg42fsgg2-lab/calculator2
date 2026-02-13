/**
 * Tests for host validation.
 */

import { describe, it, expect } from 'vitest';
import { validateHost, assertValidHost } from '../src/utils/validation.js';
import { createMockHost } from './mock-host.js';
import type { BackendHost } from '../src/types/host.js';

describe('validateHost', () => {
  it('returns no errors for a valid host', () => {
    const { host } = createMockHost({ files: {} });
    const issues = validateHost(host);
    const errors = issues.filter(i => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('reports missing fileSystem', () => {
    const { host } = createMockHost({ files: {} });
    const broken = { ...host, fileSystem: undefined } as unknown as BackendHost;
    const issues = validateHost(broken);
    expect(issues.some(i => i.field === 'fileSystem' && i.severity === 'error')).toBe(true);
  });

  it('reports missing terminal', () => {
    const { host } = createMockHost({ files: {} });
    const broken = { ...host, terminal: undefined } as unknown as BackendHost;
    const issues = validateHost(broken);
    expect(issues.some(i => i.field === 'terminal' && i.severity === 'error')).toBe(true);
  });

  it('reports missing events', () => {
    const { host } = createMockHost({ files: {} });
    const broken = { ...host, events: undefined } as unknown as BackendHost;
    const issues = validateHost(broken);
    expect(issues.some(i => i.field === 'events' && i.severity === 'error')).toBe(true);
  });

  it('warns about missing diagnostics', () => {
    const { host } = createMockHost({ files: {} });
    const issues = validateHost(host);
    expect(issues.some(i => i.field === 'diagnostics' && i.severity === 'warning')).toBe(true);
  });

  it('warns about missing webSearch', () => {
    const { host } = createMockHost({ files: {} });
    const issues = validateHost(host);
    expect(issues.some(i => i.field === 'webSearch' && i.severity === 'warning')).toBe(true);
  });

  it('reports empty workspace roots as warning', () => {
    const { host } = createMockHost({ files: {}, workspaceRoots: [] });
    const issues = validateHost(host);
    expect(issues.some(i => i.field === 'project.workspaceRoots' && i.severity === 'warning')).toBe(true);
  });
});

describe('assertValidHost', () => {
  it('does not throw for valid host', () => {
    const { host } = createMockHost({ files: {} });
    expect(() => assertValidHost(host)).not.toThrow();
  });

  it('throws for invalid host', () => {
    const broken = {} as BackendHost;
    expect(() => assertValidHost(broken)).toThrow('BackendHost validation failed');
  });

  it('includes all error details in message', () => {
    const broken = { fileSystem: null, events: null } as unknown as BackendHost;
    try {
      assertValidHost(broken);
    } catch (e) {
      expect((e as Error).message).toContain('fileSystem');
      expect((e as Error).message).toContain('events');
      expect((e as Error).message).toContain('ARCHITECTURE.md');
    }
  });
});
