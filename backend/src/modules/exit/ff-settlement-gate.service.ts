/**
 * Who may have an F&F settlement prepared, approved or paid.
 *
 * TWO RULES, evaluated together because every F&F transition needs both answers.
 *
 * 1. ABSCONDERS GET NO F&F. Not "a warning" and not "needs a second look": no settlement at all,
 *    until the Payroll Head records a hard exception against the exit request (reason mandatory,
 *    audited). Once that exception exists everything downstream runs exactly as it does for any
 *    other leaver: NOC, Payroll Head NOC approval, F&F approval, payment.
 *
 *    The exception does not waive the NOC: an absconder's F&F also needs a fully SIGNED NOC
 *    (status 'completed'); a release override does not satisfy it.
 *
 * 2. A NOC THE BRANCH HAS CLEARED STILL NEEDS THE PAYROLL HEAD. When
 *    payroll_config_flags.noc_ph_final_approval_from is set, a case completed on or after that
 *    date unlocks F&F only once payroll_head_approved_at is set (see
 *    payroll/noc-final-approval.service.ts). A Payroll Head override also unlocks, since the
 *    Payroll Head has already acted. Flag absent => this rule is inert and the existing NOC
 *    rules at approval and payment time apply unchanged.
 *
 * Absconding is detected from the exit request's type and sub-type (the same two spellings
 * exit.validation.ts accepts) and, as a backstop, from employment_status, because an absconder
 * can be flagged on the employee record without the exit request carrying the type.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { nocFinalApprovalFrom } from "../payroll/noc-final-approval.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export type FfGateCode =
  | "ABSCONDED_NO_EXCEPTION"
  | "NOC_INCOMPLETE"
  | "PAYROLL_HEAD_APPROVAL_PENDING";

export interface FfGate {
  allowed: boolean;
  code: FfGateCode | null;
  reason: string | null;
}

const ABSCONDING_TYPES = ["absconding", "abandonment"];
const ABSCONDED_STATUSES = ["absconded", "absconding"];

/**
 * SQL predicate: this exit is an absconder with NO Payroll Head exception on record.
 * Used by every "F&F pending" surface so none counts a settlement nobody is allowed to do.
 */
export function abscondedWithoutExceptionSql(erAlias = "er", empAlias = "e"): string {
  const t = ABSCONDING_TYPES.map((x) => `'${x}'`).join(",");
  const s = ABSCONDED_STATUSES.map((x) => `'${x}'`).join(",");
  return `(
    ${erAlias}.ff_exception_at IS NULL
    AND (
      LOWER(COALESCE(${erAlias}.exit_type, '')) IN (${t})
      OR LOWER(COALESCE(${erAlias}.exit_sub_type, '')) IN (${t})
      OR LOWER(COALESCE(${empAlias}.employment_status, '')) IN (${s})
    )
  )`;
}

export async function ffSettlementGate(
  employeeId: string,
  exitRequestId?: string | null,
): Promise<FfGate> {
  const [erRows] = await db.execute<RowDataPacket[]>(
    exitRequestId
      ? `SELECT er.id, er.exit_type, er.exit_sub_type, er.ff_exception_at, e.employment_status
           FROM exit_request er JOIN employees e ON e.id = er.employee_id
          WHERE er.id = ? LIMIT 1`
      : `SELECT er.id, er.exit_type, er.exit_sub_type, er.ff_exception_at, e.employment_status
           FROM exit_request er JOIN employees e ON e.id = er.employee_id
          WHERE er.employee_id = ? ORDER BY er.created_at DESC LIMIT 1`,
    [exitRequestId ?? employeeId],
  );
  const er = erRows[0];
  const empStatus = String(er?.employment_status ?? "").toLowerCase();
  const typed = [er?.exit_type, er?.exit_sub_type].some((v) =>
    ABSCONDING_TYPES.includes(String(v ?? "").toLowerCase()),
  );
  const absconded = typed || ABSCONDED_STATUSES.includes(empStatus);
  if (absconded && !er?.ff_exception_at) {
    return {
      allowed: false,
      code: "ABSCONDED_NO_EXCEPTION",
      reason:
        "F&F is not allowed for an absconded employee. A Payroll Head exception approval is required before a settlement can be prepared, approved or paid.",
    };
  }

  // An absconder who has the exception still needs a SIGNED NOC. This holds whether or not the
  // final-approval date is switched on, and a Payroll Head release override does not stand in for
  // it: the override exists to release salary when a clearance cannot be completed, and an
  // exception to "no F&F for absconders" must not be satisfiable by a second override.
  if (absconded) {
    const [signed] = await db.execute<RowDataPacket[]>(
      `SELECT status FROM noc_case WHERE employee_id = ? LIMIT 1`,
      [employeeId],
    );
    if (String(signed[0]?.status ?? "") !== "completed") {
      return {
        allowed: false,
        code: "NOC_INCOMPLETE",
        reason:
          "An absconder's F&F exception also needs a fully signed NOC (every clearance level). A Payroll Head release override does not count.",
      };
    }
  }

  const from = await nocFinalApprovalFrom();
  if (!from) return { allowed: true, code: null, reason: null };

  // The NOC part of the rule is about leavers; an employee still active (F&F prepared during
  // notice) is not held here, matching nocReleaseStatusForEmployee.
  if (empStatus === "active" || empStatus === "") {
    return { allowed: true, code: null, reason: null };
  }

  const [ncRows] = await db.execute<RowDataPacket[]>(
    `SELECT status, override_at, completed_at, payroll_head_approved_at
       FROM noc_case WHERE employee_id = ? LIMIT 1`,
    [employeeId],
  );
  const nc = ncRows[0];
  if (!nc) {
    return {
      allowed: false,
      code: "NOC_INCOMPLETE",
      reason: "No NOC clearance has been raised for this leaver, so F&F is locked.",
    };
  }
  if (nc.override_at) return { allowed: true, code: null, reason: null };
  if (String(nc.status) !== "completed") {
    return {
      allowed: false,
      code: "NOC_INCOMPLETE",
      reason: `NOC clearance is ${String(nc.status).replace(/_/g, " ")}; F&F unlocks after every level clears and the Payroll Head gives final approval.`,
    };
  }
  const completedOn = String(nc.completed_at ?? "").slice(0, 10);
  if (completedOn && completedOn < from) return { allowed: true, code: null, reason: null };
  if (nc.payroll_head_approved_at) return { allowed: true, code: null, reason: null };
  return {
    allowed: false,
    code: "PAYROLL_HEAD_APPROVAL_PENDING",
    reason:
      "NOC is complete and awaiting the Payroll Head's final approval. F&F settlement unlocks once it is approved.",
  };
}

/** Throws the F&F service's error shape when the settlement is locked. */
export async function assertFfSettlementAllowed(
  employeeId: string,
  exitRequestId?: string | null,
): Promise<void> {
  const g = await ffSettlementGate(employeeId, exitRequestId);
  if (!g.allowed) {
    throw Object.assign(new Error(g.reason ?? "F&F settlement is locked"), {
      statusCode: 409,
      code: g.code,
    });
  }
}

/**
 * Record the Payroll Head's exception for an absconder. Route restricts the caller to
 * payroll_head (and super_admin via hasAnyRole); this function insists on the reason because the
 * reason is the only record of why a rule with no exception path elsewhere was set aside.
 */
export async function grantAbscondingFfException(params: {
  exitRequestId: string;
  reason: string;
  actorUserId: string;
  actorRole?: string | null;
}): Promise<void> {
  const reason = params.reason?.trim() ?? "";
  if (reason.length < 15) {
    throw Object.assign(
      new Error("An exception reason of at least 15 characters is required."),
      { statusCode: 400, code: "FF_EXCEPTION_REASON_REQUIRED" },
    );
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.id, er.employee_id, er.ff_exception_at, er.ff_exception_bh_at, er.ff_exception_bh_by, er.exit_type, er.exit_sub_type,
            e.employment_status
       FROM exit_request er JOIN employees e ON e.id = er.employee_id
      WHERE er.id = ? LIMIT 1`,
    [params.exitRequestId],
  );
  const er = rows[0];
  if (!er) {
    throw Object.assign(new Error("Exit request not found"), { statusCode: 404, code: "EXIT_NOT_FOUND" });
  }
  // Step 1 belongs to the Branch Head. The Payroll Head's exception is only meaningful on top of it.
  if (!er.ff_exception_bh_at) {
    throw Object.assign(
      new Error("The Branch Head must approve this exception first. Ask the employee's Branch Head to approve it, then record the Payroll Head exception."),
      { statusCode: 409, code: "FF_EXCEPTION_BRANCH_HEAD_PENDING" },
    );
  }
  // Two approvers, two people: the Payroll Head step cannot be the same person as the Branch Head step.
  if (String(er.ff_exception_bh_by ?? "") === String(params.actorUserId)) {
    throw Object.assign(
      new Error("The Payroll Head exception must be recorded by someone other than the Branch Head who approved it."),
      { statusCode: 403, code: "FF_EXCEPTION_SAME_APPROVER" },
    );
  }
  if (er.ff_exception_at) {
    throw Object.assign(new Error("An F&F exception is already recorded for this exit."), {
      statusCode: 409,
      code: "FF_EXCEPTION_EXISTS",
    });
  }
  const gate = await ffSettlementGate(String(er.employee_id), params.exitRequestId);
  if (gate.code !== "ABSCONDED_NO_EXCEPTION") {
    throw Object.assign(
      new Error("This exit is not an absconding case, so no F&F exception is needed."),
      { statusCode: 409, code: "FF_EXCEPTION_NOT_NEEDED" },
    );
  }

  await db.execute(
    `UPDATE exit_request
        SET ff_exception_by = ?, ff_exception_at = NOW(), ff_exception_reason = ?
      WHERE id = ? AND ff_exception_at IS NULL`,
    [params.actorUserId, reason.slice(0, 500), params.exitRequestId],
  );
  // Awaited: an exception whose record failed to write must not be treated as granted.
  await logSensitiveAction({
    actor_user_id: params.actorUserId,
    actor_role: params.actorRole ?? undefined,
    action_type: "FF_ABSCONDER_EXCEPTION_GRANTED",
    module_key: "exit",
    entity_type: "exit_request",
    entity_id: params.exitRequestId,
    change_summary: { employee_id: String(er.employee_id), reason },
  });
}

/**
 * Step 1 of an absconder F&F exception: the employee's Branch Head approves it, with a reason.
 * The route restricts the caller to branch_head (scoped to the employee's branch by the exit-scope
 * guard). Nothing unlocks yet: the Payroll Head's exception (step 2) is still required.
 */
export async function recordBranchHeadFfException(params: {
  exitRequestId: string;
  reason: string;
  actorUserId: string;
  actorRole?: string | null;
}): Promise<void> {
  const reason = params.reason?.trim() ?? "";
  if (reason.length < 15) {
    throw Object.assign(new Error("A reason of at least 15 characters is required."), {
      statusCode: 400,
      code: "FF_EXCEPTION_REASON_REQUIRED",
    });
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.id, er.employee_id, er.ff_exception_at, er.ff_exception_bh_at FROM exit_request er WHERE er.id = ? LIMIT 1`,
    [params.exitRequestId],
  );
  const er = rows[0];
  if (!er) {
    throw Object.assign(new Error("Exit request not found"), { statusCode: 404, code: "EXIT_NOT_FOUND" });
  }
  if (er.ff_exception_bh_at) {
    throw Object.assign(new Error("The Branch Head has already approved this exception."), {
      statusCode: 409,
      code: "FF_EXCEPTION_BH_EXISTS",
    });
  }
  const gate = await ffSettlementGate(String(er.employee_id), params.exitRequestId);
  if (gate.code !== "ABSCONDED_NO_EXCEPTION") {
    throw Object.assign(new Error("This exit is not an absconding case awaiting an exception."), {
      statusCode: 409,
      code: "FF_EXCEPTION_NOT_NEEDED",
    });
  }
  await db.execute(
    `UPDATE exit_request SET ff_exception_bh_by = ?, ff_exception_bh_at = NOW(), ff_exception_bh_reason = ?
      WHERE id = ? AND ff_exception_bh_at IS NULL`,
    [params.actorUserId, reason.slice(0, 500), params.exitRequestId],
  );
  await logSensitiveAction({
    actor_user_id: params.actorUserId,
    actor_role: params.actorRole ?? undefined,
    action_type: "FF_ABSCONDER_EXCEPTION_BRANCH_HEAD_APPROVED",
    module_key: "exit",
    entity_type: "exit_request",
    entity_id: params.exitRequestId,
    change_summary: { employee_id: String(er.employee_id), reason },
  });
}

/** Where an absconder's exception stands, for the screen. */
export async function ffExceptionProgress(exitRequestId: string): Promise<{
  branchHeadApproved: boolean;
  payrollHeadApproved: boolean;
}> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ff_exception_bh_at, ff_exception_at FROM exit_request WHERE id = ? LIMIT 1`,
    [exitRequestId],
  );
  return { branchHeadApproved: Boolean(rows[0]?.ff_exception_bh_at), payrollHeadApproved: Boolean(rows[0]?.ff_exception_at) };
}
