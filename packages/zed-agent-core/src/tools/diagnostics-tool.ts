/**
 * DiagnosticsTool — fetches LSP diagnostics.
 * Ported from: crates/agent/src/tools/diagnostics_tool.rs (169 LOC)
 */

import type { AgentTool, AgentToolOutput, ToolContext, ToolKind } from '../types/tools.js';
import { textToolResult } from '../types/language-model.js';

export interface DiagnosticsToolInput {
  /** Optional paths to get diagnostics for. If empty, returns all diagnostics. */
  paths?: string[];
}

export const DIAGNOSTICS_TOOL_SCHEMA = {
  type: 'object',
  description:
    'Returns the current diagnostics (errors, warnings) for files in the project. ' +
    'Optionally filter by specific file paths.',
  properties: {
    paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional file paths to get diagnostics for.',
    },
  },
} as const;

export class DiagnosticsTool implements AgentTool<DiagnosticsToolInput, string> {
  readonly name = 'diagnostics';
  readonly kind: ToolKind = 'read';

  description(): string {
    return DIAGNOSTICS_TOOL_SCHEMA.description;
  }

  inputSchema(): unknown {
    return DIAGNOSTICS_TOOL_SCHEMA;
  }

  initialTitle(): string {
    return 'Get diagnostics';
  }

  async run(input: DiagnosticsToolInput, context: ToolContext): Promise<AgentToolOutput> {
    if (!context.host.diagnostics) {
      const text = 'No diagnostics provider available.';
      return { llmOutput: textToolResult(text), rawOutput: text };
    }

    const absPaths = input.paths?.map((p) => {
      const resolved = context.host.project.resolveProjectPath(p);
      return resolved ?? p;
    });

    const diagnostics = await context.host.diagnostics.getDiagnostics({
      paths: absPaths,
    });

    if (diagnostics.length === 0) {
      const text = 'No diagnostics found.';
      return { llmOutput: textToolResult(text), rawOutput: text };
    }

    // Group by file
    const byFile = new Map<string, typeof diagnostics>();
    for (const d of diagnostics) {
      const shortPath = context.host.project.getShortPath(d.path);
      const existing = byFile.get(shortPath);
      if (existing) {
        existing.push(d);
      } else {
        byFile.set(shortPath, [d]);
      }
    }

    let text = '';
    for (const [filePath, fileDiags] of byFile) {
      text += `## ${filePath}\n`;
      for (const d of fileDiags) {
        const severity = d.severity.toUpperCase();
        text += `  L${d.line}:${d.column} [${severity}] ${d.message}`;
        if (d.source) {
          text += ` (${d.source})`;
        }
        text += '\n';
      }
      text += '\n';
    }

    return { llmOutput: textToolResult(text), rawOutput: text };
  }
}
