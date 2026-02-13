/**
 * Tests for the LanguageModelRegistry.
 * Ported from: crates/language_model/src/registry.rs tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LanguageModelRegistry } from '../src/models/registry.js';
import { MockLanguageModel } from './mock-model.js';
import type { LanguageModelProvider } from '../src/models/provider.js';
import type { LanguageModel } from '../src/models/language-model.js';
import { languageModelProviderId, languageModelProviderName, languageModelId, languageModelName } from '../src/types/branded.js';

class MockProvider implements LanguageModelProvider {
  readonly id;
  readonly name;
  readonly icon = 'mock';
  private models: LanguageModel[];
  private _authenticated = true;

  constructor(id: string, name: string, models: LanguageModel[] = [new MockLanguageModel()]) {
    this.id = languageModelProviderId(id);
    this.name = languageModelProviderName(name);
    this.models = models;
  }

  providedModels(): LanguageModel[] { return this.models; }
  recommendedModels(): LanguageModel[] { return this.models; }
  isAuthenticated(): boolean { return this._authenticated; }
  async authenticate(): Promise<void> { this._authenticated = true; }
}

describe('LanguageModelRegistry', () => {
  let registry: LanguageModelRegistry;

  beforeEach(() => {
    registry = new LanguageModelRegistry();
  });

  it('starts with no providers', () => {
    expect(registry.visibleProviders()).toHaveLength(0);
  });

  it('registers and retrieves providers', () => {
    const provider = new MockProvider('test', 'Test');
    registry.registerProvider(provider);

    expect(registry.visibleProviders()).toHaveLength(1);
    expect(registry.provider(languageModelProviderId('test'))).toBe(provider);
  });

  it('unregisters providers', () => {
    const provider = new MockProvider('test', 'Test');
    registry.registerProvider(provider);
    registry.unregisterProvider(languageModelProviderId('test'));

    expect(registry.visibleProviders()).toHaveLength(0);
    expect(registry.provider(languageModelProviderId('test'))).toBeUndefined();
  });

  it('lists available models from authenticated providers', () => {
    const provider = new MockProvider('test', 'Test', [new MockLanguageModel()]);
    registry.registerProvider(provider);

    const models = Array.from(registry.availableModels());
    expect(models).toHaveLength(1);
  });

  it('sets and gets default model', () => {
    const provider = new MockProvider('mock', 'Mock');
    registry.registerProvider(provider);

    registry.setDefaultModel({ provider: 'mock', model: 'mock' });
    const configured = registry.defaultModel();
    expect(configured).toBeDefined();
    expect(configured!.model.id).toBe(languageModelId('mock'));
  });

  it('returns undefined for unconfigured default model', () => {
    expect(registry.defaultModel()).toBeUndefined();
  });

  it('returns undefined when provider not found', () => {
    registry.setDefaultModel({ provider: 'nonexistent', model: 'test' });
    expect(registry.defaultModel()).toBeUndefined();
  });

  it('sets and gets thread summary model', () => {
    const provider = new MockProvider('mock', 'Mock');
    registry.registerProvider(provider);

    registry.setThreadSummaryModel({ provider: 'mock', model: 'mock' });
    const configured = registry.threadSummaryModel();
    expect(configured).toBeDefined();
  });

  it('selects model by provider and id', () => {
    const provider = new MockProvider('mock', 'Mock');
    registry.registerProvider(provider);

    const configured = registry.selectModel({ provider: 'mock', model: 'mock' });
    expect(configured).toBeDefined();
    expect(configured!.model.name).toBe(languageModelName('Mock'));
  });

  it('returns undefined for nonexistent model', () => {
    const provider = new MockProvider('mock', 'Mock');
    registry.registerProvider(provider);

    const configured = registry.selectModel({ provider: 'mock', model: 'nonexistent' });
    expect(configured).toBeUndefined();
  });

  it('finds model by full ID', () => {
    const provider = new MockProvider('mock', 'Mock');
    registry.registerProvider(provider);

    const model = registry.findModelById('mock/mock');
    expect(model).toBeDefined();
  });

  it('emits models_updated on register', () => {
    let emitted = false;
    registry.on('models_updated', () => { emitted = true; });

    registry.registerProvider(new MockProvider('test', 'Test'));
    expect(emitted).toBe(true);
  });

  it('emits models_updated on unregister', () => {
    registry.registerProvider(new MockProvider('test', 'Test'));

    let emitted = false;
    registry.on('models_updated', () => { emitted = true; });

    registry.unregisterProvider(languageModelProviderId('test'));
    expect(emitted).toBe(true);
  });

  it('authenticates all providers', async () => {
    registry.registerProvider(new MockProvider('a', 'A'));
    registry.registerProvider(new MockProvider('b', 'B'));

    // Should not throw
    await registry.authenticateAllProviders();
  });
});
