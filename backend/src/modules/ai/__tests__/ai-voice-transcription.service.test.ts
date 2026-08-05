import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transcribeAudio, VoiceTranscriptionError } from '../ai-voice-transcription.service.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  vi.unstubAllGlobals();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('transcribeAudio', () => {
  it('returns the transcript on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '  how do I apply for leave  ' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await transcribeAudio(Buffer.from('fake audio bytes'), 'audio/webm', 'voice.webm');

    expect(result.text).toBe('how do I apply for leave');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(options.headers.Authorization).toBe('Bearer test-key');
    expect(options.body).toBeInstanceOf(FormData);
  });

  it('throws without calling fetch when OPENAI_API_KEY is not configured', async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeAudio(Buffer.from('x'), 'audio/webm', 'voice.webm')).rejects.toThrow(VoiceTranscriptionError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a clear message on a non-2xx OpenAI response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    }));

    await expect(transcribeAudio(Buffer.from('x'), 'audio/webm', 'voice.webm')).rejects.toThrow('Invalid API key');
  });

  it('treats an empty transcript as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: '   ' }) }));

    await expect(transcribeAudio(Buffer.from('x'), 'audio/webm', 'voice.webm')).rejects.toThrow('empty transcript');
  });

  it('wraps a network failure in VoiceTranscriptionError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    await expect(transcribeAudio(Buffer.from('x'), 'audio/webm', 'voice.webm')).rejects.toThrow(VoiceTranscriptionError);
  });
});
