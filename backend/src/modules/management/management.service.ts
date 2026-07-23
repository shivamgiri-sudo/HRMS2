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
  /**
   * Resolve a list of employee IDs that are direct reports of the given manager employee ID.
   * Falls back to an empty array if no reports found (not an error).
   */
  async getDirectReportIds(managerEmployeeId: string): Promise<string[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees
        WHERE (reporting_manager_id = ? OR manager_id = ?)
          AND active_status = 1
        LIMIT 500`,
      [managerEmployeeId, managerEmployeeId]
    );
    return (rows as RowDataPacket[]).map((r) => String(r.id));
  },

  async getTeamKpiSummary(filters: {
    process_id?: string;
    period?: string;
    branch_id?: string;
    /** When provided, restricts results to employees in this list */
    employee_ids?: string[];
  }) {
    const conds: string[] = ["e.active_status = 1"];
    const params: unknown[] = [];
    if (filters.process_id) { conds.push("e.process_id = ?"); params.push(filters.process_id); }
    if (filters.branch_id)  { conds.push("e.branch_id = ?");  params.push(filters.branch_id); }
    if (filters.employee_ids && filters.employee_ids.length > 0) {
      const placeholders = filters.employee_ids.map(() => "?").join(",");
      conds.push(`e.id IN (${placeholders})`);
      params.push(...filters.employee_ids);
    }
    const period = filters.period ?? new Date().toISOString().slice(0, 7);
    conds.push("DATE_FORMAT(kda.score_date, '%Y-%m') = ?"); params.push(period);

    // Previous period for trend calculation
    const prevDate = new Date(period + "-01");
    prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
    const prevPeriod = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;

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

    // Build trend by comparing current period score to previous period score
    const empIds = (rows as RowDataPacket[]).map((r) => String(r.employee_id));
    const prevScoreMap: Record<string, number> = {};

    if (empIds.length > 0) {
      const prevConds: string[] = ["e.active_status = 1", "DATE_FORMAT(kda.score_date, '%Y-%m') = ?"];
      const prevParams: unknown[] = [prevPeriod];
      const prevPlaceholders = empIds.map(() => "?").join(",");
      prevConds.push(`e.id IN (${prevPlaceholders})`);
      prevParams.push(...empIds);

      const [prevRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           e.id AS employee_id,
           ROUND(
             SUM((
               CASE WHEN kmm.direction = 'lower_is_better'
                    THEN LEAST(kpc.target_value / NULLIF(kda.actual_value, 0), 1.2)
                    ELSE LEAST(kda.actual_value / NULLIF(kpc.target_value, 0), 1.2)
               END * 100
             ) * kpc.weightage) / NULLIF(SUM(kpc.weightage), 0),
             2
           ) AS overall_score
           FROM kpi_daily_actual kda
           JOIN employees e ON e.id = kda.employee_id
           JOIN kpi_process_config kpc ON kpc.process_id = e.process_id AND kpc.metric_id = kda.metric_id
           JOIN kpi_metric_master kmm ON kmm.id = kda.metric_id
          WHERE ${prevConds.join(" AND ")}
          GROUP BY e.id`,
        prevParams
      );

      for (const prev of prevRows as RowDataPacket[]) {
        prevScoreMap[String(prev.employee_id)] = numberValue(prev.overall_score);
      }
    }

    return (rows as RowDataPacket[]).map((row) => {
      const empId = String(row.employee_id);
      const curr = numberValue(row.overall_score);
      let trend: "up" | "down" | "stable" = "stable";
      if (empId in prevScoreMap) {
        const prev = prevScoreMap[empId];
        if (curr > prev + 1) trend = "up";
        else if (curr < prev - 1) trend = "down";
      }
      return { ...row, trend };
    });
  },

  async listCoachingSessions(filters: {
    employee_id?: string;
    coach_user_id?: string;
    status?: string;
    /** When provided, restricts to sessions for employees in this list */
    employee_ids?: string[];
  }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.employee_id)   { conds.push("cs.employee_id = ?");   params.push(filters.employee_id); }
    if (filters.coach_user_id) { conds.push("cs.coach_user_id = ?"); params.push(filters.coach_user_id); }
    if (filters.status)        { conds.push("cs.status = ?");        params.push(filters.status); }
    if (filters.employee_ids && filters.employee_ids.length > 0) {
      const placeholders = filters.employee_ids.map(() => "?").join(",");
      conds.push(`cs.employee_id IN (${placeholders})`);
      params.push(...filters.employee_ids);
    }
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

  async listAlerts(filters: {
    employee_id?: string;
    severity?: string;
    acknowledged?: boolean;
    /** When provided, restricts to alerts for employees in this list */
    employee_ids?: string[];
  }) {
    const conds: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.employee_id)                { conds.push("pa.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.severity)                   { conds.push("pa.severity = ?");    params.push(filters.severity); }
    if (filters.acknowledged !== undefined) { conds.push("pa.acknowledged = ?"); params.push(filters.acknowledged ? 1 : 0); }
    if (filters.employee_ids && filters.employee_ids.length > 0) {
      const placeholders = filters.employee_ids.map(() => "?").join(",");
      conds.push(`pa.employee_id IN (${placeholders})`);
      params.push(...filters.employee_ids);
    }
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

  async getDashboardSummary(processId?: string, employeeIds?: string[]) {
    // Build scope conditions
    const hasEmpScope = employeeIds && employeeIds.length > 0;
    const processClause = processId ? "AND e.process_id = ?" : "";
    const processParams: unknown[] = processId ? [processId] : [];

    // When we have an explicit employee list, use IN clause; otherwise fall back to process filter
    const buildEmpConds = (alias: string) => {
      if (hasEmpScope) {
        const placeholders = employeeIds!.map(() => "?").join(",");
        return { clause: `AND ${alias}.id IN (${placeholders})`, params: [...employeeIds!] };
      }
      return { clause: processClause, params: [...processParams] };
    };

    const empConds = buildEmpConds("e");

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
         WHERE 1=1 ${empConds.clause}`,
        empConds.params
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS pending_leaves
           FROM leave_request lr
           JOIN employees e ON e.id = lr.employee_id
          WHERE LOWER(lr.status) = 'pending' ${empConds.clause}`,
        empConds.params
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS open_tickets
           FROM helpdesk_ticket ht
           JOIN employees e ON e.id = ht.employee_id
          WHERE ht.status IN ('open', 'in_progress') ${empConds.clause}`,
        empConds.params
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) AS total,
           SUM(adr.attendance_status NOT IN ('on_leave','leave','leave_approved','week_off','holiday')) AS expected_to_work,
           SUM(adr.attendance_status = 'present') AS present,
           SUM(adr.attendance_status = 'half_day') AS half_day
         FROM attendance_daily_record adr
         JOIN employees e ON e.id = adr.employee_id
         WHERE adr.record_date = (
           SELECT MAX(record_date) FROM attendance_daily_record WHERE record_date <= CURDATE()
         ) ${empConds.clause}`,
        empConds.params
      ),
      this.getTeamKpiSummary({
        process_id: hasEmpScope ? undefined : processId,
        period: new Date().toISOString().slice(0, 7),
        employee_ids: employeeIds,
      }),
    ]);

    const workforce = workforceRows[0][0] ?? {};
    const attendance = attendanceRows[0][0] ?? {};
    const headcount = numberValue(workforce.headcount);
    const exits = numberValue(workforce.exits_30d);
    const expectedToWork = numberValue(attendance.expected_to_work);
    const averageKpi = kpiRows.length
      ? (kpiRows as any[]).reduce((sum, row) => sum + numberValue(row.overall_score), 0) / kpiRows.length
      : 0;

    return {
      headcount,
      attrition_rate: headcount + exits > 0
        ? Number(((exits / (headcount + exits / 2)) * 100).toFixed(2))
        : 0,
      avg_kpi_score: Number(averageKpi.toFixed(2)),
      open_tickets: numberValue(ticketRows[0][0]?.open_tickets),
      pending_leaves: numberValue(leaveRows[0][0]?.pending_leaves),
      attendance_rate: expectedToWork > 0
        ? Number(
            ((
              (numberValue(attendance.present) + numberValue(attendance.half_day) * 0.5)
              / expectedToWork
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
      twoFaRows,
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
        `SELECT COUNT(*) AS count FROM auth_user WHERE two_fa_enabled = 0 OR two_fa_enabled IS NULL`
      ).catch(() => [[{ count: 0 }]] as any),
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

    // Calculate system uptime
    const uptimeSeconds = Math.floor(process.uptime());
    const uptimeDays = Math.floor(uptimeSeconds / 86400);
    const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
    const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
    const uptimeFormatted = uptimeDays > 0
      ? `${uptimeDays}d ${uptimeHours}h`
      : uptimeHours > 0
        ? `${uptimeHours}h ${uptimeMinutes}m`
        : `${uptimeMinutes}m`;

    return {
      metrics: {
        totalUsers: numberValue(usersRows[0][0]?.total),
        activeEmployees: numberValue(employeeRows[0][0]?.total),
        totalRoles: numberValue(roleRows[0][0]?.total),
        totalPages: numberValue(pageRows[0][0]?.total),
        activeIntegrations: numberValue(integrationRows[0][0]?.active),
        configuredIntegrations: numberValue(integrationRows[0][0]?.configured),
        systemHealth: modules.some((module) => module.status === "degraded") ? "warning" : "healthy",
        uptime: uptimeFormatted,
        usersWithout2fa: numberValue((twoFaRows as any)[0]?.[0]?.count ?? 0),
      },
      modules,
      activities: activityRows[0],
      generatedAt: new Date().toISOString(),
    };
  },

  async getWorkforceDashboard(branchId?: string, processId?: string, scopeLevel?: string) {
    // Build scope WHERE fragment for employee table
    const scopeConds: string[] = [];
    const scopeParams: unknown[] = [];
    if (branchId) { scopeConds.push("branch_id = ?"); scopeParams.push(branchId); }
    if (processId) { scopeConds.push("process_id = ?"); scopeParams.push(processId); }
    const empScopeWhere = scopeConds.length ? " AND " + scopeConds.join(" AND ") : "";
    const empScopeJoinWhere = scopeConds.length
      ? " AND " + scopeConds.map(c => "e." + c).join(" AND ")
      : "";

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
         FROM employees WHERE 1=1${empScopeWhere}`,
        scopeParams,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(d.dept_name, 'Unassigned') AS label, COUNT(*) AS value
           FROM employees e
           LEFT JOIN department_master d ON d.id = e.department_id
          WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE()${empScopeJoinWhere}
          GROUP BY d.dept_name
          ORDER BY value DESC
          LIMIT 10`,
        scopeParams,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(b.branch_name, 'Unassigned') AS label, COUNT(*) AS value
           FROM employees e
           LEFT JOIN branch_master b ON b.id = e.branch_id
          WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE()${empScopeJoinWhere}
          GROUP BY b.branch_name
          ORDER BY value DESC
          LIMIT 8`,
        scopeParams,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           COALESCE(NULLIF(employee_category, ''), NULLIF(employment_type, ''), 'Unspecified') AS label,
           COUNT(*) AS value
         FROM employees
         WHERE active_status = 1 AND date_of_joining <= CURDATE()${empScopeWhere}
         GROUP BY COALESCE(NULLIF(employee_category, ''), NULLIF(employment_type, ''), 'Unspecified')
         ORDER BY value DESC`,
        scopeParams,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(date_of_joining, '%Y-%m') AS period, COUNT(*) AS value
           FROM employees
          WHERE date_of_joining BETWEEN DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01') AND CURDATE()${empScopeWhere}
          GROUP BY DATE_FORMAT(date_of_joining, '%Y-%m')`,
        scopeParams,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(COALESCE(date_of_leaving, resignation_date, date_of_exit), '%Y-%m') AS period,
           COUNT(*) AS value
         FROM employees
         WHERE COALESCE(date_of_leaving, resignation_date, date_of_exit)
           BETWEEN DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01') AND CURDATE()${empScopeWhere}
         GROUP BY DATE_FORMAT(COALESCE(date_of_leaving, resignation_date, date_of_exit), '%Y-%m')`,
        scopeParams,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(current_stage, ''), 'Unspecified') AS stage, COUNT(*) AS value
           FROM ats_candidate
          WHERE active_status = 1
            AND LOWER(COALESCE(current_stage,'')) NOT IN (
              'joined','converted','onboarded','rejected','declined','withdrawn','absconded'
            )
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
    // Expected to work = total - leave/week_off/holiday (employees who should have been present)
    const nonWorkingStatuses = ['leave_approved', 'on_leave', 'leave', 'week_off', 'holiday'];
    const nonWorkingCount = nonWorkingStatuses.reduce(
      (sum, status) => sum + numberValue(attendanceByStatus[status]),
      0,
    );
    const expectedToWork = attendanceTotal - nonWorkingCount;
    const absentEquivalent =
      numberValue(attendanceByStatus.absent)
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

    // Add missing fields for dashboard
    const [onLeaveResult] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT employee_id) as count
       FROM leave_request
       WHERE status = 'approved'
         AND CURDATE() BETWEEN start_date AND end_date`
    );
    const onLeaveCount = numberValue(onLeaveResult[0]?.count);

    const [branchCountResult] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM branch_master WHERE active_status = 1`
    );
    const totalBranches = numberValue(branchCountResult[0]?.count);

    const [leaveSummaryResult] = await db.execute<RowDataPacket[]>(
      `SELECT status, COUNT(*) as count
       FROM leave_request
       WHERE start_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       GROUP BY status`
    );

    const [recentJoinersResult] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code, full_name as employee_name, designation_id, date_of_joining as joining_date
       FROM employees
       WHERE employment_status = 'active'
         AND date_of_joining >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       ORDER BY date_of_joining DESC
       LIMIT 10`
    );

    const [branchSnapshotResult] = await db.execute<RowDataPacket[]>(
      `SELECT
         b.id,
         b.branch_name as name,
         COUNT(DISTINCT e.id) as employee_count,
         ROUND(
           COUNT(DISTINCT s.employee_id) * 100.0 / NULLIF(COUNT(DISTINCT e.id), 0),
           2
         ) as present_pct,
         COUNT(DISTINCT s.employee_id) as present_count
       FROM branch_master b
       LEFT JOIN employees e ON e.branch_id = b.id AND e.employment_status = 'active'
       LEFT JOIN wfm_attendance_session s ON s.employee_id = e.id
         AND DATE(s.session_date) = CURDATE()
         AND s.current_status IN ('Logged In','Active','Login','Rostered')
       WHERE b.active_status = 1
       GROUP BY b.id, b.branch_name
       HAVING employee_count > 0
       ORDER BY employee_count DESC
       LIMIT 15`
    );

    // Calculate leave balance usage percentage
    const [leaveUsageResult] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(DISTINCT lr.employee_id) * 100.0 / NULLIF(COUNT(DISTINCT e.id), 0) as usage_pct
       FROM employees e
       LEFT JOIN leave_request lr ON lr.employee_id = e.id
         AND lr.status = 'approved'
         AND YEAR(lr.start_date) = YEAR(CURDATE())
       WHERE e.employment_status = 'active'`
    );
    const leaveBalanceUsagePct = leaveUsageResult[0]?.usage_pct
      ? Number(Number(leaveUsageResult[0].usage_pct).toFixed(2))
      : null;

    // Manager-specific: expense claims, work items
    const [expenseResult] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM expense_claim WHERE status = 'pending'`
    ).catch(() => [[{ count: 0 }]] as any);

    const [overtaskResult] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as overdue FROM work_item WHERE status NOT IN ('completed','cancelled') AND due_at < NOW()`
    ).catch(() => [[{ overdue: 0 }]] as any);

    // Pending timesheets (work_item type = timesheet)
    const [timesheetResult] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM work_item WHERE item_type = 'timesheet' AND status = 'pending'`
    ).catch(() => [[{ count: 0 }]] as any);

    // Expired employee documents
    const [expiredDocsResult] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM employee_document
       WHERE expiry_date IS NOT NULL AND expiry_date < CURDATE() AND active_status = 1`
    ).catch(() => [[{ count: 0 }]] as any);

    // Pending policy acknowledgements
    const [pendingPolicyResult] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM policy_acknowledgement
       WHERE acknowledged = 0`
    ).catch(() => [[{ count: 0 }]] as any);

    // Appraisal completion percentage
    const [appraisalResult] = await db.execute<RowDataPacket[]>(
      `SELECT
         ROUND(
           SUM(pa.status IN ('completed','approved')) * 100.0
           / NULLIF(COUNT(*), 0)
         , 2) AS completion_pct
       FROM performance_appraisal pa
       WHERE YEAR(pa.appraisal_year) = YEAR(CURDATE())`
    ).catch(() => [[{ completion_pct: null }]] as any);

    // Process breakdown for Operations dashboard
    const [processBreakdownResult] = await db.execute<RowDataPacket[]>(
      `SELECT
         pm.id,
         pm.process_name,
         COUNT(DISTINCT e.id) AS headcount,
         SUM(adr.attendance_status = 'present') AS present_count,
         SUM(adr.attendance_status NOT IN ('on_leave','leave','leave_approved','week_off','holiday')) AS expected_to_work,
         ROUND(
           SUM(adr.attendance_status = 'present') * 100.0 /
           NULLIF(SUM(adr.attendance_status NOT IN ('on_leave','leave','leave_approved','week_off','holiday')), 0),
         2) AS attendance_pct
       FROM process_master pm
       LEFT JOIN employees e ON e.process_id = pm.id AND e.employment_status = 'active'
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = e.id
         AND adr.record_date = (SELECT MAX(r) FROM (SELECT MAX(record_date) AS r FROM attendance_daily_record WHERE record_date <= CURDATE()) sub)
       WHERE pm.active_status = 1
       GROUP BY pm.id, pm.process_name
       HAVING headcount > 0
       ORDER BY headcount DESC
       LIMIT 15`
    ).catch(() => [[]] as any);

    // Team members snapshot for Manager dashboard roster panel
    const [teamMembersResult] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id, e.employee_code, e.full_name as employee_name,
         e.designation_id, e.employment_status,
         b.branch_name,
         COALESCE(dm.designation_name, e.designation_id) as designation_name,
         COALESCE(
           (SELECT adr.attendance_status FROM attendance_daily_record adr
            WHERE adr.employee_id = e.id AND adr.record_date = CURDATE() LIMIT 1),
           'not_marked'
         ) as today_status
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
       WHERE e.employment_status = 'active'
       ORDER BY e.full_name ASC
       LIMIT 20`
    ).catch(() => [[]] as any);

    return {
      generated_at: new Date().toISOString(),
      scope: {
        level: scopeLevel ?? "ORG_ALL",
        branch_id: branchId ?? null,
        process_id: processId ?? null,
      },
      summary: {
        active_headcount: activeHeadcount,
        new_joiners_30d: numberValue(workforce.new_joiners_30d),
        exits_30d: exits30d,
        attrition_rate_30d: attritionRate30d,
        open_pipeline: openPipeline,
        analysts_in_training: analystsInTraining,
        shrinkage_pct: expectedToWork > 0
          ? Number(((absentEquivalent / expectedToWork) * 100).toFixed(2))
          : null,
        attendance_pct: expectedToWork > 0
          ? Number(((productiveEquivalent / expectedToWork) * 100).toFixed(2))
          : null,
        expected_to_work: expectedToWork,
      },
      on_leave: onLeaveCount,
      total_branches: totalBranches,
      pending_leave_requests: numberValue(approvals.pending_leave_approvals),
      pending_expense_claims: numberValue(expenseResult[0]?.count),
      projects_at_risk: 0,
      overdue_tasks: numberValue(overtaskResult[0]?.overdue),
      team_members: teamMembersResult.map((row: RowDataPacket) => ({
        id: String(row.id),
        employee_code: String(row.employee_code),
        employee_name: String(row.employee_name),
        branch_name: row.branch_name ? String(row.branch_name) : null,
        today_status: String(row.today_status),
        status: String(row.today_status),
        attendance_status: String(row.today_status),
        designation_name: row.designation_name ? String(row.designation_name) : null,
      })),
      pending_timesheets: numberValue((timesheetResult as any)[0]?.[0]?.count ?? 0),
      expired_documents: numberValue((expiredDocsResult as any)[0]?.[0]?.count ?? 0),
      pending_policy_acknowledgements: numberValue((pendingPolicyResult as any)[0]?.[0]?.count ?? 0),
      appraisal_completion_pct: (appraisalResult as any)[0]?.[0]?.completion_pct !== null
        ? Number(Number((appraisalResult as any)[0]?.[0]?.completion_pct ?? 0).toFixed(2))
        : null,
      process_breakdown: (processBreakdownResult as any[]).map((row: any) => ({
        id: String(row.id),
        process_name: String(row.process_name),
        headcount: numberValue(row.headcount),
        present_count: numberValue(row.present_count),
        attendance_pct: row.attendance_pct !== null ? Number(row.attendance_pct) : null,
      })),
      leave_balance_usage_pct: leaveBalanceUsagePct,
      leave_summary: leaveSummaryResult.map((row) => ({
        status: String(row.status),
        count: numberValue(row.count),
      })),
      recent_joiners: recentJoinersResult.map((row) => ({
        id: String(row.id),
        employee_code: String(row.employee_code),
        employee_name: String(row.employee_name),
        designation_id: row.designation_id ? String(row.designation_id) : null,
        joining_date: row.joining_date,
      })),
      branches: branchSnapshotResult.map((row) => ({
        id: String(row.id),
        branch_name: String(row.name),
        employee_count: numberValue(row.employee_count),
        present_count: numberValue(row.present_count),
        present_pct: row.present_pct !== null ? Number(row.present_pct) : null,
      })),
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
        // LMS live data (async, non-blocking)
        certified_learners: await (async () => {
          try {
            const { lmsDb } = await import("../../db/lms-mysql.js");
            const [rows] = await lmsDb.execute<import("mysql2").RowDataPacket[]>(
              `SELECT SUM(certification_status IN ('certified','Certified')) AS cnt FROM trainee_master WHERE status != 'archived'`
            );
            return Number(rows[0]?.cnt ?? 0);
          } catch { return null; }
        })(),
        lms_total_trainees: await (async () => {
          try {
            const { lmsDb } = await import("../../db/lms-mysql.js");
            const [rows] = await lmsDb.execute<import("mysql2").RowDataPacket[]>(
              `SELECT COUNT(*) AS cnt FROM trainee_master WHERE status != 'archived'`
            );
            return Number(rows[0]?.cnt ?? 0);
          } catch { return null; }
        })(),
        lms_high_risk: await (async () => {
          try {
            const { lmsDb } = await import("../../db/lms-mysql.js");
            const [rows] = await lmsDb.execute<import("mysql2").RowDataPacket[]>(
              `SELECT COUNT(*) AS cnt FROM training_risk_log WHERE status = 'Open' AND severity IN ('HIGH','CRITICAL')`
            );
            return Number(rows[0]?.cnt ?? 0);
          } catch { return null; }
        })(),
        lms_avg_completion: await (async () => {
          try {
            const { lmsDb } = await import("../../db/lms-mysql.js");
            const [rows] = await lmsDb.execute<import("mysql2").RowDataPacket[]>(
              `SELECT ROUND(AVG(course_completion_pct),1) AS avg_pct FROM trainee_master WHERE status != 'archived'`
            );
            return Number(rows[0]?.avg_pct ?? 0);
          } catch { return null; }
        })(),
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

  async getCeoMetrics() {
    const [
      payrollResult,
      mandateGapResult,
      shrinkageResult,
      billingResult,
      attritionCostResult,
      hiringGapResult,
      ffLiabilityResult,
    ] = await Promise.all([
      // 1. Payroll liability — current month run (matches Payroll page total)
      // Fixed: select only the LATEST run for the current month to avoid summing across multiple runs
      db.execute<RowDataPacket[]>(
        `SELECT
           COALESCE(SUM(spl.gross_salary), 0)  AS total_gross,
           COALESCE(SUM(spl.net_salary), 0)    AS total_net,
           COALESCE(SUM(spl.pf_employer), 0)   AS total_pf_employer,
           COALESCE(SUM(spl.esic_employer), 0) AS total_esic_employer,
           COUNT(DISTINCT spl.employee_id)     AS employee_count,
           spr.run_month
         FROM salary_prep_line spl
         JOIN (
           SELECT id, run_month
           FROM salary_prep_run
           WHERE run_month = DATE_FORMAT(CURDATE(), '%Y-%m')
             AND status IN ('draft','processing','completed','locked','disbursed')
           ORDER BY
             CASE status
               WHEN 'disbursed' THEN 1
               WHEN 'locked' THEN 2
               WHEN 'completed' THEN 3
               WHEN 'processing' THEN 4
               WHEN 'draft' THEN 5
               ELSE 6
             END,
             created_at DESC
           LIMIT 1
         ) spr ON spr.id = spl.run_id
         GROUP BY spr.run_month`
      ),
      // 2. HC gap by process: mandated vs active
      db.execute<RowDataPacket[]>(
        `SELECT
           p.process_name,
           wm.mandated_hc,
           CEIL(wm.mandated_hc * (1 + (wm.buffer_pct + wm.shrinkage_pct + wm.attrition_buffer_pct + wm.training_buffer_pct) / 100)) AS required_hc,
           COALESCE(ec.active_hc, 0) AS active_hc,
           CEIL(wm.mandated_hc * (1 + (wm.buffer_pct + wm.shrinkage_pct + wm.attrition_buffer_pct + wm.training_buffer_pct) / 100))
             - COALESCE(ec.active_hc, 0) AS hc_gap
         FROM workforce_mandate wm
         JOIN process_master p ON p.id = wm.process_id
         LEFT JOIN (
           SELECT process_id, COUNT(*) AS active_hc
           FROM employees WHERE active_status = 1
           GROUP BY process_id
         ) ec ON ec.process_id = wm.process_id
         WHERE wm.active_status = 1
           AND wm.effective_from <= CURDATE()
           AND (wm.effective_to IS NULL OR wm.effective_to >= CURDATE())
         ORDER BY hc_gap DESC
         LIMIT 10`
      ),
      // 3. Shrinkage cost from latest snapshot
      db.execute<RowDataPacket[]>(
        `SELECT
           sds.process_id,
           COALESCE(p.process_name, 'Unknown') AS process_name,
           sds.rostered_hc,
           sds.absent_hc,
           sds.total_shrinkage_pct,
           sds.snapshot_date,
           ROUND(
             COALESCE(sds.absent_hc, 0) * COALESCE(
               (SELECT AVG(esa.ctc_annual / 365 / 8)
                FROM employee_salary_assignment esa
                JOIN employees e ON e.id = esa.employee_id
                WHERE e.process_id = sds.process_id
                  AND esa.effective_from <= CURDATE()
                  AND (esa.effective_to IS NULL OR esa.effective_to >= CURDATE())
               ), 0
             ), 2
           ) AS estimated_daily_revenue_at_risk
         FROM shrinkage_daily_snapshot sds
         LEFT JOIN process_master p ON p.id = sds.process_id
         WHERE sds.snapshot_date = (
           SELECT MAX(snapshot_date) FROM shrinkage_daily_snapshot WHERE snapshot_date <= CURDATE()
         )
         ORDER BY sds.total_shrinkage_pct DESC
         LIMIT 8`
      ),
      // 4. Last billing cycle
      db.execute<RowDataPacket[]>(
        `SELECT
           COALESCE(SUM(bi.net_amount), 0)   AS total_billed,
           COALESCE(SUM(bi.gross_amount), 0) AS total_gross_billed,
           COUNT(DISTINCT bi.process_id)     AS process_count,
           DATE_FORMAT(bi.period_from, '%Y-%m') AS billing_month
         FROM billing_invoice bi
         WHERE bi.status IN ('approved', 'paid')
           AND bi.period_from >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
         GROUP BY DATE_FORMAT(bi.period_from, '%Y-%m')
         ORDER BY billing_month DESC
         LIMIT 1`
      ),
      // 5. Attrition cost (exits last 30d × avg CTC × 0.5 replacement multiplier)
      // Industry standard: replacement cost ≈ 50% of annual CTC (recruitment + training + productivity loss)
      db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) AS exits_30d,
           ROUND(
             COUNT(*) * COALESCE(
               (SELECT AVG(esa.ctc_annual)
                FROM employee_salary_assignment esa
                WHERE esa.effective_from <= CURDATE()
                  AND (esa.effective_to IS NULL OR esa.effective_to >= CURDATE())
               ), 0
             ) * 0.5, 0
           ) AS replacement_cost_estimate
         FROM employees
         WHERE active_status = 0
           AND COALESCE(date_of_leaving, resignation_date, date_of_exit)
             BETWEEN DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND CURDATE()`
      ),
      // 6. Open hiring pipeline
      db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) AS open_candidates,
           SUM(CASE WHEN current_stage IN ('offer_sent','offer_accepted') THEN 1 ELSE 0 END) AS offers_pending_joining,
           SUM(CASE WHEN current_stage IN ('screened','interview_scheduled','interview_done') THEN 1 ELSE 0 END) AS in_pipeline
         FROM ats_candidate
         WHERE active_status = 1
           AND current_stage NOT IN ('joined','rejected','declined','withdrawn','absconded')`
      ),
      // 7. F&F pending liability
      db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) AS pending_ff_count,
           COALESCE(SUM(ffc.net_payable), 0) AS pending_ff_liability
         FROM full_final_calculation ffc
         JOIN exit_request er ON er.id = ffc.exit_request_id
         WHERE er.status NOT IN ('completed','cancelled')
           AND ffc.is_ff_provisional = 1`
      ),
    ]);

    const payroll = payrollResult[0][0] ?? {};
    const mandateGaps = mandateGapResult[0] as RowDataPacket[];
    const shrinkageByProcess = shrinkageResult[0] as RowDataPacket[];
    const billing = billingResult[0][0] ?? {};
    const attrition = attritionCostResult[0][0] ?? {};
    const hiring = hiringGapResult[0][0] ?? {};
    const ff = ffLiabilityResult[0][0] ?? {};

    const totalHcGap = mandateGaps.reduce((s, r) => s + Math.max(0, numberValue(r.hc_gap)), 0);
    const totalRevenueAtRisk = shrinkageByProcess.reduce(
      (s, r) => s + numberValue(r.estimated_daily_revenue_at_risk), 0
    );
    const processesUnderstaffed = mandateGaps.filter(r => numberValue(r.hc_gap) > 0).length;

    return {
      payroll_liability: {
        run_month: payroll.run_month ?? null,
        total_gross: numberValue(payroll.total_gross),
        total_net: numberValue(payroll.total_net),
        employer_statutory: numberValue(payroll.total_pf_employer) + numberValue(payroll.total_esic_employer),
        employee_count: numberValue(payroll.employee_count),
      },
      hc_gap: {
        total_gap: totalHcGap,
        processes_understaffed: processesUnderstaffed,
        by_process: mandateGaps.map(r => ({
          process_name: String(r.process_name),
          mandated_hc: numberValue(r.mandated_hc),
          required_hc: numberValue(r.required_hc),
          active_hc: numberValue(r.active_hc),
          gap: Math.max(0, numberValue(r.hc_gap)),
        })),
      },
      revenue_at_risk: {
        total_daily_estimate: totalRevenueAtRisk,
        by_process: shrinkageByProcess.map(r => ({
          process_name: String(r.process_name),
          shrinkage_pct: numberValue(r.total_shrinkage_pct),
          absent_hc: numberValue(r.absent_hc),
          daily_revenue_at_risk: numberValue(r.estimated_daily_revenue_at_risk),
          snapshot_date: r.snapshot_date ?? null,
        })),
      },
      billing: {
        last_month_billed: numberValue(billing.total_billed),
        billing_month: billing.billing_month ?? null,
        process_count: numberValue(billing.process_count),
      },
      attrition_cost: {
        exits_30d: numberValue(attrition.exits_30d),
        replacement_cost_estimate: numberValue(attrition.replacement_cost_estimate),
      },
      hiring_pipeline: {
        open_candidates: numberValue(hiring.open_candidates),
        offers_pending_joining: numberValue(hiring.offers_pending_joining),
        in_pipeline: numberValue(hiring.in_pipeline),
      },
      ff_liability: {
        pending_count: numberValue(ff.pending_ff_count),
        pending_amount: numberValue(ff.pending_ff_liability),
      },
    };
  },

  async getAttritionBreakdown(): Promise<{ reason: string; count: number; pct: number }[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(er.exit_reason_category, 'Not specified') AS reason,
         COUNT(*) AS count,
         ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct
       FROM exit_request er
       WHERE er.exit_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         AND er.status IN ('completed', 'accepted', 'approved')
       GROUP BY er.exit_reason_category
       ORDER BY count DESC
       LIMIT 6`
    ).catch(() => [[]] as any);
    return (rows as any[]).map((r) => ({
      reason: String(r.reason),
      count: Number(r.count),
      pct: Number(r.pct),
    }));
  },
};
