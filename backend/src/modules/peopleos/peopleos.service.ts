import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { Request } from "express";
import { db } from "../../db/mysql.js";
import { calculateDataConfidence } from "../../shared/dataConfidence.js";
import {
  buildEmployeeScopeCondition,
  canViewEmployee,
  canViewPayroll,
  canViewSensitiveEmployeeData,
  resolveUserBusinessScope,
  type EnterpriseUser,
  type ScopeCondition,
} from "../../shared/enterpriseScope.js";
import { writeAuditLog, writeSensitiveActionLog } from "../../shared/auditLog.js";
import { tableExists } from "../../shared/dbHelpers.js";

type QueryFilters = {
  from?: string;
  to?: string;
  date?: string;
  branch_id?: string;
  process_id?: string;
  client_id?: string;
  manager_id?: string;
  status?: string;
  severity?: string;
  employee_id?: string;
  limit?: string | number;
};

type Actor = EnterpriseUser;

const DEFAULT_LIMIT = 100;

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function limit(value: unknown, fallback = DEFAULT_LIMIT): number {
  const parsed = Math.trunc(Number(value ?? fallback));
  return Math.min(500, Math.max(1, Number.isFinite(parsed) ? parsed : fallback));
}

function dateRange(filters: QueryFilters): { from: string; to: string } {
  const now = new Date();
  const to = filters.to ?? filters.date ?? now.toISOString().slice(0, 10);
  const fromDate = new Date(`${to}T00:00:00.000Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  return { from: filters.from ?? fromDate.toISOString().slice(0, 10), to };
}

function and(base: string[], condition: ScopeCondition): { sql: string; params: unknown[] } {
  return {
    sql: [...base, `(${condition.sql})`].join(" AND "),
    params: [...condition.params],
  };
}


async function scopedEmployeeWhere(actor: Actor, filters: QueryFilters, alias = "e") {
  const scope = await resolveUserBusinessScope(actor);
  const scopeCondition = buildEmployeeScopeCondition(scope, {
    employeeId: `${alias}.id`,
    branchId: `${alias}.branch_id`,
    processId: `${alias}.process_id`,
    departmentId: `${alias}.department_id`,
    managerEmployeeId: `${alias}.reporting_manager_id`,
  });
  const conds = [`${alias}.active_status = 1`];
  const params: unknown[] = [];
  if (filters.branch_id) {
    conds.push(`${alias}.branch_id = ?`);
    params.push(filters.branch_id);
  }
  if (filters.process_id) {
    conds.push(`${alias}.process_id = ?`);
    params.push(filters.process_id);
  }
  if (filters.manager_id) {
    conds.push(`${alias}.reporting_manager_id = ?`);
    params.push(filters.manager_id);
  }
  if (filters.employee_id) {
    conds.push(`${alias}.id = ?`);
    params.push(filters.employee_id);
  }
  const scoped = and(conds, scopeCondition);
  return { sql: scoped.sql, params: [...params, ...scoped.params], scope };
}

async function queryOne<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return ((rows[0] ?? {}) as T);
}

async function queryRows(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

export async function getCeoCommandCenter(actor: Actor, filters: QueryFilters) {
  const { from, to } = dateRange(filters);
  const scoped = await scopedEmployeeWhere(actor, filters);

  const [headcount, attendanceRisk, supportRisk, grievanceRisk, branchHealth, processHealth, payrollReadiness, hiring, managerAttrition] =
    await Promise.all([
      queryOne(
        `SELECT
           COUNT(*) AS total_headcount,
           SUM(CASE WHEN LOWER(e.employment_status) = 'active' THEN 1 ELSE 0 END) AS active_headcount,
           SUM(CASE WHEN LOWER(e.employment_type) LIKE '%bill%' THEN 1 ELSE 0 END) AS billable_headcount,
           SUM(CASE WHEN LOWER(e.employment_type) NOT LIKE '%bill%' THEN 1 ELSE 0 END) AS non_billable_headcount
         FROM employees e
         WHERE ${scoped.sql}`,
        scoped.params,
      ),
      queryOne(
        `SELECT
           COUNT(*) AS records,
           SUM(CASE WHEN adr.attendance_status IN ('absent','unreconciled') THEN 1 ELSE 0 END) AS risky_records,
           SUM(CASE WHEN adr.late_mark = 1 THEN 1 ELSE 0 END) AS late_marks,
           SUM(COALESCE(adr.lwp_value, 0)) AS lwp_days
         FROM attendance_daily_record adr
         JOIN employees e ON e.id = adr.employee_id
         WHERE adr.record_date BETWEEN ? AND ? AND ${scoped.sql}`,
        [from, to, ...scoped.params],
      ),
      queryOne(
        `SELECT
           COUNT(*) AS total_tickets,
           SUM(CASE WHEN t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS open_tickets,
           SUM(CASE WHEN t.sla_due_at IS NOT NULL AND t.sla_due_at < NOW() AND t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS breached_tickets
         FROM helpdesk_ticket t
         LEFT JOIN employees e ON e.id = t.employee_id
         WHERE (t.created_at >= ? OR t.updated_at >= ?) AND ${scoped.sql}`,
        [from, from, ...scoped.params],
      ),
      queryOne(
        `SELECT
           COUNT(*) AS total_grievances,
           SUM(CASE WHEN g.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS open_grievances,
           SUM(CASE WHEN g.severity IN ('high','critical') THEN 1 ELSE 0 END) AS high_risk_grievances
         FROM grievance g
         LEFT JOIN employees e ON e.id = g.employee_id
         WHERE g.created_at >= ? AND ${scoped.sql}`,
        [from, ...scoped.params],
      ),
      queryRows(
        `SELECT b.branch_name, COUNT(*) AS headcount,
                SUM(CASE WHEN e.employment_status = 'Active' THEN 1 ELSE 0 END) AS active_headcount
         FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
         WHERE ${scoped.sql}
         GROUP BY e.branch_id, b.branch_name
         ORDER BY active_headcount DESC
         LIMIT 25`,
        scoped.params,
      ),
      queryRows(
        `SELECT p.process_name, COUNT(*) AS headcount,
                SUM(CASE WHEN e.employment_status = 'Active' THEN 1 ELSE 0 END) AS active_headcount
         FROM employees e
         LEFT JOIN process_master p ON p.id = e.process_id
         WHERE ${scoped.sql}
         GROUP BY e.process_id, p.process_name
         ORDER BY active_headcount DESC
         LIMIT 25`,
        scoped.params,
      ),
      queryOne(
        `SELECT
           COUNT(*) AS employees_checked,
           SUM(CASE WHEN prs.readiness_status = 'ready' THEN 1 ELSE 0 END) AS ready_count,
           SUM(CASE WHEN prs.readiness_status IN ('blocked','hold') THEN 1 ELSE 0 END) AS blocked_count,
           AVG(prs.confidence_score) AS confidence_score
         FROM payroll_readiness_snapshot prs
         JOIN employees e ON e.id = prs.employee_id
         WHERE prs.period_start <= ? AND prs.period_end >= ? AND ${scoped.sql}`,
        [to, from, ...scoped.params],
      ),
      queryOne(
        `SELECT
           COUNT(*) AS pipeline_count,
           SUM(CASE WHEN current_stage IN ('offer_pending','offer_released','payroll_validated') THEN 1 ELSE 0 END) AS near_joining_count
         FROM candidates
         WHERE created_at >= ?`,
        [from],
      ).catch(() => ({ pipeline_count: 0, near_joining_count: 0 } as RowDataPacket)),
      queryRows(
        `SELECT m.full_name AS manager_name, COUNT(er.id) AS exits
         FROM exit_request er
         JOIN employees e ON e.id = er.employee_id
         LEFT JOIN employees m ON m.id = e.reporting_manager_id
         WHERE er.created_at >= ? AND ${scoped.sql}
         GROUP BY e.reporting_manager_id, m.full_name
         ORDER BY exits DESC
         LIMIT 20`,
        [from, ...scoped.params],
      ).catch((): RowDataPacket[] => []),
    ]);

  const required = ["employees", "attendance_daily_record", "helpdesk_ticket", "grievance", "payroll_readiness_snapshot"];
  const available = await Promise.all(required.map(async (table) => (await tableExists(table)) ? table : null));

  return {
    generated_at: new Date().toISOString(),
    filters: { from, to, ...filters },
    kpis: {
      active_headcount: n(headcount.active_headcount),
      billable_headcount: n(headcount.billable_headcount),
      non_billable_headcount: n(headcount.non_billable_headcount),
      attendance_risk: n(attendanceRisk.risky_records) + n(attendanceRisk.late_marks),
      support_sla_risk: n(supportRisk.breached_tickets),
      grievance_risk: n(grievanceRisk.open_grievances) + n(grievanceRisk.high_risk_grievances),
      payroll_blocked: n(payrollReadiness.blocked_count),
      hiring_pipeline: n(hiring.pipeline_count),
      attrition_cost_basis: managerAttrition.reduce((sum, row) => sum + n(row.exits), 0),
      data_confidence_score: n(payrollReadiness.confidence_score),
    },
    risks: { attendanceRisk, supportRisk, grievanceRisk, payrollReadiness },
    rankings: { branches: branchHealth, processes: processHealth, manager_attrition: managerAttrition },
    action_queue: [
      { key: "attendance", label: "Resolve attendance exceptions", count: n(attendanceRisk.risky_records) },
      { key: "support", label: "Clear breached support tickets", count: n(supportRisk.breached_tickets) },
      { key: "payroll", label: "Release payroll blockers", count: n(payrollReadiness.blocked_count) },
      { key: "grievance", label: "Review open grievances", count: n(grievanceRisk.open_grievances) },
    ].filter((item) => item.count > 0),
    data_confidence: calculateDataConfidence({
      requiredFields: required,
      availableFields: available.filter(Boolean) as string[],
      staleSources: n(attendanceRisk.records) === 0 ? ["attendance_daily_record"] : [],
      syncStatus: n(payrollReadiness.employees_checked) === 0 ? "warning" : "healthy",
      lastUpdatedAt: new Date(),
    }),
  };
}

export async function getEmployee360(actor: Actor, employeeId: string, req?: Request) {
  if (!(await canViewEmployee(actor, employeeId))) {
    const err = new Error("Employee is outside your business scope");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }

  const canSeePayroll = await canViewPayroll(actor, employeeId);
  const canSeeSensitive = await canViewSensitiveEmployeeData(actor, employeeId);

  const [employee, attendance, documents, payroll, tickets, grievances, journey, sensitiveAudit] = await Promise.all([
    queryOne(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.full_name, e.email, e.mobile, e.gender,
              e.date_of_birth, e.date_of_joining, e.employment_type, e.employment_status,
              e.branch_id, b.branch_name, e.process_id, p.process_name, e.department_id,
              e.designation_id, e.reporting_manager_id, m.full_name AS reporting_manager_name,
              e.ctc
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
       WHERE e.id = ?
       LIMIT 1`,
      [employeeId],
    ),
    queryRows(
      `SELECT record_date, attendance_status, raw_minutes, late_mark, late_by_minutes, lwp_value, is_locked
       FROM attendance_daily_record
       WHERE employee_id = ?
       ORDER BY record_date DESC
       LIMIT 45`,
      [employeeId],
    ).catch(() => []),
    queryRows(
      `SELECT id, doc_type, doc_name, verified, created_at
       FROM employee_documents
       WHERE employee_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
      [employeeId],
    ).catch(() => []),
    queryRows(
      `SELECT period_start, period_end, readiness_status, blocker_codes, blocker_summary, confidence_score, scanned_at
       FROM payroll_readiness_snapshot
       WHERE employee_id = ?
       ORDER BY scanned_at DESC
       LIMIT 6`,
      [employeeId],
    ).catch(() => []),
    queryRows(
      `SELECT id, ticket_code, category, subject, priority, status, sla_due_at, created_at
       FROM helpdesk_ticket
       WHERE employee_id = ?
       ORDER BY created_at DESC
       LIMIT 25`,
      [employeeId],
    ).catch(() => []),
    queryRows(
      `SELECT id, category, severity, status, created_at, resolved_at
       FROM grievance
       WHERE employee_id = ? AND (is_anonymous = 0 OR is_anonymous IS NULL)
       ORDER BY created_at DESC
       LIMIT 25`,
      [employeeId],
    ).catch(() => []),
    queryRows(
      `SELECT event_type, event_date, description, module, created_at
       FROM employee_journey_log
       WHERE employee_id = ?
       ORDER BY event_date DESC, created_at DESC
       LIMIT 100`,
      [employeeId],
    ).catch(() => []),
    canSeeSensitive
      ? queryRows(
          `SELECT action_type, module_key, entity_type, entity_id, acted_at
           FROM sensitive_action_log
           WHERE entity_id = ?
           ORDER BY acted_at DESC
           LIMIT 30`,
          [employeeId],
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  if (!employee.id) {
    const err = new Error("Employee not found");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  await writeSensitiveActionLog({
    actor_user_id: typeof actor === "string" ? actor : actor?.id ?? "unknown",
    action_type: "EMPLOYEE_360_VIEWED",
    module_key: "EMPLOYEE_360",
    entity_type: "employee",
    entity_id: employeeId,
    req,
  });

  const personal = canSeeSensitive
    ? employee
    : { ...employee, mobile: employee.mobile ? "masked" : null, date_of_birth: null, ctc: undefined };

  return {
    employee: canSeePayroll ? personal : { ...personal, ctc: undefined },
    attendance,
    documents,
    payroll_readiness: canSeePayroll ? payroll : [],
    support_tickets: tickets,
    grievances,
    journey,
    audit: sensitiveAudit,
    visibility: {
      payroll: canSeePayroll,
      sensitive_personal: canSeeSensitive,
    },
    data_confidence: calculateDataConfidence({
      requiredFields: ["employee", "attendance", "documents", "journey"],
      availableFields: [
        employee.id ? "employee" : "",
        attendance.length ? "attendance" : "",
        documents.length ? "documents" : "",
        journey.length ? "journey" : "",
      ].filter(Boolean),
      staleSources: attendance.length === 0 ? ["attendance"] : [],
      lastUpdatedAt: new Date(),
    }),
  };
}

export async function getAttendanceExceptionSummary(actor: Actor, filters: QueryFilters) {
  const { from, to } = dateRange(filters);
  const scoped = await scopedEmployeeWhere(actor, filters);
  return {
    range: { from, to },
    summary: await queryOne(
      `SELECT COUNT(*) AS total,
              SUM(status NOT IN ('resolved','ignored')) AS unresolved,
              SUM(severity = 'critical') AS critical,
              SUM(severity = 'high') AS high
       FROM attendance_exception ae
       JOIN employees e ON e.id = ae.employee_id
       WHERE ae.exception_date BETWEEN ? AND ? AND ${scoped.sql}`,
      [from, to, ...scoped.params],
    ),
    by_severity: await queryRows(
      `SELECT severity, COUNT(*) AS count
       FROM attendance_exception ae
       JOIN employees e ON e.id = ae.employee_id
       WHERE ae.exception_date BETWEEN ? AND ? AND ${scoped.sql}
       GROUP BY severity`,
      [from, to, ...scoped.params],
    ),
    branch_process: await queryRows(
      `SELECT b.branch_name, p.process_name, COUNT(*) AS count
       FROM attendance_exception ae
       JOIN employees e ON e.id = ae.employee_id
       LEFT JOIN branch_master b ON b.id = ae.branch_id
       LEFT JOIN process_master p ON p.id = ae.process_id
       WHERE ae.exception_date BETWEEN ? AND ? AND ${scoped.sql}
       GROUP BY ae.branch_id, ae.process_id, b.branch_name, p.process_name
       ORDER BY count DESC
       LIMIT 25`,
      [from, to, ...scoped.params],
    ),
  };
}

export async function listAttendanceExceptions(actor: Actor, filters: QueryFilters) {
  const { from, to } = dateRange(filters);
  const scoped = await scopedEmployeeWhere(actor, filters);
  const conds = [`ae.exception_date BETWEEN ? AND ?`, scoped.sql];
  const params: unknown[] = [from, to, ...scoped.params];
  if (filters.status) {
    conds.push("ae.status = ?");
    params.push(filters.status);
  }
  if (filters.severity) {
    conds.push("ae.severity = ?");
    params.push(filters.severity);
  }
  const lim = limit(filters.limit);
  return queryRows(
    `SELECT ae.*, e.employee_code, e.full_name AS employee_name, b.branch_name, p.process_name
     FROM attendance_exception ae
     JOIN employees e ON e.id = ae.employee_id
     LEFT JOIN branch_master b ON b.id = ae.branch_id
     LEFT JOIN process_master p ON p.id = ae.process_id
     WHERE ${conds.join(" AND ")}
     ORDER BY ae.exception_date DESC, FIELD(ae.severity,'critical','high','medium','low'), ae.detected_at DESC
     LIMIT ${lim}`,
    params,
  );
}

export async function scanAttendanceExceptions(actor: Actor, filters: QueryFilters, req?: Request) {
  const { from, to } = dateRange(filters);
  const scoped = await scopedEmployeeWhere(actor, filters);
  const [result] = await db.executeRun(
    `INSERT INTO attendance_exception
       (id, employee_id, exception_date, exception_type, severity, status, source_record_id, branch_id, process_id, metadata_json)
     SELECT UUID(), adr.employee_id, adr.record_date,
            CASE
              WHEN adr.attendance_status = 'unreconciled' THEN 'unreconciled_attendance'
              WHEN adr.attendance_status = 'absent' THEN 'absence'
              WHEN adr.late_mark = 1 THEN 'late_mark'
              ELSE 'attendance_risk'
            END,
            CASE
              WHEN adr.attendance_status = 'unreconciled' THEN 'high'
              WHEN adr.attendance_status = 'absent' THEN 'medium'
              WHEN adr.late_by_minutes >= 60 THEN 'medium'
              ELSE 'low'
            END,
            'open', adr.id, adr.branch_id, adr.process_id,
            JSON_OBJECT('attendance_status', adr.attendance_status, 'late_by_minutes', adr.late_by_minutes, 'lwp_value', adr.lwp_value)
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
      WHERE adr.record_date BETWEEN ? AND ?
        AND (adr.attendance_status IN ('absent','unreconciled') OR adr.late_mark = 1 OR adr.lwp_value > 0)
        AND ${scoped.sql}
     ON DUPLICATE KEY UPDATE
       severity = VALUES(severity),
       branch_id = VALUES(branch_id),
       process_id = VALUES(process_id),
       metadata_json = VALUES(metadata_json),
       updated_at = NOW()`,
    [from, to, ...scoped.params],
  );
  await writeAuditLog({
    actor_user_id: typeof actor === "string" ? actor : actor?.id ?? "unknown",
    action_type: "ATTENDANCE_EXCEPTION_SCAN",
    module_key: "ATTENDANCE_EXCEPTION",
    metadata: { from, to },
    req,
  });
  return { range: { from, to }, affected_rows: "affectedRows" in result ? result.affectedRows : 0 };
}

export async function updateAttendanceExceptionStatus(
  actor: Actor,
  id: string,
  status: "assigned" | "resolved" | "reopened",
  data: { assigned_to?: string; resolution_notes?: string },
  req?: Request,
) {
  const updates: string[] = ["status = ?", "updated_at = NOW()"];
  const params: unknown[] = [status];
  if (status === "assigned") {
    updates.push("assigned_to = ?", "assigned_at = NOW()");
    params.push(data.assigned_to ?? (typeof actor === "string" ? actor : actor?.id ?? null));
  }
  if (status === "resolved") {
    updates.push("resolution_notes = ?", "resolved_at = NOW()");
    params.push(data.resolution_notes ?? null);
  }
  if (status === "reopened") updates.push("reopened_at = NOW()");
  params.push(id);
  await db.executeRun(`UPDATE attendance_exception SET ${updates.join(", ")} WHERE id = ?`, params);
  await writeSensitiveActionLog({
    actor_user_id: typeof actor === "string" ? actor : actor?.id ?? "unknown",
    action_type: `ATTENDANCE_EXCEPTION_${status.toUpperCase()}`,
    module_key: "ATTENDANCE_EXCEPTION",
    entity_type: "attendance_exception",
    entity_id: id,
    change_summary: data,
    req,
  });
  return queryOne("SELECT * FROM attendance_exception WHERE id = ? LIMIT 1", [id]);
}

export async function getCosecMonitoring(_actor: Actor) {
  const [latestRun, runs, errors, punches] = await Promise.all([
    queryOne(
      `SELECT * FROM integration_sync_run
       WHERE integration_key = 'cosec'
       ORDER BY started_at DESC
       LIMIT 1`,
    ),
    queryRows(
      `SELECT * FROM integration_sync_run
       WHERE integration_key = 'cosec'
       ORDER BY started_at DESC
       LIMIT 50`,
    ),
    queryRows(
      `SELECT id, started_at, completed_at, status, error_summary, records_failed
       FROM integration_sync_run
       WHERE integration_key = 'cosec' AND (status = 'failed' OR records_failed > 0)
       ORDER BY started_at DESC
       LIMIT 50`,
    ),
    tableExists("biometric_punch")
      .then((exists) => exists
        ? queryRows("SELECT * FROM biometric_punch ORDER BY punch_time DESC LIMIT 100").catch(() => [])
        : [])
  ]);
  return {
    status: latestRun.status ?? "unknown",
    latest_run: latestRun,
    sync_runs: runs,
    sync_errors: errors,
    latest_punches: punches,
    data_confidence: calculateDataConfidence({
      requiredFields: ["integration_sync_run"],
      availableFields: [latestRun.id ? "integration_sync_run" : ""].filter(Boolean),
      staleSources: !latestRun.started_at ? ["cosec"] : [],
      syncStatus: latestRun.status ? String(latestRun.status) : "warning",
      lastUpdatedAt: latestRun.completed_at as string | undefined,
    }),
  };
}

export async function getPayrollReadiness(actor: Actor, filters: QueryFilters) {
  const { from, to } = dateRange(filters);
  const scoped = await scopedEmployeeWhere(actor, filters);
  return {
    summary: await queryOne(
      `SELECT COUNT(*) AS total,
              SUM(readiness_status = 'ready') AS ready,
              SUM(readiness_status IN ('blocked','hold')) AS blocked,
              AVG(confidence_score) AS confidence_score
       FROM payroll_readiness_snapshot prs
       JOIN employees e ON e.id = prs.employee_id
       WHERE prs.period_start <= ? AND prs.period_end >= ? AND ${scoped.sql}`,
      [to, from, ...scoped.params],
    ),
    blocked_employees: await queryRows(
      `SELECT prs.*, e.employee_code, e.full_name AS employee_name, b.branch_name, p.process_name
       FROM payroll_readiness_snapshot prs
       JOIN employees e ON e.id = prs.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       WHERE prs.period_start <= ? AND prs.period_end >= ?
         AND prs.readiness_status IN ('blocked','hold')
         AND ${scoped.sql}
       ORDER BY prs.scanned_at DESC
       LIMIT ${limit(filters.limit)}`,
      [to, from, ...scoped.params],
    ),
  };
}

export async function scanPayrollReadiness(actor: Actor, filters: QueryFilters, req?: Request) {
  const { from, to } = dateRange(filters);
  const scoped = await scopedEmployeeWhere(actor, filters);
  const [result] = await db.executeRun(
    `INSERT INTO payroll_readiness_snapshot
       (id, employee_id, period_start, period_end, readiness_status, blocker_codes, blocker_summary, branch_id, process_id, confidence_score)
     SELECT UUID(), e.id, ?, ?,
            CASE
              WHEN bd.employee_id IS NULL THEN 'blocked'
              WHEN SUM(CASE WHEN adr.attendance_status = 'unreconciled' THEN 1 ELSE 0 END) > 0 THEN 'blocked'
              ELSE 'ready'
            END,
            JSON_ARRAYAGG(
              CASE
                WHEN bd.employee_id IS NULL THEN 'missing_bank_details'
                WHEN adr.attendance_status = 'unreconciled' THEN 'unreconciled_attendance'
                ELSE NULL
              END
            ),
            NULL,
            e.branch_id,
            e.process_id,
            CASE
              WHEN bd.employee_id IS NULL THEN 60
              WHEN SUM(CASE WHEN adr.attendance_status = 'unreconciled' THEN 1 ELSE 0 END) > 0 THEN 70
              ELSE 95
            END
       FROM employees e
       LEFT JOIN employee_bank_detail bd ON bd.employee_id = e.id AND bd.verified = 1
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = e.id AND adr.record_date BETWEEN ? AND ?
      WHERE ${scoped.sql}
      GROUP BY e.id, bd.employee_id, e.branch_id, e.process_id
     ON DUPLICATE KEY UPDATE
       readiness_status = VALUES(readiness_status),
       blocker_codes = VALUES(blocker_codes),
       branch_id = VALUES(branch_id),
       process_id = VALUES(process_id),
       confidence_score = VALUES(confidence_score),
       scanned_at = NOW(),
       updated_at = NOW()`,
    [from, to, from, to, ...scoped.params],
  );
  await writeSensitiveActionLog({
    actor_user_id: typeof actor === "string" ? actor : actor?.id ?? "unknown",
    action_type: "PAYROLL_READINESS_SCAN",
    module_key: "PAYROLL_READINESS",
    change_summary: { from, to },
    req,
  });
  return { range: { from, to }, affected_rows: "affectedRows" in result ? result.affectedRows : 0 };
}

export async function updatePayrollHold(actor: Actor, employeeId: string, hold: boolean, reason: string | undefined, req?: Request) {
  const { from, to } = dateRange({});
  const status = hold ? "hold" : "released";
  await db.executeRun(
    `INSERT INTO payroll_readiness_snapshot
       (id, employee_id, period_start, period_end, readiness_status, blocker_summary, hold_reason, hold_by, hold_at, released_by, released_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, IF(? = 'hold', NOW(), NULL), ?, IF(? = 'released', NOW(), NULL))
     ON DUPLICATE KEY UPDATE
       readiness_status = VALUES(readiness_status),
       blocker_summary = VALUES(blocker_summary),
       hold_reason = VALUES(hold_reason),
       hold_by = VALUES(hold_by),
       hold_at = VALUES(hold_at),
       released_by = VALUES(released_by),
       released_at = VALUES(released_at),
       updated_at = NOW()`,
    [
      employeeId,
      from,
      to,
      status,
      reason ?? null,
      reason ?? null,
      hold ? (typeof actor === "string" ? actor : actor?.id ?? null) : null,
      status,
      hold ? null : (typeof actor === "string" ? actor : actor?.id ?? null),
      status,
    ],
  );
  await writeSensitiveActionLog({
    actor_user_id: typeof actor === "string" ? actor : actor?.id ?? "unknown",
    action_type: hold ? "PAYROLL_HOLD_MARKED" : "PAYROLL_HOLD_RELEASED",
    module_key: "PAYROLL_READINESS",
    entity_type: "employee",
    entity_id: employeeId,
    change_summary: { reason },
    req,
  });
  return queryRows("SELECT * FROM payroll_readiness_snapshot WHERE employee_id = ? ORDER BY scanned_at DESC LIMIT 1", [employeeId]);
}

export async function getWorkforcePlanning(actor: Actor, filters: QueryFilters) {
  const scoped = await scopedEmployeeWhere(actor, filters);
  const coverage = await queryRows(
    `SELECT b.branch_name, p.process_name, COUNT(e.id) AS active_headcount
     FROM employees e
     LEFT JOIN branch_master b ON b.id = e.branch_id
     LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${scoped.sql}
     GROUP BY e.branch_id, e.process_id, b.branch_name, p.process_name
     ORDER BY active_headcount DESC
     LIMIT 50`,
    scoped.params,
  );
  const drafts = await queryRows(
    `SELECT wrd.*, b.branch_name, p.process_name
     FROM workforce_roster_draft wrd
     LEFT JOIN branch_master b ON b.id = wrd.branch_id
     LEFT JOIN process_master p ON p.id = wrd.process_id
     ORDER BY wrd.roster_date DESC, wrd.created_at DESC
     LIMIT ${limit(filters.limit)}`,
    [],
  );
  return {
    summary: {
      coverage_rows: coverage.length,
      active_headcount: coverage.reduce((sum, row) => sum + n(row.active_headcount), 0),
      open_drafts: drafts.filter((row) => row.status === "draft" || row.status === "submitted").length,
    },
    coverage,
    shortage: drafts.filter((row) => n(row.shortage_count) > 0),
    skill_matrix: [],
    shift_gap: drafts,
    data_confidence: calculateDataConfidence({
      requiredFields: ["employees", "workforce_roster_draft"],
      availableFields: ["employees", drafts.length ? "workforce_roster_draft" : ""].filter(Boolean),
      syncStatus: "healthy",
      lastUpdatedAt: new Date(),
    }),
  };
}

export async function simulateRoster(actor: Actor, body: Record<string, unknown>, req?: Request) {
  const required = n(body.required_count);
  const planned = n(body.planned_count);
  const shortage = Math.max(0, required - planned);
  const simulation = {
    required_count: required,
    planned_count: planned,
    shortage_count: shortage,
    coverage_percent: required > 0 ? Math.round((planned / required) * 100) : 100,
    risk_level: shortage === 0 ? "low" : shortage <= 3 ? "medium" : "high",
  };
  await writeAuditLog({
    actor_user_id: typeof actor === "string" ? actor : actor?.id ?? "unknown",
    action_type: "ROSTER_SIMULATED",
    module_key: "WORKFORCE_PLANNING",
    metadata: simulation,
    req,
  });
  return simulation;
}

export async function createDraftRoster(actor: Actor, body: Record<string, unknown>, req?: Request) {
  const id = randomUUID();
  const required = n(body.required_count);
  const planned = n(body.planned_count);
  await db.executeRun(
    `INSERT INTO workforce_roster_draft
       (id, branch_id, process_id, roster_date, shift_code, required_count, planned_count, shortage_count, simulation_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      body.branch_id ?? null,
      body.process_id ?? null,
      body.roster_date ?? new Date().toISOString().slice(0, 10),
      body.shift_code ?? null,
      required,
      planned,
      Math.max(0, required - planned),
      JSON.stringify(body),
      typeof actor === "string" ? actor : actor?.id ?? null,
    ],
  );
  await writeSensitiveActionLog({
    actor_user_id: typeof actor === "string" ? actor : actor?.id ?? "unknown",
    action_type: "DRAFT_ROSTER_GENERATED",
    module_key: "WORKFORCE_PLANNING",
    entity_type: "workforce_roster_draft",
    entity_id: id,
    change_summary: body,
    req,
  });
  return queryOne("SELECT * FROM workforce_roster_draft WHERE id = ? LIMIT 1", [id]);
}

export async function approveDraftRoster(actor: Actor, id: string, approved: boolean, req?: Request) {
  await db.executeRun(
    `UPDATE workforce_roster_draft
     SET status = ?, approved_by = ?, approved_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [approved ? "approved" : "rejected", typeof actor === "string" ? actor : actor?.id ?? null, id],
  );
  await writeSensitiveActionLog({
    actor_user_id: typeof actor === "string" ? actor : actor?.id ?? "unknown",
    action_type: approved ? "DRAFT_ROSTER_APPROVED" : "DRAFT_ROSTER_REJECTED",
    module_key: "WORKFORCE_PLANNING",
    entity_type: "workforce_roster_draft",
    entity_id: id,
    req,
  });
  return queryOne("SELECT * FROM workforce_roster_draft WHERE id = ? LIMIT 1", [id]);
}

export async function getEnterpriseReports(actor: Actor, filters: QueryFilters) {
  const commandCenter = await getCeoCommandCenter(actor, filters);
  return {
    generated_at: new Date().toISOString(),
    reports: [
      { code: "CEO_SUMMARY", name: "CEO Summary", category: "management" },
      { code: "ATTENDANCE_RISK", name: "Attendance Risk", category: "attendance" },
      { code: "PAYROLL_READINESS", name: "Payroll Readiness", category: "payroll" },
      { code: "SUPPORT_SLA", name: "Support SLA", category: "support" },
      { code: "GRIEVANCE_RISK", name: "Grievance Risk", category: "people" },
    ],
    preview: commandCenter.kpis,
    data_confidence: commandCenter.data_confidence,
  };
}

export async function getAssistantContext(actor: Actor, context: string, filters: QueryFilters, req?: Request) {
  const userId = typeof actor === "string" ? actor : actor?.id ?? "unknown";
  let data: unknown;
  switch (context) {
    case "me":
      data = await resolveUserBusinessScope(actor);
      break;
    case "ceo-summary":
      data = await getCeoCommandCenter(actor, filters);
      break;
    case "payroll-blockers":
      data = await getPayrollReadiness(actor, filters);
      break;
    case "attendance-risk":
      data = await getAttendanceExceptionSummary(actor, filters);
      break;
    case "people-risk":
      data = await getCeoCommandCenter(actor, filters).then((res) => ({ grievance_risk: res.risks.grievanceRisk, action_queue: res.action_queue }));
      break;
    case "support-risk":
      data = await getCeoCommandCenter(actor, filters).then((res) => ({ support_risk: res.risks.supportRisk, action_queue: res.action_queue }));
      break;
    case "roster-risk":
      data = await getWorkforcePlanning(actor, filters);
      break;
    default:
      data = { context, supported_contexts: ["me", "ceo-summary", "payroll-blockers", "attendance-risk", "people-risk", "support-risk", "roster-risk"] };
  }
  await writeAuditLog({ actor_user_id: userId, action_type: "ASSISTANT_CONTEXT_READ", module_key: "ASSISTANT_CONTEXT", metadata: { context }, req });
  return {
    context,
    generated_at: new Date().toISOString(),
    data,
  };
}

export async function getEmployeeAssistantSummary(actor: Actor, employeeId: string, req?: Request) {
  const employee360 = await getEmployee360(actor, employeeId, req);
  return {
    employee: employee360.employee,
    attendance_recent: employee360.attendance.slice(0, 10),
    payroll_readiness: employee360.payroll_readiness.slice(0, 1),
    risks: {
      support_tickets: employee360.support_tickets.length,
      grievances: employee360.grievances.length,
    },
    data_confidence: employee360.data_confidence,
  };
}
