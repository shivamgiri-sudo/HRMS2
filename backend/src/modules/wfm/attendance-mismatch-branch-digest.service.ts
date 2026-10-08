/**
 * Attendance mismatch branch digest.
 *
 * ATTENDANCE_MISMATCH is registered in action-item-registry.ts but had zero producers —
 * confirmed the last unwired Work Inbox item type (22/23 wired before this). The obvious
 * naive wiring — one work item per attendance_reconciliation_issue row, or even per
 * employee since it's nearly 1:1 — was rejected: that table grows 500-990 new rows/day
 * (~90%+ `missing_adr`, i.e. missing biometric enrollment — a separate known gap) touching
 * 500-980 distinct employees/day. Either would flood the wfm/hr roles with an unmanageable,
 * indefinite daily volume.
 *
 * This aggregates to one work item per (branch, currently-open backlog) instead —
 * "N employees in this branch have unresolved attendance exceptions" — deep-linking to
 * /wfm/attendance-exceptions (attendance-exceptions.routes.ts), the existing live,
 * navigable screen that already serves this exact table with a branchId filter the
 * frontend page did not previously read from the URL (see
 * NativeAttendanceExceptionEngine.tsx's branchId handling, added alongside this).
 *
 * No count/severity threshold: every branch with a nonzero open backlog gets exactly one
 * item — GROUP BY branch is what collapses the per-row flood, not a cutoff. Live branch
 * count (2026-08-19): branch_master holds 45 rows; only 13-15 carry an open backlog on any
 * given day, so this can never produce more than a few dozen items, well under the ~500-990
 * a naive per-row wiring would have produced daily. createWorkItemIfNotExists's own dedup
 * caps it further — see triggerAttendanceMismatchBranchBacklog's comment for why a branch's
 * item count going stale between scans while it sits pending is an accepted, precedented
 * characteristic here (PAYROLL_BRANCH_READINESS has the same property), not a new risk.
 *
 * `unmapped_cosec_user` rows (employee_id IS NULL, no employee to resolve a branch through)
 * and any row whose employee has no branch_id are excluded by the INNER JOINs below — same
 * treatment attendance-exceptions.routes.ts already gives them for a scoped viewer: an
 * issue that cannot be attributed to a branch cannot be handed to a branch-scoped digest.
 *
 * Read-only against attendance_reconciliation_issue, employees and branch_master. Does not
 * touch wfm/attendance-engine.service.ts or anything that computes attendance.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { triggerAttendanceMismatchBranchBacklog } from "../work-inbox/work-inbox.triggers.js";

// Matches the per-row try/catch isolation pattern in ats-reminders.cron.ts / awol-detection.service.ts:
// one branch's trigger failure must never abort the scan for the rest.
export async function runAttendanceMismatchBranchDigest(): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id AS branch_id,
            bm.branch_name AS branch_name,
            COUNT(DISTINCT ari.employee_id) AS employee_count
       FROM attendance_reconciliation_issue ari
       JOIN employees e ON e.id = ari.employee_id
       JOIN branch_master bm ON bm.id = e.branch_id
      WHERE ari.resolved_at IS NULL
      GROUP BY e.branch_id, bm.branch_name`
  );

  for (const row of rows) {
    try {
      await triggerAttendanceMismatchBranchBacklog(
        row.branch_id as string,
        row.branch_name as string,
        Number(row.employee_count)
      );
    } catch (err) {
      console.warn(`[attendance-mismatch-branch-digest] failed for branch ${row.branch_id as string}:`, err);
    }
  }

  if (rows.length > 0) {
    console.log(`[attendance-mismatch-branch-digest] notified ${rows.length} branch(es) with open attendance exceptions`);
  }
}
