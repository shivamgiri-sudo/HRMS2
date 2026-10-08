/**
 * Remember where a logged-out visitor was headed so login (and the 2FA /
 * password-change steps that can follow it) can send them there afterwards.
 *
 * Emails link straight to the page that needs action. Without this, the login
 * page always sent people to /dashboard and the destination was lost.
 *
 * Only same-origin relative paths are ever accepted: the value arrives from a
 * query string, so anything that could leave the site is rejected.
 */
const KEY = "hrms_post_login_redirect";

// Pages that are part of the sign-in flow itself — never a useful destination.
const AUTH_PATHS = new Set(["/auth", "/login", "/two-factor", "/change-password", "/reset-password"]);

export function sanitizeRedirect(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 2000) return null;
  // Must be a single-slash path: rejects "//host", "/\host", "http://…", "javascript:…".
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // Control characters and backslashes can be normalised into a different host by browsers.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  const pathname = value.split(/[?#]/)[0];
  if (AUTH_PATHS.has(pathname)) return null;
  return value;
}

export function rememberRedirect(raw: unknown): void {
  const safe = sanitizeRedirect(raw);
  if (!safe) return;
  try {
    sessionStorage.setItem(KEY, safe);
  } catch {
    /* storage blocked — fall back to the default landing page */
  }
}

/** Read without clearing, for steps (2FA, password change) that come before the final landing. */
export function peekRedirect(): string | null {
  try {
    return sanitizeRedirect(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Where to land once sign-in is fully complete. Clears the stored value. */
export function takeRedirect(fallback = "/dashboard"): string {
  const stored = peekRedirect();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return stored ?? fallback;
}
