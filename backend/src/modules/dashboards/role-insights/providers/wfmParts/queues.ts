import type { RowDataPacket } from "mysql2";
import { num, rows, severityFor } from "../../helpers.js";
import { idFilter } from "./shared.js";
import type { InsightAction, InsightContext, InsightSection, InsightSignal } from "../../types.js";

/**
 * Approval / correction queues the WFM desk can act on. Every count is the number of OPEN items, age is
 * the oldest open item in whole days, and `overdue` is the items older than the queue's SLA. SLAs are
 * product conventions (no SLA column exists), stated in each hint.
 */
export const REG_SLA_DAYS = 3;

/** Pure: open-queue action row; null count when the source could not be read. */
export function queueAction(a: Omit<InsightAction, "severity"> & { high?: number; critical?: number }): InsightAction {
  const { high = 5, critical = 20, ...rest } = a;
  const severity = severityFor(rest.count, high, critical);
  // An old queue is escalated regardless of size: one request left for a week is already a breach.
  const aged = (rest.overdue ?? 0) > 0 && severity === "normal" ? "high" : severity;
  return { ...rest, severity: aged };
}

/** Attendance corrections waiting on a decision (manager_approved still needs the WFM stage), split WFH vs other. */
export async function regularizationQueues(ctx: InsightContext): Promise<InsightSection> {
  const s = await idFilter(ctx, "r.employee_id", "active");
  const r = await rows<RowDataPacket>(
    `SELECT SUM(r.dispute_type = 'work_from_home') AS wfh,
            SUM(COALESCE(r.dispute_type,'') <> 'work_from_home') AS other,
            MAX(CASE WHEN r.dispute_type = 'work_from_home' THEN DATEDIFF(CURDATE(), r.created_at) END) AS wfh_age,
            MAX(CASE WHEN COALESCE(r.dispute_type,'') <> 'work_from_home' THEN DATEDIFF(CURDATE(), r.created_at) END) AS other_age,
            SUM(r.dispute_type = 'work_from_home' AND r.created_at < DATE_SUB(NOW(), INTERVAL ${REG_SLA_DAYS} DAY)) AS wfh_over,
            SUM(COALESCE(r.dispute_type,'') <> 'work_from_home' AND r.created_at < DATE_SUB(NOW(), INTERVAL ${REG_SLA_DAYS} DAY)) AS other_over,
            SUM(r.status = 'manager_approved') AS awaiting_wfm
       FROM attendance_regularization r
      WHERE r.status IN ('pending','manager_approved')${s.sql}`,
    s.params,
  );
  const x = r[0] ?? {};
  const wfh = num(x.wfh) ?? 0, other = num(x.other) ?? 0, over = (num(x.wfh_over) ?? 0) + (num(x.other_over) ?? 0);
  const waiting = num(x.awaiting_wfm) ?? 0;
  const signals: InsightSignal[] = over > 0 ? [{ tone: "bad", title: `${over} correction request${over === 1 ? "" : "s"} past the ${REG_SLA_DAYS}-day SLA`, detail: "Unresolved regularisations flow straight into payroll as absences or LOP.", value: over, href: "/attendance-regularization" }] : [];
  return {
    signals,
    actions: [
      queueAction({ id: "reg_other", label: "Attendance regularisations pending", count: other, oldestDays: num(x.other_age), overdue: num(x.other_over) ?? 0, href: "/attendance-regularization", hint: `${waiting} awaiting WFM stage; SLA ${REG_SLA_DAYS}d`, group: "Approvals" }),
      queueAction({ id: "reg_wfh", label: "Work-from-home requests pending", count: wfh, oldestDays: num(x.wfh_age), overdue: num(x.wfh_over) ?? 0, href: "/attendance-regularization", hint: `SLA ${REG_SLA_DAYS}d`, group: "Approvals" }),
    ],
  };
}

/** Shift-change/team roster submissions and swap requests. */
export async function rosterRequestQueues(ctx: InsightContext): Promise<InsightSection> {
  const [ss, sw] = await Promise.all([idFilter(ctx, "t.submitter_employee_id", "active"), idFilter(ctx, "q.requester_emp_id", "active")]);
  const [sub, swap] = await Promise.all([
    rows<RowDataPacket>(
      `SELECT SUM(t.status = 'pending_manager') AS mgr, SUM(t.status = 'pending_wfm') AS wfm, COUNT(*) AS n,
              MAX(DATEDIFF(CURDATE(), t.submitted_at)) AS age, SUM(t.submitted_at < DATE_SUB(NOW(), INTERVAL 2 DAY)) AS ovr
         FROM roster_team_submission t
        WHERE t.status IN ('pending_manager','pending_wfm')${ss.sql}`, ss.params),
    rows<RowDataPacket>(
      `SELECT COUNT(*) AS n, MAX(DATEDIFF(CURDATE(), q.created_at)) AS age, SUM(q.created_at < DATE_SUB(NOW(), INTERVAL 2 DAY)) AS ovr
         FROM wfm_roster_swap_request q
        WHERE q.status = 'pending'${sw.sql}`, sw.params),
  ]);
  const a = sub[0] ?? {}, b = swap[0] ?? {};
  return {
    actions: [
      queueAction({ id: "roster_submissions", label: "Shift-change / roster submissions to approve", count: num(a.n) ?? 0, oldestDays: num(a.age), overdue: num(a.ovr) ?? 0, href: "/wfm/team-roster", hint: `${num(a.wfm) ?? 0} at WFM stage, ${num(a.mgr) ?? 0} with the manager; SLA 2d`, group: "Approvals", high: 3, critical: 10 }),
      queueAction({ id: "roster_swaps", label: "Shift / week-off swap requests", count: num(b.n) ?? 0, oldestDays: num(b.age), overdue: num(b.ovr) ?? 0, href: "/wfm/roster-requests", hint: "SLA 2d", group: "Approvals", high: 3, critical: 10 }),
    ],
  };
}

/** Open attendance-reconciliation blockers (missing ADR rows, source/evidence gaps). */
export async function integrityQueue(ctx: InsightContext): Promise<InsightSection> {
  const s = await idFilter(ctx, "i.employee_id", "scoped");
  const r = await rows<RowDataPacket>(
    `SELECT COUNT(*) AS n, MAX(DATEDIFF(CURDATE(), i.issue_date)) AS age,
            SUM(i.issue_date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS ovr
       FROM attendance_reconciliation_issue i
      WHERE i.resolved_at IS NULL AND i.severity = 'blocker'${s.sql}`,
    s.params,
  );
  const x = r[0] ?? {};
  const n = num(x.n) ?? 0;
  return {
    actions: [queueAction({ id: "integrity_blockers", label: "Attendance blockers open (payroll-blocking)", count: n, oldestDays: num(x.age), overdue: num(x.ovr) ?? 0, href: "/wfm/attendance-integrity?tab=mismatches", hint: "overdue = open > 7 days", group: "Data integrity", high: 50, critical: 500 })],
    signals: n > 0 ? [{ tone: (num(x.ovr) ?? 0) > 0 ? "bad" : "watch", title: `${n.toLocaleString("en-IN")} attendance blockers still open`, detail: `${(num(x.ovr) ?? 0).toLocaleString("en-IN")} are older than 7 days and will hit the payroll cut-off.`, value: n, href: "/wfm/attendance-integrity?tab=mismatches" }] : [],
  };
}

/** Pending leave that changes tomorrow's roster (leave from 7 days ago onward; older rows are legacy). */
export async function pendingLeaveQueue(ctx: InsightContext): Promise<InsightSection> {
  const s = await idFilter(ctx, "lr.employee_id", "active");
  const r = await rows<RowDataPacket>(
    `SELECT COUNT(*) AS n, MAX(DATEDIFF(CURDATE(), COALESCE(lr.applied_at, lr.created_at))) AS age,
            SUM(COALESCE(lr.applied_at, lr.created_at) < DATE_SUB(NOW(), INTERVAL 3 DAY)) AS ovr
       FROM leave_request lr
      WHERE lr.status = 'pending' AND (lr.to_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) OR lr.end_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY))${s.sql}`,
    s.params,
  );
  const x = r[0] ?? {};
  return { actions: [queueAction({ id: "leave_pending", label: "Leave requests pending (affect roster)", count: num(x.n) ?? 0, oldestDays: num(x.age), overdue: num(x.ovr) ?? 0, href: "/leaves", hint: "current / upcoming dates only; SLA 3d", group: "Approvals" })] };
}
