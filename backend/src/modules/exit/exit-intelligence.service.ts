import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { calculateEmployeeEngagementHealth } from "../engagement/engagement-health.service.js";
import { scalar } from "../../shared/dbHelpers.js";

function riskLabel(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 75) return "critical";
  if (score >= 55) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export async function createExitHealthSnapshot(exitRequestId: string) {
  const [exitRows] = await db.execute<RowDataPacket[]>(
    `SELECT er.id, er.employee_id, er.last_working_day_proposed,
            e.date_of_joining, e.designation_id, e.process_id, e.branch_id,
            CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
      WHERE er.id = ? LIMIT 1`,
    [exitRequestId]
  );
  const rec = exitRows[0] as any;
  if (!rec) throw new Error("Exit request not found");

  const engagement = await calculateEmployeeEngagementHealth(rec.employee_id);
  const performanceScore = engagement.performance_score ?? 70;
  const attendanceScore = engagement.attendance_score ?? 70;
  const kudosReceived90d = Number((engagement.insight as any)?.kudosReceived90d ?? 0);
  const pulseAvg90d = Number((engagement.insight as any)?.pulseAvg ?? 0);

  const tenureMonths = rec.date_of_joining
    ? Math.max(0, Math.floor((Date.now() - new Date(rec.date_of_joining).getTime()) / (1000 * 60 * 60 * 24 * 30.4375)))
    : 0;

  const pendingDisciplinary = await scalar(
    `SELECT COUNT(*) AS cnt FROM pip_action_plan WHERE employee_id = ? AND status NOT IN ('closed','cancelled')`,
    [rec.employee_id]
  );

  const regrettableExit = performanceScore >= 80 && attendanceScore >= 75 && tenureMonths >= 6 && pendingDisciplinary === 0;
  const attritionRiskScore = Math.max(0, 100 - engagement.engagement_score) + (regrettableExit ? 25 : 0);
  const label = riskLabel(attritionRiskScore);

  const insight = {
    employeeName: rec.employee_name,
    tenureMonths,
    engagement,
    pendingDisciplinary,
    regrettableExit,
    recommendation: regrettableExit
      ? "Regrettable exit. Mandatory retention discussion should be completed before HR accepts resignation."
      : engagement.engagement_score < 50
        ? "Low engagement trend. Capture detailed exit reason and manager feedback."
        : "Standard exit workflow can proceed with clearance and F&F controls."
  };

  await db.execute(
    `INSERT INTO exit_employee_health_snapshot
       (id, exit_request_id, employee_id, snapshot_date, engagement_score, performance_score,
        attendance_score, kudos_received_90d, pulse_avg_90d, regrettable_exit, risk_label, insight_json)
     VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       engagement_score = VALUES(engagement_score), performance_score = VALUES(performance_score),
       attendance_score = VALUES(attendance_score), kudos_received_90d = VALUES(kudos_received_90d),
       pulse_avg_90d = VALUES(pulse_avg_90d), regrettable_exit = VALUES(regrettable_exit),
       risk_label = VALUES(risk_label), insight_json = VALUES(insight_json)`,
    [
      randomUUID(), exitRequestId, rec.employee_id, engagement.engagement_score,
      performanceScore, attendanceScore, kudosReceived90d, pulseAvg90d,
      regrettableExit ? 1 : 0, label, JSON.stringify(insight)
    ]
  );

  return {
    exit_request_id: exitRequestId,
    employee_id: rec.employee_id,
    engagement_score: engagement.engagement_score,
    performance_score: performanceScore,
    attendance_score: attendanceScore,
    kudos_received_90d: kudosReceived90d,
    pulse_avg_90d: pulseAvg90d,
    regrettable_exit: regrettableExit,
    risk_label: label,
    insight,
  };
}

export async function createDefaultClearanceTasks(exitRequestId: string, employeeId: string) {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM exit_clearance_task WHERE exit_request_id = ?`,
    [exitRequestId]
  );
  if (Number(existing[0]?.cnt ?? 0) > 0) return { created: 0, skipped: true };

  const tasks = [
    ["manager", "Manager handover clearance", "Confirm KT, pending work handover, client dependency and system access handover.", "manager"],
    ["hr", "HR resignation and exit interview", "Confirm resignation acceptance, exit reason category and exit interview completion.", "hr"],
    ["assets", "Asset recovery clearance", "Recover laptop/desktop, headset, ID card, access card, SIM, and any company property.", "admin"],
    ["it", "IT access closure", "Disable email, VPN, client tools and internal application access after last working day.", "admin"],
    ["wfm", "Roster deactivation", "Remove future roster assignments and stop WFM scheduling after LWD.", "wfm"],
    ["payroll", "Payroll hold and F&F readiness", "Check salary hold, advances, notice recovery, leave encashment and F&F readiness.", "payroll"],
    ["lms", "LMS and certification closure", "Archive LMS status and training/certification records.", "trainer"],
    ["compliance", "Compliance and NDA closure", "Confirm NDA/client confidentiality reminders and DPDP exit notice.", "hr"],
  ];

  for (const [area, title, desc, role] of tasks) {
    await db.execute(
      `INSERT INTO exit_clearance_task
         (id, exit_request_id, employee_id, clearance_area, task_title, task_description, owner_role, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 3 DAY))`,
      [randomUUID(), exitRequestId, employeeId, area, title, desc, role]
    );
  }
  return { created: tasks.length, skipped: false };
}

export async function getExitCommandCenter(filters: { managerEmployeeId?: string } = {}) {
  const params: unknown[] = [];
  const scopeWhere = filters.managerEmployeeId
    ? `WHERE (e.reporting_manager_id = ? OR e.manager_id = ?)`
    : "";
  if (filters.managerEmployeeId) params.push(filters.managerEmployeeId, filters.managerEmployeeId);

  const [summary] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN er.status IN ('submitted','manager_review','hr_review','admin_review') THEN 1 ELSE 0 END) AS pending_review,
       SUM(CASE WHEN er.status IN ('accepted','notice_serving') THEN 1 ELSE 0 END) AS active_notice,
       SUM(CASE WHEN er.status IN ('exited','exit_confirmed') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN hs.regrettable_exit = 1 THEN 1 ELSE 0 END) AS regrettable
     FROM exit_request er
     JOIN employees e ON e.id = er.employee_id
     LEFT JOIN exit_employee_health_snapshot hs ON hs.exit_request_id = er.id
     ${scopeWhere}`,
    params,
  );

  const [requests] = await db.execute<RowDataPacket[]>(
    `SELECT er.*,
            CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
            e.employee_code,
            b.branch_name,
            p.process_name,
            hs.engagement_score,
            hs.regrettable_exit,
            hs.risk_label,
            COALESCE(clearance.total_tasks, 0) AS clearance_total,
            COALESCE(clearance.cleared_tasks, 0) AS clearance_cleared
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN exit_employee_health_snapshot hs ON hs.exit_request_id = er.id
       LEFT JOIN (
         SELECT exit_request_id,
                COUNT(*) AS total_tasks,
                SUM(CASE WHEN status IN ('cleared','waived') THEN 1 ELSE 0 END) AS cleared_tasks
           FROM exit_clearance_task GROUP BY exit_request_id
       ) clearance ON clearance.exit_request_id = er.id
      ${scopeWhere}
      ORDER BY er.created_at DESC
      LIMIT 100`,
    params,
  );

  const clearanceParams: unknown[] = [];
  const clearanceScope = filters.managerEmployeeId
    ? `JOIN exit_request er ON er.id = ect.exit_request_id
       JOIN employees e ON e.id = er.employee_id
       WHERE (e.reporting_manager_id = ? OR e.manager_id = ?)`
    : "";
  if (filters.managerEmployeeId) clearanceParams.push(filters.managerEmployeeId, filters.managerEmployeeId);

  const [clearance] = await db.execute<RowDataPacket[]>(
    `SELECT ect.clearance_area, ect.status, COUNT(*) AS count
       FROM exit_clearance_task ect
       ${clearanceScope}
      GROUP BY ect.clearance_area, ect.status
      ORDER BY ect.clearance_area, ect.status`,
    clearanceParams,
  );

  return { summary: summary[0] ?? {}, requests, clearance };
}

export async function addRetentionAction(input: {
  exitRequestId: string;
  employeeId: string;
  actionType: string;
  actionSummary: string;
  outcome?: string;
  outcomeRemarks?: string | null;
  userId: string;
}) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO exit_retention_action
       (id, exit_request_id, employee_id, action_type, action_summary, outcome, outcome_remarks, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.exitRequestId, input.employeeId, input.actionType, input.actionSummary, input.outcome ?? "pending", input.outcomeRemarks ?? null, input.userId]
  );
  return { id };
}

export async function saveExitInterview(input: {
  exitRequestId: string;
  employeeId: string;
  primaryReason?: string | null;
  secondaryReason?: string | null;
  managerFeedbackScore?: number | null;
  processFeedbackScore?: number | null;
  salaryFeedbackScore?: number | null;
  workLifeScore?: number | null;
  wouldRejoin?: boolean | null;
  rehireEligible?: boolean | null;
  comments?: string | null;
  userId: string;
}) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO exit_interview_response
       (id, exit_request_id, employee_id, primary_reason, secondary_reason,
        manager_feedback_score, process_feedback_score, salary_feedback_score, work_life_score,
        would_rejoin, rehire_eligible, comments, captured_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       primary_reason = VALUES(primary_reason), secondary_reason = VALUES(secondary_reason),
       manager_feedback_score = VALUES(manager_feedback_score), process_feedback_score = VALUES(process_feedback_score),
       salary_feedback_score = VALUES(salary_feedback_score), work_life_score = VALUES(work_life_score),
       would_rejoin = VALUES(would_rejoin), rehire_eligible = VALUES(rehire_eligible),
       comments = VALUES(comments), captured_by = VALUES(captured_by), captured_at = NOW()`,
    [
      id, input.exitRequestId, input.employeeId, input.primaryReason ?? null, input.secondaryReason ?? null,
      input.managerFeedbackScore ?? null, input.processFeedbackScore ?? null, input.salaryFeedbackScore ?? null,
      input.workLifeScore ?? null, input.wouldRejoin === null || input.wouldRejoin === undefined ? null : (input.wouldRejoin ? 1 : 0),
      input.rehireEligible === null || input.rehireEligible === undefined ? null : (input.rehireEligible ? 1 : 0),
      input.comments ?? null, input.userId
    ]
  );
  return { id };
}