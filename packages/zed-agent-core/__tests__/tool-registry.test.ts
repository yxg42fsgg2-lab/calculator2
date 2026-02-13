/**
 * Tests for the tool registry.
 */

import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tools/tool-registry.js';
import { createDefaultTools, ALL_TOOL_NAMES } from '../src/tools/index.js';

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    const tools = createDefaultTools();
    for (const tool of tools) {
      registry.register(tool);
    }

    expect(registry.size).toBe(18);
    expect(registry.has('read_file')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('throws on duplicate registration', () => {
    const registry = new ToolRegistry();
    const tools = createDefaultTools();
    registry.register(tools[0]!);
    expect(() => registry.register(tools[0]!)).toThrow('Duplicate tool name');
  });

  it('unregisters tools', () => {
    const registry = new ToolRegistry();
    const tools = createDefaultTools();
    registry.register(tools[0]!);
    expect(registry.has(tools[0]!.name)).toBe(true);
    registry.unregister(tools[0]!.name);
    expect(registry.has(tools[0]!.name)).toBe(false);
  });

  it('generates request tools', () => {
    const registry = new ToolRegistry();
    const tools = createDefaultTools();
    for (const tool of tools) {
      registry.register(tool);
    }
    const requestTools = registry.toRequestTools();
    expect(requestTools.length).toBe(18);
    for (const rt of requestTools) {
      expect(rt.name).toBeTruthy();
      expect(rt.description).toBeTruthy();
      expect(rt.inputSchema).toBeTruthy();
    }
  });
});

describe('ALL_TOOL_NAMES', () => {
  it('has 18 tool names', () => {
    expect(ALL_TOOL_NAMES.length).toBe(18);
  });

  it('has unique names', () => {
    const unique = new Set(ALL_TOOL_NAMES);
    expect(unique.size).toBe(ALL_TOOL_NAMES.length);
  });

  it('matches created tools', () => {
    const tools = createDefaultTools();
    const createdNames = tools.map((t) => t.name).sort();
    const allNames = [...ALL_TOOL_NAMES].sort();
    expect(createdNames).toEqual(allNames);
  });
});
