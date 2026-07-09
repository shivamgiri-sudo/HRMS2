import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { buildScopeWhereClause, hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { regularizationSchema } from "./wfm.validation.js";
import { wfmService } from "./wfm.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export const wfmRegularizationSecureRouter = Router();
wfmRegularizationSecureRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const WFM_VIEW_SCOPE_ROLES = ["wfm", "hr", "payroll_hr", "payroll_branch", "branch_head", "manager", "assistant_manager", "tl", "process_manager"];
const WFM_APPROVAL_SCOPE_ROLES = ["wfm"];

async function employeeTarget(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id, process_id, lob_id, department_id, reporting_manager_id, manager_id
       FROM employees
      WHERE id = ?
      LIMIT 1`,
    [employeeId],
  );
  return rows[0] as any | undefined;
}

async function canAccessEmployee(userId: string, employeeId: string, allowSelf = true) {
  if (await hasAnyRole(userId, "admin", "hr", "wfm", "ceo")) return true;
  const target = await employeeTarget(employeeId);
  if (!target) return false;
  const callerEmp = await getEmployeeForUser(userId);
  if (allowSelf && callerEmp?.id === employeeId) return true;
  return hasScopedAccess(
    userId,
    WFM_VIEW_SCOPE_ROLES,
    {
      branchId: target.branch_id,
      processId: target.process_id,
      lobId: target.lob_id,
      departmentId: target.department_id,
      managerEmployeeId: target.reporting_manager_id ?? target.manager_id,
      employeeId,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true },
  );
}

async function listScope(userId: string) {
  if (await hasAnyRole(userId, "super_admin")) return { sql: "1=1", params: [] as unknown[] };
  const scoped = await buildScopeWhereClause(
    userId,
    WFM_VIEW_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id",
      employeeId: "e.id",
    },
    { allowAdminBypass: false, allowCeoAllRead: false },
  );
  if (scoped.sql !== "1=0") return scoped;
  const emp = await getEmployeeForUser(userId);
  if (emp?.id) return { sql: "e.id = ?", params: [emp.id] as unknown[] };
  return { sql: "1=0", params: [] as unknown[] };
}

async function regularizationReviewRole(userId: string, regularizationId: string): Promise<"super_admin" | "manager" | "wfm" | null> {
  if (await hasAnyRole(userId, "super_admin")) return "super_admin";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.employee_id,
            ar.status,
            e.branch_id,
            e.process_id,
            e.lob_id,
            e.department_id,
            e.reporting_manager_id,
            e.manager_id
       FROM attendance_regularization ar
       JOIN employees e ON e.id = ar.employee_id
      WHERE ar.id = ?
      LIMIT 1`,
    [regularizationId],
  );
  const target = rows[0] as any;
  if (!target) return null;
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id === target.employee_id) return null;
  if (callerEmp?.id && (callerEmp.id === target.reporting_manager_id || callerEmp.id === target.manager_id)) {
    return "manager";
  }
  const wfmScoped = await hasScopedAccess(
    userId,
    WFM_APPROVAL_SCOPE_ROLES,
    {
      branchId: target.branch_id,
      processId: target.process_id,
      lobId: target.lob_id,
      departmentId: target.department_id,
      managerEmployeeId: target.reporting_manager_id ?? target.manager_id,
      employeeId: target.employee_id,
    },
    { allowAdminBypass: false, requireScopeForNonAdmin: true },
  );
  return wfmScoped ? "wfm" : null;
}

function nextRegularizationStatus(role: "super_admin" | "manager" | "wfm", currentStatus: string, requestedStatus: string): string | null {
  if (!["approved", "rejected", "manager_approved"].includes(requestedStatus)) return null;
  if (role === "super_admin") return requestedStatus === "manager_approved" ? "approved" : requestedStatus;
  if (role === "manager") {
    if (currentStatus !== "pending") return null;
    return requestedStatus === "rejected" ? "rejected" : "manager_approved";
  }
  if (currentStatus !== "manager_approved") return null;
  return requestedStatus === "manager_approved" ? null : requestedStatus;
}

async function buildRegularizationDecisionSupport(row: RowDataPacket) {
  const sessionDate = String(row.session_date ?? "").slice(0, 10);
  const employeeId = String(row.employee_id ?? "");
  const flags: string[] = [];
  let riskScore = 0;

  if (sessionDate > new Date().toISOString().slice(0, 10)) {
    flags.push("Future attendance date");
    riskScore += 30;
  }

  if (Number(row.same_day_request_count ?? 0) > 1) {
    flags.push("Duplicate request for same date");
    riskScore += 35;
  }

  if (Number(row.recent_request_count ?? 0) >= 3) {
    flags.push("Repeated regularizations in last 30 days");
    riskScore += 20;
  }

  if (Number(row.attendance_locked ?? 0) === 1) {
    flags.push("Attendance already locked by prior correction");
    riskScore += 30;
  }

  if (String(row.current_attendance_status ?? "") === String(row.requested_status ?? "")) {
    flags.push("Requested status already matches attendance");
    riskScore += 25;
  }

  if (["present", "half_day"].includes(String(row.requested_status ?? "")) && Number(row.total_punches ?? 0) === 0) {
    flags.push("No biometric punch evidence for payable attendance");
    riskScore += 45;
  }

  if (String(row.roster_status ?? "").toLowerCase().includes("week") && String(row.requested_status ?? "") === "present") {
    flags.push("Requested present on rostered week off");
    riskScore += 20;
  }

  if (!employeeId || !sessionDate) {
    flags.push("Missing employee/date evidence");
    riskScore += 50;
  }

  const riskLevel = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";
  return {
    riskScore,
    riskLevel,
    flags,
    canBulkApprove: riskLevel === "low" && String(row.status ?? "") === "manager_approved",
    evidence: {
      currentAttendanceStatus: row.current_attendance_status ?? null,
      currentLwp: row.current_lwp ?? null,
      firstPunch: row.first_punch ?? null,
      lastPunch: row.last_punch ?? null,
      totalPunches: Number(row.total_punches ?? 0),
      biometricMinutes: row.biometric_minutes ?? null,
      rawMinutes: row.raw_minutes ?? null,
      rosterStatus: row.roster_status ?? null,
      rosterShiftStart: row.shift_start_time ?? null,
      rosterShiftEnd: row.shift_end_time ?? null,
      duplicateRequests: Number(row.same_day_request_count ?? 0),
      recentRequests: Number(row.recent_request_count ?? 0),
    },
  };
}

async function enrichRegularizationRows(rows: RowDataPacket[]) {
  return Promise.all(rows.map(async (row) => ({
    ...row,
    decision_support: await buildRegularizationDecisionSupport(row),
  })));
}

async function reviewRegularizationRequest(req: any, res: any, regularizationId: string) {
  const reviewRole = await regularizationReviewRole(req.authUser.id, regularizationId);
  if (!reviewRole) {
    return res.status(403).json({ success: false, message: "Forbidden: regularization is outside your approval scope" });
  }
  const requestedReviewStatus = String(req.body.status ?? "");

  const [preRows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.status AS reg_status,
            ar.status,
            ar.requested_status,
            ar.employee_id,
            ar.session_date,
            ar.old_status, ar.new_status, ar.dispute_type,
            adr.attendance_status AS current_attendance_status,
            adr.lwp_value AS current_lwp,
            adr.is_locked AS attendance_locked,
            adr.clock_in_time AS first_punch,
            adr.clock_out_time AS last_punch,
            adr.biometric_minutes,
            adr.raw_minutes,
            COALESCE(ibd.total_punches, CASE WHEN adr.clock_in_time IS NULL THEN 0 WHEN adr.clock_out_time IS NULL THEN 1 ELSE 2 END) AS total_punches,
            wra.roster_status,
            wra.shift_start_time,
            wra.shift_end_time,
            (SELECT COUNT(*)
               FROM attendance_regularization dup
              WHERE dup.employee_id = ar.employee_id
                AND dup.session_date = ar.session_date
                AND dup.id <> ar.id
                AND dup.status <> 'rejected') AS same_day_request_count,
            (SELECT COUNT(*)
               FROM attendance_regularization recent
              WHERE recent.employee_id = ar.employee_id
                AND recent.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND recent.id <> ar.id) AS recent_request_count
       FROM attendance_regularization ar
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = ar.employee_id AND adr.record_date = ar.session_date
       LEFT JOIN integration_biometric_daily ibd
              ON ibd.employee_code = (SELECT e2.employee_code FROM employees e2 WHERE e2.id = ar.employee_id LIMIT 1)
             AND ibd.activity_date = ar.session_date
       LEFT JOIN wfm_roster_assignment wra
              ON wra.employee_id = ar.employee_id AND wra.roster_date = ar.session_date
      WHERE ar.id = ? LIMIT 1`,
    [regularizationId]
  );
  const pre = (preRows as RowDataPacket[])[0] as any;
  if (!pre) return res.status(404).json({ success: false, message: "Regularization not found" });

  const status = nextRegularizationStatus(reviewRole, String(pre.reg_status ?? ""), requestedReviewStatus);
  if (!status) {
    return res.status(400).json({ success: false, message: "Invalid approval step for current regularization status" });
  }

  const decisionSupport = await buildRegularizationDecisionSupport(pre);
  if (
    status === "approved" &&
    reviewRole === "wfm" &&
    decisionSupport.riskLevel !== "low" &&
    req.body.force !== true
  ) {
    return res.status(409).json({
      success: false,
      message: "Risky regularization requires manual review before final WFM approval",
      decision_support: decisionSupport,
    });
  }

  const reviewerNote = req.body.reviewerNote ?? req.body.remarks ?? null;
  const data = await wfmService.reviewRegularization(regularizationId, {
    status: status as any,
    reviewerNote,
  }, req.authUser.id);

  const actionType = status === "approved"
    ? "REGULARIZATION_APPROVED"
    : status === "manager_approved"
      ? "REGULARIZATION_MANAGER_APPROVED"
      : "REGULARIZATION_REJECTED";

  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role: reviewRole,
    action_type: actionType,
    module_key: "attendance",
    entity_type: "attendance_regularization",
    entity_id: regularizationId,
    employee_id: pre.employee_id ?? null,
    reason: reviewerNote ?? undefined,
    old_value_json: {
      reg_status: pre.reg_status ?? null,
      attendance_status: pre.current_attendance_status ?? null,
      lwp_value: pre.current_lwp ?? null,
    },
    new_value_json: {
      reg_status: status,
      attendance_status: status === "approved" ? (pre.requested_status ?? null) : pre.current_attendance_status ?? null,
      lwp_value: status === "approved"
        ? ({ present: 0, half_day: 0.5, absent: 1.0 }[pre.requested_status as string] ?? null)
        : pre.current_lwp ?? null,
      reviewer_note: reviewerNote,
      session_date: pre.session_date ?? null,
      dispute_type: pre.dispute_type ?? null,
    },
    req,
  });

  if (status === "approved" && pre.requested_status) {
    void logSensitiveAction({
      actor_user_id: req.authUser.id,
      actor_role: reviewRole,
      action_type: "ATTENDANCE_RECORD_CORRECTED",
      module_key: "attendance",
      entity_type: "attendance_daily_record",
      entity_id: `${pre.employee_id}:${pre.session_date}`,
      employee_id: pre.employee_id,
      reason: `Regularization approved: ${reviewerNote ?? ""}`,
      old_value_json: {
        attendance_status: pre.current_attendance_status ?? null,
        lwp_value: pre.current_lwp ?? null,
      },
      new_value_json: {
        attendance_status: pre.requested_status,
        lwp_value: { present: 0, half_day: 0.5, absent: 1.0 }[pre.requested_status as string] ?? 0,
        corrected_by: req.authUser.id,
        regularization_id: regularizationId,
      },
      req,
    });
  }

  return res.json({ success: true, data: { ...data, decision_support: decisionSupport }, message: `Regularization ${status}` });
}

wfmRegularizationSecureRouter.post("/regularizations", h(async (req: any, res: any) => {
  const input = regularizationSchema.parse(req.body);
  const callerEmp = await getEmployeeForUser(req.authUser.id);
  const requestedEmployeeId = String(req.body.employeeId ?? callerEmp?.id ?? "");
  if (!requestedEmployeeId) return res.status(403).json({ success: false, message: "No employee record" });

  if (!(await canAccessEmployee(req.authUser.id, requestedEmployeeId, true))) {
    return res.status(403).json({ success: false, error: "Forbidden: employee is outside your WFM scope" });
  }

  const isPrivileged = await hasAnyRole(req.authUser.id, "admin", "hr", "wfm", "manager", "assistant_manager", "tl", "branch_head", "process_manager", "ceo");
  const requestedByType = isPrivileged && callerEmp?.id !== requestedEmployeeId ? "manager" : "employee";
  const data = await wfmService.submitRegularization(
    { ...input, employeeId: requestedEmployeeId, requestedByType } as any,
    req.authUser.id,
  );

  // Audit: regularization submitted
  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role: requestedByType,
    action_type: "REGULARIZATION_SUBMITTED",
    module_key: "attendance",
    entity_type: "attendance_regularization",
    entity_id: data.id,
    employee_id: requestedEmployeeId,
    reason: input.reason,
    new_value_json: {
      session_date: input.sessionDate,
      requested_status: (input as any).requestedStatus ?? null,
      reason_code: input.reasonCode ?? null,
      dispute_type: (input as any).disputeType ?? null,
      old_status: (input as any).oldStatus ?? null,
      new_status: (input as any).newStatus ?? null,
      old_punch_in: (input as any).oldPunchIn ?? null,
      old_punch_out: (input as any).oldPunchOut ?? null,
      new_punch_in: (input as any).newPunchIn ?? null,
      new_punch_out: (input as any).newPunchOut ?? null,
    },
    req,
  });

  return res.status(201).json({ success: true, data, message: "Regularization submitted" });
}));

wfmRegularizationSecureRouter.get("/regularizations/mine", h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const data = await wfmService.listRegularizations({ employeeId: emp.id });
  return res.json({ success: true, data });
}));

wfmRegularizationSecureRouter.get("/regularizations", h(async (req: any, res: any) => {
  const scope = await listScope(req.authUser.id);
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  if (req.query.employeeId) { conds.push("ar.employee_id = ?"); params.push(String(req.query.employeeId)); }
  if (req.query.status) { conds.push("ar.status = ?"); params.push(String(req.query.status)); }
  if (req.query.fromDate) { conds.push("ar.session_date >= ?"); params.push(String(req.query.fromDate)); }
  if (req.query.toDate) { conds.push("ar.session_date <= ?"); params.push(String(req.query.toDate)); }

  const where = `WHERE ${conds.join(" AND ")}`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.*,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
            e.employee_code,
            b.branch_name,
            p.process_name,
            arm.label AS reason_label,
            adr.attendance_status AS current_attendance_status,
            adr.lwp_value AS current_lwp,
            adr.is_locked AS attendance_locked,
            adr.clock_in_time AS first_punch,
            adr.clock_out_time AS last_punch,
            adr.biometric_minutes,
            adr.raw_minutes,
            COALESCE(ibd.total_punches, CASE WHEN adr.clock_in_time IS NULL THEN 0 WHEN adr.clock_out_time IS NULL THEN 1 ELSE 2 END) AS total_punches,
            wra.roster_status,
            wra.shift_start_time,
            wra.shift_end_time,
            (SELECT COUNT(*)
               FROM attendance_regularization dup
              WHERE dup.employee_id = ar.employee_id
                AND dup.session_date = ar.session_date
                AND dup.id <> ar.id
                AND dup.status <> 'rejected') AS same_day_request_count,
            (SELECT COUNT(*)
               FROM attendance_regularization recent
              WHERE recent.employee_id = ar.employee_id
                AND recent.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND recent.id <> ar.id) AS recent_request_count
       FROM attendance_regularization ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN branch_master b ON b.id = COALESCE(ar.branch_id, e.branch_id)
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN attendance_reason_master arm ON arm.code = ar.reason_code
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = ar.employee_id AND adr.record_date = ar.session_date
       LEFT JOIN integration_biometric_daily ibd
              ON ibd.employee_code = e.employee_code AND ibd.activity_date = ar.session_date
       LEFT JOIN wfm_roster_assignment wra
              ON wra.employee_id = ar.employee_id AND wra.roster_date = ar.session_date
       ${where}
      ORDER BY ar.created_at DESC`,
    params,
  );
  const data = await enrichRegularizationRows(rows);
  return res.json({ success: true, data });
}));

wfmRegularizationSecureRouter.patch("/regularizations/bulk-review", h(async (req: any, res: any) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ success: false, message: "ids array is required" });

  const results: Array<{ id: string; success: boolean; message?: string }> = [];
  for (const id of ids) {
    const localRes = {
      statusCode: 200,
      payload: null as any,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: any) { this.payload = payload; return this; },
    };
    try {
      await reviewRegularizationRequest(req, localRes, id);
    } catch (err: any) {
      localRes.statusCode = 500;
      localRes.payload = { success: false, message: err?.message ?? String(err) };
    }
    results.push({
      id,
      success: localRes.statusCode >= 200 && localRes.statusCode < 300 && localRes.payload?.success !== false,
      message: localRes.payload?.message,
    });
  }

  const succeededCount = results.filter(r => r.success).length;
  const failedCount    = results.length - succeededCount;
  return res.json({
    success: failedCount === 0,
    succeeded: succeededCount,
    failed: failedCount,
    data: results,
    message: failedCount > 0
      ? `${succeededCount} approved, ${failedCount} failed — see data for details`
      : `${succeededCount} approved successfully`,
  });
}));

wfmRegularizationSecureRouter.patch("/regularizations/:id/review", h(async (req: any, res: any) => {
  return reviewRegularizationRequest(req, res, req.params.id);
}));

// ── Reason codes ──────────────────────────────────────────────────────────
wfmRegularizationSecureRouter.get("/regularizations/reasons", h(async (req: any, res: any) => {
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");
  const isManager = await checkRole(req.authUser.id, 'admin', 'hr', 'wfm', 'manager', 'assistant_manager', 'tl', 'branch_head', 'process_manager');
  const data = await wfmService.listReasons(isManager ? undefined : 'employee');
  return res.json({ success: true, data });
}));
