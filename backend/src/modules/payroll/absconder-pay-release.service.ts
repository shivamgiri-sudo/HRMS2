/**
 * Hold and release of an absconder's pay.
 *
 * DEFAULT: an absconded employee is paid by the system as normal.
 *
 * To make the salary days 0:
 *   1. the employee's reporting manager requests it, with a reason (requestHold); or the branch Payroll HR
 *      places it directly (placeHold);
 *   2. the branch Payroll HR approves the request (approveHoldRequest) or rejects it with a reason. The
 *      days go to 0 when the Payroll HR approves.
 * To bring the days back: the branch Payroll HR releases the hold (releaseHold), with a reason.
 *
 * No Branch Head and no Payroll Head step is involved. (The F&F exception for absconders keeps its own
 * Branch Head -> Payroll Head chain in ff-settlement-gate.service.ts; that is about F&F, not salary.)
 *
 * Nothing here writes a salary line. The hold is derived (absconder-hold.service.ts); this changes
 * exit_request, and the targeted recalculation makes the days change immediately.
 */

import { randomUUID } from "node:crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { recalculateOpenPayrollForEmployee } from "./payroll-targeted-recalculation.service.js";
import { absconderHoldConfig, isAbsconderPayHeld } from "./absconder-hold.service.js";
import { inboxService } from "../inbox/inbox.service.js";
import { branchOnlyRoleHolders } from "./noc.notifications.js";

export type HoldState = "not_held" | "hold_requested" | "request_rejected" | "held" | "released";

function refuse(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

interface ExitRow extends RowDataPacket {
  id: string;
  employee_id: string;
  branch_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  last_working_day: string | null;
  pay_hold_requested_at: string | null;
  pay_hold_requested_by: string | null;
  pay_hold_requested_reason: string | null;
  pay_hold_at: string | null;
  pay_hold_released_at: string | null;
  pay_release_route: string | null;
  reporting_manager_user_id: string | null;
  exit_type: string | null;
  exit_sub_type: string | null;
  status: string | null;
}

async function loadExit(exitRequestId: string): Promise<ExitRow> {
  const [rows] = await db.execute<ExitRow[]>(
    `SELECT er.id, er.employee_id, e.branch_id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name,
            COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed, er.absconding_since) AS last_working_day,
            er.pay_hold_requested_at, er.pay_hold_requested_by, er.pay_hold_requested_reason,
            er.pay_hold_at, er.pay_hold_released_at, er.pay_release_route,
            mgr.user_id AS reporting_manager_user_id,
            er.exit_type, er.exit_sub_type, er.status
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
       LEFT JOIN employees mgr ON mgr.id = COALESCE(e.reporting_manager_id, e.manager_id)
      WHERE er.id = ? LIMIT 1`,
    [exitRequestId],
  );
  if (!rows[0]) throw refuse(404, "EXIT_NOT_FOUND", "Exit request not found");
  return rows[0];
}

async function writeEvent(x: ExitRow, action: string, actorUserId: string | null, actorRole: string | null, reason: string | null) {
  await db.execute(
    `INSERT INTO absconder_pay_release_event (id, exit_request_id, employee_id, action, actor_user_id, actor_role, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), x.id, x.employee_id, action, actorUserId, actorRole, reason?.slice(0, 500) ?? null],
  );
}

function assertAbsconding(x: ExitRow): void {
  const isAbs = [x.exit_type, x.exit_sub_type].some((v) => ["absconding", "abandonment"].includes(String(v ?? "").toLowerCase()));
  const live = !["draft", "revoked", "rejected", "cancelled", "withdrawn"].includes(String(x.status ?? "").toLowerCase());
  if (!isAbs || !live) throw refuse(409, "HOLD_NOT_ABSCONDING", "A pay hold can only be placed on a live absconding exit.");
}

async function assertFeatureOn(): Promise<void> {
  if (!(await absconderHoldConfig()).enabled) {
    throw refuse(409, "HOLD_FEATURE_OFF", "Holding an absconder's salary is not switched on.");
  }
}

function needReason(reason: string | undefined, code = "HOLD_REASON_REQUIRED"): string {
  const r = reason?.trim() ?? "";
  if (r.length < 15) throw refuse(400, code, "A reason of at least 15 characters is required.");
  return r;
}

/** Is this user the branch Payroll HR for the employee's branch? */
export async function isBranchPayrollHr(userId: string, branchId: string | null): Promise<boolean> {
  return (await branchOnlyRoleHolders(["payroll_hr"], branchId)).includes(userId);
}

/** Is this user the employee's reporting manager? */
function isReportingManager(userId: string, x: ExitRow): boolean {
  return Boolean(x.reporting_manager_user_id) && String(x.reporting_manager_user_id) === String(userId);
}

/** Months whose open runs may hold a line for this person: the last worked day's month and the two before. */
function monthsToRecalc(lastWorkingDay: string | null): string[] {
  const d = lastWorkingDay ? new Date(String(lastWorkingDay).slice(0, 10)) : new Date();
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Recalculate the person's open runs so the change shows now, not at the nightly run. */
async function recalcOpenRuns(x: ExitRow, reason: string, actorUserId: string | null): Promise<{ openRunRecalculated: boolean }> {
  let openRunRecalculated = false;
  for (const month of monthsToRecalc(x.last_working_day)) {
    try {
      const r = await recalculateOpenPayrollForEmployee({
        employeeId: x.employee_id, payrollMonth: month, sourceEventType: "absconder_pay_hold",
        sourceEventId: x.id, reason, actorUserId, enqueueOnMiss: false,
      });
      if (r.status === "recalculated") openRunRecalculated = true;
    } catch (err) {
      console.error(`[absconder-pay-hold] recalc ${x.employee_code} ${month}:`, (err as Error).message);
    }
  }
  return { openRunRecalculated };
}

async function inbox(userIds: string[], type: string, x: ExitRow, title: string, description: string): Promise<void> {
  for (const userId of new Set(userIds.filter(Boolean))) {
    await inboxService.createItem({
      user_id: userId, type, title, description,
      entity_type: "exit_request", entity_id: x.id,
      action_url: `/payroll/full-final?approvalId=${x.id}`, priority: "high",
    }).catch(() => undefined);
  }
}
async function closeTasks(x: ExitRow, types: string[]) {
  await inboxService.resolveItems({ entity_type: "exit_request", entity_id: x.id, types }).catch(() => undefined);
}

export async function getHoldState(exitRequestId: string): Promise<{
  state: HoldState; held: boolean; requested: boolean; route: string | null;
  lastEvent: { action: string; reason: string | null; at: string } | null;
}> {
  const x = await loadExit(exitRequestId);
  const [ev] = await db.execute<RowDataPacket[]>(
    `SELECT action, reason, created_at FROM absconder_pay_release_event WHERE exit_request_id = ? ORDER BY seq DESC LIMIT 1`,
    [exitRequestId],
  );
  const last = ev[0] ? { action: String(ev[0].action), reason: ev[0].reason ?? null, at: String(ev[0].created_at) } : null;
  const held = await isAbsconderPayHeld(x.employee_id);
  let state: HoldState;
  if (x.pay_hold_at && x.pay_hold_released_at) state = "released";
  else if (x.pay_hold_at) state = "held";
  else if (x.pay_hold_requested_at) state = "hold_requested";
  else if (last?.action === "hold_request_rejected") state = "request_rejected";
  else state = "not_held";
  return { state, held, requested: Boolean(x.pay_hold_requested_at && !x.pay_hold_at), route: x.pay_release_route, lastEvent: last };
}

/** The reporting manager asks for the salary days to be made 0. Nothing changes until Payroll HR approves. */
export async function requestHold(p: { exitRequestId: string; reason: string; actorUserId: string }): Promise<void> {
  await assertFeatureOn();
  const reason = needReason(p.reason);
  const x = await loadExit(p.exitRequestId);
  assertAbsconding(x);
  if (!isReportingManager(p.actorUserId, x)) {
    throw refuse(403, "HOLD_NOT_YOUR_CALL", "Only the employee's reporting manager can request a hold. The branch Payroll HR can place one directly.");
  }
  if (x.pay_hold_at && !x.pay_hold_released_at) throw refuse(409, "HOLD_ALREADY_PLACED", "Salary is already on hold for this employee.");
  if (x.pay_hold_requested_at && !x.pay_hold_at) throw refuse(409, "HOLD_ALREADY_REQUESTED", "A hold has already been requested and is waiting for Payroll HR.");
  await db.execute(
    `UPDATE exit_request SET pay_hold_requested_at = NOW(), pay_hold_requested_by = ?, pay_hold_requested_reason = ?,
            pay_hold_at = NULL, pay_hold_released_at = NULL, pay_hold_released_by = NULL, pay_hold_released_reason = NULL
      WHERE id = ?`,
    [p.actorUserId, reason, x.id],
  );
  await writeEvent(x, "hold_requested", p.actorUserId, "reporting_manager", reason);
  await inbox(await branchOnlyRoleHolders(["payroll_hr"], x.branch_id), "absconder_pay_hold_request", x,
    `Absconder salary hold request: ${x.employee_name ?? x.employee_code ?? ""}`,
    `The reporting manager asks for the salary days to be made 0. Reason: ${reason}`);
}

async function applyHold(x: ExitRow, actorUserId: string, role: string, reason: string, event: "hold_placed") {
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE exit_request SET pay_hold_at = NOW(), pay_hold_by = ?, pay_hold_role = ?, pay_hold_reason = ?,
            pay_hold_released_at = NULL, pay_hold_released_by = NULL, pay_hold_released_reason = NULL
      WHERE id = ? AND (pay_hold_at IS NULL OR pay_hold_released_at IS NOT NULL)`,
    [actorUserId, role, reason, x.id],
  );
  if (res.affectedRows !== 1) throw refuse(409, "HOLD_ALREADY_PLACED", "Salary was just put on hold by someone else.");
  await writeEvent(x, event, actorUserId, role, reason);
  await recalcOpenRuns(x, "Absconder salary held at 0 days (branch Payroll HR approved)", actorUserId);
}

/** The branch Payroll HR approves the reporting manager's request: the days go to 0. */
export async function approveHoldRequest(p: { exitRequestId: string; reason: string; actorUserId: string }): Promise<void> {
  await assertFeatureOn();
  const reason = needReason(p.reason);
  const x = await loadExit(p.exitRequestId);
  assertAbsconding(x);
  if (!(await isBranchPayrollHr(p.actorUserId, x.branch_id))) {
    throw refuse(403, "HOLD_NOT_YOUR_CALL", "Only the branch Payroll HR can approve a salary hold.");
  }
  if (!x.pay_hold_requested_at || x.pay_hold_at) throw refuse(409, "HOLD_NOT_REQUESTED", "There is no pending hold request for this employee.");
  await applyHold(x, p.actorUserId, "branch_payroll_hr", `${reason} (requested: ${x.pay_hold_requested_reason ?? ""})`.slice(0, 500), "hold_placed");
  await closeTasks(x, ["absconder_pay_hold_request"]);
  await inbox(x.reporting_manager_user_id ? [x.reporting_manager_user_id] : [], "absconder_pay_hold_decision", x,
    `Salary hold approved: ${x.employee_name ?? x.employee_code ?? ""}`, "Payroll HR approved the hold. Salary days are 0 until Payroll HR releases it.");
}

/** The branch Payroll HR declines the request. Salary stays as normal. */
export async function rejectHoldRequest(p: { exitRequestId: string; reason: string; actorUserId: string }): Promise<void> {
  const reason = needReason(p.reason);
  const x = await loadExit(p.exitRequestId);
  if (!(await isBranchPayrollHr(p.actorUserId, x.branch_id))) {
    throw refuse(403, "HOLD_NOT_YOUR_CALL", "Only the branch Payroll HR can decide a salary hold request.");
  }
  if (!x.pay_hold_requested_at || x.pay_hold_at) throw refuse(409, "HOLD_NOT_REQUESTED", "There is no pending hold request for this employee.");
  await db.execute(
    `UPDATE exit_request SET pay_hold_requested_at = NULL, pay_hold_requested_by = NULL, pay_hold_requested_reason = NULL WHERE id = ? AND pay_hold_at IS NULL`,
    [x.id],
  );
  await writeEvent(x, "hold_request_rejected", p.actorUserId, "branch_payroll_hr", reason);
  await closeTasks(x, ["absconder_pay_hold_request"]);
  await inbox(x.reporting_manager_user_id ? [x.reporting_manager_user_id] : [], "absconder_pay_hold_decision", x,
    `Salary hold request declined: ${x.employee_name ?? x.employee_code ?? ""}`, `Payroll HR declined. ${reason} Salary continues as normal.`);
}

/** The branch Payroll HR places a hold directly (no request needed). */
export async function placeHold(p: { exitRequestId: string; reason: string; actorUserId: string }): Promise<{ role: string }> {
  await assertFeatureOn();
  const reason = needReason(p.reason);
  const x = await loadExit(p.exitRequestId);
  assertAbsconding(x);
  if (!(await isBranchPayrollHr(p.actorUserId, x.branch_id))) {
    throw refuse(403, "HOLD_NOT_YOUR_CALL", "Only the branch Payroll HR can place a salary hold directly; the reporting manager requests one.");
  }
  if (x.pay_hold_at && !x.pay_hold_released_at) throw refuse(409, "HOLD_ALREADY_PLACED", "Salary is already on hold for this employee.");
  await applyHold(x, p.actorUserId, "branch_payroll_hr", reason, "hold_placed");
  await closeTasks(x, ["absconder_pay_hold_request"]);
  return { role: "branch_payroll_hr" };
}

/** The branch Payroll HR lifts the hold: attendance days return. Recorded once as payroll or F&F. */
export async function releaseHold(p: { exitRequestId: string; reason: string; actorUserId: string }): Promise<{ route: "payroll" | "fnf"; openRunRecalculated: boolean }> {
  const reason = needReason(p.reason);
  const x = await loadExit(p.exitRequestId);
  if (!(await isBranchPayrollHr(p.actorUserId, x.branch_id))) {
    throw refuse(403, "HOLD_NOT_YOUR_CALL", "Only the branch Payroll HR can release a salary hold.");
  }
  if (!x.pay_hold_at) throw refuse(409, "HOLD_NOT_PLACED", "No hold is placed on this employee's salary.");
  if (x.pay_hold_released_at) throw refuse(409, "HOLD_ALREADY_RELEASED", "This hold has already been released.");
  await db.execute(
    `UPDATE exit_request SET pay_hold_released_at = NOW(), pay_hold_released_by = ?, pay_hold_released_reason = ? WHERE id = ? AND pay_hold_released_at IS NULL`,
    [p.actorUserId, reason, x.id],
  );
  await writeEvent(x, "hold_released", p.actorUserId, "branch_payroll_hr", reason);
  await closeTasks(x, ["absconder_pay_hold_request", "absconder_pay_hold_decision"]);
  // The hold is lifted. Rebuild the days in every open run; a closed month is paid through the F&F instead,
  // and the route is recorded once so the same days can never be paid twice.
  const { openRunRecalculated } = await recalcOpenRuns(x, "Absconder pay hold released: attendance days restored", p.actorUserId);
  const route = openRunRecalculated ? "payroll" : "fnf";
  await db.execute(`UPDATE exit_request SET pay_release_route = ? WHERE id = ? AND pay_release_route IS NULL`, [route, x.id]);
  return { route, openRunRecalculated };
}
