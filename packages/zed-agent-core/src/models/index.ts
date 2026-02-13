/**
 * @module models
 * Language model abstraction and infrastructure.
 */

export type { LanguageModel } from './language-model.js';
export type { LanguageModelProvider, AuthenticateError } from './provider.js';
export { LanguageModelRegistry } from './registry.js';
export type { ConfiguredModel, RegistryEvents } from './registry.js';
export { RateLimiter } from './rate-limiter.js';
export { adaptSchemaToFormat, rootSchemaFor } from './tool-schema.js';

// Provider implementations
export * from './providers/index.js';
