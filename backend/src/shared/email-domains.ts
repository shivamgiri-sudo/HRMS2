/**
 * Company email-domain policy — the single definition.
 *
 * Extracted from modules/reporting/report-email-resolver.ts, which has enforced this
 * allowlist on report delivery since the reporting platform shipped. The notification
 * gateway needs the identical rule for `fin` events, and two copies of a security
 * allowlist drift. That file now imports from here.
 *
 * Deliberately NOT configurable at runtime. A DB-backed allowlist would let anyone with
 * write access to a config table redirect payslips.
 */

/** Company-controlled domains. Subdomains are accepted; nothing else is. */
export const ALLOWED_EMAIL_DOMAINS = ['teammas.in', 'teammas.co.in', 'mascallnet.com'] as const;

/**
 * True when `email` sits on a company-controlled domain.
 *
 * Matches the domain exactly or as a subdomain (`hr.teammas.in`). Note that endsWith('.'+d)
 * is what makes `noteammas.in` fail while `hr.teammas.in` passes — a bare endsWith(d) would
 * accept the former.
 */
export function isOfficialDomain(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return false;
  return ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
}

/** Cheap structural check. Not RFC 5322 — it rejects the shapes that break SMTP headers. */
export function isPlausibleEmail(value: string): boolean {
  const v = value.trim();
  if (v.length < 6 || v.length > 254) return false;
  if (/[\s,;<>"\\]/.test(v)) return false;      // header-injection and multi-address shapes
  const parts = v.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || !domain.includes('.')) return false;
  return true;
}

/** Lowercased and trimmed, or null when the value could not be an address at all. */
export function normaliseEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  return isPlausibleEmail(v) ? v : null;
}

/** `s***@teammas.in` — for logs and audit rows. Never log a full address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  const visible = local.length > 2 ? local[0] + '***' : '***';
  return `${visible}@${domain}`;
}
