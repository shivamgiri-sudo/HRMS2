import { isWorkerEnabled, markWorkerRun } from '../shared/worker-config.js';
import { upsertOpenWorkItem } from '../shared/workItem.js';
import {
  PENDENCY_KINDS, describeSkip, listPendingEmployeeIds, sendPendencyReminders, MAX_REMINDERS,
  type PendencyKind,
} from '../modules/payroll/pendency/pendency.service.js';

/**
 * Daily pendency follow-ups (ESI documents, bank account, DigiLocker).
 *
 * OFF BY DEFAULT. Sending mail to employees is outward-facing, so this does nothing until
 * PENDENCY_REMINDER_MODE is set deliberately:
 *   off      (default) — the worker starts and does nothing
 *   dry-run  — evaluates every rule and logs how many mails WOULD go out; sends nothing,
 *              writes no pendency_reminder_log row
 *   live     — sends. The 3-day gap and 5-reminder cap per employee and kind come from
 *              pendency_reminder_log, so a restart or a second run cannot double-send.
 *
 * After the cap, the employee is handed to a person: a work-inbox item for Payroll HR
 * (one per employee and kind, idempotent) instead of a sixth email.
 */
const WORKER = 'pendency-reminder';
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const RUN_HOUR_IST = 10;
/** Per kind, per run — a ceiling on mail volume, not on the population. */
const BATCH_LIMIT = 100;

export type PendencyMode = 'off' | 'dry-run' | 'live';

export function readMode(raw: string | undefined = process.env.PENDENCY_REMINDER_MODE): PendencyMode {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'live' || v === 'dry-run' ? v : 'off';
}

/** IST calendar date (YYYY-MM-DD) and hour for a given instant. */
export function istParts(now: Date): { date: string; hour: number } {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return { date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours() };
}

const ESCALATION_TITLE: Record<PendencyKind, string> = {
  esi_docs: 'ESI documents still missing after 5 reminders',
  bank_account: 'Bank details still missing after 5 reminders',
  digilocker: 'DigiLocker verification still pending after 5 reminders',
};

let intervalRef: ReturnType<typeof setInterval> | undefined;
let lastRunDate = '';

export async function runPendencyReminders(mode: PendencyMode, now = new Date()): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = { mode };
  for (const kind of PENDENCY_KINDS) {
    const ids = await listPendingEmployeeIds(kind, BATCH_LIMIT);
    const results = await sendPendencyReminders({
      kind, employeeIds: ids, sentBy: null, trigger: 'scheduler', now, dryRun: mode === 'dry-run',
    });
    const count = (s: string) => results.filter((r) => r.status === s).length;
    summary[kind] = {
      pending: ids.length,
      sent: count('sent'),
      would_send: count('would_send'),
      failed: count('failed'),
      skipped: count('skipped'),
    };

    if (mode === 'live') {
      for (const r of results.filter((x) => x.reason === 'max_reminders_reached')) {
        await upsertOpenWorkItem({
          itemType: `PENDENCY_${kind.toUpperCase()}_ESCALATION`,
          title: ESCALATION_TITLE[kind],
          moduleCode: 'payroll',
          entityType: 'employee',
          entityId: r.employee_id,
          assignedToRole: 'payroll_hr',
          priority: 'normal',
          description: `${r.employee_code ?? r.employee_id}: ${MAX_REMINDERS} automatic reminders sent. ${describeSkip('max_reminders_reached')}`,
        }).catch((e) => console.error('[pendency-reminder] escalation failed', (e as Error).message));
      }
    }
  }
  return summary;
}

async function tick(): Promise<void> {
  const mode = readMode();
  if (mode === 'off') return;
  if (!(await isWorkerEnabled(WORKER))) return;
  const { date, hour } = istParts(new Date());
  if (hour !== RUN_HOUR_IST || lastRunDate === date) return;
  lastRunDate = date;
  try {
    const summary = await runPendencyReminders(mode);
    console.log(`[pendency-reminder] ${JSON.stringify(summary)}`);
    await markWorkerRun(WORKER);
  } catch (err) {
    console.error('[pendency-reminder] run failed', (err as Error).message);
  }
}

export function startPendencyReminderWorker(): void {
  console.log(`[pendency-reminder] Starting — mode=${readMode()} (set PENDENCY_REMINDER_MODE=dry-run|live to enable)`);
  intervalRef = setInterval(() => { void tick(); }, CHECK_INTERVAL_MS);
}

export function stopPendencyReminderWorker(): void {
  if (intervalRef) { clearInterval(intervalRef); intervalRef = undefined; }
}
