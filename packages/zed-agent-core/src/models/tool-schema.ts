/**
 * Tool schema utilities.
 * Ported from: crates/language_model/src/tool_schema.rs
 *
 * Handles JSON Schema generation and adaptation for different LLM providers.
 * Some providers (like Anthropic) require simplified schemas without $schema, definitions, etc.
 */

import type { LanguageModelToolSchemaFormat } from '../types/language-model.js';

/**
 * Adapt a JSON Schema for the target provider format.
 * Ported from: adapt_schema_to_format()
 *
 * For 'json_schema' format: return as-is.
 * For 'simplified' format: strip $schema, definitions, and other meta-properties.
 */
export function adaptSchemaToFormat(
  schema: Record<string, unknown>,
  format: LanguageModelToolSchemaFormat,
): Record<string, unknown> {
  if (format === 'json_schema') {
    return schema;
  }

  // Simplified format — strip meta-properties
  const simplified = { ...schema };
  delete simplified['$schema'];
  delete simplified['$id'];
  delete simplified['definitions'];
  delete simplified['$defs'];

  // Recursively simplify nested schemas
  return simplifySchema(simplified);
}

function simplifySchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema' || key === '$id' || key === 'definitions' || key === '$defs') {
      continue;
    }

    if (key === 'properties' && typeof value === 'object' && value !== null) {
      const props: Record<string, unknown> = {};
      for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof propValue === 'object' && propValue !== null) {
          props[propKey] = simplifySchema(propValue as Record<string, unknown>);
        } else {
          props[propKey] = propValue;
        }
      }
      result[key] = props;
    } else if (key === 'items' && typeof value === 'object' && value !== null) {
      result[key] = simplifySchema(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Generate a "root" schema for a tool input type.
 * This wraps the type schema as the root of a JSON Schema document.
 * Ported from: root_schema_for()
 */
export function rootSchemaFor(
  schema: Record<string, unknown>,
  format: LanguageModelToolSchemaFormat = 'json_schema',
): Record<string, unknown> {
  return adaptSchemaToFormat(schema, format);
}
