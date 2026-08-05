/**
 * OpenAI Whisper speech-to-text, for the Safari/iOS voice-input fallback.
 *
 * Deliberately NOT registered in aiProviderRegistry / does not implement
 * AiProvider (ai-provider.registry.ts, ai-provider.types.ts) — that interface
 * is text-in/text-out only (generateText(request): Promise<AiGenerateResponse>,
 * no audio field anywhere on AiGenerateRequest). Forcing a transcription
 * service into that shape would be worse than this small, parallel,
 * purpose-built path.
 *
 * API key is a plain OPENAI_API_KEY env var, not the encrypted ai_provider_config
 * path other providers use — that path's own POST /api/ai/providers route
 * (ai-insights.routes.ts) hard-rejects any providerKey not already registered
 * in aiProviderRegistry, and its encrypt/decrypt helpers
 * (ai-provider-config.service.ts) are private, unexported class methods. This
 * mirrors OpenRouter's own existing process.env.OPENROUTER_API_KEY precedent —
 * an already-accepted convention in this exact codebase — rather than
 * building a new encrypted-DB-config admin path for one credential.
 *
 * No SDK — plain fetch() with the runtime's global FormData/Blob (Node 24),
 * matching OpenRouter's lightweight fetch-only precedent.
 */

export class VoiceTranscriptionError extends Error {}

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-1';

export async function transcribeAudio(buffer: Buffer, mimeType: string, filename: string): Promise<{ text: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new VoiceTranscriptionError('OpenAI API key is not configured');

  const form = new FormData();
  // Buffer isn't directly assignable to BlobPart (its underlying
  // ArrayBufferLike can be a SharedArrayBuffer, which BlobPart's typing
  // excludes) — Uint8Array.from copies into a plain ArrayBuffer-backed view.
  form.append('file', new Blob([Uint8Array.from(buffer)], { type: mimeType }), filename);
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_MODEL);

  let response: Response;
  try {
    response = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (error) {
    throw new VoiceTranscriptionError(error instanceof Error ? error.message : 'Could not reach OpenAI for transcription');
  }

  const payload = await response.json().catch(() => ({})) as { text?: string; error?: { message?: string } };
  if (!response.ok) {
    throw new VoiceTranscriptionError(payload.error?.message || `OpenAI transcription failed with status ${response.status}`);
  }
  const text = String(payload.text ?? '').trim();
  if (!text) throw new VoiceTranscriptionError('OpenAI returned an empty transcript');
  return { text };
}
