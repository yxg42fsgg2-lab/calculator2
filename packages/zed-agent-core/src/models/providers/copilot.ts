/**
 * GitHub Copilot Chat language model provider.
 * Ported from: crates/language_models/src/provider/copilot_chat.rs (~1,478 LOC)
 *
 * This provider uses the GitHub Copilot token-based authentication
 * and routes through GitHub's API to access language models.
 */

import { OpenAICompatibleProvider, type OpenAICompatibleProviderOptions } from './openai-compatible.js';
import { languageModelProviderId, languageModelProviderName } from '../../types/branded.js';

export const COPILOT_PROVIDER_ID = languageModelProviderId('copilot_chat');
export const COPILOT_PROVIDER_NAME = languageModelProviderName('GitHub Copilot');

/**
 * Create a GitHub Copilot Chat provider.
 * Ported from: crates/language_models/src/provider/copilot_chat.rs
 *
 * Requires a GitHub Copilot token (obtained via the Copilot extension auth flow).
 */
export function createCopilotProvider(options: {
  token: string;
  baseURL?: string;
}): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    id: 'copilot_chat',
    name: 'GitHub Copilot',
    baseURL: options.baseURL ?? 'https://api.githubcopilot.com',
    apiKey: options.token,
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (Copilot)', maxTokens: 128_000, supportsImages: true, supportsTools: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Copilot)', maxTokens: 128_000, supportsTools: true },
      { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (Copilot)', maxTokens: 200_000, supportsTools: true },
      { id: 'o3-mini', name: 'o3-mini (Copilot)', maxTokens: 200_000, supportsThinking: true },
    ],
  });
}
