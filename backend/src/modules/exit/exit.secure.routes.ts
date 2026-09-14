import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { buildScopeWhereClause, hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { nocRequired, nocValidated } from "../payroll/noc.service.js";
import { exitService } from "./exit.service.js";

export const exitSecureRouter = Router();
exitSecureRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const EXIT_SCOPE_ROLES = ["manager", "assistant_manager", "tl", "branch_head", "process_manager", "hr"];

/**
 * FSM transitions for exit_request.status.
 *
 * Corrected business flow (2026-08-23):
 * - Employee submits resignation → goes to Manager
 * - Manager reviews and accepts resignation → status becomes "accepted"
 * - HR does retention attempts / exit interview during accepted period (via clearance tasks)
 * - HR or Employee can revoke if retained (revoke reason is optional)
 * - Admin does IT deprovisioning via clearance tasks only (NOT a status approval gate)
 * - After clearance → notice_serving → exited
 *
 * Removed from approval chain:
 * - hr_review: HR does retention/interview but doesn't approve resignations
 * - admin_review: Admin does IT deprovisioning via clearance tasks, not status approval
 */
/**
 * 'rejected' is NOT reachable — owner ruling 2026-09-12.
 *
 * A manager cannot refuse a resignation. They may record that they disagree, WITH A REASON, and
 * that objection is kept on the exit's history — but the resignation stays active and the notice
 * period keeps running, because only the employee who raised it may withdraw it. See
 * POST /:id/objection in this file for where the objection is recorded.
 *
 * 'rejected' therefore no longer appears as a destination from manager_review. It is retained as
 * a terminal key so that the 11 historical rows already carrying it stay valid states with no
 * outbound transitions, rather than becoming a status the FSM does not recognise at all —
 * normalizeExitStatus would then hand them an empty allow-list and every action on them would
 * report "Allowed: none", which is correct but for the wrong reason.
 */
export const ALLOWED_EXIT_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted", "revoked", "withdrawn"],
  submitted: ["manager_review", "revoked", "withdrawn"],
  manager_review: ["accepted", "revoked", "withdrawn"],
  accepted: ["notice_serving", "clearance_pending", "revoked", "withdrawn"],
  notice_serving: ["exited", "revoked", "withdrawn"],
  clearance_pending: ["fnf_pending", "revoked", "withdrawn"],
  fnf_pending: ["closed", "revoked", "withdrawn"],
  closed: [],
  /** Terminal and unreachable. Kept for rows written before the ruling above. */
  rejected: [],
  revoked: [],
  withdrawn: [],
  exited: [],
};

/** Shared by handleExitStatusUpdate below and resignation.routes.ts's status-writing endpoints
 * — the single source of truth for whether a transition is legal, so the two files can't drift
 * the way the four now-unmounted duplicate FSM guards did (see the file-header comment on
 * handleExitStatusUpdate). */
export function assertValidExitTransition(
  currentStatus: unknown,
  nextStatus: unknown,
): { ok: true } | { ok: false; message: string } {
  const from = normalizeExitStatus(currentStatus);
  const to = normalizeExitStatus(nextStatus);
  const allowed = ALLOWED_EXIT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      message: `Invalid exit transition: ${from} → ${to}. Allowed: ${allowed.join(", ") || "none"}`,
    };
  }
  return { ok: true };
}

/**
 * Blockers for the final "exited" transition: open clearance tasks, and F&F not yet approved
 * or still provisional. Originally built as finalExitBlockers() in exit.compat.routes.ts,
 * which never ran for the same shadowing reason as the FSM map above. Consolidated here.
 */
async function finalExitBlockers(exitRequestId: string): Promise<string[]> {
  const [clearanceRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS open_count
       FROM exit_clearance_task
      WHERE exit_request_id = ?
        AND status NOT IN ('cleared', 'waived')`,
    [exitRequestId],
  );
  const [ffRows] = await db.execute<RowDataPacket[]>(
    `SELECT status, is_ff_provisional
       FROM full_final_calculation
      WHERE exit_request_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [exitRequestId],
  );
  const ff = ffRows[0];
  const blockers: string[] = [];
  const openClearance = Number(clearanceRows[0]?.open_count ?? 0);
  if (openClearance > 0) blockers.push(`${openClearance} clearance task(s) still open`);
  if (!ff) blockers.push("F&F calculation is missing");
  else {
    if (!["approved", "paid"].includes(String(ff.status))) blockers.push(`F&F is ${ff.status}`);
    if (Number(ff.is_ff_provisional) === 1) blockers.push("F&F is provisional");
  }

  // NOC (2026-08-27). noc.service.ts has exported nocValidated() since it was written and
  // nothing ever called it: the NOC upload/validate workflow recorded a decision that no
  // downstream step consulted, so a leaver could reach "exited" — and their F&F be settled —
  // with the NOC still missing or rejected. Every other module's docs described NOC as the
  // gate on release; this is the first code that makes that true.
  //
  // Gated on nocRequired() rather than applied unconditionally, deliberately. That function
  // already encodes who needs one (inactive, and either an FNF with net_payable > 0 or an
  // open salary run) and was tuned to stop over-triggering on finalized runs. Reusing it
  // means this blocker cannot fire for a leaver the business never wanted a NOC from, and
  // any future change to the policy moves both call sites at once.
  //
  // Failure is non-fatal by design: if the NOC lookup itself errors, exit is NOT blocked.
  // Refusing every exit because a query failed would be a worse outage than the gap this
  // closes, and the surrounding transition has no way to distinguish the two.
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id FROM exit_request WHERE id = ? LIMIT 1`,
    [exitRequestId],
  );
  const employeeId = empRows[0]?.employee_id as string | undefined;
  if (employeeId) {
    try {
      const { required, reason } = await nocRequired(String(employeeId));
      if (required && !(await nocValidated(String(employeeId), "fnf"))) {
        blockers.push(
          `NOC not validated${reason ? ` (${reason})` : ""} — upload and validate it in Payroll › NOC Management`,
        );
      }
    } catch (err) {
      console.error("[exit.secure] NOC blocker check failed, not blocking exit:", err);
    }
  }

  return blockers;
}

function normalizeExitStatus(status: unknown): string {
  const value = String(status ?? "").trim();
  return value === "exit_confirmed" ? "exited" : value;
}

async function exitListScope(userId: string) {
  if (await hasAnyRole(userId, "admin", "hr", "finance", "payroll", "ceo")) return { sql: "1=1", params: [] as unknown[] };
  const scoped = await buildScopeWhereClause(
    userId,
    EXIT_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id",
      employeeId: "e.id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
  if (scoped.sql !== "1=0") return scoped;
  const emp = await getEmployeeForUser(userId);
  if (emp?.id) return { sql: "e.id = ?", params: [emp.id] as unknown[] };
  return { sql: "1=0", params: [] as unknown[] };
}

async function canActOnExit(userId: string, exitRequestId: string) {
  if (await hasAnyRole(userId, "admin", "hr", "ceo")) return true;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.employee_id,
            e.branch_id,
            e.process_id,
            e.lob_id,
            e.department_id,
            e.reporting_manager_id,
            e.manager_id
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
      WHERE er.id = ?
      LIMIT 1`,
    [exitRequestId],
  );
  const target = rows[0] as any;
  if (!target) return false;
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id === target.employee_id) return false;
  return hasScopedAccess(
    userId,
    EXIT_SCOPE_ROLES,
    {
      branchId: target.branch_id,
      processId: target.process_id,
      lobId: target.lob_id,
      departmentId: target.department_id,
      managerEmployeeId: target.reporting_manager_id ?? target.manager_id,
      employeeId: target.employee_id,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true },
  );
}

exitSecureRouter.get("/stats", h(async (req: any, res: any) => {
  const scope = await exitListScope(req.authUser!.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.status, COUNT(*) AS cnt
       FROM exit_request er
       LEFT JOIN employees e ON e.id = er.employee_id
      WHERE ${scope.sql}
      GROUP BY er.status`,
    scope.params,
  );
  const counts: Record<string, number> = {};
  for (const row of rows as any[]) counts[String(row.status)] = Number(row.cnt ?? 0);
  const statuses = ["draft", "submitted", "manager_review", "accepted", "rejected", "revoked", "withdrawn", "notice_serving", "clearance_pending", "fnf_pending", "closed", "exited"];
  const detailed = Object.fromEntries(statuses.map((s) => [s, counts[s] ?? 0])) as Record<string, number>;
  const total = Object.values(detailed).reduce((a, b) => a + b, 0);
  const pending = detailed.submitted + detailed.manager_review;
  return res.json({ success: true, data: { ...detailed, total, pending, completed: detailed.exited + detailed.closed, active_notice: detailed.accepted + detailed.notice_serving + detailed.clearance_pending + detailed.fnf_pending } });
}));

exitSecureRouter.get("/", h(async (req: any, res: any) => {
  const privileged = await hasAnyRole(req.authUser!.id, "admin", "hr", "finance", "payroll", "ceo", ...EXIT_SCOPE_ROLES);
  if (!privileged) {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp || !req.query.employeeId || String(req.query.employeeId) !== emp.id) {
      return res.status(403).json({ success: false, message: "Forbidden: employee collection access is not allowed" });
    }
  }
  const scope = await exitListScope(req.authUser!.id);
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 100) || 100), 500);
  const offset = (page - 1) * limit;
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  if (req.query.status) { conds.push("er.status = ?"); params.push(String(req.query.status === "exit_confirmed" ? "exited" : req.query.status)); }
  if (req.query.employeeId) { conds.push("er.employee_id = ?"); params.push(String(req.query.employeeId)); }
  if (req.query.branchId) { conds.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
  if (req.query.processId) { conds.push("e.process_id = ?"); params.push(String(req.query.processId)); }
  if (req.query.search) {
    const q = `%${String(req.query.search)}%`;
    conds.push("(e.employee_code LIKE ? OR e.full_name LIKE ? OR er.resignation_reason LIKE ? OR er.exit_reason_category LIKE ?)");
    params.push(q, q, q, q);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const fromSql = `FROM exit_request er LEFT JOIN employees e ON e.id = er.employee_id LEFT JOIN branch_master b ON b.id = e.branch_id LEFT JOIN process_master p ON p.id = e.process_id LEFT JOIN exit_employee_health_snapshot hs ON hs.exit_request_id = er.id LEFT JOIN (SELECT exit_request_id, COUNT(*) AS total_tasks, SUM(CASE WHEN status IN ('cleared','waived') THEN 1 ELSE 0 END) AS cleared_tasks FROM exit_clearance_task GROUP BY exit_request_id) clearance ON clearance.exit_request_id = er.id`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.*, e.employee_code, COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name, b.branch_name, p.process_name, hs.engagement_score, hs.regrettable_exit, hs.risk_label, COALESCE(clearance.total_tasks, 0) AS clearance_total, COALESCE(clearance.cleared_tasks, 0) AS clearance_cleared ${fromSql} ${where} ORDER BY er.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${fromSql} ${where}`, params);
  return res.json({ success: true, data: rows, total: Number(countRows[0]?.total ?? 0), page, limit });
}));

/**
 * Consolidated status-update handler — the sole implementation of PATCH/POST
 * /api/exit/:id/status. This used to be defined four separate times across four routers
 * mounted at /api/exit (exit.secure.routes.ts, exit.compat.routes.ts,
 * exit-status-guard.compat.routes.ts, exit.routes.ts); Express dispatches to the first
 * matching handler, so only this file's version — the one with the weakest guard — ever ran.
 * The other three each independently built half of the missing protection (FSM-transition
 * validity, and clearance/F&F blockers on "exited") as dead code. Both are merged in here;
 * the other three files' /:id/status registrations are removed. See
 * hrms2-exit-status-router-shadowing memory for the full history.
 */
async function handleExitStatusUpdate(req: any, res: any) {
  if (!(await canActOnExit(req.authUser!.id, req.params.id))) {
    return res.status(403).json({ success: false, message: "Forbidden: exit request is outside your action scope" });
  }

  const nextStatus = normalizeExitStatus(req.body?.status);
  // 'rejected' removed (owner ruling 2026-09-12): nobody may refuse a resignation. A manager who
  // disagrees records an objection via POST /:id/objection, which leaves the request active and
  // the notice period running. Refused here as well as in the FSM map so the API answers the
  // policy question directly instead of reporting a transition error.
  const allowed = ["submitted", "manager_review", "accepted", "notice_serving", "exited", "revoked", "withdrawn"];
  if (!allowed.includes(nextStatus)) {
    return res.status(400).json({
      success: false,
      message:
        nextStatus === "rejected"
          ? "A resignation cannot be rejected. Record an objection with a reason instead — the resignation stays active and only the employee can withdraw it."
          : "Invalid exit status",
    });
  }

  const remarks = String(req.body?.remarks ?? "").trim();
  const remarksOptionalFor = ["revoked", "withdrawn"];
  if (!remarks && !remarksOptionalFor.includes(nextStatus)) {
    return res.status(400).json({ success: false, message: "Remarks are required" });
  }

  // Notice terms. Both were already being SENT by NativeExitManagement's "Confirm & Advance"
  // modal (updateStatus() puts lastWorkingDayConfirmed and noticePeriodDays on the PATCH body)
  // and this handler read neither, so HR confirmed a Last Working Day and a notice period,
  // got a success toast, and nothing was persisted. Validated here rather than trusted:
  // last_working_day_confirmed feeds payroll's employment-end-date resolver, so a malformed
  // value would propagate into who gets paid and through what date.
  const rawLwd = req.body?.lastWorkingDayConfirmed ?? req.body?.last_working_day_confirmed;
  let lastWorkingDayConfirmed: string | null = null;
  if (rawLwd !== undefined && rawLwd !== null && String(rawLwd).trim() !== "") {
    const candidate = String(rawLwd).trim().slice(0, 10);
    // Format AND real-calendar check: /^\d{4}-\d{2}-\d{2}$/ alone accepts 2026-02-31, which
    // MySQL would then reject or coerce depending on sql_mode.
    const parsed = new Date(`${candidate}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(candidate) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== candidate
    ) {
      return res.status(400).json({
        success: false,
        message: "lastWorkingDayConfirmed must be a real calendar date in YYYY-MM-DD format",
      });
    }
    lastWorkingDayConfirmed = candidate;
  }

  const rawNoticeDays = req.body?.noticePeriodDays ?? req.body?.notice_period_days;
  let noticePeriodDays: number | null = null;
  if (rawNoticeDays !== undefined && rawNoticeDays !== null && String(rawNoticeDays).trim() !== "") {
    const n = Number(rawNoticeDays);
    // 0..365 matches the modal's max attribute. The bound is not cosmetic: this number is
    // multiplied by a per-day salary rate in ff-compute.service.ts to produce a notice-shortfall
    // recovery deducted from someone's settlement, so nonsense (negatives, 10000, "thirty",
    // 30.5) has to be refused here rather than turned into money.
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 365) {
      return res.status(400).json({
        success: false,
        message: "noticePeriodDays must be a whole number of days between 0 and 365",
      });
    }
    noticePeriodDays = n;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM exit_request WHERE id = ? LIMIT 1`,
    [req.params.id],
  );
  const current = rows[0];
  if (!current) return res.status(404).json({ success: false, message: "Exit request not found" });

  const currentStatus = normalizeExitStatus(current.status);
  const allowedNext = ALLOWED_EXIT_TRANSITIONS[currentStatus] ?? [];
  if (!allowedNext.includes(nextStatus)) {
    return res.status(409).json({
      success: false,
      message: `Invalid exit transition: ${currentStatus} → ${nextStatus}. Allowed: ${allowedNext.join(", ") || "none"}`,
    });
  }

  if (nextStatus === "exited") {
    const blockers = await finalExitBlockers(req.params.id);
    if (blockers.length) {
      return res.status(409).json({
        success: false,
        message: "Cannot mark employee exited until exit controls are complete.",
        blockers,
      });
    }
  }

  // currentStatus is the value the FSM check above was decided on. Handing it to the
  // service lets the transaction there refuse the write if another approver moved the
  // request in the gap between that SELECT and the UPDATE — the two are separate
  // statements with no lock held in between, so without this both actors succeed.
  const data = await exitService.updateExitStatus(
    req.params.id,
    nextStatus,
    remarks,
    req.authUser!.id,
    currentStatus,
    { lastWorkingDayConfirmed, noticePeriodDays },
  );
  return res.json({ success: true, data, message: `Exit request status updated to ${nextStatus}` });
}

exitSecureRouter.patch("/:id/status", h(handleExitStatusUpdate));
exitSecureRouter.post("/:id/status", h(handleExitStatusUpdate));

/**
 * POST /:id/objection — the manager disagrees with a resignation, on the record.
 *
 * Owner ruling 2026-09-12: a manager may not refuse a resignation. Before this there was no way
 * to express disagreement at all — the screen offered only Accept and Revoke, and "Revoke" means
 * something entirely different (the employee was retained and the exit is cancelled). A manager
 * who thought the resignation was a mistake had to either accept it or cancel someone else's
 * decision.
 *
 * What this deliberately does NOT do:
 *   - it does not change status. The request stays exactly where it was and the notice period
 *     keeps running. Recording an objection is not a veto.
 *   - it does not stop the clock, the clearance checklist, or the F&F.
 *   - only the EMPLOYEE may withdraw a resignation (POST /resignation/:exitId/withdraw), and
 *     nothing here touches that.
 *
 * The reason is mandatory. An objection with no reason is unreadable six months later in a
 * dispute, and this is written into the same exit_approval_log the rest of the timeline comes
 * from — so it surfaces on the employee's journey and in the exit drill-down for free.
 */
exitSecureRouter.post("/:id/objection", h(async (req: any, res: any) => {
  if (!(await canActOnExit(req.authUser!.id, req.params.id))) {
    return res.status(403).json({ success: false, message: "Forbidden: exit request is outside your action scope" });
  }

  const reason = String(req.body?.reason ?? req.body?.remarks ?? "").trim();
  if (!reason) {
    return res.status(400).json({
      success: false,
      message: "A reason is required to record an objection — it is the only record of why the manager disagreed",
    });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM exit_request WHERE id = ? LIMIT 1`,
    [req.params.id],
  );
  const current = rows[0];
  if (!current) return res.status(404).json({ success: false, message: "Exit request not found" });

  const currentStatus = normalizeExitStatus(current.status);
  // Pointless — and misleading on the timeline — once the exit is over. The employee has either
  // already left or the request was cancelled; an objection logged now reads as though it were
  // considered during the process.
  if (["exited", "closed", "revoked", "withdrawn", "rejected"].includes(currentStatus)) {
    return res.status(409).json({
      success: false,
      message: `This exit request is already '${currentStatus}' — an objection can only be recorded while it is still in progress`,
    });
  }

  await db.execute(
    `INSERT INTO exit_approval_log
       (id, exit_request_id, stage, action, action_by, action_by_role, discussion_remarks, created_at)
     VALUES (UUID(), ?, ?, 'objection_recorded', ?, ?, ?, NOW())`,
    [req.params.id, currentStatus, req.authUser!.id, req.authUser!.role ?? null, reason],
  );

  return res.status(201).json({
    success: true,
    message:
      "Objection recorded. The resignation remains active and the notice period continues — only the employee can withdraw it.",
    data: { exit_request_id: req.params.id, status: currentStatus, objection_reason: reason },
  });
}));

/**
 * Test-only export. finalExitBlockers is module-private on purpose — it is not a second
 * entry point into the exit FSM — but the NOC gate inside it is a rule that must stay
 * pinned, so the test drives the real function rather than a copy of its logic.
 */
export const __testFinalExitBlockers = finalExitBlockers;
