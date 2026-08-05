/**
 * Voice transcription — OpenAI Whisper fallback for Safari/iOS, where the
 * browser has no Web Speech API. Kept in its own file rather than folded into
 * the already-large ai-insights.routes.ts.
 */
import { Router } from 'express';
import type { Response } from 'express';
import multer from 'multer';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { apiError, apiSuccess } from '../../shared/apiResponse.js';
import { checkAndIncrement } from './ai-rate-limiter.js';
import { transcribeAudio, VoiceTranscriptionError } from './ai-voice-transcription.service.js';

export const aiVoiceRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => fn(req, res).catch(next);

// Any authenticated employee — not an HR/admin role list. Voice input is a
// general self-service feature, not an administrative one.
aiVoiceRouter.use(requireAuth);

// Whisper bills per-minute-of-audio, a different cost shape than the text
// rate limiter's per-request counting — reused as-is via a namespaced key
// (`voice:${userId}`) rather than a new table, cleanly separating
// transcription counts from text-request counts in the same bucket table.
// Lower default than the 100/day text limit since each request costs real
// money — a policy call, easy to tune later, not a hard requirement.
const DAILY_VOICE_TRANSCRIPTION_LIMIT = 25;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // short voice clips only
  fileFilter: (_req, file, cb) => {
    // Safari's MediaRecorder primarily produces audio/mp4 (AAC), not the
    // audio/webm most Chromium browsers default to — both need to be allowed.
    const allowed = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg']);
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Audio type ${file.mimetype} is not allowed`));
  },
});

aiVoiceRouter.post('/transcribe', h(async (req, res) => {
  const userId = req.authUser!.id;

  // Checked before multer even parses the body, so an over-limit request
  // never gets its audio buffered, let alone billed to OpenAI.
  const rateResult = await checkAndIncrement(`voice:${userId}`, DAILY_VOICE_TRANSCRIPTION_LIMIT);
  if (!rateResult.allowed) {
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', rateResult.resetAt.toISOString());
    return res.status(429).json(apiError('RATE_LIMIT_EXCEEDED', 'Daily voice transcription limit reached. Please type your question instead.', 429));
  }

  return upload.single('audio')(req, res, async (err) => {
    if (err) return res.status(400).json(apiError('VALIDATION_ERROR', err instanceof Error ? err.message : 'Invalid audio upload', 400));
    if (!req.file) return res.status(400).json(apiError('VALIDATION_ERROR', 'audio file is required', 400));
    try {
      const { text } = await transcribeAudio(req.file.buffer, req.file.mimetype, req.file.originalname || 'voice.webm');
      return res.json(apiSuccess({ text }));
    } catch (error) {
      if (error instanceof VoiceTranscriptionError) {
        return res.status(502).json(apiError('TRANSCRIPTION_FAILED', error.message, 502));
      }
      throw error;
    }
  });
}));
