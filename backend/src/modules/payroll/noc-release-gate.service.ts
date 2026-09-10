/**
 * The mandatory NOC gate on salary release.
 *
 * THE RULE
 *
 * An inactive employee's pending salary is not released until their NOC clearance is complete.
 * Payroll Head and super_admin can override, per employee, with a recorded reason. Nobody else.
 *
 * WHAT WAS BROKEN BEFORE THIS FILE EXISTED
 *
 * Nothing in payroll read payroll_noc before paying. nocValidated() had exactly one caller in
 * the entire backend — finalExitBlockers() in exit.secure.routes.ts, gating the exit FSM's
 * 'exited' transition — while updateRunStatus's locked/disbursed branch, the NEFT payable query,
 * run validation and F&F approval contained no NOC reference at all. An inactive employee with a
 * positive salary_prep_line went straight into the bank file. The validate route even answers
 * "NOC validated. Salary/FNF processing unblocked", which was not true of payroll.
 *
 * WHY THE PREDICATE IS NOT nocRequired()
 *
 * nocRequired() (noc.service.ts) answers a different question — "does this person need a NOC
 * raised" — and its salary limb excludes runs whose status is in CLOSED_RUN_STATUSES
 * ('locked','disbursed','finalized'). Production runs settle as FINALIZED, and NEFT export
 * REQUIRES isRunClosed(), i.e. exactly those statuses. So at the moment money actually leaves,
 * nocRequired() has already flipped to required:false for the salary case and a gate keyed on it
 * would never fire. That exclusion is correct for its own purpose (it was added because the
 * older form flagged 21,127 inactive employees spuriously) — it is simply the wrong predicate
 * for release. Release asks only: is this person inactive, and is their NOC cleared.
 *
 * WHY DERIVED AND NOT PERSISTED
 *
 * The obvious implementation is to write salary_prep_line.status = 'blocked', which the NEFT
 * exporter already honours. It would not hold: the calculator's bulk upsert sets
 * `status = 'calculated'` in its ON DUPLICATE KEY UPDATE clause (payrollCalculate.service.ts),
 * and payroll-nightly-recalc.worker.ts re-runs every open run each night — so a persisted block
 * would silently disappear before payment. A predicate evaluated in the payable query cannot be
 * wiped by a recalculation.
 *
 * KILL SWITCH
 *
 * A gate that can stop a payroll run needs an off switch that does not require a deploy. Same
 * mechanism and same reasoning as payroll_head_review_gate_enabled in payrollCalculate.service.ts.
 * It fails OPEN when the flag row or table is unreadable — deliberately: this gate withholds pay,
 * and a database hiccup must not become an unpaid workforce. The compensating control is that
 * every withheld employee is reported by name at run validation rather than silently dropped, so
 * a gate that is off is visible rather than assumed.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const NOC_GATE_FLAG_KEY = "noc_salary_release_gate_enabled";

/** Default ON. An unset flag means the gate applies; only an explicit 'false' disables it. */
export async function isNocReleaseGateEnabled(): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM payroll_config_flags
        WHERE branch_id IS NULL AND process_id IS NULL AND config_key = ? LIMIT 1`,
      [NOC_GATE_FLAG_KEY],
    );
    if (!rows.length) return true;
    return String(rows[0].config_value).trim().toLowerCase() !== "false";
  } catch (err) {
    // Fails OPEN. See the header: an unreadable flag must not withhold everyone's pay.
    console.error(
      "[noc-gate] could not read the kill-switch flag; treating the gate as DISABLED so payroll is not blocked by a config read failure:",
      (err as Error).message,
    );
    return false;
  }
}

/**
 * SQL predicate for "this employee may be paid as far as NOC is concerned".
 *
 * Inlined into the payable query rather than run per employee: the NEFT exporter selects ~1,200
 * rows in one statement, and a per-row await would turn one query into 1,200.
 *
 * Reads TRUE for an active employee (the gate is only about leavers), for a completed NOC, and
 * for an overridden one. Everything else is withheld.
 *
 * @param empAlias table alias for `employees` in the surrounding query
 */
export function nocReleaseClearedSql(empAlias = "e"): string {
  return `(
    LOWER(COALESCE(${empAlias}.employment_status, 'active')) = 'active'
    OR EXISTS (
      SELECT 1 FROM noc_case nc
       WHERE nc.employee_id = ${empAlias}.id
         AND (nc.status = 'completed' OR nc.override_at IS NOT NULL)
    )
  )`;
}

/**
 * Whether the digital eight-signatory clearance is satisfied for this employee.
 *
 * Deliberately narrower than nocReleaseStatusForEmployee: it answers only "is the case cleared",
 * with no employment-status test and no kill-switch check. Callers that already know a NOC is
 * required — the exit FSM, which has asked nocRequired() — need exactly this and nothing else,
 * and folding the kill switch in here would let the payroll flag silently unblock the exit
 * transition too, which is a different control with a different owner.
 */
export async function nocCaseCleared(employeeId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM noc_case
      WHERE employee_id = ?
        AND (status = 'completed' OR override_at IS NOT NULL)
      LIMIT 1`,
    [employeeId],
  );
  return rows.length > 0;
}

export interface NocReleaseStatus {
  blocked: boolean;
  /** Present only when blocked. Written for a payroll user, not a developer. */
  reason: string | null;
  caseStatus: string | null;
  hasCase: boolean;
  overridden: boolean;
}

/** Per-employee decision, for single-employee paths (F&F release, an employee drill-down). */
export async function nocReleaseStatusForEmployee(employeeId: string): Promise<NocReleaseStatus> {
  if (!(await isNocReleaseGateEnabled())) {
    return { blocked: false, reason: null, caseStatus: null, hasCase: false, overridden: false };
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employment_status FROM employees WHERE id = ? LIMIT 1`, [employeeId]);
  if (!empRows.length) {
    return { blocked: false, reason: null, caseStatus: null, hasCase: false, overridden: false };
  }
  const isActive = String(empRows[0].employment_status ?? "active").trim().toLowerCase() === "active";
  if (isActive) {
    return { blocked: false, reason: null, caseStatus: null, hasCase: false, overridden: false };
  }

  const [caseRows] = await db.execute<RowDataPacket[]>(
    `SELECT status, override_at, declined_stage_key FROM noc_case WHERE employee_id = ? LIMIT 1`,
    [employeeId],
  );
  const nocCase = caseRows[0];

  if (!nocCase) {
    return {
      blocked: true, hasCase: false, overridden: false, caseStatus: null,
      reason: "No NOC clearance has been raised for this inactive employee.",
    };
  }
  if (nocCase.override_at) {
    return {
      blocked: false, hasCase: true, overridden: true,
      caseStatus: String(nocCase.status), reason: null,
    };
  }
  if (String(nocCase.status) === "completed") {
    return { blocked: false, hasCase: true, overridden: false, caseStatus: "completed", reason: null };
  }
  if (String(nocCase.status) === "declined") {
    return {
      blocked: true, hasCase: true, overridden: false, caseStatus: "declined",
      reason: `NOC was declined at the ${nocCase.declined_stage_key ?? "clearance"} stage and is awaiting HR resolution.`,
    };
  }
  return {
    blocked: true, hasCase: true, overridden: false, caseStatus: String(nocCase.status),
    reason: `NOC clearance is ${String(nocCase.status).replace(/_/g, " ")} — not all signatories have responded.`,
  };
}

export interface NocBlockedEmployee {
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  net_salary: number;
  case_status: string | null;
  pending_stages: string | null;
}

/**
 * Every employee in a run who is withheld by this gate.
 *
 * This is what makes the gate honest. A payable employee silently absent from a bank file is the
 * failure mode the NEFT exporter's own EXCLUDED block and its population-reconciliation refusal
 * exist to prevent, and adding a new silent exclusion beside them would reintroduce exactly that.
 * Head Payroll sees this list at validation, before the run closes.
 *
 * Returns [] when the gate is off, so callers need no separate flag check.
 */
export async function nocBlockedEmployeesForRuns(runIds: string[]): Promise<NocBlockedEmployee[]> {
  if (!runIds.length) return [];
  if (!(await isNocReleaseGateEnabled())) return [];

  const placeholders = runIds.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.employee_id,
            e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name,
            ROUND(spl.net_salary, 2) AS net_salary,
            nc.status AS case_status,
            (SELECT GROUP_CONCAT(s.stage_label ORDER BY s.display_no SEPARATOR ', ')
               FROM noc_signatory s
              WHERE s.noc_case_id = nc.id AND s.status = 'pending') AS pending_stages
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN noc_case nc ON nc.employee_id = spl.employee_id
      WHERE spl.run_id IN (${placeholders})
        AND spl.net_salary > 0
        AND LOWER(COALESCE(spl.status, '')) NOT IN ('excluded', 'blocked')
        AND NOT ${nocReleaseClearedSql("e")}
      ORDER BY e.employee_code`,
    runIds,
  );
  return rows as unknown as NocBlockedEmployee[];
}

/**
 * Record a Payroll Head override for one employee.
 *
 * Restricted to payroll_head and super_admin by the calling route — asserted there rather than
 * here so the 403 carries the route's message, but stated in both places because this is the one
 * function in the module that can release money the signatories have not cleared.
 *
 * Written into dedicated columns instead of setting status='completed'. An overridden case must
 * never be indistinguishable from one the branch actually signed: the certificate, the audit
 * trail and any later dispute all turn on that difference.
 */
export async function overrideNocRelease(params: {
  employeeId: string;
  reason: string;
  actorUserId: string;
}): Promise<{ caseId: string }> {
  if (!params.reason?.trim()) {
    throw Object.assign(
      new Error("An override reason is required — it is the only record of why salary was released without a completed NOC."),
      { statusCode: 400, code: "NOC_OVERRIDE_REASON_REQUIRED" },
    );
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status, override_at FROM noc_case WHERE employee_id = ? LIMIT 1`, [params.employeeId]);
  const nocCase = rows[0];
  if (!nocCase) {
    throw Object.assign(
      new Error("This employee has no NOC clearance to override. Raise the NOC first, then override it if the release genuinely cannot wait."),
      { statusCode: 404, code: "NOC_CASE_NOT_FOUND" },
    );
  }
  if (nocCase.override_at) {
    throw Object.assign(
      new Error("This NOC release has already been overridden."),
      { statusCode: 409, code: "NOC_ALREADY_OVERRIDDEN" },
    );
  }

  await db.execute(
    `UPDATE noc_case SET override_by = ?, override_at = NOW(), override_reason = ? WHERE id = ?`,
    [params.actorUserId, params.reason.trim(), nocCase.id],
  );
  return { caseId: String(nocCase.id) };
}
