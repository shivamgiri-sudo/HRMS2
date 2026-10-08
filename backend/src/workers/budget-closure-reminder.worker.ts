/**
 * Budget Closure Reminder Worker
 *
 * Owner requirement, 2026-08-21: every month's budget has to be closed, head/sub-head by
 * head/sub-head, by the 7th of the following month. This is a REMINDER only — confirmed against
 * the requirement's own wording, nothing here blocks or auto-closes anything. It fires on the 7th
 * of each month (IST) for the PREVIOUS month, and for every active budget still carrying an open
 * (unclosed) head/sub-head with at least one budget line, creates a Work Inbox item for that
 * branch's Branch Admin(s).
 *
 * Same scheduling shape as payroll-prep-reminder.worker.ts (capped setTimeout re-evaluated on
 * each wake, so Node's 32-bit setTimeout limit is never exceeded), pointed at the 7th instead of
 * the 1st.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { inboxService } from "../modules/inbox/inbox.service.js";
import { registerTimer, unregisterTimer } from "./worker-utils.js";

const WORKER_NAME = "budget-closure-reminder";

let scheduledTimer: NodeJS.Timeout | null = null;

/** Returns YYYY-MM for the previous calendar month in IST — the month that must be closed by
 *  the 7th of the CURRENT month. */
function previousMonthIST(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed, so this IS the previous month number
  if (m === 0) return `${y - 1}-12`;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** ms until next 7th of month at 08:00 IST (02:30 UTC). Capped at 24 days for the same reason
 *  payroll-prep-reminder.worker.ts's msUntilNext1st() is. */
function msUntilNext7th(): number {
  const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000 * 24;
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const next7th = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 7, 2, 30, 0, 0)
  );
  if (next7th.getTime() <= now.getTime()) {
    next7th.setUTCMonth(next7th.getUTCMonth() + 1);
  }
  const ms = next7th.getTime() - now.getTime();
  return Math.min(ms, MAX_TIMEOUT_MS);
}

/** Returns true only when today (IST) is the 7th of the month. */
function isTodayThe7th(): boolean {
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return istNow.getUTCDate() === 7;
}

async function runReminders(): Promise<void> {
  const period = previousMonthIST();
  console.log(`[${WORKER_NAME}] Checking business-case closure for ${period}...`);

  // Every active budget for the month that must be closed, with a count of its still-open
  // head/sub-heads (no closure row, or closure row not 'closed'). A head/sub-head with no line
  // is not counted — nothing to close if nothing was budgeted there.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT h.id AS budget_id, h.branch_id, bm.branch_name,
            COUNT(DISTINCT CONCAT(l.head, '|', COALESCE(l.sub_head, ''))) AS open_count
       FROM finance_budget_header h
       JOIN finance_budget_line l ON l.budget_id = h.id
       LEFT JOIN branch_master bm ON bm.id = h.branch_id
       LEFT JOIN finance_budget_subhead_closure c
         ON c.budget_id = h.id AND c.head = l.head AND c.sub_head = COALESCE(l.sub_head, '')
      WHERE h.period_code = ?
        AND h.status = 'active'
        AND (c.id IS NULL OR c.status <> 'closed')
      GROUP BY h.id, h.branch_id, bm.branch_name`,
    [period]
  );

  let sent = 0;
  for (const row of rows as Array<{ budget_id: string; branch_id: string; branch_name: string | null; open_count: number }>) {
    try {
      // Two-tier resolution, matching resolveFinanceBranchScopeSet's own precedence
      // (finance-access-scope.ts): an explicit user_assignment_scope branch grant first;
      // failing that, a branch_admin's own employee record's branch — "the behaviour every
      // finance user has today" per that file's own comment, so a branch_admin with no
      // explicit grant (the common case) is not silently skipped.
      const [branchAdmins] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT uas.user_id
           FROM user_assignment_scope uas
          WHERE uas.active_status = 1
            AND uas.role_key = 'branch_admin'
            AND uas.scope_type IN ('branch', 'branch_process')
            AND uas.branch_id = ?
         UNION
         SELECT DISTINCT u.id AS user_id
           FROM auth_user u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN employees e ON e.user_id = u.id
          WHERE ur.role_key = 'branch_admin'
            AND ur.active_status = 1
            AND e.active_status = 1
            AND e.branch_id = ?
            AND (u.is_blocked IS NULL OR u.is_blocked = 0)
            AND NOT EXISTS (
              SELECT 1 FROM user_assignment_scope x
               WHERE x.user_id = u.id AND x.active_status = 1
            )`,
        [row.branch_id, row.branch_id]
      );
      for (const admin of branchAdmins as Array<{ user_id: string }>) {
        await inboxService.createItem({
          user_id: String(admin.user_id),
          type: "BUDGET_CLOSURE_DUE",
          title: `Close ${period} business case — ${row.branch_name ?? row.branch_id}`,
          description: `${row.open_count} head/sub-head(s) still open for ${period}. Close each on the Variance tab by the 7th.`,
          entity_type: "finance_budget_header",
          entity_id: String(row.budget_id),
          action_url: `/finance/branch-budget?tab=variance&branchId=${row.branch_id}&period=${period}`,
          priority: "medium",
        });
        sent++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${WORKER_NAME}] Failed for budget ${row.budget_id}: ${msg}`);
    }
  }

  console.log(`[${WORKER_NAME}] Sent ${sent} reminder(s) for ${period}.`);
}

export async function startBudgetClosureReminderWorker(): Promise<void> {
  const delay = msUntilNext7th();
  console.log(`[${WORKER_NAME}] Next run on 7th of month — in ${Math.round(delay / 3600000)}h`);

  scheduledTimer = setTimeout(async () => {
    if (isTodayThe7th()) {
      try {
        await runReminders();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${WORKER_NAME}] Error:`, msg);
      }
    }
    await startBudgetClosureReminderWorker();
  }, delay);

  registerTimer(`${WORKER_NAME}-scheduled`, scheduledTimer);
}

export function stopBudgetClosureReminderWorker(): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    unregisterTimer(`${WORKER_NAME}-scheduled`);
    scheduledTimer = null;
  }
}
