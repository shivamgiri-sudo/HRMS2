/**
 * Coaching Center data. The LMS sync already brings each learner's progress, courses, assessments and
 * certifications into HRMS; the existing per-employee endpoints only let HR/admin or the learner read them,
 * so a TL or AM could not see their own team's. This adds the team roll-up and a per-employee coaching view
 * with the reporting-line scope: a TL sees the team, an AM each TL's team, HR/admin/trainer everyone.
 * Read-only - it reads the synced tables and writes nothing.
 */
import { Router, type NextFunction, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import {
  isInReportingSpan,
  spanClauseFor,
} from "../../shared/reportingSpan.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import {
  attentionReasons,
  isFailedResult,
  sortByAttention,
} from "./lms-coaching.pure.js";

export const lmsCoachingRouter = Router();
lmsCoachingRouter.use(requireAuth);

/** Roles that coach or oversee learning across teams. */
const ORG_WIDE_COACHING_ROLES = [
  "super_admin",
  "admin",
  "hr",
  "hr_admin",
  "ceo",
  "coo",
  "trainer",
  "operations_head",
] as const;
const TEAM_LIST_LIMIT = 300;

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const wrap =
  (fn: Handler) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

const NAME = `COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))))`;

async function canSeeCoaching(
  req: AuthenticatedRequest,
  employeeId: string,
): Promise<boolean> {
  const caller = await getEmployeeForUser(req.authUser.id);
  if (caller?.id && String(caller.id) === employeeId) return true;
  if (await hasAnyRole(req.authUser.id, ...ORG_WIDE_COACHING_ROLES))
    return true;
  if (await isInReportingSpan(req.authUser.id, employeeId)) return true;
  return canViewEmployee(req.authUser, employeeId);
}

/** Team roll-up: one row per learner in the caller's span, most in need of attention first. */
lmsCoachingRouter.get(
  "/coaching/team",
  wrap(async (req, res) => {
    const orgWide = await hasAnyRole(
      req.authUser.id,
      ...ORG_WIDE_COACHING_ROLES,
    );
    const caller = await getEmployeeForUser(req.authUser.id);
    if (!orgWide && !caller?.id)
      return res.json({ success: true, data: { scope: "none", rows: [] } });

    const where: string[] = ["e.active_status = 1"];
    const params: unknown[] = [];
    if (!orgWide) {
      const span = spanClauseFor(String(caller!.id), "e");
      where.push(span.sql);
      params.push(...span.params);
    }
    const search = String(req.query.search ?? "")
      .trim()
      .slice(0, 60);
    if (search) {
      where.push(`(${NAME} LIKE ? OR e.employee_code LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, ${NAME} AS name, pm.process_name,
              lp.batch_no, lp.batch_name, lp.readiness_score, lp.ops_handover_ready, lp.attrition_risk_signal,
              COALESCE(c.total, 0) AS courses_total, COALESCE(c.overdue, 0) AS overdue_courses, c.avg_completion,
              a.assessment_name AS last_assessment, a.percentage AS last_percentage, a.result AS last_result,
              DATE_FORMAT(a.attempted_at, '%Y-%m-%d') AS last_attempted,
              COALESCE(f.failed, 0) AS failed_assessments
         FROM employees e
         LEFT JOIN process_master pm ON pm.id = e.process_id
         LEFT JOIN lms_learner_progress lp
                ON lp.id = (SELECT y.id FROM lms_learner_progress y WHERE y.employee_id = e.id ORDER BY y.updated_at DESC LIMIT 1)
         LEFT JOIN (SELECT employee_id, COUNT(*) AS total, AVG(completion_pct) AS avg_completion,
                           SUM(CASE WHEN due_date IS NOT NULL AND due_date < CURDATE() AND COALESCE(completion_pct, 0) < 100 THEN 1 ELSE 0 END) AS overdue
                      FROM lms_learning_progress_snapshot GROUP BY employee_id) c ON c.employee_id = e.id
         LEFT JOIN lms_assessment_scores a
                ON a.id = (SELECT x.id FROM lms_assessment_scores x WHERE x.employee_id = e.id ORDER BY x.attempted_at DESC LIMIT 1)
         LEFT JOIN (SELECT employee_id, COUNT(*) AS failed FROM lms_assessment_scores
                     WHERE LOWER(result) IN ('fail', 'failed') GROUP BY employee_id) f ON f.employee_id = e.id
        WHERE ${where.join(" AND ")}
        ORDER BY name
        LIMIT ${TEAM_LIST_LIMIT}`,
      params,
    );
    const mapped = rows.map((r) => {
      const base = {
        employeeId: String(r.id),
        overdueCourses: Number(r.overdue_courses ?? 0),
        failedAssessments: Number(r.failed_assessments ?? 0),
        attritionRisk: (r.attrition_risk_signal as string | null) ?? null,
        opsHandoverReady:
          r.ops_handover_ready === null || r.ops_handover_ready === undefined
            ? null
            : Number(r.ops_handover_ready),
        batchNo: (r.batch_no as string | null) ?? null,
      };
      return {
        ...base,
        code: (r.employee_code as string | null) ?? null,
        name: String(r.name ?? ""),
        processName: (r.process_name as string | null) ?? null,
        batchName: (r.batch_name as string | null) ?? null,
        readinessScore:
          r.readiness_score === null || r.readiness_score === undefined
            ? null
            : Number(r.readiness_score),
        coursesTotal: Number(r.courses_total ?? 0),
        avgCompletion:
          r.avg_completion === null || r.avg_completion === undefined
            ? null
            : Math.round(Number(r.avg_completion)),
        lastAssessment: (r.last_assessment as string | null) ?? null,
        lastPercentage:
          r.last_percentage === null || r.last_percentage === undefined
            ? null
            : Number(r.last_percentage),
        lastResult: (r.last_result as string | null) ?? null,
        lastAttempted: (r.last_attempted as string | null) ?? null,
        reasons: attentionReasons(base),
      };
    });
    return res.json({
      success: true,
      data: {
        scope: orgWide ? "all" : "span",
        truncated: rows.length >= TEAM_LIST_LIMIT,
        rows: sortByAttention(mapped),
      },
    });
  }),
);

async function coachingDetail(employeeId: string) {
  const [[person], [progress], [courses], [assessments], [certs], [reminders]] =
    await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT e.id, e.employee_code, ${NAME} AS name FROM employees e WHERE e.id = ? LIMIT 1`,
        [employeeId],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT batch_no, batch_name, process_name, branch_name, mcq_best_score, readiness_score, attrition_risk_signal, ops_handover_ready,
              DATE_FORMAT(synced_at, '%Y-%m-%d %H:%i') AS synced_at
         FROM lms_learner_progress WHERE employee_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [employeeId],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT course_name, completion_pct, status, DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date, DATE_FORMAT(last_accessed, '%Y-%m-%d') AS last_accessed,
              CASE WHEN due_date IS NOT NULL AND due_date < CURDATE() AND COALESCE(completion_pct, 0) < 100 THEN 1 ELSE 0 END AS overdue
         FROM lms_learning_progress_snapshot WHERE employee_id = ? ORDER BY overdue DESC, due_date IS NULL, due_date LIMIT 100`,
        [employeeId],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT assessment_name, attempt_no, percentage, result, DATE_FORMAT(attempted_at, '%Y-%m-%d') AS attempted_at
         FROM lms_assessment_scores WHERE employee_id = ? ORDER BY attempted_at DESC LIMIT 50`,
        [employeeId],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT certification_name, status, DATE_FORMAT(issued_date, '%Y-%m-%d') AS issued_date, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date
         FROM lms_certification_snapshot WHERE employee_id = ? ORDER BY expiry_date IS NULL, expiry_date LIMIT 50`,
        [employeeId],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT reminder_type, DATE_FORMAT(sent_at, '%Y-%m-%d') AS sent_at FROM lms_reminder_log WHERE employee_id = ? ORDER BY sent_at DESC LIMIT 20`,
        [employeeId],
      ),
    ]);
  const learner = progress[0] ?? null;
  return {
    employee: person[0]
      ? {
          id: String(person[0].id),
          code: (person[0].employee_code as string | null) ?? null,
          name: String(person[0].name ?? ""),
        }
      : null,
    progress: learner
      ? {
          batchNo: learner.batch_no ?? null,
          batchName: learner.batch_name ?? null,
          mcqBestScore:
            learner.mcq_best_score === null
              ? null
              : Number(learner.mcq_best_score),
          readinessScore:
            learner.readiness_score === null
              ? null
              : Number(learner.readiness_score),
          attritionRisk: learner.attrition_risk_signal ?? null,
          opsHandoverReady:
            learner.ops_handover_ready === null
              ? null
              : Number(learner.ops_handover_ready),
          syncedAt: learner.synced_at ?? null,
        }
      : null,
    courses: courses.map((c) => ({
      name: String(c.course_name ?? ""),
      completionPct:
        c.completion_pct === null ? null : Number(c.completion_pct),
      status: c.status ?? null,
      dueDate: c.due_date ?? null,
      lastAccessed: c.last_accessed ?? null,
      overdue: Number(c.overdue) === 1,
    })),
    assessments: assessments.map((a) => ({
      name: String(a.assessment_name ?? ""),
      attempt: Number(a.attempt_no ?? 1),
      percentage: a.percentage === null ? null : Number(a.percentage),
      result: a.result ?? null,
      failed: isFailedResult(a.result),
      attemptedAt: a.attempted_at ?? null,
    })),
    certifications: certs.map((c) => ({
      name: String(c.certification_name ?? ""),
      status: c.status ?? null,
      issuedDate: c.issued_date ?? null,
      expiryDate: c.expiry_date ?? null,
    })),
    reminders: reminders.map((r) => ({
      type: r.reminder_type ?? null,
      sentAt: r.sent_at ?? null,
    })),
  };
}

lmsCoachingRouter.get(
  "/coaching/employee/:employeeId",
  wrap(async (req, res) => {
    const employeeId = String(req.params.employeeId).slice(0, 36);
    if (!(await canSeeCoaching(req, employeeId)))
      return res
        .status(403)
        .json({
          success: false,
          message: "You cannot view this person's coaching record.",
        });
    return res.json({ success: true, data: await coachingDetail(employeeId) });
  }),
);

/** Same view found by OFFICIAL email only (personal and legacy addresses are never used)  - how the Onfido dashboard (which knows analysts by email) reaches it. */
lmsCoachingRouter.get(
  "/coaching/by-email",
  wrap(async (req, res) => {
    const email = String(req.query.email ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 255);
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "email is required" });
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees
        WHERE active_status = 1
          AND LOWER(official_email) = ?
        LIMIT 2`,
      [email],
    );
    if (rows.length !== 1) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            rows.length === 0
              ? "No employee has that official email."
              : "More than one employee has that official email.",
        });
    }
    const employeeId = String(rows[0].id);
    if (!(await canSeeCoaching(req, employeeId)))
      return res
        .status(403)
        .json({
          success: false,
          message: "You cannot view this person's coaching record.",
        });
    return res.json({ success: true, data: await coachingDetail(employeeId) });
  }),
);
