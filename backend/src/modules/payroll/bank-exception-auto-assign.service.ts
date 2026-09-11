/**
 * Bank exception auto-assign — when an employee's bank-payment-readiness exception is
 * INVALID (malformed IFSC/account), MISSING (no record) or CONFLICT (sources disagree) and
 * nobody has claimed it yet, assign it to the branch's payroll HR and email the employee,
 * their reporting manager, and the assigned payroll HR.
 *
 * Real gap this closes, found live 2026-09-11: the Payment Center Exceptions queue shows
 * these employees but gives a payroll_head/payroll/finance_head viewer no button anywhere on
 * that page to start fixing one — the only correction trigger (request-resubmission) lives on
 * a different page and is gated to hr/hr_admin/super_admin, not the payroll roles who actually
 * work this queue. Auto-assignment plus this email at least puts a named, notified owner on
 * every blocked-salary case instead of leaving it silently "unassigned".
 *
 * WHO GETS ASSIGNED, deliberately kept consistent with who gets emailed: this queries
 * user_assignment_scope for role_key='payroll_hr' with the exact same scope semantics as
 * recipient-resolver.ts's roleScopeRows() (branch scope row, OR an 'all'-scoped holder, OR the
 * person simply sits in that branch). The notification's 'payroll_hr' recipient selector
 * resolves the same way, so the person written into payroll_bank_exception.owner_user_id is
 * always the same person the email reaches — no drift between "assigned to" and "notified".
 * (The DB also holds a handful of role_key='payroll' branch-scoped grants that this
 * deliberately does NOT match — see hrms2-payroll-hr-role-alias-breaks-rbac in memory. Using
 * the same selector as the notification, rather than a broader one, was the choice: a wider
 * match here would assign to someone the email never reaches.)
 *
 * IDEMPOTENT BY CONSTRUCTION, not by a "have I run today" flag: the INSERT's ON DUPLICATE
 * KEY UPDATE only ever sets owner_user_id when it is currently NULL (COALESCE keeps whatever
 * is already there) — a human's manual assignment, or an earlier auto-assign, is never
 * overwritten. The email only fires when that write actually changed a row (MySQL reports
 * affectedRows=1 on insert, =2 on a real update, =0 when nothing changed), so re-running this
 * against an already-assigned employee is a silent no-op, not a repeat email.
 */
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { notificationGateway } from "../communication/notification.gateway.js";
import type { BankReadinessResult } from "./bank-payment-readiness.service.js";

type BankReadinessRow = BankReadinessResult & { branch_id: string | null; branch_name: string | null };

const AUTO_ASSIGN_CLASSES = new Set(["INVALID", "MISSING", "CONFLICT"]);

interface PayrollHrPerson {
  employeeId: string;
  userId: string;
  name: string;
}

const branchHrCache = new Map<string, PayrollHrPerson | null>();

async function resolvePayrollHrForBranch(branchId: string): Promise<PayrollHrPerson | null> {
  if (branchHrCache.has(branchId)) return branchHrCache.get(branchId)!;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT e.id AS employee_id, e.user_id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name),''), e.employee_code) AS name
       FROM employees e
       JOIN auth_user au ON au.id = e.user_id
       LEFT JOIN user_roles ur ON ur.user_id = e.user_id AND ur.active_status = 1 AND ur.role_key = 'payroll_hr'
       LEFT JOIN user_assignment_scope uas ON uas.user_id = e.user_id AND uas.active_status = 1 AND uas.role_key = 'payroll_hr'
      WHERE e.active_status = 1
        AND (ur.id IS NOT NULL OR uas.id IS NOT NULL)
        AND (uas.scope_type = 'all'
             OR (uas.scope_type IN ('branch','team') AND uas.branch_id = ?)
             OR e.branch_id = ?)
      ORDER BY e.employee_code
      LIMIT 1`,
    [branchId, branchId],
  );
  const row = (rows as any[])[0];
  const result = row ? { employeeId: row.employee_id, userId: row.user_id, name: row.name } : null;
  branchHrCache.set(branchId, result);
  return result;
}

export interface AutoAssignSummary {
  eligible: number;
  assigned: number;
  notified: number;
  skipped_no_branch_hr: number;
}

/**
 * Runs one auto-assign pass over already-classified bank-readiness rows. Call this from
 * GET /exceptions after buildBankReadinessReport() — cheap when there is nothing to do
 * (every row already owned resolves to a single UPDATE affecting 0 rows, no notify call).
 */
export async function autoAssignBankExceptionsToPayrollHr(
  rows: BankReadinessRow[],
): Promise<AutoAssignSummary> {
  const summary: AutoAssignSummary = { eligible: 0, assigned: 0, notified: 0, skipped_no_branch_hr: 0 };

  for (const r of rows) {
    if (!AUTO_ASSIGN_CLASSES.has(r.readiness_class)) continue;
    if (!r.branch_id) continue;
    summary.eligible++;

    const hr = await resolvePayrollHrForBranch(r.branch_id);
    if (!hr) {
      summary.skipped_no_branch_hr++;
      continue;
    }

    const note = `Auto-assigned to branch payroll HR (${hr.name}) — ${r.readiness_class}: ${r.reason_detail ?? ""}`.slice(0, 2000);
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO payroll_bank_exception
         (id, employee_id, owner_user_id, workflow_status, notes, created_by, updated_by)
       VALUES (UUID(), ?, ?, 'open', ?, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         owner_user_id = COALESCE(owner_user_id, VALUES(owner_user_id))`,
      [r.employee_id, hr.userId, note],
    );

    // affectedRows: 1 = fresh insert, 2 = an existing NULL owner was just filled in, 0 = an
    // owner already existed (human or an earlier pass) and nothing changed. Only the first
    // two cases are a real new assignment worth emailing about.
    if (result.affectedRows === 0) continue;
    summary.assigned++;

    const outcome = await notificationGateway.notify({
      eventCode: "bank_exception_invalid_assigned",
      // Once per employee: a later re-run finds owner_user_id already set and never reaches
      // this line again, but the dedupe key is still the real backstop against a race between
      // two concurrent /exceptions requests both seeing affectedRows>0 before either commits.
      dedupeKey: `bank_exception_invalid_assigned:${r.employee_id}`,
      context: { employeeId: r.employee_id, branchId: r.branch_id },
      entityType: "employee",
      entityId: r.employee_id,
      data: {
        employee_code: r.employee_code,
        employee_name: r.employee_name,
        branch_name: r.branch_name,
        readiness_class: r.readiness_class,
        reason: r.reason_detail,
        assigned_to: hr.name,
      },
    });
    if (outcome.outcome === "sent" || outcome.outcome === "shadow") summary.notified++;
  }

  return summary;
}
