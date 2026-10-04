import { env } from '../../config/env.js';

/**
 * Where the recipient of a gateway notification should land to act on it.
 *
 * Gateway events (payroll, leave, exit, roster, GRN, NOC, regularization, statutory)
 * were delivered with no link at all: the deliverer never received an actionUrl and the
 * fallback body has none, so the recipient had to find the right page themselves.
 *
 * Paths are bare app routes. Login now returns people to the page they were sent to,
 * so a logged-out recipient still ends up here after signing in.
 */
const EXACT: Record<string, string> = {
  payslip_ready: '/profile?tab=payslips',
  salary_increment_letter: '/employee-stat-card',
  salary_advance_recovery: '/payroll/ho-queues?tab=advances',
  payroll_window_closing: '/payroll',
  statutory_opt_out_submitted: '/payroll/ho-queues?tab=optout',
  statutory_opt_out_decided: '/profile?tab=statutory',
  statutory_opt_out_revoked: '/profile?tab=statutory',
  full_final_ready: '/profile',
  roster_published: '/my-roster',
  shift_changed: '/my-roster',
  training_reminder_nudge: '/lms/my-learning',
  provisioning_overdue: '/it-provisioning',
  bank_exception_invalid_assigned: '/payroll/bank-readiness',
  exit_resignation_submitted: '/exit/command-center',
  resignation_submitted: '/exit/command-center',
  exit_auto_exited: '/exit/command-center',
  exit_revoked: '/exit/command-center',
  exit_lwd_approaching: '/exit/command-center',
  leave_pending_branch_head: '/leave-approvals',
  leave_approval_overdue: '/leave-approvals',
  leave_submitted: '/leave-approvals',
  regularization_stage2_pending: '/wfm-manager-approvals',
  esign_escalation_hr: '/ats/joining-documents-tracker',
  esign_escalation_manager: '/ats/joining-documents-tracker',
  esign_reminder: '/profile',
  rejoin_requested: '/employees/reactivation',
  rejoin_decided: '/employees/reactivation',
  rejoin_pending_reminder: '/employees/reactivation',
  rejoin_pending_escalation: '/employees/reactivation',
  rejoin_followup_attention: '/employees/reactivation',
  rejoin_blocked_at_joining: '/employees/reactivation',
};

const PREFIX: Array<[string, string]> = [
  ['payroll_run_', '/payroll'],
  ['exit_', '/exit-management'],
  ['regularization_', '/attendance-regularization'],
  ['grn_', '/finance/grn'],
  ['noc_', '/payroll/noc'],
  ['leave_', '/leaves'],
];

/** Bare path for an event, or '' when the event has no sensible landing page. */
export function linkForEvent(eventCode: string): string {
  if (EXACT[eventCode]) return EXACT[eventCode];
  for (const [prefix, path] of PREFIX) if (eventCode.startsWith(prefix)) return path;
  return '';
}

export function absoluteAppUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const base = String(env.FRONTEND_URL).replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** An explicit link in the event data wins; otherwise the event's default landing page. */
export function resolveActionUrl(eventCode: string, data: Record<string, unknown>): string {
  const explicit = data.action_url ?? data.actionUrl;
  if (typeof explicit === 'string' && explicit.trim()) return absoluteAppUrl(explicit.trim());
  return absoluteAppUrl(linkForEvent(eventCode));
}

/**
 * Make sure the mail carries the link. A DB template that already references the URL is
 * left alone; otherwise a button is appended (and the URL added to the text part).
 */
export function withActionLink(
  html: string,
  text: string | undefined,
  url: string,
): { html: string; text: string | undefined } {
  if (!url || html.includes(url)) return { html, text };
  const button =
    `<p style="margin:20px 0 0"><a href="${url}" ` +
    `style="display:inline-block;background:#073f78;color:#ffffff;text-decoration:none;` +
    `padding:10px 20px;border-radius:6px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;` +
    `font-size:14px;font-weight:600">Open in HRMS</a></p>` +
    `<p style="margin:8px 0 0;font-size:12px;color:#6b7280">If the button does not work, copy this link: ${url}</p>`;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  const nextHtml = idx >= 0 ? `${html.slice(0, idx)}${button}${html.slice(idx)}` : `${html}${button}`;
  const nextText = text !== undefined ? `${text}\n\nOpen in HRMS: ${url}` : text;
  return { html: nextHtml, text: nextText };
}
