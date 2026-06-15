import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthKeys(monthCount: number): string[] {
  const now = new Date();
  const months: string[] = [];

  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  return months;
}

export const managementService = {
  async getTeamKpiSummary(filters: { process_id?: string; period?: string; branch_id?: string }) {
    const conds: string[] = ["e.active_status = 1"];
    const params: unknown[] = [];
    if (filters.process_id) { conds.push("e.process_id = ?"); params.push(filters.process_id); }
    if (filters.branch_id)  { conds.push("e.branch_id = ?");  params.push(filters.branch_id); }
    const period = filters.period ?? new Date().toISOString().slice(0, 7);
    conds.push("DATE_FORMAT(kda.score_date, '%Y-%m') = ?"); params.push(period);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id AS employee_id,
         e.employee_code,
         e.full_name AS employee_name,
         ? AS period,
         ROUND(
           SUM((
             CASE WHEN kmm.direction = 'lower_is_better'
                  THEN LEAST(kpc.target_value / NULLIF(kda.actual_value, 0), 1.2)
                  ELSE LEAST(kda.actual_value / NULLIF(kpc.target_value, 0), 1.2)
             END * 100
           ) * kpc.weightage) / NULLIF(SUM(kpc.weightage), 0),
           2
         ) AS overall_score,
         DENSE_RANK() OVER (
           ORDER BY
             SUM((
               CASE WHEN kmm.direction = 'lower_is_better'
                    THEN LEAST(kpc.target_value / NULLIF(kda.actual_value, 0), 1.2)
                    ELSE LEAST(kda.actual_value / NULLIF(kpc.target_value, 0), 1.2)
               END * 100
             ) * kpc.weightage) / NULLIF(SUM(kpc.weightage), 0) DESC
         ) AS rank_position,
         'stable' AS trend,
         p.process_name
         FROM kpi_daily_actual kda
         JOIN employees e ON e.id = kda.employee_id
         JOIN kpi_process_config kpc
           ON kpc.process_id = e.process_id
          AND kpc.metric_id = kda.metric_id
         JOIN kpi_metric_master kmm ON kmm.id = kda.metric_id
         LEFT JOIN process_master p ON p.id = e.process_id
        WHERE ${conds.join(" AND ")}
        GROUP BY e.id, e.employee_code, e.full_name, p.process_name
        ORDER BY rank_position ASC, overall_score DESC
        LIMIT 200`,
      [period, ...params]
    );
    return rows as RowDataPacket[];
  },

  async listCoachingSessions(filters: { employee_id?: string; coach_user_id?: string; status?: string }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.employee_id)   { conds.push("cs.employee_id = ?");   params.push(filters.employee_id); }
    if (filters.coach_user_id) { conds.push("cs.coach_user_id = ?"); params.push(filters.coach_user_id); }
    if (filters.status)        { conds.push("cs.status = ?");        params.push(filters.status); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cs.*, e.employee_code, e.full_name AS employee_name FROM coaching_session cs
         JOIN employees e ON e.id = cs.employee_id
        WHERE ${conds.join(" AND ")} ORDER BY cs.session_date DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async createCoachingSession(data: {
    employee_id: string; session_date: string; session_type: string;
    notes?: string; action_items?: Record<string, unknown>[];
  }, coachUserId: string, req?: Request) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO coaching_session (id, employee_id, coach_user_id, session_date, session_type, notes, action_items) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, data.employee_id, coachUserId, data.session_date, data.session_type, data.notes ?? null, data.action_items ? JSON.stringify(data.action_items) : null]
    );
    await logSensitiveAction({ actor_user_id: coachUserId, action_type: "COACHING_SESSION_CREATED", module_key: "MANAGEMENT", entity_type: "employee", entity_id: data.employee_id, req });
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM coaching_session WHERE id = ? LIMIT 1", [id]);
    return (rows as RowDataPacket[])[0];
  },

  async listAlerts(filters: { employee_id?: string; severity?: string; acknowledged?: boolean }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.employee_id)                { conds.push("pa.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.severity)                   { conds.push("pa.severity = ?");    params.push(filters.severity); }
    if (filters.acknowledged !== undefined) { conds.push("pa.acknowledged = ?"); params.push(filters.acknowledged ? 1 : 0); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pa.*, e.employee_code, e.full_name AS employee_name FROM performance_alert pa
         JOIN employees e ON e.id = pa.employee_id
        WHERE ${conds.join(" AND ")} ORDER BY pa.created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async acknowledgeAlert(alertId: string, acknowledgedBy: string, req?: Request) {
    await db.execute("UPDATE performance_alert SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = NOW() WHERE id = ?", [acknowledgedBy, alertId]);
    await logSensitiveAction({ actor_user_id: acknowledgedBy, action_type: "ALERT_ACKNOWLEDGED", module_key: "MANAGEMENT", entity_type: "performance_alert", entity_id: alertId, req });
  },

  // ─── TNI (Training Needs Identification) ───────────────────────────────────

  async listTni(filters: { employee_id?: string; status?: string }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.employee_id) { conds.push("tn.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.status)      { conds.push("tn.status = ?");      params.push(filters.status); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT tn.*, e.employee_code, e.full_name,
              km.metric_name, km.metric_code,
              cs.session_type AS coaching_session_type, cs.session_date
         FROM training_need tn
         JOIN employees e ON e.id = tn.employee_id
         LEFT JOIN kpi_metric_master km ON km.id = tn.metric_id
         LEFT JOIN coaching_session cs ON cs.id = tn.coaching_session_id
        WHERE ${conds.join(" AND ")}
        ORDER BY tn.created_at DESC LIMIT 500`,
      params
    );
    return rows as RowDataPacket[];
  },

  async createTni(data: {
    employee_id: string;
    metric_id?: string;
    need_type: string;
    description?: string;
    priority?: string;
    coaching_session_id?: string;
  }, identifiedBy: string) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO training_need
         (id, employee_id, metric_id, coaching_session_id, need_type, description, priority, identified_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.employee_id,
        data.metric_id ?? null,
        data.coaching_session_id ?? null,
        data.need_type,
        data.description ?? null,
        data.priority ?? "medium",
        identifiedBy,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM training_need WHERE id = ? LIMIT 1", [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  async updateTniStatus(tniId: string, status: string) {
    await db.execute(
      "UPDATE training_need SET status = ? WHERE id = ?",
      [status, tniId]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM training_need WHERE id = ? LIMIT 1", [tniId]
    );
    return (rows as RowDataPacket[])[0];
  },

  async createTniFromCoaching(coachingId: string, overrides: {
    need_type: string;
    description?: string;
    priority?: string;
    metric_id?: string;
  }, identifiedBy: string) {
    const [sessionRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM coaching_session WHERE id = ? LIMIT 1", [coachingId]
    );
    const session = (sessionRows as RowDataPacket[])[0];
    if (!session) throw new Error("Coaching session not found");

    return this.createTni(
      {
        employee_id: session.employee_id as string,
        need_type: overrides.need_type,
        description: overrides.description,
        priority: overrides.priority,
        metric_id: overrides.metric_id,
        coaching_session_id: coachingId,
      },
      identifiedBy
    );
  },

  async getDashboardSummary(processId?: string) {
    const processClause = processId ? "AND e.process_id = ?" : "";
    const params: unknown[] = processId ? [processId] : [];
    const [
      workforceRows,
      leaveRows,
      ticketRows,
      attendanceRows,
      kpiRows,
    ] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT
           SUM(e.active_status = 1 AND e.date_of_joining <= CURDATE()) AS headcount,
           SUM(
             COALESCE(e.date_of_leaving, e.resignation_date, e.date_of_exit)
             BETWEEN DATE_SUB(CURDATE(), INTERVAL 29 DAY) AND CURDATE()
           ) AS exits_30d
         FROM employees e
         WHERE 1=1 ${processClause}`,
        params
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS pending_leaves
           FROM leave_request lr
           JOIN employees e ON e.id = lr.employee_id
          WHERE LOWER(lr.status) = 'pending' ${processClause}`,
        params
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS open_tickets
           FROM helpdesk_ticket ht
           JOIN employees e ON e.id = ht.employee_id
          WHERE ht.status IN ('open', 'in_progress') ${processClause}`,
        params
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) AS total,
           SUM(adr.attendance_status = 'present') AS present,
           SUM(adr.attendance_status = 'half_day') AS half_day
         FROM attendance_daily_record adr
         JOIN employees e ON e.id = adr.employee_id
         WHERE adr.record_date = (
           SELECT MAX(record_date) FROM attendance_daily_record WHERE record_date <= CURDATE()
         ) ${processClause}`,
        params
      ),
      this.getTeamKpiSummary({
        process_id: processId,
        period: new Date().toISOString().slice(0, 7),
      }),
    ]);

    const workforce = workforceRows[0][0] ?? {};
    const attendance = attendanceRows[0][0] ?? {};
    const headcount = numberValue(workforce.headcount);
    const exits = numberValue(workforce.exits_30d);
    const attendanceTotal = numberValue(attendance.total);
    const averageKpi = kpiRows.length
      ? kpiRows.reduce((sum, row) => sum + numberValue(row.overall_score), 0) / kpiRows.length
      : 0;

    return {
      headcount,
      attrition_rate: headcount + exits > 0
        ? Number(((exits / (headcount + exits / 2)) * 100).toFixed(2))
        : 0,
      avg_kpi_score: Number(averageKpi.toFixed(2)),
      open_tickets: numberValue(ticketRows[0][0]?.open_tickets),
      pending_leaves: numberValue(leaveRows[0][0]?.pending_leaves),
      attendance_rate: attendanceTotal > 0
        ? Number(
            ((
              (numberValue(attendance.present) + numberValue(attendance.half_day) * 0.5)
              / attendanceTotal
            ) * 100).toFixed(2)
          )
        : 0,
    };
  },

  async getSystemDashboard() {
    const [
      usersRows,
      employeeRows,
      roleRows,
      pageRows,
      integrationRows,
      moduleRows,
      activityRows,
    ] = await Promise.all([
      db.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM auth_user"),
      db.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM employees WHERE active_status = 1 AND date_of_joining <= CURDATE()"
      ),
      db.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM workforce_role_catalog WHERE active_status = 1"),
      db.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM page_catalog"),
      db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) AS configured,
           SUM(active_status = 1) AS active
         FROM integration_config`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT 'ATS' AS module_name, COUNT(*) AS record_count, MAX(updated_at) AS last_activity, 0 AS error_count
           FROM ats_candidate
         UNION ALL
         SELECT 'Payroll', COUNT(*), MAX(updated_at), SUM(status = 'failed')
           FROM salary_prep_run
         UNION ALL
         SELECT 'Leave', COUNT(*), MAX(COALESCE(applied_at, created_at)), 0
           FROM leave_request
         UNION ALL
         SELECT 'Attendance', COUNT(*), MAX(updated_at), 0
           FROM attendance_daily_record
         UNION ALL
         SELECT 'Integration Hub', COUNT(*), MAX(completed_at),
                SUM(status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR))
           FROM integration_connector_run
         UNION ALL
         SELECT 'KPI', COUNT(*), MAX(created_at), 0
           FROM kpi_daily_actual`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           sal.id,
           LOWER(sal.module_key) AS type,
           COALESCE(au.email, 'System') AS user,
           REPLACE(LOWER(sal.action_type), '_', ' ') AS action,
           sal.acted_at AS timestamp,
           'success' AS status
         FROM sensitive_action_log sal
         LEFT JOIN auth_user au ON au.id = sal.actor_user_id
         ORDER BY sal.acted_at DESC
         LIMIT 12`
      ),
    ]);

    const modules = moduleRows[0].map((row) => {
      const recordCount = numberValue(row.record_count);
      const errorCount = numberValue(row.error_count);
      return {
        module: String(row.module_name),
        status: errorCount > 0 ? "degraded" : recordCount > 0 ? "operational" : "degraded",
        lastActivity: row.last_activity ?? null,
        errorCount,
        recordCount,
      };
    });

    return {
      metrics: {
        totalUsers: numberValue(usersRows[0][0]?.total),
        activeEmployees: numberValue(employeeRows[0][0]?.total),
        totalRoles: numberValue(roleRows[0][0]?.total),
        totalPages: numberValue(pageRows[0][0]?.total),
        activeIntegrations: numberValue(integrationRows[0][0]?.active),
        configuredIntegrations: numberValue(integrationRows[0][0]?.configured),
        systemHealth: modules.some((module) => module.status === "degraded") ? "warning" : "healthy",
      },
      modules,
      activities: activityRows[0],
    };
  },

  async getWorkforceDashboard() {
    const [
      workforceResult,
      departmentResult,
      branchResult,
      employmentResult,
      joinerResult,
      leaverResult,
      pipelineResult,
      attendanceResult,
      trainingResult,
      approvalResult,
      mandateResult,
    ] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT
           SUM(active_status = 1 AND date_of_joining <= CURDATE()) AS active_headcount,
           SUM(active_status = 1 AND date_of_joining BETWEEN DATE_SUB(CURDATE(), INTERVAL 29 DAY) AND CURDATE()) AS new_joiners_30d,
           SUM(
             COALESCE(date_of_leaving, resignation_date, date_of_exit)
             BETWEEN DATE_SUB(CURDATE(), INTERVAL 29 DAY) AND CURDATE()
           ) AS exits_30d,
           SUM(active_status = 1 AND COALESCE(reporting_manager_id, manager_id) IS NULL) AS missing_manager,
           SUM(active_status = 1 AND department_id IS NULL) AS missing_department,
           SUM(active_status = 1 AND process_id IS NULL) AS missing_process,
           SUM(active_status = 1 AND (bank_account_number IS NULL OR bank_account_number = '')) AS missing_bank_details
         FROM employees`,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(d.dept_name, 'Unassigned') AS label, COUNT(*) AS value
           FROM employees e
           LEFT JOIN department_master d ON d.id = e.department_id
          WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE()
          GROUP BY d.dept_name
          ORDER BY value DESC
          LIMIT 10`,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(b.branch_name, 'Unassigned') AS label, COUNT(*) AS value
           FROM employees e
           LEFT JOIN branch_master b ON b.id = e.branch_id
          WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE()
          GROUP BY b.branch_name
          ORDER BY value DESC
          LIMIT 8`,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           COALESCE(NULLIF(employee_category, ''), NULLIF(employment_type, ''), 'Unspecified') AS label,
           COUNT(*) AS value
         FROM employees
         WHERE active_status = 1 AND date_of_joining <= CURDATE()
         GROUP BY COALESCE(NULLIF(employee_category, ''), NULLIF(employment_type, ''), 'Unspecified')
         ORDER BY value DESC`,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(date_of_joining, '%Y-%m') AS period, COUNT(*) AS value
           FROM employees
          WHERE date_of_joining BETWEEN DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01') AND CURDATE()
          GROUP BY DATE_FORMAT(date_of_joining, '%Y-%m')`,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(COALESCE(date_of_leaving, resignation_date, date_of_exit), '%Y-%m') AS period,
           COUNT(*) AS value
         FROM employees
         WHERE COALESCE(date_of_leaving, resignation_date, date_of_exit)
           BETWEEN DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01') AND CURDATE()
         GROUP BY DATE_FORMAT(COALESCE(date_of_leaving, resignation_date, date_of_exit), '%Y-%m')`,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(current_stage, ''), 'Unspecified') AS stage, COUNT(*) AS value
           FROM ats_candidate
          WHERE active_status = 1
          GROUP BY COALESCE(NULLIF(current_stage, ''), 'Unspecified')
          ORDER BY value DESC`,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           record_date,
           attendance_status AS status,
           COUNT(*) AS value
         FROM attendance_daily_record
         WHERE record_date = (
           SELECT MAX(record_date)
           FROM attendance_daily_record
           WHERE record_date <= CURDATE()
         )
         GROUP BY record_date, attendance_status`,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           (SELECT COUNT(DISTINCT candidate_id)
              FROM ats_payroll_hr_validation
             WHERE validation_status = 'approved'
               AND training_period_days > 0
               AND joining_date <= CURDATE()
               AND COALESCE(training_end_date, DATE_ADD(joining_date, INTERVAL training_period_days DAY)) >= CURDATE()
           ) AS ats_training,
           (SELECT COUNT(DISTINCT id)
              FROM ats_candidate
             WHERE active_status = 1 AND LOWER(current_stage) LIKE '%train%'
           ) AS training_stage_candidates,
           (SELECT COUNT(DISTINCT employee_id)
              FROM training_need
             WHERE status = 'in_training'
           ) AS training_needs_in_progress,
           (SELECT COUNT(DISTINCT employee_id)
              FROM lms_learning_progress_snapshot
             WHERE status = 'in_progress'
           ) AS lms_in_progress,
           (SELECT COUNT(*)
              FROM ats_onboarding_request
             WHERE status IN ('pending', 'in_progress', 'offer_submitted')
           ) AS onboarding_in_progress`,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           (SELECT COUNT(*) FROM leave_request WHERE LOWER(status) = 'pending') AS pending_leave_approvals,
           (SELECT COUNT(*) FROM performance_alert
             WHERE acknowledged = 0 AND severity IN ('high', 'critical')) AS critical_performance_alerts`,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) AS active_mandates,
           COALESCE(SUM(mandated_hc), 0) AS mandated_hc,
           COALESCE(SUM(
             CEIL(mandated_hc * (1 + (buffer_pct + shrinkage_pct + attrition_buffer_pct + training_buffer_pct) / 100))
           ), 0) AS required_hc
         FROM workforce_mandate
         WHERE active_status = 1
           AND effective_from <= CURDATE()
           AND (effective_to IS NULL OR effective_to >= CURDATE())`,
      ),
    ]);

    const workforce = workforceResult[0][0] ?? {};
    const training = trainingResult[0][0] ?? {};
    const approvals = approvalResult[0][0] ?? {};
    const mandate = mandateResult[0][0] ?? {};
    const activeHeadcount = numberValue(workforce.active_headcount);
    const exits30d = numberValue(workforce.exits_30d);
    const attritionDenominator = activeHeadcount + exits30d / 2;
    const attritionRate30d = attritionDenominator > 0
      ? Number(((exits30d / attritionDenominator) * 100).toFixed(2))
      : 0;

    const attendanceRows = attendanceResult[0];
    const attendanceByStatus = Object.fromEntries(
      attendanceRows.map((row) => [String(row.status), numberValue(row.value)]),
    );
    const attendanceTotal = Object.values(attendanceByStatus).reduce((sum, value) => sum + value, 0);
    const absentEquivalent =
      numberValue(attendanceByStatus.absent)
      + numberValue(attendanceByStatus.leave_approved)
      + numberValue(attendanceByStatus.unreconciled)
      + numberValue(attendanceByStatus.half_day) * 0.5;
    const productiveEquivalent =
      numberValue(attendanceByStatus.present)
      + numberValue(attendanceByStatus.half_day) * 0.5;
    const attendanceDate = attendanceRows[0]?.record_date
      ? new Date(attendanceRows[0].record_date as string | Date).toISOString().slice(0, 10)
      : null;
    const attendanceDataAgeDays = attendanceDate
      ? Math.max(0, Math.floor((Date.now() - new Date(`${attendanceDate}T00:00:00Z`).getTime()) / 86_400_000))
      : null;

    const months = monthKeys(6);
    const joinsByMonth = new Map(
      joinerResult[0].map((row) => [String(row.period), numberValue(row.value)]),
    );
    const exitsByMonth = new Map(
      leaverResult[0].map((row) => [String(row.period), numberValue(row.value)]),
    );
    let runningHeadcount = activeHeadcount;
    const movement = [...months].reverse().map((period) => {
      const joins = joinsByMonth.get(period) ?? 0;
      const exits = exitsByMonth.get(period) ?? 0;
      const point = { period, headcount: runningHeadcount, joins, exits };
      runningHeadcount = runningHeadcount - joins + exits;
      return point;
    }).reverse();

    const pipeline = pipelineResult[0].map((row) => ({
      stage: String(row.stage),
      value: numberValue(row.value),
    }));
    const terminalStages = new Set(["onboarded", "converted", "rejected", "declined", "withdrawn"]);
    const openPipeline = pipeline.reduce(
      (sum, item) => terminalStages.has(item.stage.toLowerCase()) ? sum : sum + item.value,
      0,
    );
    const analystsInTraining =
      numberValue(training.ats_training) + numberValue(training.training_stage_candidates);

    return {
      generated_at: new Date().toISOString(),
      summary: {
        active_headcount: activeHeadcount,
        new_joiners_30d: numberValue(workforce.new_joiners_30d),
        exits_30d: exits30d,
        attrition_rate_30d: attritionRate30d,
        open_pipeline: openPipeline,
        analysts_in_training: analystsInTraining,
        shrinkage_pct: attendanceTotal > 0
          ? Number(((absentEquivalent / attendanceTotal) * 100).toFixed(2))
          : null,
        attendance_pct: attendanceTotal > 0
          ? Number(((productiveEquivalent / attendanceTotal) * 100).toFixed(2))
          : null,
      },
      movement,
      headcount_by_department: departmentResult[0].map((row) => ({
        label: String(row.label),
        value: numberValue(row.value),
      })),
      headcount_by_branch: branchResult[0].map((row) => ({
        label: String(row.label),
        value: numberValue(row.value),
      })),
      employment_mix: employmentResult[0].map((row) => ({
        label: String(row.label),
        value: numberValue(row.value),
      })),
      pipeline,
      attendance: {
        record_date: attendanceDate,
        data_age_days: attendanceDataAgeDays,
        total: attendanceTotal,
        statuses: attendanceRows.map((row) => ({
          label: String(row.status),
          value: numberValue(row.value),
        })),
      },
      training: {
        analysts_in_training: analystsInTraining,
        ats_training: numberValue(training.ats_training),
        training_stage_candidates: numberValue(training.training_stage_candidates),
        training_needs_in_progress: numberValue(training.training_needs_in_progress),
        lms_in_progress: numberValue(training.lms_in_progress),
        onboarding_in_progress: numberValue(training.onboarding_in_progress),
      },
      actions: {
        pending_leave_approvals: numberValue(approvals.pending_leave_approvals),
        critical_performance_alerts: numberValue(approvals.critical_performance_alerts),
        missing_manager: numberValue(workforce.missing_manager),
        missing_department: numberValue(workforce.missing_department),
        missing_process: numberValue(workforce.missing_process),
        missing_bank_details: numberValue(workforce.missing_bank_details),
      },
      mandate: {
        active_mandates: numberValue(mandate.active_mandates),
        mandated_hc: numberValue(mandate.mandated_hc),
        required_hc: numberValue(mandate.required_hc),
        gap: numberValue(mandate.required_hc) - activeHeadcount,
      },
      data_readiness: {
        attendance_available: attendanceTotal > 0,
        attendance_fresh: attendanceDataAgeDays !== null && attendanceDataAgeDays <= 1,
        training_records_available:
          analystsInTraining
          + numberValue(training.training_needs_in_progress)
          + numberValue(training.lms_in_progress) > 0,
        workforce_mandates_available: numberValue(mandate.active_mandates) > 0,
      },
    };
  },
};
