/**
 * Ollama AI Provider (Foundation)
 * Local/offline AI provider for future deployment
 * Phase 1: Interface only, full implementation deferred
 */

import type {
  AiProvider,
  SafeAiProviderConfig,
  AiProviderTestResult,
  AiGenerateRequest,
  AiGenerateResponse,
} from '../ai-provider.types.js';
import { ruleBasedProvider } from './ruleBased.provider.js';

export class OllamaProvider implements AiProvider {
  key = 'ollama';
  displayName = 'Ollama (Local AI)';
  supportsChat = true;
  supportsJson = true;
  supportsStreaming = true;
  supportsEmbeddings = true;

  async testConnection(config: SafeAiProviderConfig): Promise<AiProviderTestResult> {
    const startTime = Date.now();

    // Phase 1: Not implemented, return not configured
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      model: config.modelName || 'llama3.2',
      error: 'Ollama provider not implemented in Phase 1. Future enhancement.',
    };
  }

  async generateText(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    // Phase 1: Fallback to rule-based provider
    console.warn('[Ollama] Not implemented in Phase 1, falling back to rule-based provider');
    const fallback = await ruleBasedProvider.generateText(request);
    return { ...fallback, fallbackUsed: true };
  }
}

export const ollamaProvider = new OllamaProvider();
