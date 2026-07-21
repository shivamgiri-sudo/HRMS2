/**
 * Google Gemini AI Provider
 * Integration with Google Generative AI SDK
 * PeopleOS AI Enhancement Phase 1
 */

import type {
  AiProvider,
  SafeAiProviderConfig,
  AiProviderTestResult,
  AiGenerateRequest,
  AiGenerateResponse,
} from '../ai-provider.types.js';
import { ruleBasedProvider } from './ruleBased.provider.js';

// Google Generative AI SDK types
type GoogleGenerativeAI = any;
type GenerativeModel = any;
type GenerateContentResult = any;

export class GeminiProvider implements AiProvider {
  key = 'gemini';
  displayName = 'Google Gemini AI';
  supportsChat = true;
  supportsJson = true;
  supportsStreaming = false; // Not implemented in Phase 1
  supportsEmbeddings = false; // Not implemented in Phase 1

  private sdk: any = null;

  /**
   * Initialize Gemini SDK
   */
  private async initSdk(apiKey: string): Promise<any> {
    if (this.sdk) return this.sdk;

    try {
      // Dynamic import to handle optional dependency
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      this.sdk = new GoogleGenerativeAI(apiKey);
      return this.sdk;
    } catch (error) {
      throw new Error('Google Generative AI SDK not installed. Run: npm install @google/generative-ai');
    }
  }

  async testConnection(config: SafeAiProviderConfig): Promise<AiProviderTestResult> {
    const startTime = Date.now();

    if (!config.apiKey) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        model: config.modelName || 'unknown',
        error: 'API key not configured',
      };
    }

    try {
      const sdk = await this.initSdk(config.apiKey);
      const model = sdk.getGenerativeModel({
        model: config.modelName || 'gemini-flash',
      });

      // Send a simple test prompt
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Reply with: connection successful' }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 50,
          temperature: 0,
        },
      });

      const response = result.response.text();

      return {
        success: true,
        latencyMs: Date.now() - startTime,
        model: config.modelName || 'gemini-flash',
      };
    } catch (error: any) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        model: config.modelName || 'gemini-flash',
        error: error.message || 'Test connection failed',
      };
    }
  }

  async generateText(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const startTime = Date.now();

    // Prefer the decrypted key passed in the request (from DB config), fall back to env var
    const apiKey = (request as any).apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[Gemini] API key not configured, falling back to rule-based provider');
      const fallback = await ruleBasedProvider.generateText(request);
      return { ...fallback, fallbackUsed: true };
    }

    // Reset cached SDK instance when key changes (e.g. after config update)
    this.sdk = null;

    try {
      const sdk = await this.initSdk(apiKey);
      const modelName = request.model || process.env.GEMINI_DEFAULT_MODEL || 'gemini-1.5-flash';
      const model = sdk.getGenerativeModel({ model: modelName });

      // Build system instruction + user question
      const systemInstruction = request.systemInstruction || 'You are a helpful AI assistant.';
      const userQuestion = request.userQuestion;
      const contextStr = JSON.stringify(request.sanitizedContext, null, 2);

      const prompt = `${systemInstruction}

Context (sanitized and PII-protected):
${contextStr}

User question: ${userQuestion}

Provide a concise, actionable response based solely on the provided context.`;

      // Generate content
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: request.temperature ?? 0.3,
          maxOutputTokens: request.maxOutputTokens ?? 1024,
          responseMimeType: request.responseFormat === 'json' ? 'application/json' : 'text/plain',
        },
        safetySettings: this.getSafetySettings(request.safetyLevel),
      });

      const answer = result.response.text();
      const usage = result.response.usageMetadata;

      const response: AiGenerateResponse = {
        answer,
        provider: this.key,
        model: modelName,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        latencyMs: Date.now() - startTime,
        safetyBlocked: false,
        fallbackUsed: false,
        generatedAt: new Date().toISOString(),
        sourceContexts: this.extractSourceContexts(request.sanitizedContext),
        dataConfidence: request.sanitizedContext.data_confidence as Record<string, number> | undefined,
      };

      return response;
    } catch (error: any) {
      console.error('[Gemini] Generation failed, falling back to rule-based provider:', error.message);

      // Fallback to rule-based provider
      const fallback = await ruleBasedProvider.generateText(request);
      return {
        ...fallback,
        fallbackUsed: true,
        provider: 'rule-based',
        model: 'internal-rules-v1',
      };
    }
  }

  /**
   * Get safety settings based on level
   */
  private getSafetySettings(
    level?: 'strict' | 'moderate' | 'permissive'
  ): Array<{ category: string; threshold: string }> {
    const categories = [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ];

    const threshold = level === 'permissive' ? 'BLOCK_ONLY_HIGH' : level === 'strict' ? 'BLOCK_LOW_AND_ABOVE' : 'BLOCK_MEDIUM_AND_ABOVE';

    return categories.map((category) => ({ category, threshold }));
  }

  /**
   * Extract source context names
   */
  private extractSourceContexts(context: Record<string, unknown>): string[] {
    const sources: string[] = [];

    if (context.blocked_count !== undefined) {
      sources.push('payroll_readiness');
    }
    if (context.risky_records !== undefined || context.late_marks !== undefined) {
      sources.push('attendance_exceptions');
    }
    if (context.breached_tickets !== undefined) {
      sources.push('support_sla');
    }
    if (context.open_grievances !== undefined) {
      sources.push('grievances');
    }
    if (context.active_headcount !== undefined) {
      sources.push('headcount_summary');
    }

    return sources.length > 0 ? sources : ['generic_context'];
  }
}

export const geminiProvider = new GeminiProvider();
