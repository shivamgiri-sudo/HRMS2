/**
 * Retry + throttle policy for SMTP sends.
 *
 * Gmail/Workspace answers bursts with "421-4.3.0 Temporary System Problem. Try again later"
 * (a 4xx = temporary, the message was NOT accepted). On 2026-10-02 a 63-mail burst in one
 * minute saw 24 of them fail that way, and nothing retried — the failure was recorded
 * as final. 5xx replies are permanent (bad address, auth) and must not be retried.
 */

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 30_000;

/** Messages per minute handed to the pooled transport (nodemailer rateLimit/rateDelta). */
export function smtpRateLimitPerMinute(): number {
  const n = Number(process.env.SMTP_MAX_PER_MINUTE);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

/** True for temporary SMTP failures (4xx reply, or a dropped/timed-out connection). */
export function isTransientSmtpError(error: unknown): boolean {
  const e = error as { responseCode?: unknown; code?: unknown; message?: unknown } | null;
  const rc = Number(e?.responseCode);
  if (Number.isFinite(rc) && rc > 0) return rc >= 400 && rc < 500;
  const code = String(e?.code ?? "");
  if (["ETIMEDOUT", "ECONNRESET", "ECONNECTION", "ESOCKET", "EDNS"].includes(code)) return true;
  // Fallback: nodemailer sometimes wraps the reply text without a numeric responseCode.
  return /(^|\s)4\d\d[- ]4\.\d+\.\d+/.test(String(e?.message ?? ""));
}

export async function withSmtpRetry<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isTransientSmtpError(error)) throw error;
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
      await sleep(delay + Math.floor(Math.random() * 500));
    }
  }
}
