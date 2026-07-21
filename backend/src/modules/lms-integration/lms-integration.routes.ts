import { Router } from "express";
import type { NextFunction, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { lmsDb } from "../../db/lms-mysql.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";

export const lmsIntegrationRouter = Router();
lmsIntegrationRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: any) => fn(req, res).catch(next);

const LMS_PROGRESS_OVERSIGHT_ROLES = [
  "super_admin",
  "admin",
  "hr",
  "manager",
  "process_manager",
  "branch_head",
  "team_leader",
  "tl",
  "assistant_manager",
  "trainer",
  "training_manager",
  "ceo",
  "coo",
  "operations_manager",
] as const;

export function isOwnLmsEmployeeReference(
  targetEmployeeId: string,
  employee: { id: string; employee_code: string } | null,
): boolean {
  if (!employee) return false;
  const target = targetEmployeeId.trim().toLowerCase();
  return target.length > 0 && [employee.id, employee.employee_code]
    .some((value) => value.trim().toLowerCase() === target);
}

async function requireLmsProgressAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.authUser!.id;
    if (await hasRole(userId, ...LMS_PROGRESS_OVERSIGHT_ROLES)) return next();

    const employee = await getEmployeeForUser(userId);
    if (isOwnLmsEmployeeReference(req.params.employeeId, employee)) return next();

    return res.status(403).json({ success: false, message: "Forbidden" });
  } catch (error) {
    return next(error);
  }
}

// ─── Dashboard Summary ────────────────────────────────────────────────────────
// GET /api/lms/dashboard-summary — org-wide LMS snapshot for CEO/Super Admin
lmsIntegrationRouter.get("/dashboard-summary",
  requireRole("super_admin", "admin", "ceo", "hr"),
  h(async (_req, res) => {
    const [summary] = await lmsDb.execute<RowDataPacket[]>(`
      SELECT
        COUNT(*)                                          AS total_trainees,
        SUM(certification_status = 'certified')          AS certified_count,
        SUM(handover_to_ops = 1)                         AS ops_ready_count,
        SUM(ojt_ready = 1)                               AS ojt_ready_count,
        SUM(risk_status IN ('high','critical'))          AS high_risk_count,
        SUM(risk_status = 'critical')                    AS critical_risk_count,
        ROUND(AVG(course_completion_pct), 1)             AS avg_course_completion,
        ROUND(AVG(assessment_pass_pct), 1)               AS avg_mcq_pass,
        ROUND(AVG(attendance_pct), 1)                    AS avg_attendance_pct,
        SUM(certification_status IN ('certified','Certified')) AS certified_total
      FROM trainee_master
      WHERE status != 'archived'
    `);

    const [batches] = await lmsDb.execute<RowDataPacket[]>(`
      SELECT
        COUNT(*)                                  AS total_batches,
        SUM(batch_status = 'Active')              AS active_batches,
        SUM(total_trainees)                       AS total_trainees_in_batches,
        SUM(certified)                            AS total_certified,
        SUM(handover_to_ops)                      AS total_handed_over
      FROM batch_master
      WHERE batch_status != 'Deleted'
    `);

    const [risks] = await lmsDb.execute<RowDataPacket[]>(`
      SELECT
        SUM(status = 'Open' AND severity = 'HIGH')     AS open_high,
        SUM(status = 'Open' AND severity = 'CRITICAL') AS open_critical,
        SUM(status = 'Open' AND severity = 'WATCH')    AS open_watch,
        SUM(status = 'Resolved')                       AS resolved,
        COUNT(*)                                        AS total_risks
      FROM training_risk_log
    `);

    const [kpi] = await lmsDb.execute<RowDataPacket[]>(`
      SELECT * FROM historical_training_kpi
      ORDER BY period DESC LIMIT 6
    `);

    const [activeBatches] = await lmsDb.execute<RowDataPacket[]>(`
      SELECT batch_no, batch_name, branch, process, total_trainees, certified, handover_to_ops, batch_status
      FROM batch_master
      WHERE batch_status = 'Active'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const s = summary[0] ?? {};
    const b = batches[0] ?? {};

    return res.json({
      success: true,
      data: {
        // Key metrics for CEO / Super Admin widgets
        certified_learners:     Number(s.certified_count ?? s.certified_total ?? 0),
        total_trainees:         Number(s.total_trainees ?? 0),
        ops_ready:              Number(b.total_handed_over ?? s.ops_ready_count ?? 0),
        ojt_ready:              Number(s.ojt_ready_count ?? 0),
        high_risk_trainees:     Number(s.high_risk_count ?? 0),
        critical_risk_trainees: Number(s.critical_risk_count ?? 0),
        avg_course_completion:  Number(s.avg_course_completion ?? 0),
        avg_mcq_pass:           Number(s.avg_mcq_pass ?? 0),
        avg_attendance_pct:     Number(s.avg_attendance_pct ?? 0),
        // Batch info
        active_batches:         Number(b.active_batches ?? 0),
        total_batches:          Number(b.total_batches ?? 0),
        // Risk
        risks: {
          open_high:     Number((risks[0] ?? {}).open_high ?? 0),
          open_critical: Number((risks[0] ?? {}).open_critical ?? 0),
          open_watch:    Number((risks[0] ?? {}).open_watch ?? 0),
          resolved:      Number((risks[0] ?? {}).resolved ?? 0),
        },
        // Historical KPI trend
        kpi_trend: (kpi as RowDataPacket[]).map(r => ({
          period:           String(r.period),
          active_batches:   Number(r.active_batches),
          total_trainees:   Number(r.total_trainees),
          avg_course_pct:   Number(r.avg_course_pct),
          avg_mcq_pct:      Number(r.avg_mcq_pct),
          avg_attendance_pct: Number(r.avg_attendance_pct),
          certified_count:  Number(r.certified_count),
          certification_pct: Number(r.certification_pct),
          critical_risks:   Number(r.critical_risks),
        })),
        // Active batch list
        active_batch_list: (activeBatches as RowDataPacket[]).map(r => ({
          batch_no:      String(r.batch_no),
          batch_name:    String(r.batch_name),
          branch:        String(r.branch),
          process:       String(r.process),
          total_trainees: Number(r.total_trainees),
          certified:     Number(r.certified),
          handover_to_ops: Number(r.handover_to_ops),
        })),
      },
    });
  })
);

// ─── Per-Employee Progress ────────────────────────────────────────────────────
// GET /api/lms/learner-progress/:employeeId — employee's own LMS progress
// Any authenticated user can request their own record; managers/hr/admin can request any.
lmsIntegrationRouter.get("/learner-progress/:employeeId",
  requireRole("super_admin", "admin", "hr", "manager", "process_manager", "branch_head",
              "team_leader", "tl", "assistant_manager", "trainer", "training_manager",
              "payroll", "payroll_head", "ceo", "coo", "employee", "agent", "trainee",
              "wfm", "qa", "quality_analyst", "operations_manager", "recruiter", "recruitment_hr"),
  requireLmsProgressAccess,
  h(async (req, res) => {
  const { employeeId } = req.params;

  const [trainee] = await lmsDb.execute<RowDataPacket[]>(`
    SELECT * FROM trainee_master
    WHERE employee_id = ? OR permanent_emp_id = ?
    LIMIT 1
  `, [employeeId, employeeId]);

  if (!(trainee as RowDataPacket[]).length) {
    return res.json({ success: true, data: null });
  }

  const t = (trainee as RowDataPacket[])[0];

  const [assessment] = await lmsDb.execute<RowDataPacket[]>(`
    SELECT best_percentage, result, total_attempts, last_attempt_at
    FROM assessment_results
    WHERE employee_id = ?
    ORDER BY best_percentage DESC
    LIMIT 1
  `, [employeeId]);

  const [risks] = await lmsDb.execute<RowDataPacket[]>(`
    SELECT risk_type, risk_title, severity, status
    FROM training_risk_log
    WHERE employee_id = ? AND status = 'Open'
    ORDER BY FIELD(severity,'CRITICAL','HIGH','WATCH')
    LIMIT 5
  `, [employeeId]);

  const [content] = await lmsDb.execute<RowDataPacket[]>(`
    SELECT COUNT(*) as total,
           SUM(opened = 1) as opened,
           ROUND(AVG(completion_pct), 1) as avg_pct
    FROM content_progress
    WHERE employee_id = ?
  `, [employeeId]);

  const a = (assessment as RowDataPacket[])[0];
  const cp = (content as RowDataPacket[])[0];

  return res.json({
    success: true,
    data: {
      employee_id:         String(t.employee_id),
      lms_id:              String(t.lms_id ?? ""),
      trainee_name:        String(t.trainee_name),
      batch_no:            String(t.batch_no ?? ""),
      classroom_name:      String(t.classroom_name ?? ""),
      branch:              String(t.branch ?? ""),
      process:             String(t.process ?? ""),
      // Completion metrics
      completion_pct:      Number(t.course_completion_pct ?? 0),
      mcq_best_score:      Number(a?.best_percentage ?? t.assessment_pass_pct ?? 0),
      mcq_result:          String(a?.result ?? ""),
      attendance_pct:      Number(t.attendance_pct ?? 0),
      // Certification
      certification_status: String(t.certification_status ?? "Not Certified"),
      ojt_ready:           Boolean(t.ojt_ready),
      handover_to_ops:     Boolean(t.handover_to_ops),
      // Risk
      risk_status:         String(t.risk_status ?? ""),
      risk_reason:         String(t.risk_reason ?? ""),
      open_risks:          (risks as RowDataPacket[]).map(r => ({
        type:     String(r.risk_type),
        title:    String(r.risk_title),
        severity: String(r.severity),
      })),
      // Content progress
      content_total:       Number(cp?.total ?? 0),
      content_opened:      Number(cp?.opened ?? 0),
      content_avg_pct:     Number(cp?.avg_pct ?? 0),
      // For dashboard model compatibility
      completionPct:       Number(t.course_completion_pct ?? 0),
      mcqBestScore:        Number(a?.best_percentage ?? t.assessment_pass_pct ?? 0),
      readinessScore:      Number(t.attendance_pct ?? 0),
      certificationStatus: String(t.certification_status ?? "Not Certified"),
      course_progress:     `${Math.round(Number(cp?.opened ?? 0))}/${Number(cp?.total ?? 0)} modules`,
      course_name:         String(t.classroom_name ?? t.batch_no ?? ""),
    },
  });
}));

// ─── Training Risk Summary ────────────────────────────────────────────────────
// GET /api/lms/risk-summary — org-wide risk breakdown
lmsIntegrationRouter.get("/risk-summary",
  requireRole("super_admin", "admin", "ceo", "hr", "manager"),
  h(async (_req, res) => {
    const [risks] = await lmsDb.execute<RowDataPacket[]>(`
      SELECT
        trl.employee_id, trl.trainee_name, trl.batch_no, trl.branch,
        trl.process, trl.risk_type, trl.risk_title, trl.severity,
        trl.current_value, trl.expected_value, trl.status, trl.created_at
      FROM training_risk_log trl
      WHERE trl.status = 'Open'
      ORDER BY FIELD(trl.severity,'CRITICAL','HIGH','WATCH'), trl.created_at ASC
      LIMIT 50
    `);

    const [summary] = await lmsDb.execute<RowDataPacket[]>(`
      SELECT severity, COUNT(*) as count
      FROM training_risk_log
      WHERE status = 'Open'
      GROUP BY severity
    `);

    return res.json({
      success: true,
      data: {
        summary: (summary as RowDataPacket[]).reduce((acc, r) => {
          acc[String(r.severity).toLowerCase()] = Number(r.count);
          return acc;
        }, {} as Record<string, number>),
        risks: (risks as RowDataPacket[]).map(r => ({
          employee_id:   String(r.employee_id),
          trainee_name:  String(r.trainee_name),
          batch_no:      String(r.batch_no),
          branch:        String(r.branch),
          process:       String(r.process),
          risk_type:     String(r.risk_type),
          risk_title:    String(r.risk_title),
          severity:      String(r.severity),
          current_value: Number(r.current_value),
          expected_value: Number(r.expected_value),
          created_at:    String(r.created_at),
        })),
      },
    });
  })
);

// ─── Batch Progress List ──────────────────────────────────────────────────────
// GET /api/lms/batches — active batch list with progress
lmsIntegrationRouter.get("/batches",
  requireRole("super_admin", "admin", "ceo", "hr", "manager", "trainer"),
  h(async (_req, res) => {
    const [batches] = await lmsDb.execute<RowDataPacket[]>(`
      SELECT
        b.batch_no, b.batch_name, b.branch, b.process, b.lob,
        b.batch_status, b.total_trainees, b.certified, b.handover_to_ops,
        b.ojt_ready, b.start_date, b.end_date, b.coordinator_name,
        ROUND(AVG(t.course_completion_pct), 1) AS avg_course_pct,
        ROUND(AVG(t.assessment_pass_pct), 1)   AS avg_mcq_pct,
        SUM(t.risk_status IN ('high','critical')) AS at_risk_count
      FROM batch_master b
      LEFT JOIN trainee_master t ON t.batch_no = b.batch_no
      WHERE b.batch_status != 'Deleted'
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `);

    return res.json({
      success: true,
      data: (batches as RowDataPacket[]).map(r => ({
        batch_no:        String(r.batch_no),
        batch_name:      String(r.batch_name),
        branch:          String(r.branch),
        process:         String(r.process),
        batch_status:    String(r.batch_status),
        total_trainees:  Number(r.total_trainees),
        certified:       Number(r.certified),
        handover_to_ops: Number(r.handover_to_ops),
        ojt_ready:       Number(r.ojt_ready),
        avg_course_pct:  Number(r.avg_course_pct ?? 0),
        avg_mcq_pct:     Number(r.avg_mcq_pct ?? 0),
        at_risk_count:   Number(r.at_risk_count ?? 0),
        start_date:      r.start_date ? String(r.start_date) : null,
        end_date:        r.end_date ? String(r.end_date) : null,
        coordinator:     r.coordinator_name ? String(r.coordinator_name) : null,
      })),
    });
  })
);
