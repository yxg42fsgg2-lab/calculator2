/**
 * LanguageModel interface — the core abstraction for any LLM.
 * Ported from: crates/language_model/src/language_model.rs — pub trait LanguageModel
 */

import type {
  LanguageModelId,
  LanguageModelName,
  LanguageModelProviderId,
  LanguageModelProviderName,
} from '../types/branded.js';
import type {
  LanguageModelCompletionEvent,
  LanguageModelEffortLevel,
  LanguageModelRequest,
  LanguageModelToolChoice,
  LanguageModelToolSchemaFormat,
} from '../types/language-model.js';

/**
 * A language model that can generate completions.
 * Ported from: crates/language_model/src/language_model.rs — pub trait LanguageModel
 *
 * This is the primary abstraction for interacting with any LLM provider.
 * Each provider (Anthropic, OpenAI, Google, etc.) implements this interface.
 */
export interface LanguageModel {
  /** Unique model identifier (e.g., "claude-sonnet-4-20250514"). */
  readonly id: LanguageModelId;

  /** Human-readable model name (e.g., "Claude Sonnet 4"). */
  readonly name: LanguageModelName;

  /** Provider identifier (e.g., "anthropic"). */
  readonly providerId: LanguageModelProviderId;

  /** Provider display name (e.g., "Anthropic"). */
  readonly providerName: LanguageModelProviderName;

  /** Upstream provider ID (may differ from providerId for proxy providers like Zed Cloud). */
  readonly upstreamProviderId?: LanguageModelProviderId;

  /** Upstream provider name. */
  readonly upstreamProviderName?: LanguageModelProviderName;

  /** Whether this model is the "latest" in its family (for UI highlighting). */
  readonly isLatest: boolean;

  /** Telemetry identifier string. */
  readonly telemetryId: string;

  // --- Capability flags ---

  /** Whether this model supports extended thinking / chain-of-thought. */
  readonly supportsThinking: boolean;

  /** Available effort levels for thinking (empty if thinking not supported). */
  readonly supportedEffortLevels: LanguageModelEffortLevel[];

  /** The default effort level (if any). */
  readonly defaultEffortLevel?: LanguageModelEffortLevel;

  /** Whether this model supports image inputs. */
  readonly supportsImages: boolean;

  /** Whether this model supports tool/function calling. */
  readonly supportsTools: boolean;

  /** Whether this model supports streaming tool calls. */
  readonly supportsStreamingTools: boolean;

  /** Whether this model reports accurate split input/output token counts. */
  readonly supportsSplitTokenDisplay: boolean;

  /** The format for tool input schemas. */
  readonly toolInputFormat: LanguageModelToolSchemaFormat;

  /** Maximum total token count for the context window. */
  readonly maxTokenCount: number;

  /** Maximum output tokens (if model-specific). */
  readonly maxOutputTokens?: number;

  // --- Methods ---

  /** Check if a specific tool choice mode is supported. */
  supportsToolChoice(choice: LanguageModelToolChoice): boolean;

  /** Get the API key (if applicable). */
  apiKey?(): string | undefined;

  /**
   * Stream a completion from the model.
   * Returns an async iterable of completion events.
   */
  streamCompletion(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelCompletionEvent>;

  /**
   * Count the tokens in a request (optional — not all providers support this).
   */
  countTokens?(request: LanguageModelRequest): Promise<number>;
}
