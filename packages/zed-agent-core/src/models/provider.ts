/**
 * LanguageModelProvider interface — represents a source of language models.
 * Ported from: crates/language_model/src/registry.rs — pub trait LanguageModelProvider
 */

import type {
  LanguageModelProviderId,
  LanguageModelProviderName,
} from '../types/branded.js';
import type { LanguageModel } from './language-model.js';

/**
 * Authentication error types.
 * Ported from: crates/language_model/src/language_model.rs — AuthenticateError
 */
export type AuthenticateError =
  | { type: 'credentials_not_found' }
  | { type: 'connection_refused' }
  | { type: 'other'; error: Error };

/**
 * A provider of language models (e.g., Anthropic, OpenAI, Google).
 * Ported from: crates/language_model/src/registry.rs — pub trait LanguageModelProvider
 */
export interface LanguageModelProvider {
  /** Unique provider identifier (e.g., "anthropic"). */
  readonly id: LanguageModelProviderId;

  /** Human-readable provider name (e.g., "Anthropic"). */
  readonly name: LanguageModelProviderName;

  /** Icon identifier for the provider. */
  readonly icon: string;

  /** All models this provider offers. */
  providedModels(): LanguageModel[];

  /** Models recommended for this provider (shown in "Recommended" section). */
  recommendedModels(): LanguageModel[];

  /** Whether the provider is currently authenticated. */
  isAuthenticated(): boolean;

  /**
   * Attempt to authenticate with the provider.
   * For API-key-based providers, this verifies the key is set.
   * For local providers (Ollama, LM Studio), this checks the API is reachable.
   */
  authenticate(): Promise<void>;
}
