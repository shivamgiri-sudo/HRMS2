/**
 * Daily recruiter productivity report — its own scheduler, on its own switch.
 *
 * WHY THIS FILE EXISTS
 *
 *   ats-daily-report.service.ts's header says the report is "Called by the 6 PM cron in
 *   ats-reminders.cron.ts". It is not, and there is no 6 PM cron.
 *   startAtsRemindersScheduler() schedules exactly two jobs — 9 PM (onboarding +
 *   joining-docs reminders) and 8 AM (joining-date + approval nudge) — and neither
 *   touches runDailyHiringReport(). Every one of its call sites was a manual or test
 *   route, so a report described as daily had never run on a schedule at all.
 *
 *   Simply adding it to startAtsRemindersScheduler would not have fixed it either,
 *   because that whole scheduler is gated behind ATS_REMINDERS_ENABLED, which is
 *   deliberately unset: switching it on also releases an onboarding reminder burst
 *   across ~299 bridge rows stuck at 'pending', some months old, to people who have
 *   since joined or dropped out. server.ts's comment is explicit that enabling it is
 *   the owner's call.
 *
 *   So the report was held hostage by an unrelated job sharing one switch. It gets its
 *   own flag here, and the reminder burst stays exactly as locked as it was.
 *
 * Registered in BOTH all-workers.ts and server.ts. Registering in only one is how
 * ats-reminders.cron.ts came to never run in production.
 */
import { runDailyHiringReport } from './ats-reminders.cron.js';

const WORKER_NAME = 'ats-daily-report';
const HOUR_MS = 60 * 60 * 1000;
/** 6 PM IST — after the working day, matching what the service was always meant to do. */
const TARGET_HOUR = 18;

let _timer: ReturnType<typeof setTimeout> | null = null;
let _started = false;

/** Milliseconds until the next occurrence of `hour` in server-local time. */
function nextRunDelay(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startAtsDailyReportScheduler(): void {
  if (_started) return;
  _started = true;

  const run = () => {
    // No date argument: runDailyHiringReport defaults to the current day. The manual
    // routes pass a hardcoded '2026-08-24', which is fine for a one-off test and would
    // be a bug on a schedule — a daily report that always reports the same day.
    runDailyHiringReport()
      .then((r: any) => {
        if (r?.success) {
          console.log(`[${WORKER_NAME}] sent to ${r.recipients}`);
        } else {
          console.warn(`[${WORKER_NAME}] completed without sending:`, r?.error ?? 'no reason given');
        }
      })
      .catch((e: unknown) =>
        console.error(`[${WORKER_NAME}] job error:`, (e as Error).message),
      );
    _timer = setTimeout(run, 24 * HOUR_MS);
  };

  _timer = setTimeout(run, nextRunDelay(TARGET_HOUR));
  console.log(`[${WORKER_NAME}] scheduled — daily at ${TARGET_HOUR}:00`);
}

export function stopAtsDailyReportScheduler(): void {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _started = false;
  console.log(`[${WORKER_NAME}] stopped`);
}
