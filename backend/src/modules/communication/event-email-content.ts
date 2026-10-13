/**
 * Readable email content for gateway events that have no communication_template.
 *
 * fallbackBody() used to dump the first 12 payload keys as `snake case` / **raw value** rows with
 * a "this notification has no template" apology, so every untemplated event arrived looking like a
 * debug print: no sentence saying what happened or what to do, ISO timestamps, unformatted money,
 * and anything past the 12th key silently dropped. This module supplies per-event copy (headline,
 * intro, call to action) plus a generic labeller/formatter for the payload, so an event is
 * complete the day it is wired, template or not. A real template still wins when one resolves.
 */

export interface EventCopy {
  /** Headline and subject. `{key}` is replaced from the payload; a missing key drops its token. */
  title: string;
  /** One or two sentences: what happened and what the reader should do. */
  intro: string;
  /** Button text. The URL comes from the first present key in URL_KEYS. */
  cta?: string;
}

export const EVENT_COPY: Record<string, EventCopy> = {
  // Leave
  leave_submitted: { title: 'Leave request — {employee_name} ({employee_code})', intro: 'A leave request is waiting for your decision. Details are below; please approve or reject it in HRMS.', cta: 'Review leave request' },
  leave_pending_branch_head: { title: 'Leave needs Branch Head approval — {employee_name} ({employee_code})', intro: 'This request has been escalated to you because it falls outside the standard approval limit. The policy rule that triggered it is listed below.', cta: 'Review leave request' },
  leave_approval_overdue: { title: 'Leave approval overdue — {employee_name} ({employee_code})', intro: 'This leave request is still pending your decision. Reminder #{reminder_no}. Please act on it today so the employee can plan.', cta: 'Review leave request' },
  // Attendance
  regularization_submitted: { title: 'Attendance regularization — {employee_name} ({employee_code})', intro: 'An attendance regularization request has been raised and needs your review.', cta: 'Review request' },
  regularization_stage2_pending: { title: 'Regularization awaiting final approval — {employee_name} ({employee_code})', intro: 'Stage 1 is complete. This request now needs your final approval; the queue position is shown below.', cta: 'Review request' },
  regularization_decision: { title: 'Attendance regularization {decision} — {date}', intro: 'Your attendance regularization request has been reviewed. The decision and the reviewer\'s note are below.', cta: 'View attendance' },
  // Roster
  roster_published: { title: 'Your roster for {week} is published', intro: 'Your roster is ready. Please review your shifts and acknowledge it before the deadline.', cta: 'View and acknowledge roster' },
  shift_changed: { title: 'Your shift on {roster_date} has changed', intro: 'A shift in your published roster has been changed. The old and new shift are shown below.', cta: 'View roster' },
  // Payroll
  payslip_ready: { title: 'Your payslip for {run_month} is ready', intro: 'Your payslip is available in HRMS. For security the figures below are a summary; open HRMS for the full breakdown.', cta: 'View payslip' },
  salary_advance_recovery: { title: 'Salary advance recovered in {run_month}', intro: 'An advance has been recovered from your {run_month} salary. The amount and resulting net pay are below.', cta: 'View payslip' },
  salary_increment_letter: { title: 'Salary increment — {employee_name} ({employee_code})', intro: 'A salary revision has been issued. The revised and previous CTC and the effective date are below.', cta: 'View increment' },
  payroll_window_closing: { title: 'Payroll window for {run_month} closes on {window_close_date}', intro: 'Submit any pending inputs (attendance corrections, incentives, deductions) before the window closes; changes after that need a payroll exception.', cta: 'Open payroll' },
  statutory_opt_out_submitted: { title: 'Statutory opt-out request submitted — {override_type}', intro: 'A statutory deduction opt-out request has been submitted and is awaiting a decision.', cta: 'Review request' },
  statutory_opt_out_decided: { title: 'Statutory opt-out {decision} — {override_type}', intro: 'Your statutory deduction request has been decided. The outcome and effective month are below.', cta: 'View request' },
  statutory_opt_out_revoked: { title: 'Statutory opt-out revoked — {override_type}', intro: 'A statutory deduction opt-out has been revoked and normal deductions will resume.', cta: 'View request' },
  bank_exception_invalid_assigned: { title: 'Bank verification exception assigned — {employee_name} ({employee_code})', intro: 'A bank account verification failed for this employee and has been assigned to you. Please correct the details or contact the employee so salary is not held.', cta: 'Open exception' },
  // Exit / NOC
  resignation_submitted: { title: 'Resignation submitted — {employee_name} ({employee_code})', intro: 'A resignation has been submitted. Please hold the manager discussion and record the outcome in HRMS.', cta: 'Open resignation' },
  exit_resignation_submitted: { title: 'Resignation submitted — {employee_name}', intro: 'Your resignation has been recorded. The proposed last working day is below; HR will confirm it after the manager discussion.', cta: 'View exit status' },
  exit_revoked: { title: 'Resignation revoked — {employee_name}', intro: 'The resignation below has been withdrawn and the exit process has been stopped.', cta: 'View exit record' },
  exit_auto_exited: { title: 'Employee auto-exited — {employee_name}', intro: 'The employee has been moved to exited status automatically after the last working day. Access and pending clearances should now be closed out.', cta: 'View exit record' },
  exit_lwd_approaching: { title: 'Last working day approaching — {employee_name} ({employee_code})', intro: 'The last working day is {days_to_lwd} day(s) away. Clearances still open are listed below; please close them before the date.', cta: 'Open exit case' },
  exit_ff_approved: { title: 'Full & Final settlement approved', intro: 'Your full and final settlement has been approved. The net payable amount is below; it will be credited in the next payment cycle.', cta: 'View settlement' },
  full_final_ready: { title: 'Full & Final statement ready — {employee_name} ({employee_code})', intro: 'The full and final statement is ready. The settlement components are below.', cta: 'View statement' },
  noc_invite_sent: { title: 'Complete your No-Dues Clearance (NOC) form', intro: 'Please fill in your NOC form so each department can clear you. The link is personal and expires on the date below.', cta: 'Open NOC form' },
  noc_employee_submitted: { title: 'NOC form submitted — {employee_name} ({employee_code})', intro: 'The employee has submitted their NOC form. Department clearance can now begin.', cta: 'Open NOC case' },
  noc_signatory_pending: { title: 'NOC clearance needed — {employee_name} ({employee_code})', intro: 'Your clearance is required for this employee ({stage_label}). Verify the items below and approve or decline within the SLA.', cta: 'Review and clear' },
  noc_signatory_reminder: { title: 'NOC clearance pending — {employee_name} ({employee_code})', intro: 'This clearance ({stage_label}) is past or close to its SLA. Please complete it so the employee\'s settlement is not delayed.', cta: 'Review and clear' },
  noc_declined: { title: 'NOC declined at {stage_label} — {employee_name} ({employee_code})', intro: 'A department has declined clearance. The reason is below; the case cannot progress until it is resolved.', cta: 'Open NOC case' },
  noc_completed: { title: 'NOC completed — {employee_name} ({employee_code})', intro: 'All departments have cleared this employee. The full and final settlement can now proceed.', cta: 'Open NOC case' },
  // Finance
  grn_submitted: { title: 'GRN {grn_reference} raised — {amount}', intro: 'A GRN has been raised for your branch and needs your approval as Branch Head.', cta: 'Review GRN' },
  grn_accounts_head_pending: { title: 'GRN {grn_reference} awaiting Accounts approval — {amount}', intro: 'The Branch Head has approved this GRN. It now needs your approval as Accounts Head.', cta: 'Review GRN' },
  grn_approval_overdue: { title: 'GRN {grn_reference} pending {pending_stage} approval — {amount}', intro: 'This GRN has been waiting at the {pending_stage} stage. Reminder #{reminder_no}. Please approve or reject it.', cta: 'Review GRN' },
  // Governance / provisioning / learning
  provisioning_overdue: { title: 'IT provisioning overdue — {employee_name} ({employee_code})', intro: 'The task below is {hours_overdue} hour(s) past its SLA. Please complete it or reassign it today; the new joiner is waiting.', cta: 'Open task' },
  task_sla_breach_l3: { title: 'SLA breached — {task_code}', intro: 'This task has breached its SLA through two earlier escalation levels and now needs branch-level attention.', cta: 'Open task' },
  sla_breach_weekly_digest: { title: 'Weekly SLA breach digest', intro: 'Tasks that breached their SLA this week are summarised below.', cta: 'Open dashboard' },
  training_reminder_nudge: { title: 'Training reminder — {skill_category}', intro: 'You have a pending training in this skill area. Please complete it before the due date.', cta: 'Open training' },
};

const LABELS: Record<string, string> = {
  employee_name: 'Employee', employee_code: 'Employee code', process_name: 'Process', branch_name: 'Branch',
  reporting_manager_name: 'Reporting manager', designation: 'Designation', location: 'Location',
  leave_type: 'Leave type', dates: 'Dates', days: 'Days', taken_ytd: 'Taken this year', policy_rule: 'Policy rule',
  reminder_no: 'Reminder number', reason: 'Reason', reason_category: 'Reason category', remarks: 'Remarks',
  session_date: 'Date', date: 'Date', current_status: 'Current status', requested_status: 'Requested status',
  decision: 'Decision', reviewer_name: 'Reviewed by', reviewer_note: 'Reviewer note', days_corrected: 'Days corrected',
  attendance_pct_mtd: 'Attendance this month', present_days_mtd: 'Present days this month', working_days_mtd: 'Working days this month',
  queue_depth: 'Requests in queue', oldest_pending: 'Oldest pending since',
  week: 'Week', week_start: 'Week starts', week_end: 'Week ends', shifts: 'Shifts', week_offs: 'Week-offs', nights: 'Night shifts',
  holidays: 'Holidays', ack_deadline: 'Acknowledge by', roster_date: 'Date', from_shift: 'Earlier shift', to_shift: 'New shift',
  notice_hours: 'Notice given (hours)',
  run_month: 'Salary month', net_pay: 'Net pay', gross_pay: 'Gross pay', lop_days: 'LOP days', advance_recovery: 'Advance recovered',
  proposed_ctc: 'Revised CTC (annual)', current_ctc: 'Current CTC (annual)', increment_percentage: 'Increment', effective_from: 'Effective from',
  window_close_date: 'Window closes', override_type: 'Deduction', effective_from_month: 'Effective from month',
  readiness_class: 'Failure class', assigned_to: 'Assigned to',
  proposed_lwd: 'Proposed last working day', lwd: 'Last working day', confirmed_lwd: 'Confirmed last working day', last_working_day: 'Last working day',
  days_to_lwd: 'Days to last working day', days_to_proposed_lwd: 'Days to proposed last day', notice_period_days: 'Notice period (days)',
  tenure_years: 'Tenure (years)', clearance_pending: 'Clearances pending', clearance_departments: 'Pending departments',
  revoke_reason: 'Revoked because', resignation_date: 'Resignation date', fnf_option: 'F&F option',
  net_payable: 'Net payable', gratuity_amount: 'Gratuity', notice_recovery: 'Notice recovery', earned_leave_encashment: 'Leave encashment',
  salary_hold: 'Salary on hold', advances_recovery: 'Advances recovered',
  stage_label: 'Clearance stage', verify_hint: 'What to verify', sla_due_at: 'Due by', decline_reason: 'Decline reason', expires_on: 'Link expires on',
  grn_reference: 'GRN', amount: 'Amount (incl. tax)', head: 'Head', sub_head: 'Sub-head', bill_date: 'Bill date', vendor_name: 'Vendor',
  raised_by: 'Raised by', pending_stage: 'Pending at',
  task_code: 'Task', assigned_role: 'Assigned role', status: 'Status', hours_overdue: 'Hours overdue', unassigned: 'Unassigned',
  skill_category: 'Skill area', document_name: 'Document', days_pending: 'Days pending', deadline: 'Link expires',
};

/** Keys that are plumbing, not facts for the reader. */
const HIDDEN = new Set(['employee_id', 'exit_request_id', 'action_url', 'noc_case_url', 'noc_form_url', 'reference', 'remarks_dup']);
/** Payload keys that may carry the button target, in priority order. */
export const URL_KEYS = ['action_url', 'noc_form_url', 'noc_case_url'] as const;

const MONEY = /(ctc|net_pay|gross_pay|payable|gratuity|recovery|encashment|salary_hold|^amount$)/;
const PERCENT = /(pct|percentage)/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function escapeHtml(v: unknown): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function prettyLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  });
}

export function formatValue(key: string, v: unknown, asTitle = false): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return null;
  let s = String(v).trim();
  if (s === '' || s === '—') return null;
  if (ISO_DATE.test(s)) return fmtDate(s);
  if (typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(s) || (MONEY.test(key) && /^-?[\d,]+(\.\d+)?$/.test(s))) {
    const n = Number(s.replace(/,/g, ''));
    if (MONEY.test(key)) return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    if (PERCENT.test(key)) return `${n}%`;
  }
  if (key === 'decision' && !asTitle) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

function fillTokens(tpl: string, data: Record<string, unknown>): string {
  return tpl
    .replace(/\s*[—-]?\s*\(?\{(\w+)\}\)?/g, (tok, k: string) => {
      const val = formatValue(k, data[k], true);
      return val ? tok.replace(/\{\w+\}/, val) : '';
    })
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+—\s*$/, '')
    .trim();
}

export interface RenderedEvent { subject: string; html: string; text: string; }

export function renderEventEmail(eventCode: string, data: Record<string, unknown>, baseUrl: string): RenderedEvent {
  const copy = EVENT_COPY[eventCode];
  const titleFallback = eventCode.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const title = copy ? fillTokens(copy.title, data) || titleFallback : titleFallback;
  const intro = copy
    ? copy.intro.replace(/\{(\w+)\}/g, (_t, k: string) => formatValue(k, data[k]) ?? '—')
    : '';

  const facts = Object.entries(data)
    .filter(([k]) => !k.startsWith('__') && !HIDDEN.has(k))
    .map(([k, v]) => [k, formatValue(k, v)] as const)
    .filter((e): e is readonly [string, string] => e[1] !== null);
  // A remarks/reviewer_note pair that carry the same text would print twice.
  const seen = new Set<string>();
  const ORDER = ['employee_name', 'employee_code', 'designation', 'process_name', 'branch_name', 'location', 'reporting_manager_name'];
  const rank = (k: string) => { const i = ORDER.indexOf(k); return i < 0 ? ORDER.length : i; };
  const ordered = [...facts].sort((a, b) => rank(a[0]) - rank(b[0]));
  const rows = ordered.filter(([k, v]) => {
    const sig = `${prettyLabel(k)}|${v}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    if (k === 'remarks' && facts.some(([k2, v2]) => k2 === 'reviewer_note' && v2 === v)) return false;
    if (k === 'session_date' && facts.some(([k2, v2]) => k2 === 'date' && v2 === v)) return false;
    return true;
  });

  const urlKey = URL_KEYS.find((k) => typeof data[k] === 'string' && String(data[k]).trim());
  let url = urlKey ? String(data[urlKey]).trim() : '';
  if (url && !/^https?:\/\//i.test(url)) url = `${baseUrl.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;

  const tableRows = rows
    .map(([k, v]) =>
      `<tr><td style="padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;color:#475569;font-size:13px;width:38%">${escapeHtml(prettyLabel(k))}</td>` +
      `<td style="padding:8px 12px;border:1px solid #e2e8f0;color:#0f172a;font-size:14px">${escapeHtml(v)}</td></tr>`)
    .join('');
  const button = url && copy?.cta
    ? `<p style="margin:22px 0 6px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#1B6AB5;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;font-size:14px">${escapeHtml(copy.cta)}</a></p>`
    : url
      ? `<p style="margin:22px 0 6px"><a href="${escapeHtml(url)}" style="color:#1B6AB5">Open in HRMS</a></p>`
      : '';

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:620px;color:#0f172a">` +
    `<div style="background:#1B6AB5;color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase">MAS Callnet · PeopleOS</div>` +
    `<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;padding:22px 20px">` +
    `<h2 style="margin:0 0 10px;font-size:19px;line-height:1.3">${escapeHtml(title)}</h2>` +
    (intro ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155">${escapeHtml(intro)}</p>` : '') +
    (tableRows ? `<table style="border-collapse:collapse;width:100%">${tableRows}</table>` : '') +
    button +
    `<p style="margin:22px 0 0;font-size:12px;color:#64748b">You are receiving this from MAS Callnet PeopleOS because of your role or involvement in the above. ` +
    `If it reached you in error, please tell HR Systems.</p></div></div>`;

  const text =
    `${title}\n\n${intro ? `${intro}\n\n` : ''}` +
    rows.map(([k, v]) => `${prettyLabel(k)}: ${v}`).join('\n') +
    (url ? `\n\n${copy?.cta ?? 'Open in HRMS'}: ${url}` : '') +
    `\n\nMAS Callnet PeopleOS`;

  return { subject: `MAS Callnet HRMS — ${title}`, html, text };
}
