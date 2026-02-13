/**
 * Tests for the ContextServerRegistry (MCP integration).
 * Ported from: crates/agent/src/tools/context_server_registry.rs tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextServerRegistry, type McpToolDefinition, type McpPromptDefinition } from '../src/tools/context-server-registry.js';

describe('ContextServerRegistry', () => {
  let registry: ContextServerRegistry;
  const mockExecutor = async (_serverId: { id: string }, _tool: string, input: unknown) => {
    return { result: 'executed', input };
  };

  beforeEach(() => {
    registry = new ContextServerRegistry(mockExecutor);
  });

  // --- Tool registration ---

  it('starts empty', () => {
    expect(registry.toolCount).toBe(0);
    expect(registry.promptCount).toBe(0);
  });

  it('registers server tools', () => {
    const tools: McpToolDefinition[] = [
      { name: 'read_db', description: 'Read from database', inputSchema: { type: 'object' } },
      { name: 'write_db', description: 'Write to database', inputSchema: { type: 'object' } },
    ];

    registry.registerServerTools({ id: 'db-server' }, tools);
    expect(registry.toolCount).toBe(2);
  });

  it('registers tools from multiple servers', () => {
    registry.registerServerTools({ id: 'server-a' }, [
      { name: 'tool_a', description: 'A', inputSchema: {} },
    ]);
    registry.registerServerTools({ id: 'server-b' }, [
      { name: 'tool_b', description: 'B', inputSchema: {} },
    ]);

    expect(registry.toolCount).toBe(2);
  });

  it('iterates over servers', () => {
    registry.registerServerTools({ id: 'srv-1' }, [
      { name: 't1', description: '', inputSchema: {} },
    ]);
    registry.registerServerTools({ id: 'srv-2' }, [
      { name: 't2', description: '', inputSchema: {} },
    ]);

    const serverIds: string[] = [];
    for (const [serverId] of registry.servers()) {
      serverIds.push(serverId.id);
    }
    expect(serverIds).toContain('srv-1');
    expect(serverIds).toContain('srv-2');
  });

  // --- Tool execution ---

  it('wraps MCP tools as AnyAgentTool', () => {
    registry.registerServerTools({ id: 'test-server' }, [
      { name: 'my_tool', description: 'Does things', inputSchema: { type: 'object' } },
    ]);

    for (const [, tools] of registry.servers()) {
      const tool = tools.get('my_tool');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('my_tool');
      expect(tool!.description()).toBe('Does things');
      expect(tool!.kind).toBe('other');
    }
  });

  // --- Prompt registration ---

  it('registers server prompts', () => {
    const prompts: McpPromptDefinition[] = [
      { name: 'explain', description: 'Explain code' },
      { name: 'refactor', description: 'Refactor code', arguments: [{ name: 'target' }] },
    ];

    registry.registerServerPrompts({ id: 'code-server' }, prompts);
    expect(registry.promptCount).toBe(2);
  });

  it('finds a prompt by name', () => {
    registry.registerServerPrompts({ id: 'srv' }, [
      { name: 'my_prompt', description: 'A prompt' },
    ]);

    const found = registry.findPrompt(undefined, 'my_prompt');
    expect(found).toBeDefined();
    expect(found!.prompt.name).toBe('my_prompt');
    expect(found!.serverId.id).toBe('srv');
  });

  it('finds a prompt scoped to a server', () => {
    registry.registerServerPrompts({ id: 'srv-1' }, [
      { name: 'common', description: 'From srv-1' },
    ]);
    registry.registerServerPrompts({ id: 'srv-2' }, [
      { name: 'common', description: 'From srv-2' },
    ]);

    const found = registry.findPrompt({ id: 'srv-2' }, 'common');
    expect(found).toBeDefined();
    expect(found!.prompt.description).toBe('From srv-2');
  });

  it('returns undefined for nonexistent prompt', () => {
    expect(registry.findPrompt(undefined, 'nonexistent')).toBeUndefined();
  });

  it('iterates all prompts', () => {
    registry.registerServerPrompts({ id: 'a' }, [{ name: 'p1' }]);
    registry.registerServerPrompts({ id: 'b' }, [{ name: 'p2' }, { name: 'p3' }]);

    const names: string[] = [];
    for (const { prompt } of registry.prompts()) {
      names.push(prompt.name);
    }
    expect(names).toEqual(expect.arrayContaining(['p1', 'p2', 'p3']));
  });

  // --- Unregistration ---

  it('unregisters a server', () => {
    registry.registerServerTools({ id: 'srv' }, [
      { name: 't1', description: '', inputSchema: {} },
    ]);
    registry.registerServerPrompts({ id: 'srv' }, [
      { name: 'p1' },
    ]);

    expect(registry.toolCount).toBe(1);
    expect(registry.promptCount).toBe(1);

    registry.unregisterServer({ id: 'srv' });

    expect(registry.toolCount).toBe(0);
    expect(registry.promptCount).toBe(0);
  });

  // --- Events ---

  it('emits tools_changed on register', () => {
    let emitted = false;
    registry.on('tools_changed', () => { emitted = true; });

    registry.registerServerTools({ id: 's' }, [
      { name: 't', description: '', inputSchema: {} },
    ]);

    expect(emitted).toBe(true);
  });

  it('emits prompts_changed on register', () => {
    let emitted = false;
    registry.on('prompts_changed', () => { emitted = true; });

    registry.registerServerPrompts({ id: 's' }, [{ name: 'p' }]);

    expect(emitted).toBe(true);
  });

  it('emits events on unregister', () => {
    registry.registerServerTools({ id: 's' }, [{ name: 't', description: '', inputSchema: {} }]);

    let toolsChanged = false;
    let promptsChanged = false;
    registry.on('tools_changed', () => { toolsChanged = true; });
    registry.on('prompts_changed', () => { promptsChanged = true; });

    registry.unregisterServer({ id: 's' });

    expect(toolsChanged).toBe(true);
    expect(promptsChanged).toBe(true);
  });

  // --- Re-registration ---

  it('replaces tools on re-registration', () => {
    registry.registerServerTools({ id: 'srv' }, [
      { name: 'old_tool', description: 'Old', inputSchema: {} },
    ]);
    expect(registry.toolCount).toBe(1);

    registry.registerServerTools({ id: 'srv' }, [
      { name: 'new_tool_1', description: 'New 1', inputSchema: {} },
      { name: 'new_tool_2', description: 'New 2', inputSchema: {} },
    ]);
    expect(registry.toolCount).toBe(2);
  });
});
