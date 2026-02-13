/**
 * @module models/providers
 * Language model provider implementations.
 * Ported from: crates/language_models/src/provider/ (14 providers, ~15,542 LOC)
 */

// Anthropic
export {
  AnthropicProvider,
  AnthropicLanguageModel,
  ANTHROPIC_PROVIDER_ID,
  ANTHROPIC_PROVIDER_NAME,
} from './anthropic.js';
export type { AnthropicProviderOptions } from './anthropic.js';

// OpenAI
export {
  OpenAIProvider,
  OpenAILanguageModel,
  OPENAI_PROVIDER_ID,
  OPENAI_PROVIDER_NAME,
} from './openai.js';
export type { OpenAIProviderOptions } from './openai.js';

// Google AI (Gemini)
export {
  GoogleProvider,
  GOOGLE_PROVIDER_ID,
  GOOGLE_PROVIDER_NAME,
} from './google.js';
export type { GoogleProviderOptions } from './google.js';

// OpenAI-compatible (Ollama, LM Studio, DeepSeek, OpenRouter, xAI, Mistral, etc.)
export {
  OpenAICompatibleProvider,
  OpenAICompatibleLanguageModel,
  createOllamaProvider,
  createLMStudioProvider,
  createDeepSeekProvider,
  createOpenRouterProvider,
  createXAIProvider,
  createMistralProvider,
} from './openai-compatible.js';
export type {
  OpenAICompatibleProviderOptions,
  OpenAICompatibleModelDef,
} from './openai-compatible.js';

// GitHub Copilot Chat
export {
  createCopilotProvider,
  COPILOT_PROVIDER_ID,
  COPILOT_PROVIDER_NAME,
} from './copilot.js';

// AWS Bedrock
export {
  createBedrockProvider,
  BEDROCK_PROVIDER_ID,
  BEDROCK_PROVIDER_NAME,
} from './bedrock.js';

// Vercel AI
export {
  createVercelProvider,
  VERCEL_PROVIDER_ID,
  VERCEL_PROVIDER_NAME,
} from './vercel.js';

// Zed Cloud
export {
  ZedCloudProvider,
  ZED_CLOUD_PROVIDER_ID,
  ZED_CLOUD_PROVIDER_NAME,
} from './zed-cloud.js';
export type { ZedCloudProviderOptions } from './zed-cloud.js';
