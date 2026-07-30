/**
 * Deciding when the user has started talking over Mira.
 *
 * This is the decision logic only — it takes timestamped loudness samples and
 * says whether to interrupt. It knows nothing about microphones or
 * AudioContext, so it is testable with plain numbers and does not need a
 * browser to run.
 *
 * The real signal is messy: a keyboard click, a chair creak, someone coughing
 * two desks over should not stop Mira mid-sentence. Only a sustained run of
 * loud samples counts, and a brief dip back to quiet resets the run rather than
 * tolerating gaps — a real interruption is continuous speech, not one loud
 * sample followed by silence. After a trigger, a cooldown window ignores
 * further samples so one interruption cannot fire twice in a row while the mic
 * is still settling.
 */

export interface VoiceActivityOptions {
  /** RMS (0-1) above which a sample counts as speech. */
  speechThreshold: number;
  /** RMS (0-1) below which a sample resets an in-progress run — must be <= speechThreshold. */
  silenceThreshold: number;
  /** Consecutive milliseconds above speechThreshold before triggering. */
  sustainMs: number;
  /** Milliseconds after a trigger during which further samples are ignored. */
  cooldownMs: number;
}

export const DEFAULT_VOICE_ACTIVITY_OPTIONS: VoiceActivityOptions = {
  speechThreshold: 0.06,
  silenceThreshold: 0.03,
  sustainMs: 300,
  cooldownMs: 1500,
};

export interface VoiceActivityDetector {
  /** Feed one loudness sample. Returns true exactly on the sample that triggers a barge-in. */
  feed(rms: number, atMs: number): boolean;
  reset(): void;
}

export function createVoiceActivityDetector(
  options: Partial<VoiceActivityOptions> = {},
): VoiceActivityDetector {
  const opts = { ...DEFAULT_VOICE_ACTIVITY_OPTIONS, ...options };
  let runStartedAt: number | null = null;
  let cooldownUntil = 0;

  return {
    feed(rms: number, atMs: number): boolean {
      if (atMs < cooldownUntil) return false;

      if (rms >= opts.speechThreshold) {
        if (runStartedAt === null) runStartedAt = atMs;
        if (atMs - runStartedAt >= opts.sustainMs) {
          runStartedAt = null;
          cooldownUntil = atMs + opts.cooldownMs;
          return true;
        }
        return false;
      }

      if (rms < opts.silenceThreshold) runStartedAt = null;
      // Between silenceThreshold and speechThreshold: hold the run neither
      // extending nor resetting it, so a brief dip mid-word does not restart the count.
      return false;
    },
    reset() {
      runStartedAt = null;
      cooldownUntil = 0;
    },
  };
}

/** RMS of a Uint8Array time-domain buffer from AnalyserNode.getByteTimeDomainData, as 0-1. */
export function rmsFromByteTimeDomain(buffer: Uint8Array): number {
  if (!buffer.length) return 0;
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const centered = (buffer[i] - 128) / 128; // -1..1
    sumSquares += centered * centered;
  }
  return Math.sqrt(sumSquares / buffer.length);
}
