/**
 * Flag for Retention Review — the one write action on the AON Analytics drill-down page.
 *
 * Calls the existing, already-tested upsertOpenWorkItem() helper (backend/src/shared/workItem.ts)
 * -- the same idempotent Work Inbox writer already used by 7+ producers in this codebase. No new
 * work-item plumbing: flagging the same employee twice while a review is still open is a no-op
 * refresh, not a duplicate, because that idempotency is already proven for the shared helper.
 *
 * Routed by role (assignedToRole), not by a specific user id -- WorkItemInput has no
 * assignedToUserId field, and Work Inbox's existing branch/process row-scope on reads already
 * ensures only the relevant manager/branch head sees it.
 *
 * `employeeId` is the employee's real `employees.id` UUID -- the same value
 * `aon-drilldown-employees` (Task 3) selects as `employee_id` specifically so the frontend can
 * hand it straight to this endpoint. It is never `employee_code`.
 *
 * MANAGER-ROLE RESOLUTION -- verified against the live DB before writing this (2026-08-25):
 *   The obvious approach (join `employees` -> `auth_user` by email, then read one arbitrary
 *   active `user_roles` row) has two real defects that were confirmed live, not assumed:
 *
 *   1. Email is the wrong join key. `employees.email`/`official_email` are unreliable free-text
 *      fields -- live query found 17,854 employees with placeholder values like 'na' in
 *      official_email and 22,171 in email, plus real employees carry a personal Gmail address in
 *      `email` with nothing in `official_email`. `employees.user_id` is the actual FK to
 *      `auth_user.id` and resolves more managers live (77/161 distinct reporting managers) than
 *      the email join did (66/161). So this joins through `user_id`, not email.
 *
 *   2. A manager can hold several simultaneously-active `user_roles` rows (confirmed live: one
 *      real branch manager account carries active "employee", "payroll_admin" and "payroll_hr"
 *      roles at once). `... LIMIT 1` with no ordering returns whichever the storage engine hands
 *      back first -- it picked "employee" in a live check, which is useless as a review-routing
 *      target. This reuses `resolvePrimaryRole()` from `shared/roleResolver.ts` -- the same
 *      priority ranking already used for `req.authUser.role` and `/api/access/me` -- so the same
 *      manager always resolves to the same, most-senior role instead of an arbitrary one.
 *
 *   If the manager has no resolvable role beyond "employee" (or no `user_roles` row at all,
 *   which `resolvePrimaryRole` also reports as "employee"), that's not a real routing target --
 *   fall back to "branch_head", the same fallback used when there is no manager at all.
 */
import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { upsertOpenWorkItem } from "../../shared/workItem.js";
import { resolvePrimaryRole } from "../../shared/roleResolver.js";

export const aonRetentionFlagRouter = Router();

interface EmployeeForFlag extends RowDataPacket {
  id: string;
  reporting_manager_id: string | null;
  branch_id: string | null;
}

interface ManagerRoleRow extends RowDataPacket {
  role_key: string;
}

const FALLBACK_ROLE = "branch_head";

async function resolveAssignedRole(employeeId: string): Promise<string> {
  const [rows] = await db.execute<EmployeeForFlag[]>(
    `SELECT id, reporting_manager_id, branch_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = rows[0];
  if (!emp?.reporting_manager_id) return FALLBACK_ROLE;

  // Join through employees.user_id -> auth_user.id (the real FK), never through email --
  // employees.email/official_email are unreliable free text (see file header).
  const [roleRows] = await db.execute<ManagerRoleRow[]>(
    `SELECT ur.role_key
       FROM employees mgr
       JOIN user_roles ur ON ur.user_id = mgr.user_id
      WHERE mgr.id = ? AND ur.active_status = 1`,
    [emp.reporting_manager_id],
  );

  const roleKeys = roleRows.map((row) => row.role_key);
  const primaryRole = resolvePrimaryRole(roleKeys);
  return primaryRole === "employee" ? FALLBACK_ROLE : primaryRole;
}

aonRetentionFlagRouter.post(
  "/flag-retention",
  requireAuth,
  async (req: Request, res: Response) => {
    const employeeId = String((req.body as { employeeId?: unknown })?.employeeId ?? "").trim();
    if (!employeeId) {
      return res.status(400).json({ success: false, message: "employeeId is required" });
    }

    const assignedToRole = await resolveAssignedRole(employeeId);
    const riskBand = String((req.body as { riskBand?: unknown })?.riskBand ?? "").trim();
    const priority = riskBand === "High" ? "high" : riskBand === "Medium" ? "normal" : "low";

    const outcome = await upsertOpenWorkItem({
      itemType: "RETENTION_REVIEW",
      title: "Retention review requested",
      moduleCode: "aon-analytics",
      entityType: "employee",
      entityId: employeeId,
      assignedToRole,
      priority,
      description: `Flagged from AON & Attrition Analytics${riskBand ? ` — risk band: ${riskBand}` : ""}.`,
    });

    return res.json({ success: true, outcome });
  },
);
