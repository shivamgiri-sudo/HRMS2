/**
 * Hold and release of an absconder's pay.
 *
 * DEFAULT: an absconded employee is paid by the system as normal. Only the employee's reporting manager, the
 * branch Payroll HR or the Branch Head can decide to make the salary days 0 (placeHold). That call needs no
 * approval; it lasts until the Branch Head and then a DIFFERENT Payroll Head release it, or until it is
 * withdrawn. On release the paid days build again.
 *
 * ONE CHAIN. The two approvals are the ones the F&F exception already uses (exit_request.ff_exception_bh_*
 * then ff_exception_*, ff-settlement-gate.service.ts, which also enforces the 15-character reason and the
 * different-person rule). Releasing salary and unlocking the F&F exception are the same decision. F&F still
 * needs a fully signed NOC; that rule lives in ffSettlementGate and is untouched.
 *
 * Rejection keeps the days at 0. It is recorded with a reason and can be re-requested, which starts again at
 * the Branch Head (a stale Branch Head approval is cleared).
 *
 * Nothing here writes a salary line. The hold is derived (absconder-hold.service.ts); approving changes
 * exit_request, and the targeted recalculation below makes the days reappear immediately.
 */

import { randomUUID } from "node:crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { recordBranchHeadFfException, grantAbscondingFfException } from "../exit/ff-settlement-gate.service.js";
import { recalculateOpenPayrollForEmployee } from "./payroll-targeted-recalculation.service.js";
import { absconderHoldConfig, isAbsconderPayHeld } from "./absconder-hold.service.js";
import { inboxService } from "../inbox/inbox.service.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
import { branchHeadUserIds, branchOnlyRoleHolders } from "./noc.notifications.js";

export type ReleaseState =
  | "not_held"
  | "awaiting_branch_head"
  | "awaiting_payroll_head"
  | "rejected_by_branch_head"
  | "rejected_by_payroll_head"
  | "released";

function refuse(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

interface ExitRow extends RowDataPacket {
  id: string;
  employee_id: string;
  branch_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  absconding_since: string | null;
  last_working_day: string | null;
  ff_exception_bh_at: string | null;
  ff_exception_at: string | null;
  pay_release_route: string | null;
  pay_hold_at: string | null;
  exit_type: string | null;
  exit_sub_type: string | null;
  status: string | null;
}

async function loadExit(exitRequestId: string): Promise<ExitRow> {
  const [rows] = await db.execute<ExitRow[]>(
    `SELECT er.id, er.employee_id, e.branch_id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name,
            er.absconding_since,
            COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed, er.absconding_since) AS last_working_day,
            er.ff_exception_bh_at, er.ff_exception_at, er.pay_release_route, er.pay_hold_at,
            er.exit_type, er.exit_sub_type, er.status
       FROM exit_request er JOIN employees e ON e.id = er.employee_id
      WHERE er.id = ? LIMIT 1`,
    [exitRequestId],
  );
  if (!rows[0]) throw refuse(404, "EXIT_NOT_FOUND", "Exit request not found");
  return rows[0];
}

async function writeEvent(
  x: ExitRow,
  action: string,
  actorUserId: string | null,
  actorRole: string | null,
  reason: string | null,
): Promise<void> {
  await db.execute(
    `INSERT INTO absconder_pay_release_event (id, exit_request_id, employee_id, action, actor_user_id, actor_role, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), x.id, x.employee_id, action, actorUserId, actorRole, reason?.slice(0, 500) ?? null],
  );
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

/** Recalculate the person's open runs so the hold (or its release) shows now, not at the nightly run. */
async function recalcOpenRuns(x: ExitRow, reason: string, actorUserId: string | null): Promise<{ openRunRecalculated: boolean }> {
  let openRunRecalculated = false;
  for (const month of monthsToRecalc(x.last_working_day)) {
    try {
      const r = await recalculateOpenPayrollForEmployee({
        employeeId: x.employee_id,
        payrollMonth: month,
        sourceEventType: "absconder_pay_release",
        sourceEventId: x.id,
        reason,
        actorUserId,
        enqueueOnMiss: false,
      });
      if (r.status === "recalculated") openRunRecalculated = true;
    } catch (err) {
      console.error(`[absconder-pay-release] recalc ${x.employee_code} ${month}:`, (err as Error).message);
    }
  }
  return { openRunRecalculated };
}

export async function getReleaseState(exitRequestId: string): Promise<{
  state: ReleaseState;
  held: boolean;
  branchHeadApproved: boolean;
  payrollHeadApproved: boolean;
  route: string | null;
  lastEvent: { action: string; reason: string | null; at: string } | null;
}> {
  const x = await loadExit(exitRequestId);
  const [ev] = await db.execute<RowDataPacket[]>(
    `SELECT action, reason, created_at FROM absconder_pay_release_event
      WHERE exit_request_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    [exitRequestId],
  );
  const last = ev[0] ? { action: String(ev[0].action), reason: ev[0].reason ?? null, at: String(ev[0].created_at) } : null;
  const held = await isAbsconderPayHeld(x.employee_id);
  const bh = Boolean(x.ff_exception_bh_at);
  const ph = Boolean(x.ff_exception_at);
  let state: ReleaseState;
  if (ph) state = "released";
  else if (last?.action === "bh_rejected") state = "rejected_by_branch_head";
  else if (last?.action === "ph_rejected") state = "rejected_by_payroll_head";
  else if (bh) state = "awaiting_payroll_head";
  else state = held ? "awaiting_branch_head" : "not_held";
  // held already means: a hold was placed, the feature is on, and nothing has released it.
  return { state, held, branchHeadApproved: bh, payrollHeadApproved: ph, route: x.pay_release_route, lastEvent: last };
}

/**
 * Which of the three people who may decide this is the caller? null when none of them.
 *   - the employee's reporting manager
 *   - the Payroll HR of the employee's branch
 *   - the Branch Head of the employee's branch
 */
export async function holdDeciderRole(
  userId: string,
  x: { employee_id: string; branch_id: string | null },
): Promise<"reporting_manager" | "branch_payroll_hr" | "branch_head" | null> {
  const [mgr] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM employees emp
       JOIN employees m ON m.id = COALESCE(emp.reporting_manager_id, emp.manager_id)
      WHERE emp.id = ? AND m.user_id = ? LIMIT 1`,
    [x.employee_id, userId],
  );
  if (mgr.length) return "reporting_manager";
  if ((await branchOnlyRoleHolders(["payroll_hr"], x.branch_id)).includes(userId)) return "branch_payroll_hr";
  if ((await branchHeadUserIds(x.branch_id)).includes(userId)) return "branch_head";
  return null;
}

function assertAbsconding(x: ExitRow): void {
  const isAbs = [x.exit_type, x.exit_sub_type].some((v) => ["absconding", "abandonment"].includes(String(v ?? "").toLowerCase()));
  const live = !["draft", "revoked", "rejected", "cancelled", "withdrawn"].includes(String(x.status ?? "").toLowerCase());
  if (!isAbs || !live) throw refuse(409, "HOLD_NOT_ABSCONDING", "A pay hold can only be placed on a live absconding exit.");
}

/** Make an absconder's salary days 0. Reporting manager, branch Payroll HR or Branch Head only. */
export async function placeHold(p: { exitRequestId: string; reason: string; actorUserId: string }): Promise<{ role: string }> {
  if (!(await absconderHoldConfig()).enabled) {
    throw refuse(409, "HOLD_FEATURE_OFF", "Holding an absconder's salary is not switched on.");
  }
  const reason = p.reason?.trim() ?? "";
  if (reason.length < 15) throw refuse(400, "HOLD_REASON_REQUIRED", "A reason of at least 15 characters is required to hold salary.");
  const x = await loadExit(p.exitRequestId);
  assertAbsconding(x);
  if (x.ff_exception_at) throw refuse(409, "HOLD_ALREADY_RELEASED", "Pay has already been released for this employee.");
  if (x.pay_hold_at) throw refuse(409, "HOLD_ALREADY_PLACED", "Salary is already on hold for this employee.");
  const role = await holdDeciderRole(p.actorUserId, x);
  if (!role) {
    throw refuse(403, "HOLD_NOT_YOUR_CALL", "Only the employee's reporting manager, the branch Payroll HR or the Branch Head can hold this salary.");
  }
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE exit_request SET pay_hold_at = NOW(), pay_hold_by = ?, pay_hold_role = ?, pay_hold_reason = ?
      WHERE id = ? AND pay_hold_at IS NULL AND ff_exception_at IS NULL`,
    [p.actorUserId, role, reason.slice(0, 500), x.id],
  );
  if (res.affectedRows !== 1) throw refuse(409, "HOLD_ALREADY_PLACED", "Salary was just put on hold by someone else.");
  await writeEvent(x, "hold_placed", p.actorUserId, role, reason);
  // Drop the open lines to 0 now, not at the next nightly run.
  await recalcOpenRuns(x, "Absconder salary held at 0 days on a reporting manager / Payroll HR / Branch Head decision", p.actorUserId);
  if (role !== "branch_head") await notifyBranchHead(x);
  return { role };
}

/** Lift a hold that was placed, before any release: salary returns to normal. Same three people (or Payroll Head). */
export async function withdrawHold(p: { exitRequestId: string; reason: string; actorUserId: string }): Promise<void> {
  const reason = p.reason?.trim() ?? "";
  if (reason.length < 15) throw refuse(400, "HOLD_REASON_REQUIRED", "A reason of at least 15 characters is required to withdraw a hold.");
  const x = await loadExit(p.exitRequestId);
  if (!x.pay_hold_at) throw refuse(409, "HOLD_NOT_PLACED", "No hold is placed on this employee's salary.");
  if (x.ff_exception_at) throw refuse(409, "HOLD_ALREADY_RELEASED", "Pay has already been released.");
  const role = await holdDeciderRole(p.actorUserId, x);
  if (!role) throw refuse(403, "HOLD_NOT_YOUR_CALL", "Only the employee's reporting manager, the branch Payroll HR or the Branch Head can withdraw this hold.");
  await db.execute(
    `UPDATE exit_request SET pay_hold_at = NULL, pay_hold_by = NULL, pay_hold_role = NULL, pay_hold_reason = NULL
      WHERE id = ? AND ff_exception_at IS NULL`,
    [x.id],
  );
  await writeEvent(x, "hold_withdrawn", p.actorUserId, role, reason);
  await closeTasks(x.id, ["absconder_pay_release_bh", "absconder_pay_release_ph", "absconder_pay_release_rejected"]);
  await recalcOpenRuns(x, "Absconder salary hold withdrawn: normal days restored", p.actorUserId);
}

async function notifyBranchHead(x: ExitRow): Promise<void> {
  try {
    for (const userId of await branchHeadUserIds(x.branch_id)) {
      await inboxService.createItem({
        user_id: userId,
        type: "absconder_pay_release_bh",
        title: `Absconder pay release — your approval: ${x.employee_name ?? x.employee_code ?? ""}`,
        description: "Salary days are held at 0 until you and then the Payroll Head approve. Give a reason when you approve or reject.",
        entity_type: "exit_request",
        entity_id: x.id,
        action_url: `/payroll/full-final?approvalId=${x.id}`,
        priority: "high",
      }).catch(() => undefined);
    }
  } catch (err) {
    console.error("[absconder-pay-release] notify branch head:", (err as Error).message);
  }
}

async function notifyPayrollHead(x: ExitRow): Promise<void> {
  try {
    for (const userId of await resolveRoleHolderUserIds("payroll_head", null)) {
      await inboxService.createItem({
        user_id: userId,
        type: "absconder_pay_release_ph",
        title: `Absconder pay release — Payroll Head approval: ${x.employee_name ?? x.employee_code ?? ""}`,
        description: "The Branch Head has approved. Your approval releases the held salary days and unlocks the F&F exception.",
        entity_type: "exit_request",
        entity_id: x.id,
        action_url: `/payroll/full-final?approvalId=${x.id}`,
        priority: "high",
      }).catch(() => undefined);
    }
  } catch (err) {
    console.error("[absconder-pay-release] notify payroll head:", (err as Error).message);
  }
}

async function closeTasks(exitRequestId: string, types: string[]): Promise<void> {
  await inboxService.resolveItems({ entity_type: "exit_request", entity_id: exitRequestId, types }).catch(() => undefined);
}

export async function branchHeadApprove(p: { exitRequestId: string; reason: string; actorUserId: string; actorRole?: string | null }): Promise<void> {
  await recordBranchHeadFfException({ exitRequestId: p.exitRequestId, reason: p.reason, actorUserId: p.actorUserId, actorRole: p.actorRole });
  const x = await loadExit(p.exitRequestId);
  await writeEvent(x, "bh_approved", p.actorUserId, p.actorRole ?? "branch_head", p.reason);
  await closeTasks(x.id, ["absconder_pay_release_bh"]);
  await notifyPayrollHead(x);
}

export async function branchHeadReject(p: { exitRequestId: string; reason: string; actorUserId: string; actorRole?: string | null }): Promise<void> {
  return reject(p, "bh_rejected", "absconder_pay_release_bh");
}

export async function payrollHeadReject(p: { exitRequestId: string; reason: string; actorUserId: string; actorRole?: string | null }): Promise<void> {
  return reject(p, "ph_rejected", "absconder_pay_release_ph");
}

async function reject(
  p: { exitRequestId: string; reason: string; actorUserId: string; actorRole?: string | null },
  action: "bh_rejected" | "ph_rejected",
  taskType: string,
): Promise<void> {
  const reason = p.reason?.trim() ?? "";
  if (reason.length < 15) throw refuse(400, "RELEASE_REASON_REQUIRED", "A reason of at least 15 characters is required to reject.");
  const x = await loadExit(p.exitRequestId);
  if (x.ff_exception_at) throw refuse(409, "RELEASE_ALREADY_DONE", "The pay release has already been approved.");
  if (action === "ph_rejected" && !x.ff_exception_bh_at) {
    throw refuse(409, "RELEASE_BRANCH_HEAD_PENDING", "The Branch Head has not approved yet.");
  }
  await writeEvent(x, action, p.actorUserId, p.actorRole ?? null, reason);
  await closeTasks(x.id, [taskType]);
  // The days stay at 0 (nothing changes in the hold); the people who can re-request are told.
  try {
    for (const userId of await resolveRoleHolderUserIds("hr", x.branch_id)) {
      await inboxService.createItem({
        user_id: userId,
        type: "absconder_pay_release_rejected",
        title: `Absconder pay release rejected — ${x.employee_name ?? x.employee_code ?? ""}`,
        description: `${reason} Salary stays held at 0. Re-request with new facts if the decision should be reconsidered.`,
        entity_type: "exit_request",
        entity_id: x.id,
        action_url: `/payroll/full-final?approvalId=${x.id}`,
        priority: "normal",
      }).catch(() => undefined);
    }
  } catch { /* the bell is a mirror */ }
}

/** After a rejection: start again at the Branch Head with a fresh reason. */
export async function reRequest(p: { exitRequestId: string; reason: string; actorUserId: string; actorRole?: string | null }): Promise<void> {
  const reason = p.reason?.trim() ?? "";
  if (reason.length < 15) throw refuse(400, "RELEASE_REASON_REQUIRED", "A reason of at least 15 characters is required to re-request.");
  const x = await loadExit(p.exitRequestId);
  if (x.ff_exception_at) throw refuse(409, "RELEASE_ALREADY_DONE", "The pay release has already been approved.");
  const s = await getReleaseState(p.exitRequestId);
  if (s.state !== "rejected_by_branch_head" && s.state !== "rejected_by_payroll_head") {
    throw refuse(409, "RELEASE_NOT_REJECTED", "Only a rejected release can be re-requested.");
  }
  // A stale Branch Head approval must not carry over: the Payroll Head only decides on a fresh one.
  await db.execute(
    `UPDATE exit_request SET ff_exception_bh_by = NULL, ff_exception_bh_at = NULL, ff_exception_bh_reason = NULL
      WHERE id = ? AND ff_exception_at IS NULL`,
    [x.id],
  );
  await writeEvent(x, "re_requested", p.actorUserId, p.actorRole ?? null, reason);
  await notifyBranchHead(x);
}

export async function payrollHeadApprove(p: { exitRequestId: string; reason: string; actorUserId: string; actorRole?: string | null }): Promise<{
  route: "payroll" | "fnf";
  openRunRecalculated: boolean;
}> {
  await grantAbscondingFfException({ exitRequestId: p.exitRequestId, reason: p.reason, actorUserId: p.actorUserId, actorRole: p.actorRole });
  const x = await loadExit(p.exitRequestId);
  await writeEvent(x, "ph_approved", p.actorUserId, p.actorRole ?? "payroll_head", p.reason);
  await closeTasks(x.id, ["absconder_pay_release_bh", "absconder_pay_release_ph", "absconder_pay_release_rejected"]);
  // Hold is lifted (ff_exception_at is set). Rebuild the days in every open run; a closed month is paid
  // through the F&F instead, and the route is recorded once so the same days are never paid twice.
  // Only when a hold had been placed: with no hold the employee was being paid normally, and there is
  // nothing to rebuild or route.
  if (!x.pay_hold_at) return { route: "payroll", openRunRecalculated: false };
  const { openRunRecalculated } = await recalcOpenRuns(x, "Absconder pay release approved: attendance days restored", p.actorUserId);
  const route = openRunRecalculated ? "payroll" : "fnf";
  await db.execute(`UPDATE exit_request SET pay_release_route = ? WHERE id = ? AND pay_release_route IS NULL`, [route, x.id]);
  return { route, openRunRecalculated };
}
