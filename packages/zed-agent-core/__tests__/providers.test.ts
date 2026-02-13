/**
 * Tests for provider definitions — verify model IDs, names, and capabilities.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicProvider, ANTHROPIC_PROVIDER_ID } from '../src/models/providers/anthropic.js';
import { OpenAIProvider, OPENAI_PROVIDER_ID } from '../src/models/providers/openai.js';
import { GoogleProvider, GOOGLE_PROVIDER_ID } from '../src/models/providers/google.js';
import {
  createOllamaProvider,
  createLMStudioProvider,
  createDeepSeekProvider,
  createOpenRouterProvider,
  createXAIProvider,
  createMistralProvider,
} from '../src/models/providers/openai-compatible.js';
import { createCopilotProvider } from '../src/models/providers/copilot.js';
import { createBedrockProvider } from '../src/models/providers/bedrock.js';
import { createVercelProvider } from '../src/models/providers/vercel.js';
import { ZedCloudProvider, ZED_CLOUD_PROVIDER_ID } from '../src/models/providers/zed-cloud.js';

describe('Anthropic provider', () => {
  const provider = new AnthropicProvider({ apiKey: 'test-key' });

  it('has correct ID and name', () => {
    expect(String(provider.id)).toBe('anthropic');
    expect(String(provider.name)).toBe('Anthropic');
  });

  it('provides models', () => {
    const models = provider.providedModels();
    expect(models.length).toBeGreaterThan(0);
  });

  it('includes Claude Sonnet 4', () => {
    const models = provider.providedModels();
    const sonnet = models.find(m => String(m.id).includes('sonnet'));
    expect(sonnet).toBeDefined();
    expect(sonnet!.supportsThinking).toBe(true);
    expect(sonnet!.supportsImages).toBe(true);
    expect(sonnet!.supportsTools).toBe(true);
    expect(sonnet!.maxTokenCount).toBeGreaterThanOrEqual(200_000);
  });

  it('is authenticated with key', () => {
    expect(provider.isAuthenticated()).toBe(true);
  });

  it('is not authenticated without key', () => {
    const noKey = new AnthropicProvider({});
    expect(noKey.isAuthenticated()).toBe(false);
  });
});

describe('OpenAI provider', () => {
  const provider = new OpenAIProvider({ apiKey: 'test-key' });

  it('has correct ID', () => {
    expect(String(provider.id)).toBe('openai');
  });

  it('includes GPT-4o', () => {
    const models = provider.providedModels();
    const gpt4o = models.find(m => String(m.id) === 'gpt-4o');
    expect(gpt4o).toBeDefined();
    expect(gpt4o!.supportsImages).toBe(true);
    expect(gpt4o!.supportsTools).toBe(true);
  });

  it('includes o3 with thinking', () => {
    const models = provider.providedModels();
    const o3 = models.find(m => String(m.id) === 'o3');
    expect(o3).toBeDefined();
    expect(o3!.supportsThinking).toBe(true);
  });
});

describe('Google provider', () => {
  const provider = new GoogleProvider({ apiKey: 'test-key' });

  it('has correct ID', () => {
    expect(String(provider.id)).toBe('google');
  });

  it('includes Gemini 2.5 Pro', () => {
    const models = provider.providedModels();
    const gemini = models.find(m => String(m.name).includes('2.5 Pro'));
    expect(gemini).toBeDefined();
    expect(gemini!.supportsThinking).toBe(true);
    expect(gemini!.maxTokenCount).toBeGreaterThanOrEqual(1_000_000);
  });
});

describe('OpenAI-compatible providers', () => {
  it('Ollama has correct ID and auto-discovery', () => {
    const provider = createOllamaProvider();
    expect(String(provider.id)).toBe('ollama');
    expect(provider.isAuthenticated()).toBe(true); // Local providers always auth'd
  });

  it('LMStudio has correct ID', () => {
    const provider = createLMStudioProvider();
    expect(String(provider.id)).toBe('lmstudio');
  });

  it('DeepSeek includes R1 with thinking', () => {
    const provider = createDeepSeekProvider('test-key');
    const models = provider.providedModels();
    const r1 = models.find(m => String(m.id).includes('reasoner'));
    expect(r1).toBeDefined();
    expect(r1!.supportsThinking).toBe(true);
  });

  it('OpenRouter has correct ID', () => {
    const provider = createOpenRouterProvider('test-key');
    expect(String(provider.id)).toBe('open_router');
  });

  it('xAI includes Grok 3', () => {
    const provider = createXAIProvider('test-key');
    const models = provider.providedModels();
    expect(models.find(m => String(m.name).includes('Grok 3'))).toBeDefined();
  });

  it('Mistral includes Codestral', () => {
    const provider = createMistralProvider('test-key');
    const models = provider.providedModels();
    expect(models.find(m => String(m.name).includes('Codestral'))).toBeDefined();
  });
});

describe('Other providers', () => {
  it('Copilot has correct ID', () => {
    const provider = createCopilotProvider({ token: 'test' });
    expect(String(provider.id)).toBe('copilot_chat');
  });

  it('Bedrock has correct ID', () => {
    const provider = createBedrockProvider({
      region: 'us-east-1',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    });
    expect(String(provider.id)).toBe('bedrock');
    expect(provider.providedModels().length).toBeGreaterThan(0);
  });

  it('Vercel has correct ID', () => {
    const provider = createVercelProvider({ apiKey: 'test' });
    expect(String(provider.id)).toBe('vercel');
  });

  it('Zed Cloud has correct ID and models', () => {
    const provider = new ZedCloudProvider({ token: 'test' });
    expect(String(provider.id)).toBe('zed.dev');
    const models = provider.providedModels();
    expect(models.length).toBeGreaterThan(0);
    // Should have models from multiple upstream providers
    const upstreamProviders = new Set(models.map(m => String(m.upstreamProviderId)));
    expect(upstreamProviders.size).toBeGreaterThan(1);
  });
});

describe('All providers', () => {
  it('every model has required fields', () => {
    const allProviders = [
      new AnthropicProvider({ apiKey: 'k' }),
      new OpenAIProvider({ apiKey: 'k' }),
      new GoogleProvider({ apiKey: 'k' }),
      createDeepSeekProvider('k'),
      createXAIProvider('k'),
      createMistralProvider('k'),
      new ZedCloudProvider({ token: 'k' }),
    ];

    for (const provider of allProviders) {
      for (const model of provider.providedModels()) {
        expect(model.id, `${provider.name} model missing id`).toBeTruthy();
        expect(model.name, `${provider.name} model missing name`).toBeTruthy();
        expect(model.providerId, `${model.name} missing providerId`).toBeTruthy();
        expect(model.maxTokenCount, `${model.name} missing maxTokenCount`).toBeGreaterThan(0);
        expect(typeof model.supportsThinking).toBe('boolean');
        expect(typeof model.supportsImages).toBe('boolean');
        expect(typeof model.supportsTools).toBe('boolean');
      }
    }
  });
});
