/**
 * AI Provider Registry
 * Central registry for all AI providers
 * PeopleOS AI Enhancement Phase 1
 */

import type { AiProvider } from './ai-provider.types.js';
import { ruleBasedProvider } from './providers/ruleBased.provider.js';
import { geminiProvider } from './providers/gemini.provider.js';
import { ollamaProvider } from './providers/ollama.provider.js';
import { aiProviderConfigService } from './ai-provider-config.service.js';

class AiProviderRegistry {
  private providers: Map<string, AiProvider> = new Map();

  constructor() {
    // Register built-in providers
    this.register(ruleBasedProvider);
    this.register(geminiProvider);
    this.register(ollamaProvider);
  }

  /**
   * Register a provider
   */
  register(provider: AiProvider): void {
    this.providers.set(provider.key, provider);
    console.log(`[AI Registry] Registered provider: ${provider.displayName} (${provider.key})`);
  }

  /**
   * Get provider by key
   */
  get(providerKey: string): AiProvider | null {
    return this.providers.get(providerKey) || null;
  }

  /**
   * Get active default provider (from DB config)
   */
  async getDefault(): Promise<AiProvider> {
    const config = await aiProviderConfigService.getDefaultProvider(false);

    if (!config) {
      console.warn('[AI Registry] No default provider configured, using rule-based fallback');
      return ruleBasedProvider;
    }

    const provider = this.get(config.providerKey);

    if (!provider) {
      console.warn(`[AI Registry] Provider ${config.providerKey} not found in registry, using rule-based fallback`);
      return ruleBasedProvider;
    }

    return provider;
  }

  /**
   * Get provider with config (includes decrypted API key for execution)
   */
  async getWithConfig(providerKey: string): Promise<{
    provider: AiProvider;
    config: Awaited<ReturnType<typeof aiProviderConfigService.getByKey>>;
  } | null> {
    const provider = this.get(providerKey);
    if (!provider) return null;

    const config = await aiProviderConfigService.getByKey(providerKey, true);
    if (!config) return null;

    return { provider, config };
  }

  /**
   * List all registered providers
   */
  listAll(): Array<{ key: string; displayName: string; capabilities: {
    supportsChat: boolean;
    supportsJson: boolean;
    supportsStreaming: boolean;
    supportsEmbeddings: boolean;
  }}> {
    return Array.from(this.providers.values()).map((provider) => ({
      key: provider.key,
      displayName: provider.displayName,
      capabilities: {
        supportsChat: provider.supportsChat,
        supportsJson: provider.supportsJson,
        supportsStreaming: provider.supportsStreaming,
        supportsEmbeddings: provider.supportsEmbeddings || false,
      },
    }));
  }
}

export const aiProviderRegistry = new AiProviderRegistry();
