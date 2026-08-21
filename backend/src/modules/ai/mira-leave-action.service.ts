/**
 * Mira's first write-capable action: parse a free-text leave request, hold it as a
 * draft, and only submit it once the same user explicitly confirms in the next chat
 * turn. Every rule that actually decides whether a leave request is valid — gender
 * eligibility, day-count classification, CL/ML/EL policy caps, the overlap/lock guard
 * — lives in leave.service.ts's submitRequest() and is never duplicated here. This
 * file's only job is turning natural language into that function's input shape, and
 * holding it long enough for a "yes" to arrive.
 *
 * Mirrors the confirm-then-materialize shape team-attendance-month.routes.ts already
 * uses for manager_raised_request (1545_manager_raised_request.sql) — same principle
 * (draft, then call the real service on confirm, no duplicated business logic) — but
 * that flow is cross-person with an async employee-consent inbox item; this one is the
 * same user confirming themselves in the same chat, so it stays in the lightweight,
 * in-memory conversation thread (ai-conversation.service.ts) rather than a DB table,
 * and the DB only records what happened, via mira_action_audit_log
 * (1546_mira_action_audit_log.sql).
 */

import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getEmployeeForUser } from '../../shared/accessGuard.js';
import { leaveService } from '../leave/leave.service.js';
import { leaveRequestSchema } from '../leave/leave.validation.js';
import { checkActionSafety } from './mira-action-guard.js';
import {
  setPendingAction,
  getPendingAction,
  clearPendingAction,
  type PendingLeaveAction,
} from './ai-conversation.service.js';

const MIRA_ACTIONS_ENABLED = process.env.MIRA_ACTIONS_ENABLED === 'true';

export function miraActionsEnabled(): boolean {
  return MIRA_ACTIONS_ENABLED;
}

const LEAVE_ACTION_VERB_PATTERN = /\b(raise|apply|request|book|file|submit)\b[^.?!]{0,25}\bleaves?\b/i;
const LEAVE_ACTION_DATE_PATTERN = /\bleaves?\b[^.?!]{0,15}\b(?:for|on|from)\b[^.?!]{0,10}\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/**
 * Distinguishes "raise leave for 23rd August" (an action request) from the existing
 * read-only self-account intents ("leave balance", "my leaves", "status of my
 * leave") in ai-account.service.ts's INTENTS table — deliberately requires either an
 * explicit action verb or a concrete date, so a plain balance question is never
 * misrouted into drafting a submission.
 */
export function isLeaveActionRequest(text: string): boolean {
  return LEAVE_ACTION_VERB_PATTERN.test(text) || LEAVE_ACTION_DATE_PATTERN.test(text);
}

export interface DraftResult {
  ok: boolean;
  summary?: string;
  clarifyingQuestion?: string;
  error?: string;
}

export interface ConfirmResult {
  ok: boolean;
  message: string;
  leaveRequestId?: string;
}

// ── Date parsing ─────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function todayIST(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kolkata',
  }).formatToParts(new Date());
  return {
    y: Number(parts.find((p) => p.type === 'year')?.value),
    m: Number(parts.find((p) => p.type === 'month')?.value),
    d: Number(parts.find((p) => p.type === 'day')?.value),
  };
}

function toISODate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Finds every "23rd August" / "23 Aug" style date mention plus bare "today"/
 * "tomorrow", in the order they appear. No year in the phrasing is resolved against
 * the current IST date, rolling to next year only if that exact day has already
 * passed — "raise leave for 23rd Aug" said in September means next year, not last
 * month.
 */
function findDates(text: string): string[] {
  const today = todayIST();
  const found: Array<{ index: number; iso: string }> = [];

  const dayMonthPattern = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(\d{4}))?/gi;
  let match: RegExpExecArray | null;
  while ((match = dayMonthPattern.exec(text)) !== null) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    if (!month || day < 1 || day > 31) continue;
    let year = match[3] ? Number(match[3]) : today.y;
    if (!match[3]) {
      const candidate = new Date(Date.UTC(year, month - 1, day));
      const todayUtc = new Date(Date.UTC(today.y, today.m - 1, today.d));
      if (candidate.getTime() < todayUtc.getTime()) year += 1;
    }
    found.push({ index: match.index, iso: toISODate(year, month, day) });
  }

  if (/\btomorrow\b/i.test(text) && !found.length) {
    const t = new Date(Date.UTC(today.y, today.m - 1, today.d + 1));
    found.push({ index: text.search(/\btomorrow\b/i), iso: toISODate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) });
  }
  if (/\btoday\b/i.test(text) && !found.length) {
    found.push({ index: text.search(/\btoday\b/i), iso: toISODate(today.y, today.m, today.d) });
  }

  return found.sort((a, b) => a.index - b.index).map((f) => f.iso);
}

// ── Leave type resolution ───────────────────────────────────────────────────────

const LEAVE_KEYWORDS: Array<{ pattern: RegExp; codes: string[] }> = [
  { pattern: /\bcasual\b/i, codes: ['CL'] },
  { pattern: /\b(sick|medical)\b/i, codes: ['ML'] },
  { pattern: /\b(earned|privilege)\b/i, codes: ['EL'] },
  { pattern: /\bmaternity\b/i, codes: ['MTRL'] },
  { pattern: /\bpaternity\b/i, codes: ['PL', 'PTRL'] },
];

interface LeaveTypeRow extends RowDataPacket {
  id: string;
  leave_code: string;
  leave_name: string;
}

async function resolveLeaveType(text: string): Promise<{ type?: LeaveTypeRow; options?: LeaveTypeRow[] }> {
  const [rows] = await db.execute<LeaveTypeRow[]>(
    `SELECT id, leave_code, leave_name FROM leave_type_master WHERE active_status = 1 ORDER BY leave_name`,
  );
  for (const { pattern, codes } of LEAVE_KEYWORDS) {
    if (pattern.test(text)) {
      const found = rows.find((row) => codes.includes(row.leave_code));
      if (found) return { type: found };
    }
  }
  return { options: rows };
}

// ── Reason extraction (best-effort; optional field on the real schema) ──────────

function extractReason(text: string): string | null {
  const match = text.match(/\b(?:because|reason:?|for)\s+([^.?!]{5,120})/i);
  return match ? match[1].trim() : null;
}

function chargeableDayCount(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00Z`).getTime();
  const to = new Date(`${toISO}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
}

function formatDateForSummary(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    .format(new Date(`${iso}T12:00:00+05:30`));
}

// ── Audit ─────────────────────────────────────────────────────────────────────

async function writeAudit(row: {
  userId: string;
  employeeId: string | null;
  status: 'drafted' | 'confirmed' | 'rejected' | 'submitted' | 'failed' | 'cancelled';
  payload?: unknown;
  guardReasons?: string[];
  leaveRequestId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO mira_action_audit_log
         (id, user_id, employee_id, action_type, status, payload, guard_reasons, leave_request_id, error_message)
       VALUES (?, ?, ?, 'leave_request', ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?)`,
      [
        randomUUID(), row.userId, row.employeeId, row.status,
        row.payload ? JSON.stringify(row.payload) : null,
        row.guardReasons?.length ? JSON.stringify(row.guardReasons) : null,
        row.leaveRequestId ?? null,
        row.errorMessage ?? null,
      ],
    );
  } catch (error) {
    // Audit failure must never block the actual action — log and move on, the way
    // every other AI audit call site in this module (aiAuditService.log*) already
    // does with a trailing .catch(() => {}).
    console.error('[Mira] failed to write action audit row', error instanceof Error ? error.message : error);
  }
}

// ── Draft / confirm / cancel ─────────────────────────────────────────────────────

export async function draftLeaveRequest(question: string, userId: string): Promise<DraftResult> {
  if (!MIRA_ACTIONS_ENABLED) {
    return { ok: false, error: "Mira can't submit requests on your behalf yet — please use the Leave page directly." };
  }

  const guard = checkActionSafety(question);
  if (!guard.safe) {
    await writeAudit({ userId, employeeId: null, status: 'rejected', payload: { question }, guardReasons: guard.reasons });
    return { ok: false, error: "I can't act on that request. Please use the Leave page directly, or rephrase asking only about your own leave." };
  }

  const employee = await getEmployeeForUser(userId);
  if (!employee?.id) {
    return { ok: false, error: 'Your login is not linked to an active employee record, so I cannot file a leave request for you.' };
  }

  const dates = findDates(question);
  if (!dates.length) {
    return { ok: false, clarifyingQuestion: "What date (or date range) would you like this leave for? For example, '23rd August' or '23 Aug to 25 Aug'." };
  }
  const fromDate = dates[0];
  const toDate = dates.length > 1 ? dates[dates.length - 1] : dates[0];
  if (toDate < fromDate) {
    return { ok: false, error: 'The date range you gave ends before it starts — please give me the earlier date first.' };
  }

  const { type, options } = await resolveLeaveType(question);
  if (!type) {
    const list = (options ?? []).slice(0, 6).map((o) => o.leave_name).join(', ');
    return { ok: false, clarifyingQuestion: `Which leave type is this — ${list || 'Casual, Earned, or Medical Leave'}?` };
  }

  const totalDays = chargeableDayCount(fromDate, toDate);
  const reason = extractReason(question);

  const payload: PendingLeaveAction['payload'] = {
    employeeId: employee.id,
    leaveTypeId: type.id,
    leaveTypeName: type.leave_name,
    fromDate,
    toDate,
    totalDays,
    reason,
  };

  // Cheap upfront sanity check with the real schema — a bad range or non-integer
  // day count is caught here rather than only surfacing after the user confirms.
  // The exhaustive business rules (gender eligibility, policy caps, overlap lock)
  // still only ever run inside leaveService.submitRequest() at confirm time —
  // this is shape validation, not policy.
  const parsed = leaveRequestSchema.safeParse({
    employeeId: payload.employeeId, leaveTypeId: payload.leaveTypeId,
    fromDate: payload.fromDate, toDate: payload.toDate,
    totalDays: payload.totalDays, reason: payload.reason,
  });
  if (!parsed.success) {
    return { ok: false, error: `I couldn't put together a valid request from that: ${parsed.error.issues[0]?.message ?? 'please check the dates.'}` };
  }

  setPendingAction(userId, { type: 'leave_request', payload, createdAt: Date.now() });
  await writeAudit({ userId, employeeId: employee.id, status: 'drafted', payload });

  const range = fromDate === toDate
    ? formatDateForSummary(fromDate)
    : `${formatDateForSummary(fromDate)} to ${formatDateForSummary(toDate)}`;
  const summary = `You'd like to request **${type.leave_name}** for ${range} (${totalDays} day${totalDays === 1 ? '' : 's'})` +
    `${reason ? `, reason: "${reason}"` : ''}. Nothing is submitted yet — I'll only file it once you confirm. Shall I go ahead?`;

  return { ok: true, summary };
}

export async function confirmLeaveAction(userId: string): Promise<ConfirmResult> {
  const pending = getPendingAction(userId);
  if (!pending) {
    return { ok: false, message: "I don't have a leave request waiting on your confirmation. Ask me to raise one first." };
  }

  await writeAudit({ userId, employeeId: pending.payload.employeeId, status: 'confirmed', payload: pending.payload });

  try {
    const input = leaveRequestSchema.parse({
      employeeId: pending.payload.employeeId, leaveTypeId: pending.payload.leaveTypeId,
      fromDate: pending.payload.fromDate, toDate: pending.payload.toDate,
      totalDays: pending.payload.totalDays, reason: pending.payload.reason,
    });
    const created = await leaveService.submitRequest(input, userId);
    clearPendingAction(userId);
    await writeAudit({ userId, employeeId: pending.payload.employeeId, status: 'submitted', payload: pending.payload, leaveRequestId: created.id });
    return {
      ok: true,
      message: `Done — your ${pending.payload.leaveTypeName} request for ${pending.payload.fromDate} to ${pending.payload.toDate} has been submitted and is now with your approver.`,
      leaveRequestId: created.id,
    };
  } catch (error) {
    clearPendingAction(userId);
    const message = error instanceof Error ? error.message : 'Something went wrong submitting that.';
    await writeAudit({ userId, employeeId: pending.payload.employeeId, status: 'failed', payload: pending.payload, errorMessage: message });
    return { ok: false, message: `I couldn't submit that: ${message}` };
  }
}

export async function cancelLeaveAction(userId: string): Promise<ConfirmResult> {
  const pending = getPendingAction(userId);
  clearPendingAction(userId);
  if (!pending) {
    return { ok: true, message: 'There was nothing pending to cancel.' };
  }
  await writeAudit({ userId, employeeId: pending.payload.employeeId, status: 'cancelled', payload: pending.payload });
  return { ok: true, message: 'Cancelled — nothing was submitted.' };
}
