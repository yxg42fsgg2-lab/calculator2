/**
 * LanguageModelRegistry — manages providers and models.
 * Ported from: crates/language_model/src/registry.rs
 */

import type {
  LanguageModelId,
  LanguageModelProviderId,
} from '../types/branded.js';
import type { LanguageModelSelection } from '../types/settings.js';
import type { LanguageModel } from './language-model.js';
import type { LanguageModelProvider } from './provider.js';
import { EventEmitter } from 'eventemitter3';

/**
 * A configured model selection, resolved from settings.
 * Ported from: SelectedModel / ConfiguredModel
 */
export interface ConfiguredModel {
  model: LanguageModel;
}

/**
 * Events emitted by the registry when models change.
 */
export interface RegistryEvents {
  /** Emitted when providers or models are updated. */
  models_updated: [];
}

/**
 * Registry that manages language model providers and their models.
 * Ported from: crates/language_model/src/registry.rs — LanguageModelRegistry
 */
export class LanguageModelRegistry extends EventEmitter<RegistryEvents> {
  private providers: Map<LanguageModelProviderId, LanguageModelProvider> = new Map();
  private _defaultModel?: LanguageModelSelection;
  private _threadSummaryModel?: LanguageModelSelection;

  /**
   * Register a provider.
   */
  registerProvider(provider: LanguageModelProvider): void {
    this.providers.set(provider.id, provider);
    this.emit('models_updated');
  }

  /**
   * Unregister a provider.
   */
  unregisterProvider(id: LanguageModelProviderId): void {
    this.providers.delete(id);
    this.emit('models_updated');
  }

  /**
   * Get a provider by ID.
   */
  provider(id: LanguageModelProviderId): LanguageModelProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get all visible (registered) providers.
   */
  visibleProviders(): LanguageModelProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all available models across all authenticated providers.
   */
  *availableModels(): Iterable<LanguageModel> {
    for (const provider of this.providers.values()) {
      if (provider.isAuthenticated()) {
        yield* provider.providedModels();
      }
    }
  }

  /**
   * Set the default model selection.
   */
  setDefaultModel(selection: LanguageModelSelection): void {
    this._defaultModel = selection;
  }

  /**
   * Get the configured default model.
   */
  defaultModel(): ConfiguredModel | undefined {
    if (!this._defaultModel) return undefined;
    return this.selectModel(this._defaultModel);
  }

  /**
   * Set the thread summary model selection.
   */
  setThreadSummaryModel(selection: LanguageModelSelection | undefined): void {
    this._threadSummaryModel = selection;
  }

  /**
   * Get the configured thread summary model.
   */
  threadSummaryModel(): ConfiguredModel | undefined {
    if (!this._threadSummaryModel) return undefined;
    return this.selectModel(this._threadSummaryModel);
  }

  /**
   * Resolve a model selection to an actual model instance.
   * Ported from: LanguageModelRegistry::select_model
   */
  selectModel(selection: LanguageModelSelection): ConfiguredModel | undefined {
    const providerId = selection.provider as LanguageModelProviderId;
    const provider = this.providers.get(providerId);
    if (!provider) return undefined;

    const models = provider.providedModels();
    const model = models.find((m) => m.id === selection.model);
    if (!model) return undefined;

    return { model };
  }

  /**
   * Find a model by its full ID (provider/model).
   */
  findModelById(fullId: string): LanguageModel | undefined {
    const [providerId, modelId] = fullId.split('/');
    if (!providerId || !modelId) return undefined;

    const provider = this.providers.get(providerId as LanguageModelProviderId);
    if (!provider) return undefined;

    return provider.providedModels().find((m) => m.id === modelId);
  }

  /**
   * Authenticate all providers in parallel.
   * Ported from: LanguageModels::authenticate_all_language_model_providers
   */
  async authenticateAllProviders(): Promise<void> {
    const tasks = Array.from(this.providers.values()).map(async (provider) => {
      try {
        await provider.authenticate();
      } catch (err) {
        // Silently ignore authentication failures for background authentication
        // (matches Zed's behavior of not logging noisy failures)
      }
    });

    await Promise.all(tasks);
    this.emit('models_updated');
  }
}
