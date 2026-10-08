import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import {
  hasDirectReports,
  reportingSpanClause,
} from "../../shared/reportingSpan.js";
import {
  buildScopeWhereClause,
  hasAnyRole,
  hasScopedAccess,
} from "../../shared/scopeAccess.js";
import { ORG_WIDE_EXEMPT_ROLES } from "../../shared/scopeAccess.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { exitService } from "./exit.service.js";

export const exitSecureRouter = Router();
exitSecureRouter.use(requireAuth);

const h =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res).catch(next);
const EXIT_SCOPE_ROLES = [
  "manager",
  "assistant_manager",
  "tl",
  "branch_head",
  "process_manager",
  "hr",
];

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
  // Involuntary exits land here directly (no notice period served). Allow
  // clearance_pending so F&F can still be processed after the employee is gone.
  exited: ["clearance_pending"],
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
 * Blockers for the final "exited" transition: only open clearance tasks.
 *
 * F&F is deliberately NOT checked here (owner ruling 2026-09-18, same reasoning as the
 * NOC ruling on 2026-09-16). F&F gates money, not the exit date/status itself:
 *   - F&F payout is gated independently by noc-release-gate.service.ts, which keys off
 *     employees.employment_status flipping to inactive/terminated — the exact write this
 *     transition performs.
 *   - Blocking "exited" on F&F approval leaves an employee stuck active (active_status=1,
 *     counted in headcount, eligible for attendance/leave) for however long the finance
 *     team takes to approve the settlement — even when the person physically left weeks ago
 *     and HR is doing retroactive paperwork. That is the same bug the NOC removal fixed.
 *
 * NOC is also not checked here — see the 2026-09-16 ruling comment in noc.service.ts.
 *
 * Clearance no longer gates "exited" either (owner ruling 2026-09-26: generate clearance and
 * NOC must not block the exit gate). Open tasks are reported back as `pendingAtExit` and
 * keep gating the money/paperwork steps instead: F&F approval (ff-approval-guard), F&F paid,
 * bank batch, leaver salary release and the relieving letter.
 */
async function openClearanceAtExit(exitRequestId: string): Promise<number> {
  const [clearanceRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS open_count
       FROM exit_clearance_task
      WHERE exit_request_id = ?
        AND status NOT IN ('cleared', 'waived')`,
    [exitRequestId],
  );
  return Number(clearanceRows[0]?.open_count ?? 0);
}

function normalizeExitStatus(status: unknown): string {
  const value = String(status ?? "").trim();
  return value === "exit_confirmed" ? "exited" : value;
}

// Branch scoping (owner ruling 2026-10-01): only the org-wide roles see every branch's exits. hr,
// payroll and payroll_hr used to be waved through as 1=1 here.
const EXIT_LIST_SCOPE_ROLES = [...EXIT_SCOPE_ROLES, "payroll", "payroll_hr", "hr_admin", "branch_hr", "branch_admin"];

async function exitListScope(userId: string) {
  if (await hasAnyRole(userId, ...ORG_WIDE_EXEMPT_ROLES))
    return { sql: "1=1", params: [] as unknown[] };
  const scoped = await buildScopeWhereClause(
    userId,
    EXIT_LIST_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id",
      employeeId: "e.id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true, blockOrgWideForRoles: ["hr", "hr_admin", "payroll", "payroll_hr", "branch_hr", "branch_admin"] },
  );
  // A TL sees the team and an AM sees each TL's team, from the day a resignation is submitted (UAT
  // 2026-09-25). View only: canActOnExit below still requires the direct manager.
  const span = await reportingSpanClause(userId);
  if (scoped.sql !== "1=0") {
    return span
      ? {
          sql: `(${scoped.sql}) OR ${span.sql}`,
          params: [...scoped.params, ...span.params] as unknown[],
        }
      : scoped;
  }
  const emp = await getEmployeeForUser(userId);
  if (emp?.id) {
    return span
      ? {
          sql: `e.id = ? OR ${span.sql}`,
          params: [emp.id, ...span.params] as unknown[],
        }
      : { sql: "e.id = ?", params: [emp.id] as unknown[] };
  }
  return { sql: "1=0", params: [] as unknown[] };
}

async function canActOnExit(userId: string, exitRequestId: string) {
  // hr is branch-scoped: it is no longer in this bypass, it goes through the scope check below.
  if (await hasAnyRole(userId, ...ORG_WIDE_EXEMPT_ROLES))
    return true;
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
  if (
    await hasScopedAccess(
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
    )
  ) return true;
  return canViewEmployee({ id: userId }, String(target.employee_id));
}

exitSecureRouter.get(
  "/stats",
  h(async (req: any, res: any) => {
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
    for (const row of rows as any[])
      counts[String(row.status)] = Number(row.cnt ?? 0);
    const statuses = [
      "draft",
      "submitted",
      "manager_review",
      "accepted",
      "rejected",
      "revoked",
      "withdrawn",
      "notice_serving",
      "clearance_pending",
      "fnf_pending",
      "closed",
      "exited",
    ];
    const detailed = Object.fromEntries(
      statuses.map((s) => [s, counts[s] ?? 0]),
    ) as Record<string, number>;
    const total = Object.values(detailed).reduce((a, b) => a + b, 0);
    const pending = detailed.submitted + detailed.manager_review;
    return res.json({
      success: true,
      data: {
        ...detailed,
        total,
        pending,
        completed: detailed.exited + detailed.closed,
        active_notice:
          detailed.accepted +
          detailed.notice_serving +
          detailed.clearance_pending +
          detailed.fnf_pending,
      },
    });
  }),
);

exitSecureRouter.get(
  "/",
  h(async (req: any, res: any) => {
    const privileged = await hasAnyRole(
      req.authUser!.id,
      "admin",
      "super_admin",
      "hr",
      "finance",
      "payroll",
      "ceo",
      ...EXIT_SCOPE_ROLES,
    );
    if (!privileged && !(await hasDirectReports(req.authUser!.id))) {
      const emp = await getEmployeeForUser(req.authUser!.id);
      if (
        !emp ||
        !req.query.employeeId ||
        String(req.query.employeeId) !== emp.id
      ) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: employee collection access is not allowed",
        });
      }
    }
    const scope = await exitListScope(req.authUser!.id);
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(
      Math.max(1, Number(req.query.limit ?? 100) || 100),
      500,
    );
    const offset = (page - 1) * limit;
    const conds: string[] = [`(${scope.sql})`];
    const params: unknown[] = [...scope.params];
    if (req.query.status) {
      conds.push("er.status = ?");
      params.push(
        String(
          req.query.status === "exit_confirmed" ? "exited" : req.query.status,
        ),
      );
    }
    if (req.query.statuses) {
      // Comma list, e.g. the notice-period view: every status in which the person is still working out notice.
      const statuses = String(req.query.statuses)
        .split(",")
        .map((v) => normalizeExitStatus(v))
        .filter((v) => /^[a-z_]{3,30}$/.test(v));
      if (statuses.length > 0) {
        conds.push(`er.status IN (${statuses.map(() => "?").join(",")})`);
        params.push(...statuses);
      }
    }
    if (req.query.employeeId) {
      conds.push("er.employee_id = ?");
      params.push(String(req.query.employeeId));
    }
    if (req.query.branchId) {
      conds.push("e.branch_id = ?");
      params.push(String(req.query.branchId));
    }
    if (req.query.processId) {
      conds.push("e.process_id = ?");
      params.push(String(req.query.processId));
    }
    if (req.query.search) {
      const q = `%${String(req.query.search)}%`;
      conds.push(
        "(e.employee_code LIKE ? OR e.full_name LIKE ? OR er.resignation_reason LIKE ? OR er.exit_reason_category LIKE ?)",
      );
      params.push(q, q, q, q);
    }
    const where = `WHERE ${conds.join(" AND ")}`;
    // Base joins without clearance — used for COUNT (clearance data is not needed for counting).
    const baseSql = `FROM exit_request er LEFT JOIN employees e ON e.id = er.employee_id LEFT JOIN branch_master b ON b.id = e.branch_id LEFT JOIN process_master p ON p.id = e.process_id LEFT JOIN exit_employee_health_snapshot hs ON hs.exit_request_id = er.id`;
    // Clearance counts as correlated subqueries so MySQL only scans rows for the
    // exits actually returned on this page, not the entire exit_clearance_task table.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT er.*, e.employee_code, COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name, b.branch_name, p.process_name, hs.engagement_score, hs.regrettable_exit, hs.risk_label,
              (SELECT COUNT(*) FROM exit_clearance_task ct WHERE ct.exit_request_id = er.id) AS clearance_total,
              (SELECT COUNT(*) FROM exit_clearance_task ct WHERE ct.exit_request_id = er.id AND ct.status IN ('cleared','waived')) AS clearance_cleared
         ${baseSql} ${where} ORDER BY er.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total ${baseSql} ${where}`,
      params,
    );
    return res.json({
      success: true,
      data: rows,
      total: Number(countRows[0]?.total ?? 0),
      page,
      limit,
    });
  }),
);

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
  const userId: string = req.authUser!.id;
  const exitId: string = req.params.id;

  // One combined query replaces 3–4 sequential user_roles + exit_request round-trips.
  // Fetches: the caller's roles, the exit request's current status and employee scope,
  // and whether the caller is the employee's reporting manager — all in a single DB hit.
  const [prefetchRows] = await db.execute<RowDataPacket[]>(
    `SELECT er.status                                              AS current_status,
            er.employee_id,
            e.branch_id,
            e.process_id,
            e.lob_id,
            e.department_id,
            e.reporting_manager_id,
            e.manager_id,
            GROUP_CONCAT(DISTINCT ur.role_key ORDER BY ur.role_key) AS roles,
            EXISTS (
              SELECT 1 FROM employees mgr
                JOIN auth_user au2 ON au2.email = mgr.official_email
               WHERE mgr.id = e.reporting_manager_id AND au2.id = ?
            ) AS is_reporting_manager
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
       LEFT JOIN user_roles ur ON ur.user_id = ? AND ur.active_status = 1
      WHERE er.id = ?
      GROUP BY er.id, e.id
      LIMIT 1`,
    [userId, userId, exitId],
  );
  const prefetch = prefetchRows[0] as any;
  if (!prefetch?.current_status)
    return res
      .status(404)
      .json({ success: false, message: "Exit request not found" });

  const userRoles: string[] = prefetch.roles
    ? String(prefetch.roles).split(",")
    : [];
  const isSuperAdmin = userRoles.includes("super_admin");
  const isAdminOrHr =
    isSuperAdmin ||
    ["admin", "hr", "ceo", "branch_admin"].some((r) => userRoles.includes(r));
  const isManager =
    isSuperAdmin ||
    ["manager", "process_manager", "operations_manager", "branch_head"].some(
      (r) => userRoles.includes(r),
    );
  const isReportingManager = Number(prefetch.is_reporting_manager) === 1;
  const isPureAdminSuperCeo =
    isSuperAdmin || ["admin", "ceo"].some((r) => userRoles.includes(r));

  // Scope check: only the org-wide roles skip it. hr / branch_admin are branch-scoped (owner ruling
  // 2026-10-01), so they must be inside their own branch / assigned scope like everybody else.
  const isOrgWide = userRoles.some((r) => (ORG_WIDE_EXEMPT_ROLES as readonly string[]).includes(r));
  if (!isOrgWide) {
    const scopeOk = (await hasScopedAccess(
      userId,
      EXIT_SCOPE_ROLES,
      {
        branchId: prefetch.branch_id,
        processId: prefetch.process_id,
        lobId: prefetch.lob_id,
        departmentId: prefetch.department_id,
        managerEmployeeId: prefetch.reporting_manager_id ?? prefetch.manager_id,
        employeeId: prefetch.employee_id,
      },
      { allowAdminBypass: true, requireScopeForNonAdmin: true },
    )) || (await canViewEmployee({ id: userId }, String(prefetch.employee_id)));
    if (!scopeOk)
      return res
        .status(403)
        .json({
          success: false,
          message: "Forbidden: exit request is outside your action scope",
        });
  }

  const nextStatus = normalizeExitStatus(req.body?.status);

  // Per-transition role gate (same policy as before, evaluated in-memory from prefetched roles):
  //   submitted → manager_review : reporting manager only
  //   manager_review → accepted  : reporting manager only
  //   accepted / notice_serving → further : HR or admin
  //   exited                              : HR or admin
  //   revoked / withdrawn                 : any in-scope user
  if (["manager_review", "accepted"].includes(nextStatus)) {
    if (!isReportingManager && !isPureAdminSuperCeo) {
      return res.status(403).json({
        success: false,
        message: `Only the employee's reporting manager may move an exit to '${nextStatus}'. HR's role is via clearance tasks and exit interview, not this status gate.`,
      });
    }
  } else if (["notice_serving", "exited"].includes(nextStatus)) {
    if (!isAdminOrHr) {
      return res.status(403).json({
        success: false,
        message: `Only HR or Admin may move an exit to '${nextStatus}'.`,
      });
    }
  }
  // revoked / withdrawn: any in-scope user may initiate (employee self-service or HR)

  // 'rejected' removed (owner ruling 2026-09-12): nobody may refuse a resignation. A manager who
  // disagrees records an objection via POST /:id/objection, which leaves the request active and
  // the notice period running. Refused here as well as in the FSM map so the API answers the
  // policy question directly instead of reporting a transition error.
  const allowed = [
    "submitted",
    "manager_review",
    "accepted",
    "notice_serving",
    "clearance_pending",
    "exited",
    "revoked",
    "withdrawn",
  ];
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
    return res
      .status(400)
      .json({ success: false, message: "Remarks are required" });
  }

  // Notice terms. Both were already being SENT by NativeExitManagement's "Confirm & Advance"
  // modal (updateStatus() puts lastWorkingDayConfirmed and noticePeriodDays on the PATCH body)
  // and this handler read neither, so HR confirmed a Last Working Day and a notice period,
  // got a success toast, and nothing was persisted. Validated here rather than trusted:
  // last_working_day_confirmed feeds payroll's employment-end-date resolver, so a malformed
  // value would propagate into who gets paid and through what date.
  const rawLwd =
    req.body?.lastWorkingDayConfirmed ?? req.body?.last_working_day_confirmed;
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
        message:
          "lastWorkingDayConfirmed must be a real calendar date in YYYY-MM-DD format",
      });
    }
    lastWorkingDayConfirmed = candidate;
  }

  const rawNoticeDays =
    req.body?.noticePeriodDays ?? req.body?.notice_period_days;
  let noticePeriodDays: number | null = null;
  if (
    rawNoticeDays !== undefined &&
    rawNoticeDays !== null &&
    String(rawNoticeDays).trim() !== ""
  ) {
    const n = Number(rawNoticeDays);
    // 0..365 matches the modal's max attribute. The bound is not cosmetic: this number is
    // multiplied by a per-day salary rate in ff-compute.service.ts to produce a notice-shortfall
    // recovery deducted from someone's settlement, so nonsense (negatives, 10000, "thirty",
    // 30.5) has to be refused here rather than turned into money.
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 365) {
      return res.status(400).json({
        success: false,
        message:
          "noticePeriodDays must be a whole number of days between 0 and 365",
      });
    }
    noticePeriodDays = n;
  }

  // currentStatus already fetched in the prefetch query above — no extra round-trip needed.
  const currentStatus = normalizeExitStatus(prefetch.current_status);
  const allowedNext = ALLOWED_EXIT_TRANSITIONS[currentStatus] ?? [];
  if (!allowedNext.includes(nextStatus)) {
    return res.status(409).json({
      success: false,
      message: `Invalid exit transition: ${currentStatus} → ${nextStatus}. Allowed: ${allowedNext.join(", ") || "none"}`,
    });
  }

  const pendingAtExit =
    nextStatus === "exited" ? await openClearanceAtExit(req.params.id) : 0;

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

  // Clearance no longer blocks "exited" (2026-09-26 ruling), so an exit with open clearance
  // is now a normal outcome, not an error — but it must still be visible on the employee's
  // journey. Same table/shape as the objection log above so journeyLog.service.ts's existing
  // exit_approval_log reader picks it up for free.
  if (pendingAtExit > 0) {
    await db.execute(
      `INSERT INTO exit_approval_log
         (id, exit_request_id, stage, action, action_by, action_by_role, discussion_remarks, created_at)
       VALUES (UUID(), ?, 'exited', 'exited_with_open_clearance', ?, ?, ?, NOW())`,
      [
        req.params.id,
        req.authUser!.id,
        req.authUser!.role ?? null,
        `${pendingAtExit} clearance task(s) still open at exit. F&F approval is blocked until they clear.`,
      ],
    );
  }

  return res.json({
    success: true,
    data,
    pendingAtExit,
    message:
      pendingAtExit > 0
        ? `Exit request status updated to ${nextStatus}. ${pendingAtExit} clearance task(s) still open; they will block F&F approval.`
        : `Exit request status updated to ${nextStatus}`,
  });
}

/**
 * POST /bulk-status — apply one status to many exit requests in a single round-trip.
 *
 * The Bulk Actions tab used to loop over the selection and PATCH /:id/status once per employee,
 * sequentially, swallowing every error. Ten people meant ten serial round-trips, and a row that
 * failed (wrong current status, not the reporting manager, no remarks) was just counted as
 * "failed" with no reason, so nothing appeared to change.
 *
 * Every id still goes through handleExitStatusUpdate itself, so the FSM, role gate, scope check,
 * row lock and audit log are exactly the single-item ones; this only removes the network hops and
 * reports why each failure failed. A small worker pool keeps the DB pool from being flooded.
 */
const BULK_EXIT_MAX = 500;
const BULK_EXIT_CONCURRENCY = 8;

exitSecureRouter.post(
  "/bulk-status",
  h(async (req: any, res: any) => {
    const ids: string[] = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map((x: unknown) => String(x)))].filter(Boolean) as string[]
      : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "ids is required" });
    }
    if (ids.length > BULK_EXIT_MAX) {
      return res
        .status(400)
        .json({ success: false, message: `At most ${BULK_EXIT_MAX} exit requests per bulk action` });
    }

    type Result = { id: string; ok: boolean; status: number; message: string };
    const results: Result[] = new Array(ids.length);
    let next = 0;

    const runOne = async (id: string): Promise<Result> => {
      let code = 200;
      let payload: any = null;
      const capture = {
        status(c: number) { code = c; return capture; },
        json(body: unknown) { payload = body; return capture; },
      };
      try {
        await handleExitStatusUpdate(
          {
            authUser: req.authUser,
            params: { id },
            body: { status: req.body?.status, remarks: req.body?.remarks },
            query: {},
          },
          capture,
        );
      } catch (err: any) {
        return { id, ok: false, status: Number(err?.statusCode ?? 500), message: String(err?.message ?? "Failed") };
      }
      const ok = code >= 200 && code < 300 && payload?.success !== false;
      return { id, ok, status: code, message: String(payload?.message ?? (ok ? "Updated" : "Failed")) };
    };

    const worker = async () => {
      while (next < ids.length) {
        const i = next++;
        results[i] = await runOne(ids[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(BULK_EXIT_CONCURRENCY, ids.length) }, worker));

    const succeeded = results.filter((r) => r.ok).length;
    return res.json({ success: true, total: ids.length, succeeded, failed: ids.length - succeeded, results });
  }),
);

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
exitSecureRouter.post(
  "/:id/objection",
  h(async (req: any, res: any) => {
    if (!(await canActOnExit(req.authUser!.id, req.params.id))) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: exit request is outside your action scope",
      });
    }

    const reason = String(req.body?.reason ?? req.body?.remarks ?? "").trim();
    if (!reason) {
      return res.status(400).json({
        success: false,
        message:
          "A reason is required to record an objection — it is the only record of why the manager disagreed",
      });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status FROM exit_request WHERE id = ? LIMIT 1`,
      [req.params.id],
    );
    const current = rows[0];
    if (!current)
      return res
        .status(404)
        .json({ success: false, message: "Exit request not found" });

    const currentStatus = normalizeExitStatus(current.status);
    // Pointless — and misleading on the timeline — once the exit is over. The employee has either
    // already left or the request was cancelled; an objection logged now reads as though it were
    // considered during the process.
    if (
      ["exited", "closed", "revoked", "withdrawn", "rejected"].includes(
        currentStatus,
      )
    ) {
      return res.status(409).json({
        success: false,
        message: `This exit request is already '${currentStatus}' — an objection can only be recorded while it is still in progress`,
      });
    }

    await db.execute(
      `INSERT INTO exit_approval_log
       (id, exit_request_id, stage, action, action_by, action_by_role, discussion_remarks, created_at)
     VALUES (UUID(), ?, ?, 'objection_recorded', ?, ?, ?, NOW())`,
      [
        req.params.id,
        currentStatus,
        req.authUser!.id,
        req.authUser!.role ?? null,
        reason,
      ],
    );

    return res.status(201).json({
      success: true,
      message:
        "Objection recorded. The resignation remains active and the notice period continues — only the employee can withdraw it.",
      data: {
        exit_request_id: req.params.id,
        status: currentStatus,
        objection_reason: reason,
      },
    });
  }),
);

/**
 * Test-only export. openClearanceAtExit is module-private on purpose — it is not a second
 * entry point into the exit FSM — but the rule that it only counts (never blocks) must stay
 * pinned, so the test drives the real function rather than a copy of its logic.
 */
export const __testOpenClearanceAtExit = openClearanceAtExit;
