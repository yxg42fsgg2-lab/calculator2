/**
 * Vercel AI language model provider.
 * Ported from: crates/language_models/src/provider/vercel.rs (~495 LOC)
 *
 * Connects to Vercel's AI SDK for model access.
 */

import { OpenAICompatibleProvider } from './openai-compatible.js';
import { languageModelProviderId, languageModelProviderName } from '../../types/branded.js';

export const VERCEL_PROVIDER_ID = languageModelProviderId('vercel');
export const VERCEL_PROVIDER_NAME = languageModelProviderName('Vercel');

/**
 * Create a Vercel AI provider.
 * Ported from: crates/language_models/src/provider/vercel.rs
 */
export function createVercelProvider(options: {
  apiKey: string;
  baseURL?: string;
}): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'vercel',
    name: 'Vercel',
    baseURL: options.baseURL ?? 'https://api.vercel.ai/v1',
    apiKey: options.apiKey,
    discoverModels: true,
    defaultMaxTokens: 128_000,
  });
}
