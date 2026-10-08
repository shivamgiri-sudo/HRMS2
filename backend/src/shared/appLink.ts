import { env } from '../config/env.js';

/**
 * The one way to build an absolute link into the HRMS web app for an email/SMS/WhatsApp.
 *
 * Emails previously built these in ~15 private helpers with different fallbacks
 * (production host in some, localhost in others). env.FRONTEND_URL is zod-defaulted and
 * always an absolute URL, so this cannot emit a relative link.
 *
 * `path` is an app route ("/profile"); `query` values are URL-encoded. Login returns the
 * recipient to this exact page afterwards, so a logged-out recipient still lands on it.
 */
export function buildAppLink(path: string, query?: Record<string, string | number | undefined>): string {
  const base = String(env.FRONTEND_URL).replace(/\/+$/, '');
  const clean = path.startsWith('/') ? path : `/${path}`;
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${base}${clean}${qs ? `?${qs}` : ''}`;
}
