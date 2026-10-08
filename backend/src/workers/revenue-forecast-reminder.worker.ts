/**
 * Revenue Forecast Reminder Worker (owner requirement 2026-10-06).
 *
 * Branch Heads forecast next month's revenue per cost centre by the 26th. Reminder only — nothing
 * is blocked. Runs daily at 09:00 IST:
 *   - 20th–26th: each Branch Head whose branch still has cost centres with no forecast, a draft or
 *     a returned one for next month gets a Work Inbox item (inboxService de-duplicates on user +
 *     type + entity + url, so it is one open item per branch per month, not one a day).
 *   - 27th: each Finance Head gets one item per branch still overdue.
 * Same capped-setTimeout shape as budget-closure-reminder.worker.ts.
 */
import { resolveRoleHolderUserIds } from "../shared/recipient-resolver.js";
import { inboxService } from "../modules/inbox/inbox.service.js";
import { revenueForecastService } from "../modules/process-pnl/revenue-forecast.service.js";
import { registerTimer, unregisterTimer } from "./worker-utils.js";

const WORKER_NAME = "revenue-forecast-reminder";
let scheduledTimer: NodeJS.Timeout | null = null;

function istNow(): Date {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

/** YYYY-MM of next month in IST — the month being forecast. */
export function forecastPeriodIST(now: Date = istNow()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 7);
}

/** ms until the next 09:00 IST (03:30 UTC). Always under 24 h. */
function msUntilNext0900IST(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 30, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

const NOT_SUBMITTED = new Set<string>(["missing", "draft", "rejected"]);

type Pending = { branchId: string; branchName: string; count: number; codes: string[] };

/** Branches with cost centres still to forecast (no forecast, draft or returned) for `period`. */
export async function pendingByBranch(period: string): Promise<Pending[]> {
  const { rows } = await revenueForecastService.list(period, null);
  const map = new Map<string, Pending>();
  for (const r of rows) {
    if (!r.branchId || !NOT_SUBMITTED.has(String(r.status))) continue;
    const p: Pending = map.get(r.branchId) ?? { branchId: r.branchId, branchName: r.branchName ?? r.branchId, count: 0, codes: [] };
    p.count += 1;
    if (p.codes.length < 5 && r.costCentreCode) p.codes.push(r.costCentreCode);
    map.set(r.branchId, p);
  }
  return [...map.values()];
}

export async function runRevenueForecastReminders(now: Date = istNow()): Promise<number> {
  const day = now.getUTCDate();
  if (day < 20 || day > 27) return 0;
  const period = forecastPeriodIST(now);
  const pending = await pendingByBranch(period);
  const dueText = `26 ${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 26)).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}`;
  let sent = 0;
  for (const p of pending) {
    const list = `${p.codes.join(", ")}${p.count > p.codes.length ? ` and ${p.count - p.codes.length} more` : ""}`;
    const recipients = day <= 26
      ? await resolveRoleHolderUserIds("branch_head", p.branchId).catch(() => [] as string[])
      : await resolveRoleHolderUserIds("finance_head", null).catch(() => [] as string[]);
    for (const userId of recipients) {
      try {
        await inboxService.createItem({
          user_id: userId,
          type: day <= 26 ? "REVENUE_FORECAST_DUE" : "REVENUE_FORECAST_OVERDUE",
          title: day <= 26
            ? `Revenue forecast for ${period} due by ${dueText} — ${p.branchName}`
            : `Revenue forecast overdue for ${period} — ${p.branchName}`,
          description: `${p.count} cost centre(s) not yet submitted: ${list}.`,
          entity_type: "revenue_forecast_branch_period",
          entity_id: `${p.branchId}:${period}`,
          action_url: `/finance/revenue-forecast?period=${period}`,
          priority: day >= 25 ? "high" : "medium",
        });
        sent++;
      } catch (err) {
        console.warn(`[${WORKER_NAME}] inbox item failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  console.log(`[${WORKER_NAME}] ${period}: ${pending.length} branch(es) pending, ${sent} reminder(s) sent.`);
  return sent;
}

export async function startRevenueForecastReminderWorker(): Promise<void> {
  const delay = msUntilNext0900IST();
  scheduledTimer = setTimeout(async () => {
    try {
      await runRevenueForecastReminders();
    } catch (err) {
      console.error(`[${WORKER_NAME}] Error:`, err instanceof Error ? err.message : String(err));
    }
    await startRevenueForecastReminderWorker();
  }, delay);
  registerTimer(`${WORKER_NAME}-scheduled`, scheduledTimer);
}

export function stopRevenueForecastReminderWorker(): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    unregisterTimer(`${WORKER_NAME}-scheduled`);
    scheduledTimer = null;
  }
}
