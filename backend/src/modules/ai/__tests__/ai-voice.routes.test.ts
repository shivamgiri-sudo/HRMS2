import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../ai-rate-limiter.js', () => ({ checkAndIncrement: vi.fn() }));
vi.mock('../ai-voice-transcription.service.js', async () => {
  const actual = await vi.importActual<typeof import('../ai-voice-transcription.service.js')>('../ai-voice-transcription.service.js');
  return { ...actual, transcribeAudio: vi.fn() };
});

vi.mock('../../../middleware/authMiddleware.js', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ success: false, message: 'Unauthenticated' });
    (req as express.Request & { authUser: { id: string } }).authUser = { id: 'test-user-id' };
    next();
  },
}));

import { checkAndIncrement } from '../ai-rate-limiter.js';
import { transcribeAudio, VoiceTranscriptionError } from '../ai-voice-transcription.service.js';

const ALLOWED = { allowed: true, remaining: 24, resetAt: new Date('2026-01-01T00:00:00Z') };
const DENIED = { allowed: false, remaining: 0, resetAt: new Date('2026-01-01T00:00:00Z') };

describe('POST /transcribe', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(checkAndIncrement).mockResolvedValue(ALLOWED);
    vi.mocked(transcribeAudio).mockResolvedValue({ text: 'how do I apply for leave' });
    const { aiVoiceRouter } = await import('../ai-voice.routes.js');
    app = express();
    app.use('/api/ai/voice', aiVoiceRouter);
  });

  it('rejects without an auth token', async () => {
    const res = await request(app).post('/api/ai/voice/transcribe');
    expect(res.status).toBe(401);
  });

  it('checks the rate limit before parsing the body, and never calls transcribeAudio when denied', async () => {
    vi.mocked(checkAndIncrement).mockResolvedValue(DENIED);
    const res = await request(app)
      .post('/api/ai/voice/transcribe')
      .set('Authorization', 'Bearer x')
      .attach('audio', Buffer.from('fake audio'), { filename: 'voice.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(429);
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(checkAndIncrement).toHaveBeenCalledWith('voice:test-user-id', 25);
  });

  it('rejects a disallowed mimetype', async () => {
    const res = await request(app)
      .post('/api/ai/voice/transcribe')
      .set('Authorization', 'Bearer x')
      .attach('audio', Buffer.from('not audio'), { filename: 'evil.exe', contentType: 'application/x-msdownload' });

    expect(res.status).toBe(400);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('rejects a file over the 5MB limit', async () => {
    const oversized = Buffer.alloc(6 * 1024 * 1024, 1);
    const res = await request(app)
      .post('/api/ai/voice/transcribe')
      .set('Authorization', 'Bearer x')
      .attach('audio', oversized, { filename: 'voice.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(400);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('returns the transcript on the happy path', async () => {
    const res = await request(app)
      .post('/api/ai/voice/transcribe')
      .set('Authorization', 'Bearer x')
      .attach('audio', Buffer.from('fake audio'), { filename: 'voice.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(200);
    expect(res.body.data.text).toBe('how do I apply for leave');
  });

  it('surfaces a VoiceTranscriptionError as a 502, not a 500', async () => {
    vi.mocked(transcribeAudio).mockRejectedValue(new VoiceTranscriptionError('OpenAI is down'));
    const res = await request(app)
      .post('/api/ai/voice/transcribe')
      .set('Authorization', 'Bearer x')
      .attach('audio', Buffer.from('fake audio'), { filename: 'voice.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(502);
    expect(res.body.error.message).toContain('OpenAI is down');
  });
});
