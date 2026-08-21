/**
 * A manager's whole team, a whole month, in one request.
 *
 * Nothing existing can serve this. scopedAttendanceDailyHandler has the right scope
 * and the right grain but is hard-capped at 500 rows per page and ordered date-major
 * — 20 employees x 31 days is already 620 rows, so a modest team needs two round
 * trips just to render one screen. The monthly attendance register report has the
 * right shape but returns a single letter per cell and enforces no manager row-scope
 * at all (its `managerId` is a caller-supplied filter, not a guard).
 *
 * The one thing this endpoint does that no other does: it returns a cell for EVERY
 * calendar day in the employee's window, including days with no attendance_daily_record
 * row at all. That absence is PARTIAL_ATTENDANCE_DAYS_MISSING — the blocker that
 * refuses payroll when one employee is missing one day — and it is invisible in every
 * response that only carries rows that exist. A blank cell is exactly what a manager
 * scrolls past.
 */
import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireWriteAccess } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { inboxService } from "../inbox/inbox.service.js";
import { leaveService } from "../leave/leave.service.js";
import { leaveRequestSchema } from "../leave/leave.validation.js";

export const teamAttendanceMonthRouter = Router();
teamAttendanceMonthRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Days in the month, and its first/last date as YYYY-MM-DD. */
function monthWindow(month: string) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${y}-${pad(m)}-01`,
    end: `${y}-${pad(m)}-${pad(days)}`,
    days,
    dateFor: (day: number) => `${y}-${pad(m)}-${pad(day)}`,
  };
}

/**
 * A day needs a manager's attention when it has no usable attendance decision.
 *
 * Mirrors payroll-governance.service.ts rather than inventing a definition:
 * missing_punch (its MISSING_PUNCH_WITH_BIOMETRIC_EVIDENCE blocker), unreconciled,
 * and — handled by the caller — no record at all (PARTIAL_ATTENDANCE_DAYS_MISSING).
 *
 * `mismatch_flag` is deliberately NOT part of this, though the first version had it.
 * It records that APR and biometric disagreed about a day, which is provenance, not
 * an open question: governance reads it nowhere and it blocks no payroll. Including
 * it flagged 4,761 of 6,181 days in the first week of 2026-08 — 77% of the grid —
 * and 2,612 of those were flagged by nothing else while already being settled as
 * present (1,415) or half_day (1,108). A grid that is mostly orange cannot be
 * triaged, which defeats the only thing this page is for.
 *
 * The disagreement is still worth seeing, so it travels as `sourceMismatch` on the
 * cell and shows as a quiet marker instead of an alarm.
 */
function needsAttention(row: { attendance_status?: string | null }): boolean {
  const status = String(row.attendance_status ?? "");
  return status === "missing_punch" || status === "unreconciled";
}

/** APR and biometric disagreed. Informational — not a blocker, not an action. */
function hasSourceMismatch(row: { mismatch_flag?: number | null; mismatch_resolved_at?: unknown }): boolean {
  return Number(row.mismatch_flag ?? 0) === 1 && !row.mismatch_resolved_at;
}

/**
 * GET /api/wfm/attendance/team-month?month=YYYY-MM
 *
 * Roles gate who may call it; the scope predicate below decides whose rows come back.
 * Both are required — a role check alone would let any manager read any team.
 */
teamAttendanceMonthRouter.get(
  "/team-month",
  requireRole(
    "manager", "assistant_manager", "tl", "team_leader", "process_manager",
    "branch_head", "hr", "wfm", "admin", "super_admin", "ceo",
  ),
  h(async (req, res) => {
    const month = String(req.query.month ?? "");
    if (!MONTH_REGEX.test(month)) {
      return res.status(400).json({ success: false, message: "month must be YYYY-MM" });
    }
    const win = monthWindow(month);

    const userId = req.authUser!.id;
    const isWide = await hasRole(userId, "admin", "hr", "wfm", "ceo", "super_admin");
    const callerEmp = await getEmployeeForUser(userId);

    // ── Who is in the team ────────────────────────────────────────────────────
    //
    // The same predicate scopedAttendanceDailyHandler uses (attendance-daily-scoped
    // .routes.ts:70), and for the same reason: buildScopeWhereClause's 'team' scope
    // reads user_assignment_scope, which most managers have no row in, and it fails
    // closed to 1=0 — a manager would silently see an empty grid.
    // Same cohort payroll uses, so the grid and the payslip never disagree about who
    // belongs to the month. runEmployeeScopeSql in payroll-governance.service.ts
    // requires the employment window to overlap the month; without the same rule this
    // page lists people payroll will not pay and sends managers chasing their days.
    //
    // This is not hypothetical: on a sampled 23-person team, 10 were active_status=1
    // and employment_status='active' while carrying an exit date in the previous
    // month. Their rows would otherwise be almost entirely inert.
    const where: string[] = [
      "e.active_status = 1",
      "COALESCE(e.salary_start_date, e.date_of_joining, ?) <= ?",
      "COALESCE(e.date_of_exit, e.date_of_leaving, ?) >= ?",
    ];
    const params: unknown[] = [win.start, win.end, win.end, win.start];

    if (!isWide) {
      if (!callerEmp?.id) {
        return res.status(403).json({ success: false, message: "No employee record for this user" });
      }
      where.push("(e.reporting_manager_id = ? OR e.manager_id = ? OR e.id = ?)");
      params.push(callerEmp.id, callerEmp.id, callerEmp.id);
    }

    // Optional narrowing, never widening.
    if (req.query.branchId) { where.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
    if (req.query.processId) { where.push("e.process_id = ?"); params.push(String(req.query.processId)); }
    if (req.query.search) {
      where.push("(e.employee_code LIKE ? OR COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) LIKE ?)");
      const like = `%${String(req.query.search).trim()}%`;
      params.push(like, like);
    }

    const [empRows] = await db.query<RowDataPacket[]>(
      `SELECT e.id, e.employee_code,
              COALESCE(NULLIF(TRIM(e.full_name),''),
                       TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
              d.designation_name, dp.dept_name, p.process_name, b.branch_name,
              e.date_of_joining, e.salary_start_date,
              COALESCE(e.date_of_exit, e.date_of_leaving) AS exit_date
         FROM employees e
         LEFT JOIN designation_master d ON d.id = e.designation_id
         LEFT JOIN department_master dp ON dp.id = e.department_id
         LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE ${where.join(" AND ")}
        ORDER BY employee_name ASC`,
      params,
    );
    const employees = empRows as any[];

    if (employees.length === 0) {
      return res.json({
        success: true, month, days: win.days, employees: [],
        summary: { employees: 0, needs_attention: 0, absent: 0, regularized: 0, missing: 0 },
      });
    }

    // ── Their attendance for the month ────────────────────────────────────────
    //
    // Driven from the employee ids so (employee_id, record_date) is used as a range
    // scan. Driving from record_date alone would scan every employee in the company
    // for 31 days and then throw most of it away.
    const ids = employees.map((e) => String(e.id));
    const idPlaceholders = ids.map(() => "?").join(",");
    const [cellRows] = await db.query<RowDataPacket[]>(
      `SELECT adr.employee_id,
              DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS d,
              adr.attendance_status, adr.lwp_value,
              adr.regularization_id, adr.override_by, adr.is_locked,
              adr.mismatch_flag, adr.mismatch_resolved_at,
              adr.attendance_source, adr.source_system,
              adr.raw_minutes, adr.late_mark, adr.late_by_minutes,
              adr.status_change_reason,
              TIME_FORMAT(adr.clock_in_time, '%H:%i')  AS clock_in,
              TIME_FORMAT(adr.clock_out_time, '%H:%i') AS clock_out
         FROM attendance_daily_record adr
        WHERE adr.employee_id IN (${idPlaceholders})
          AND adr.record_date BETWEEN ? AND ?`,
      [...ids, win.start, win.end],
    );

    const byEmployee = new Map<string, Map<string, any>>();
    for (const r of cellRows as any[]) {
      const empId = String(r.employee_id);
      if (!byEmployee.has(empId)) byEmployee.set(empId, new Map());
      byEmployee.get(empId)!.set(String(r.d), r);
    }

    // ── Pending regularizations, so a cell can offer the right action ─────────
    const [regRows] = await db.query<RowDataPacket[]>(
      `SELECT id, employee_id, DATE_FORMAT(session_date, '%Y-%m-%d') AS d, status, reason
         FROM attendance_regularization
        WHERE employee_id IN (${idPlaceholders})
          AND session_date BETWEEN ? AND ?
          AND status IN ('pending','manager_approved')`,
      [...ids, win.start, win.end],
    ).catch(() => [[]] as unknown as [RowDataPacket[], unknown]);
    const pendingByKey = new Map<string, any>();
    for (const r of regRows as any[]) pendingByKey.set(`${r.employee_id}:${r.d}`, r);

    // ── Build one cell per calendar day, present or not ───────────────────────
    const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let totalAttention = 0, totalAbsent = 0, totalRegularized = 0, totalMissing = 0;

    const out = employees.map((emp) => {
      const cells = byEmployee.get(String(emp.id)) ?? new Map();

      // Only days the employee was actually employed can be "missing" — counting a
      // day before joining or after exit as a gap would send managers chasing rows
      // that must never exist. Mirrors the governance blocker's own window.
      const startsOn = String(emp.salary_start_date ?? emp.date_of_joining ?? win.start).slice(0, 10);
      const endsOn = emp.exit_date ? String(emp.exit_date).slice(0, 10) : win.end;

      let attention = 0, absent = 0, regularized = 0, missing = 0;

      const days = Array.from({ length: win.days }, (_, i) => {
        const date = win.dateFor(i + 1);
        const inWindow = date >= startsOn && date <= endsOn && date <= today;
        const row = cells.get(date);
        const pending = pendingByKey.get(`${emp.id}:${date}`);

        if (!row) {
          // Future days and days outside employment are simply not applicable — they
          // are not gaps and must not be counted as ones.
          if (!inWindow) return { d: date, applicable: false };
          missing++; attention++;
          return { d: date, applicable: true, hasRecord: false, needsAttention: true, pendingRegularizationId: pending?.id ?? null };
        }

        const attn = needsAttention(row);
        const isReg = Boolean(row.regularization_id);
        if (attn) attention++;
        if (String(row.attendance_status) === "absent") absent++;
        if (isReg) regularized++;

        return {
          d: date,
          applicable: true,
          hasRecord: true,
          status: row.attendance_status,
          lwp: Number(row.lwp_value ?? 0),
          regularized: isReg,
          overridden: Boolean(row.override_by),
          locked: Number(row.is_locked ?? 0) === 1,
          needsAttention: attn,
          sourceMismatch: hasSourceMismatch(row),
          source: row.attendance_source,
          sourceSystem: row.source_system,
          minutes: Number(row.raw_minutes ?? 0),
          lateMark: Number(row.late_mark ?? 0) === 1,
          lateBy: Number(row.late_by_minutes ?? 0),
          clockIn: row.clock_in,
          clockOut: row.clock_out,
          note: row.status_change_reason ?? null,
          pendingRegularizationId: pending?.id ?? null,
        };
      });

      totalAttention += attention; totalAbsent += absent;
      totalRegularized += regularized; totalMissing += missing;

      return {
        employeeId: String(emp.id),
        employeeCode: emp.employee_code,
        employeeName: emp.employee_name,
        designation: emp.designation_name ?? null,
        department: emp.dept_name ?? null,
        process: emp.process_name ?? null,
        branch: emp.branch_name ?? null,
        counts: { needsAttention: attention, absent, regularized, missing },
        days,
      };
    });

    return res.json({
      success: true,
      month,
      days: win.days,
      employees: out,
      summary: {
        employees: out.length,
        needs_attention: totalAttention,
        absent: totalAbsent,
        regularized: totalRegularized,
        missing: totalMissing,
      },
    });
  }),
);

/**
 * POST /api/wfm/attendance/team-month/flag
 * body: { items: [{ employeeId, date }], note }
 *
 * Raise a "look at this day" for someone on the team. Writes NO attendance: it puts
 * a work-inbox item in front of the employee and, where the day is one only WFM can
 * fix, in front of WFM too.
 *
 * Deliberately not an attendance write. A manager cannot resolve a mismatch or mark
 * a day manually — both routes exclude them — and quietly granting that authority
 * from a new screen would be a much larger change than a visibility page. Flagging
 * is the honest thing a manager can do: say "this is wrong" to the person who can
 * fix it, and keep the day visible until they do.
 */
teamAttendanceMonthRouter.post(
  "/team-month/flag",
  requireWriteAccess,
  requireRole(
    "manager", "assistant_manager", "tl", "team_leader", "process_manager",
    "branch_head", "hr", "wfm", "admin", "super_admin",
  ),
  h(async (req, res) => {
    const items: Array<{ employeeId?: string; date?: string }> = Array.isArray(req.body?.items)
      ? req.body.items
      : [];
    const note = String(req.body?.note ?? "").trim();
    if (items.length === 0) {
      return res.status(400).json({ success: false, message: "Nothing selected to flag" });
    }
    if (items.length > 200) {
      return res.status(400).json({ success: false, message: "Flag at most 200 days at a time" });
    }
    if (!note) {
      return res.status(400).json({ success: false, message: "A note is required — a flag with no reason is noise" });
    }

    const userId = req.authUser!.id;
    const isWide = await hasRole(userId, "admin", "hr", "wfm", "ceo", "super_admin");
    const callerEmp = await getEmployeeForUser(userId);
    if (!isWide && !callerEmp?.id) {
      return res.status(403).json({ success: false, message: "No employee record for this user" });
    }

    // Re-check the team on the way in. The grid already scoped what a manager could
    // see, but a request is not the page — nothing stops a caller posting any id, so
    // authorisation is decided here rather than trusted from the client.
    const ids = [...new Set(items.map((i) => String(i.employeeId ?? "")).filter(Boolean))];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "No employees in the request" });
    }
    const ph = ids.map(() => "?").join(",");
    const scopeSql = isWide
      ? ""
      : " AND (e.reporting_manager_id = ? OR e.manager_id = ? OR e.id = ?)";
    const scopeParams = isWide ? [] : [callerEmp!.id, callerEmp!.id, callerEmp!.id];

    const [allowedRows] = await db.query<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.auth_user_id,
              COALESCE(NULLIF(TRIM(e.full_name),''),
                       TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name
         FROM employees e
        WHERE e.id IN (${ph}) AND e.active_status = 1${scopeSql}`,
      [...ids, ...scopeParams],
    );
    const allowed = new Map((allowedRows as any[]).map((r) => [String(r.id), r]));

    let flagged = 0;
    let skippedOutOfScope = 0;
    let skippedNoAccount = 0;

    for (const item of items) {
      const emp = allowed.get(String(item.employeeId ?? ""));
      if (!emp) { skippedOutOfScope++; continue; }
      const date = String(item.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skippedOutOfScope++; continue; }

      // An employee with no login cannot be told anything by an inbox item. Counted
      // and returned rather than silently dropped, so the manager knows the message
      // did not land and can follow up another way.
      if (!emp.auth_user_id) { skippedNoAccount++; continue; }

      await inboxService.createItem({
        user_id: String(emp.auth_user_id),
        type: "attendance_flagged_by_manager",
        title: `Attendance query for ${date}`,
        description: `${note} — raised by your reporting manager. Open your attendance and raise a regularization if this day is wrong.`,
        entity_type: "attendance_daily_record",
        entity_id: `${emp.id}:${date}`.slice(0, 64),
        action_url: `/attendance?date=${encodeURIComponent(date)}`,
        priority: "high",
      }, 24 * 60).catch(() => undefined);
      flagged++;
    }

    return res.json({
      success: true,
      flagged,
      skipped_out_of_scope: skippedOutOfScope,
      skipped_no_account: skippedNoAccount,
    });
  }),
);

/**
 * Raise a leave request on a direct report's behalf — subject to that employee's own
 * consent before it becomes a real leave_request.
 *
 * Deliberately narrower than POST /api/leave/requests's existing on-behalf path
 * (isLeavePrivileged: super_admin/admin/hr/manager/payroll_head/payroll_admin, no consent
 * step, no row-scope check beyond the role list). This route is the opposite shape by
 * design: open to the whole manager chain (tl/team_leader/assistant_manager/manager/
 * process_manager/branch_head, none of whom could reach the older path at all), but
 * row-scoped to direct reports only and gated on the employee's consent. The two paths are
 * intentionally independent — this one does not touch isLeavePrivileged or leave.routes.ts.
 */
const RAISE_ON_BEHALF_ROLES = [
  "manager", "process_manager", "tl", "team_leader", "assistant_manager", "branch_head",
] as const;

teamAttendanceMonthRouter.post(
  "/team-month/leave-on-behalf",
  requireWriteAccess,
  requireRole(...RAISE_ON_BEHALF_ROLES),
  h(async (req, res) => {
    const raiserEmp = await getEmployeeForUser(req.authUser!.id);
    if (!raiserEmp?.id) {
      return res.status(403).json({ success: false, message: "No employee record for this user" });
    }

    const employeeId = String(req.body?.employeeId ?? "");
    if (!employeeId) {
      return res.status(400).json({ success: false, message: "employeeId is required" });
    }

    // Direct reports only — the same scope predicate the grid itself is built on. A
    // request against anyone else is refused here even if the client never should have
    // offered the action; the request is not the page.
    const [scopeRows] = await db.query<RowDataPacket[]>(
      `SELECT e.id,
              COALESCE(NULLIF(TRIM(e.full_name),''),
                       TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
              e.auth_user_id
         FROM employees e
        WHERE e.id = ? AND e.active_status = 1
          AND (e.reporting_manager_id = ? OR e.manager_id = ?)
        LIMIT 1`,
      [employeeId, raiserEmp.id, raiserEmp.id],
    );
    const targetEmp = (scopeRows as any[])[0];
    if (!targetEmp) {
      return res.status(403).json({ success: false, message: "Not one of your direct reports" });
    }
    if (!targetEmp.auth_user_id) {
      return res.status(422).json({
        success: false,
        message: `${targetEmp.employee_name} has no login account, so they cannot be asked to consent to this.`,
      });
    }

    // Validate the leave payload with the exact schema the employee's own submission
    // uses, so a bad on-behalf request fails the same way a bad self-service one would —
    // not a looser or stricter check invented for this path.
    const parsed = leaveRequestSchema.safeParse({
      employeeId,
      leaveTypeId: req.body?.leaveTypeId,
      fromDate: req.body?.fromDate,
      toDate: req.body?.toDate,
      totalDays: req.body?.totalDays,
      reason: req.body?.reason ?? null,
    });
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid request" });
    }

    const id = randomUUID();
    const callerRoles = await Promise.all(RAISE_ON_BEHALF_ROLES.map((r) => hasRole(req.authUser!.id, r)));
    const raisedByRole = RAISE_ON_BEHALF_ROLES[callerRoles.findIndex(Boolean)] ?? "manager";

    await db.execute(
      `INSERT INTO manager_raised_request
         (id, request_type, employee_id, raised_by_user_id, raised_by_employee_id, raised_by_role, payload, consent_status)
       VALUES (?, 'leave', ?, ?, ?, ?, CAST(? AS JSON), 'pending_employee_consent')`,
      [id, employeeId, req.authUser!.id, raiserEmp.id, raisedByRole, JSON.stringify(parsed.data)],
    );

    await inboxService.createItem({
      user_id: String(targetEmp.auth_user_id),
      type: "leave_raised_by_manager",
      title: "Leave requested on your behalf",
      description:
        `Your reporting manager asked for leave for you (${parsed.data.fromDate} to ${parsed.data.toDate}). ` +
        `Nothing is submitted yet — open Leave Requests to approve or decline.`,
      entity_type: "manager_raised_request",
      entity_id: id,
      action_url: "/leaves",
      priority: "high",
    }).catch(() => undefined);

    return res.status(201).json({ success: true, data: { id, consentStatus: "pending_employee_consent" } });
  }),
);

/** GET /team-month/leave-on-behalf/mine — the caller's own pending/decided consent items. */
teamAttendanceMonthRouter.get(
  "/team-month/leave-on-behalf/mine",
  h(async (req, res) => {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp?.id) return res.json({ success: true, data: [] });

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT mrr.id, mrr.request_type, mrr.payload, mrr.consent_status, mrr.created_at,
              mrr.resulting_request_id,
              COALESCE(NULLIF(TRIM(m.full_name),''),
                       TRIM(CONCAT(m.first_name,' ',COALESCE(m.last_name,'')))) AS raised_by_name,
              lt.leave_name
         FROM manager_raised_request mrr
         LEFT JOIN employees m ON m.id = mrr.raised_by_employee_id
         LEFT JOIN leave_type_master lt ON lt.id = JSON_UNQUOTE(JSON_EXTRACT(mrr.payload, '$.leaveTypeId'))
        WHERE mrr.employee_id = ?
        ORDER BY mrr.created_at DESC
        LIMIT 50`,
      [callerEmp.id],
    );
    return res.json({ success: true, data: rows });
  }),
);

/** GET /team-month/leave-on-behalf?scope=team — what the caller themself has raised. */
teamAttendanceMonthRouter.get(
  "/team-month/leave-on-behalf",
  h(async (req, res) => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT mrr.id, mrr.employee_id, mrr.payload, mrr.consent_status, mrr.created_at,
              mrr.resulting_request_id, mrr.decline_reason,
              COALESCE(NULLIF(TRIM(e.full_name),''),
                       TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name
         FROM manager_raised_request mrr
         JOIN employees e ON e.id = mrr.employee_id
        WHERE mrr.raised_by_user_id = ?
        ORDER BY mrr.created_at DESC
        LIMIT 100`,
      [req.authUser!.id],
    );
    return res.json({ success: true, data: rows });
  }),
);

/**
 * PATCH /team-month/leave-on-behalf/:id/consent — only the named employee may decide.
 * On approval this is the ONE place that materializes the real leave_request, via the
 * same leaveService.submitRequest() the self-service form calls — no duplicated balance
 * or eligibility logic.
 */
teamAttendanceMonthRouter.patch(
  "/team-month/leave-on-behalf/:id/consent",
  requireWriteAccess,
  h(async (req, res) => {
    const decision = String(req.body?.decision ?? "");
    if (decision !== "approve" && decision !== "decline") {
      return res.status(400).json({ success: false, message: "decision must be 'approve' or 'decline'" });
    }

    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp?.id) {
      return res.status(403).json({ success: false, message: "No employee record for this user" });
    }

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT * FROM manager_raised_request WHERE id = ? LIMIT 1`,
      [req.params.id],
    );
    const row = (rows as any[])[0];
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (String(row.employee_id) !== String(callerEmp.id)) {
      return res.status(403).json({ success: false, message: "This request is not addressed to you" });
    }
    if (row.consent_status !== "pending_employee_consent") {
      return res.status(409).json({ success: false, message: `Already ${row.consent_status}` });
    }

    if (decision === "decline") {
      await db.execute(
        `UPDATE manager_raised_request
            SET consent_status = 'declined', consent_decided_at = NOW(), decline_reason = ?
          WHERE id = ?`,
        [req.body?.reason ? String(req.body.reason).slice(0, 500) : null, row.id],
      );
      await inboxService.createItem({
        user_id: row.raised_by_user_id,
        type: "leave_on_behalf_declined",
        title: "Leave request declined",
        description: "The employee declined the leave you raised on their behalf.",
        entity_type: "manager_raised_request",
        entity_id: row.id,
        action_url: "/wfm/team-attendance",
        priority: "normal",
      }).catch(() => undefined);
      return res.json({ success: true, data: { consentStatus: "declined" } });
    }

    // Approve — materialize the real leave_request. The employee is the actor of record
    // (submitRequest's second argument), matching what actually happened: they, not the
    // manager, are the one who just said yes.
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    try {
      const created = await leaveService.submitRequest(payload, req.authUser!.id);
      await db.execute(
        `UPDATE manager_raised_request
            SET consent_status = 'consented', consent_decided_at = NOW(), resulting_request_id = ?
          WHERE id = ?`,
        [(created as any).id, row.id],
      );
      await inboxService.createItem({
        user_id: row.raised_by_user_id,
        type: "leave_on_behalf_consented",
        title: "Leave request submitted",
        description: "The employee approved the leave you raised on their behalf — it is now in the normal approval queue.",
        entity_type: "leave_request",
        entity_id: (created as any).id,
        action_url: "/wfm/team-attendance",
        priority: "normal",
      }).catch(() => undefined);
      return res.json({ success: true, data: { consentStatus: "consented", leaveRequestId: (created as any).id } });
    } catch (e) {
      // Balance/eligibility rejected it — the manager_raised_request row stays pending so
      // nothing is silently lost; the employee sees why and can raise it themself with
      // different dates if that resolves it.
      return res.status(422).json({
        success: false,
        message: e instanceof Error ? e.message : "Could not submit this leave request",
      });
    }
  }),
);
