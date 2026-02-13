/**
 * ContextServerRegistry — manages MCP (Model Context Protocol) server tools.
 * Ported from: crates/agent/src/tools/context_server_registry.rs (~456 LOC production)
 *
 * This registry allows external MCP servers to register tools and prompts
 * that become available to the agent. It handles:
 * - Tool registration from MCP servers
 * - Prompt discovery from MCP servers  
 * - Dynamic tool/prompt lifecycle as servers connect/disconnect
 */

import type { AnyAgentTool, ToolKind, AgentToolOutput, ToolContext } from '../types/tools.js';
import type { LanguageModelToolSchemaFormat } from '../types/language-model.js';
import { textToolResult } from '../types/language-model.js';
import { EventEmitter } from 'eventemitter3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextServerId {
  readonly id: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface McpPromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpServerInfo {
  id: ContextServerId;
  tools: Map<string, McpToolDefinition>;
  prompts: Map<string, McpPromptDefinition>;
}

export interface ContextServerRegistryEvents {
  tools_changed: [];
  prompts_changed: [];
}

// ---------------------------------------------------------------------------
// McpTool — wraps an MCP tool definition as an AnyAgentTool
// ---------------------------------------------------------------------------

class McpTool implements AnyAgentTool {
  readonly name: string;
  readonly kind: ToolKind = 'other';
  private def: McpToolDefinition;
  private serverId: ContextServerId;
  private executor: McpToolExecutor;

  constructor(serverId: ContextServerId, def: McpToolDefinition, executor: McpToolExecutor) {
    this.name = def.name;
    this.def = def;
    this.serverId = serverId;
    this.executor = executor;
  }

  description(): string {
    return this.def.description;
  }

  inputSchema(_format?: LanguageModelToolSchemaFormat): unknown {
    return this.def.inputSchema;
  }

  initialTitle(rawInput: unknown): string {
    return this.def.name;
  }

  async run(rawInput: unknown, context: ToolContext): Promise<AgentToolOutput> {
    const result = await this.executor(this.serverId, this.def.name, rawInput);
    return {
      llmOutput: textToolResult(typeof result === 'string' ? result : JSON.stringify(result)),
      rawOutput: result,
    };
  }
}

/**
 * Callback for executing MCP tool calls.
 * The host must provide this to connect to actual MCP servers.
 */
export type McpToolExecutor = (
  serverId: ContextServerId,
  toolName: string,
  input: unknown,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// ContextServerRegistry
// ---------------------------------------------------------------------------

/**
 * Registry for MCP (Model Context Protocol) server tools and prompts.
 * Ported from: ContextServerRegistry in context_server_registry.rs
 */
export class ContextServerRegistry extends EventEmitter<ContextServerRegistryEvents> {
  private serverTools: Map<string, Map<string, AnyAgentTool>> = new Map();
  private serverPrompts: Map<string, Map<string, McpPromptDefinition>> = new Map();
  private executor: McpToolExecutor;

  constructor(executor: McpToolExecutor) {
    super();
    this.executor = executor;
  }

  /**
   * Register tools from an MCP server.
   */
  registerServerTools(serverId: ContextServerId, tools: McpToolDefinition[]): void {
    const toolMap = new Map<string, AnyAgentTool>();
    for (const def of tools) {
      toolMap.set(def.name, new McpTool(serverId, def, this.executor));
    }
    this.serverTools.set(serverId.id, toolMap);
    this.emit('tools_changed');
  }

  /**
   * Register prompts from an MCP server.
   */
  registerServerPrompts(serverId: ContextServerId, prompts: McpPromptDefinition[]): void {
    const promptMap = new Map<string, McpPromptDefinition>();
    for (const def of prompts) {
      promptMap.set(def.name, def);
    }
    this.serverPrompts.set(serverId.id, promptMap);
    this.emit('prompts_changed');
  }

  /**
   * Unregister a server (when it disconnects).
   */
  unregisterServer(serverId: ContextServerId): void {
    this.serverTools.delete(serverId.id);
    this.serverPrompts.delete(serverId.id);
    this.emit('tools_changed');
    this.emit('prompts_changed');
  }

  /**
   * Get all tools from all servers.
   * Returns [serverId, toolMap] pairs.
   */
  *servers(): Iterable<[ContextServerId, Map<string, AnyAgentTool>]> {
    for (const [id, tools] of this.serverTools) {
      yield [{ id }, tools];
    }
  }

  /**
   * Get all prompts from all servers.
   */
  *prompts(): Iterable<{ serverId: ContextServerId; prompt: McpPromptDefinition }> {
    for (const [id, promptMap] of this.serverPrompts) {
      for (const prompt of promptMap.values()) {
        yield { serverId: { id }, prompt };
      }
    }
  }

  /**
   * Find a prompt by name, optionally scoped to a specific server.
   */
  findPrompt(
    serverId: ContextServerId | undefined,
    promptName: string,
  ): { serverId: ContextServerId; prompt: McpPromptDefinition } | undefined {
    if (serverId) {
      const serverPrompts = this.serverPrompts.get(serverId.id);
      const prompt = serverPrompts?.get(promptName);
      if (prompt) return { serverId, prompt };
      return undefined;
    }

    // Search all servers
    for (const [id, promptMap] of this.serverPrompts) {
      const prompt = promptMap.get(promptName);
      if (prompt) return { serverId: { id }, prompt };
    }
    return undefined;
  }

  /**
   * Get the total number of registered tools across all servers.
   */
  get toolCount(): number {
    let count = 0;
    for (const tools of this.serverTools.values()) {
      count += tools.size;
    }
    return count;
  }

  /**
   * Get the total number of registered prompts across all servers.
   */
  get promptCount(): number {
    let count = 0;
    for (const prompts of this.serverPrompts.values()) {
      count += prompts.size;
    }
    return count;
  }
}
