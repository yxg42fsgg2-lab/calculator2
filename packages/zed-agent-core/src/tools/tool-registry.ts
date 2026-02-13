/**
 * Tool registry — manages available tools and their metadata.
 * Ported from: crates/agent/src/tools.rs — tools! macro and helpers
 */

import type {
  AnyAgentTool,
} from '../types/tools.js';
import type { LanguageModelToolSchemaFormat } from '../types/language-model.js';
import type { LanguageModelRequestTool } from '../types/language-model.js';
import { MAX_TOOL_NAME_LENGTH } from '../types/tools.js';

/**
 * Registry that holds all available tools.
 * Ported from the tools! macro in Zed.
 */
export class ToolRegistry {
  private tools: Map<string, AnyAgentTool> = new Map();

  /**
   * Register a tool. Throws if a tool with the same name already exists.
   */
  register(tool: AnyAgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    if (tool.name.length > MAX_TOOL_NAME_LENGTH) {
      throw new Error(
        `Tool name "${tool.name}" exceeds maximum length of ${MAX_TOOL_NAME_LENGTH}`,
      );
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool by name.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): AnyAgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tool names.
   */
  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get all registered tools.
   */
  all(): IterableIterator<AnyAgentTool> {
    return this.tools.values();
  }

  /**
   * Get the number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Whether a tool supports a given provider.
   * Ported from: tool_supports_provider()
   */
  toolSupportsProvider(name: string, providerId: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    return tool.supportsProvider?.(providerId) ?? true;
  }

  /**
   * Convert all tools to the LanguageModelRequestTool format for completion requests.
   * Ported from: built_in_tools()
   */
  toRequestTools(format?: LanguageModelToolSchemaFormat): LanguageModelRequestTool[] {
    const result: LanguageModelRequestTool[] = [];
    for (const tool of this.tools.values()) {
      const schema = tool.inputSchema(format);
      if (schema) {
        result.push({
          name: tool.name,
          description: tool.description(),
          inputSchema: schema,
        });
      }
    }
    return result;
  }
}
