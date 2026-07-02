import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildEmployeeScopeCondition, type PeopleExperienceScope } from "./people-experience.scope.js";
import { tableExists, scalar } from "../../shared/dbHelpers.js";

type FilterMap = Record<string, string | undefined>;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function riskLabel(score: number): "highly_engaged" | "stable" | "watchlist" | "attrition_risk" | "critical_people_risk" {
  if (score >= 82) return "highly_engaged";
  if (score >= 65) return "stable";
  if (score >= 45) return "watchlist";
  if (score >= 30) return "attrition_risk";
  return "critical_people_risk";
}

function filterCondition(filters: FilterMap, alias = "e"): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries({
    branch_id: "branch_id",
    process_id: "process_id",
    department_id: "department_id",
    manager_id: "reporting_manager_id",
  })) {
    const value = filters[key];
    if (value && value !== "all") {
      clauses.push(`${alias}.${column} = ?`);
      params.push(value);
    }
  }
  return { sql: clauses.length ? clauses.join(" AND ") : "1 = 1", params };
}

async function scopedEmployees(scope: PeopleExperienceScope, filters: FilterMap) {
  const scoped = buildEmployeeScopeCondition(scope, "e");
  const filtered = filterCondition(filters, "e");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id,
            e.employee_code,
            e.full_name,
            e.date_of_joining,
            e.branch_id,
            e.process_id,
            e.department_id,
            e.reporting_manager_id,
            b.branch_name,
            p.process_name,
            d.department_name,
            mgr.full_name AS manager_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master d ON d.id = e.department_id
       LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
      WHERE e.active_status = 1
        AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
        AND ${scoped.sql}
        AND ${filtered.sql}
      ORDER BY e.full_name
      LIMIT 5000`,
    [...scoped.params, ...filtered.params]
  );
  return rows as Array<RowDataPacket & { id: string; branch_name?: string; process_name?: string }>;
}

async function latestHealthForEmployees(employeeIds: string[]) {
  if (employeeIds.length === 0 || !(await tableExists("people_experience_health_snapshot"))) return new Map<string, any>();
  const placeholders = employeeIds.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT px.*
       FROM people_experience_health_snapshot px
       JOIN (
         SELECT employee_id, MAX(snapshot_date) AS snapshot_date
         FROM people_experience_health_snapshot
         WHERE employee_id IN (${placeholders})
         GROUP BY employee_id
       ) latest ON latest.employee_id = px.employee_id AND latest.snapshot_date = px.snapshot_date`,
    employeeIds
  );
  return new Map(rows.map((row: any) => [String(row.employee_id), row]));
}

async function calculateEmployeeSnapshot(employee: any) {
  const employeeId = String(employee.id);
  const pulseAvg = await scalar(
    `SELECT AVG(COALESCE(mood_score, mood_rating)) AS score
       FROM pulse_check
      WHERE employee_id = ? AND submitted_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
    [employeeId],
    3
  );
  const pulses = await scalar(
    "SELECT COUNT(*) AS cnt FROM pulse_check WHERE employee_id = ? AND submitted_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)",
    [employeeId]
  );
  const kudosReceived = await scalar(
    "SELECT COUNT(*) AS cnt FROM kudos_transaction WHERE receiver_id = ? AND sent_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)",
    [employeeId]
  );
  const kudosGiven = await scalar(
    "SELECT COUNT(*) AS cnt FROM kudos_transaction WHERE sender_id = ? AND sent_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)",
    [employeeId]
  );
  const surveyResponses = await scalar(
    "SELECT COUNT(DISTINCT survey_id) AS cnt FROM survey_response WHERE employee_id = ? AND submitted_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)",
    [employeeId]
  );
  const openTickets = await scalar(
    "SELECT COUNT(*) AS cnt FROM helpdesk_ticket WHERE employee_id = ? AND status NOT IN ('resolved','closed','cancelled')",
    [employeeId]
  );
  const openGrievances = await scalar(
    "SELECT COUNT(*) AS cnt FROM grievance WHERE employee_id = ? AND status NOT IN ('resolved','closed')",
    [employeeId]
  );

  let attendanceScore = 72;
  if (await tableExists("attendance_daily_record")) {
    const days = await scalar(
      "SELECT COUNT(*) AS cnt FROM attendance_daily_record WHERE employee_id = ? AND attendance_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)",
      [employeeId]
    );
    const absent = await scalar(
      "SELECT COUNT(*) AS cnt FROM attendance_daily_record WHERE employee_id = ? AND attendance_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND LOWER(status) IN ('absent','a','lwp')",
      [employeeId]
    );
    attendanceScore = days > 0 ? clamp(100 - (absent / days) * 100) : 72;
  }

  const pulseScore = clamp((pulseAvg / 5) * 100);
  const recognitionScore = clamp(kudosReceived * 10 + kudosGiven * 5);
  const participationScore = clamp(surveyResponses * 20 + pulses * 8);
  const supportFrictionScore = clamp(100 - openTickets * 12 - openGrievances * 25);
  const performanceScore = 70;
  const careerGrowthScore = 65;
  const engagementScore = clamp(
    pulseScore * 0.2 +
    recognitionScore * 0.15 +
    participationScore * 0.12 +
    attendanceScore * 0.16 +
    performanceScore * 0.12 +
    supportFrictionScore * 0.18 +
    careerGrowthScore * 0.07
  );

  const drivers: string[] = [];
  if (pulseScore < 45) drivers.push("Low pulse mood");
  if (recognitionScore < 25) drivers.push("Low recognition activity");
  if (openTickets > 0) drivers.push(`${openTickets} unresolved support ticket(s)`);
  if (openGrievances > 0) drivers.push("Open grievance");
  if (attendanceScore < 65) drivers.push("Attendance instability");

  const recommendedActions = engagementScore < 40
    ? ["HR check-in within 48 hours", "Manager 1:1", "Resolve support blockers"]
    : engagementScore < 60
      ? ["Manager 1:1 within 7 days", "Recognition/appreciation touchpoint"]
      : ["Continue monitoring"];
  const signals = [pulses, kudosReceived + kudosGiven, surveyResponses, openTickets + openGrievances, attendanceScore !== 72 ? 1 : 0]
    .filter((v) => Number(v) > 0).length;
  const confidence = signals >= 5 ? 90 : signals >= 3 ? 65 : 35;

  return {
    employee_id: employeeId,
    engagement_score: Math.round(engagementScore),
    data_confidence_score: confidence,
    risk_label: riskLabel(engagementScore),
    component_scores: {
      pulse: Math.round(pulseScore),
      recognition: Math.round(recognitionScore),
      participation: Math.round(participationScore),
      attendance: Math.round(attendanceScore),
      performance: Math.round(performanceScore),
      support_friction: Math.round(supportFrictionScore),
      career_growth: Math.round(careerGrowthScore),
    },
    top_risk_drivers: drivers,
    recommended_actions: recommendedActions,
    support_open_count: openTickets,
    grievance_open_count: openGrievances,
    generated_at: new Date().toISOString(),
  };
}

export async function scanPeopleExperience(scope: PeopleExperienceScope, filters: FilterMap = {}, limit = 500) {
  const employees = (await scopedEmployees(scope, filters)).slice(0, Math.min(limit, 2000));
  const results = [];
  for (const employee of employees) {
    const snapshot = await calculateEmployeeSnapshot(employee);
    await db.execute(
      `INSERT INTO people_experience_health_snapshot
         (id, employee_id, snapshot_date, engagement_score, data_confidence_score, risk_label,
          pulse_score, recognition_score, participation_score, attendance_score, performance_score,
          support_friction_score, career_growth_score, top_risk_drivers_json, recommended_actions_json)
       VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         engagement_score = VALUES(engagement_score),
         data_confidence_score = VALUES(data_confidence_score),
         risk_label = VALUES(risk_label),
         pulse_score = VALUES(pulse_score),
         recognition_score = VALUES(recognition_score),
         participation_score = VALUES(participation_score),
         attendance_score = VALUES(attendance_score),
         performance_score = VALUES(performance_score),
         support_friction_score = VALUES(support_friction_score),
         career_growth_score = VALUES(career_growth_score),
         top_risk_drivers_json = VALUES(top_risk_drivers_json),
         recommended_actions_json = VALUES(recommended_actions_json),
         created_at = NOW()`,
      [
        randomUUID(),
        employee.id,
        snapshot.engagement_score,
        snapshot.data_confidence_score,
        snapshot.risk_label,
        snapshot.component_scores.pulse,
        snapshot.component_scores.recognition,
        snapshot.component_scores.participation,
        snapshot.component_scores.attendance,
        snapshot.component_scores.performance,
        snapshot.component_scores.support_friction,
        snapshot.component_scores.career_growth,
        JSON.stringify(snapshot.top_risk_drivers),
        JSON.stringify(snapshot.recommended_actions),
      ]
    );
    results.push(snapshot);
  }
  return { scanned: results.length, results };
}

export async function getPeopleExperienceCommandCenter(scope: PeopleExperienceScope, filters: FilterMap = {}) {
  const employees = await scopedEmployees(scope, filters);
  const employeeIds = employees.map((employee: any) => String(employee.id));
  const health = await latestHealthForEmployees(employeeIds);
  const fallbackNeeded = employeeIds.length > 0 && health.size === 0;
  const computed = fallbackNeeded
    ? new Map((await Promise.all(employees.slice(0, 200).map(async (employee) => [String(employee.id), await calculateEmployeeSnapshot(employee)] as const))))
    : new Map<string, any>();

  const healthFor = (id: string) => health.get(id) ?? computed.get(id) ?? {
    engagement_score: 70,
    data_confidence_score: 20,
    risk_label: "stable",
    top_risk_drivers_json: "[]",
    recommended_actions_json: "[\"Continue monitoring\"]",
    support_open_count: 0,
    grievance_open_count: 0,
  };

  const rows = employees.map((employee: any) => {
    const h = healthFor(String(employee.id));
    const drivers = h.top_risk_drivers ?? safeJson(h.top_risk_drivers_json, []);
    const actions = h.recommended_actions ?? safeJson(h.recommended_actions_json, []);
    return {
      employee_id: employee.id,
      employee_name: employee.full_name,
      employee_code: employee.employee_code,
      branch_name: employee.branch_name,
      process_name: employee.process_name,
      department_name: employee.department_name,
      manager_name: employee.manager_name,
      tenure_days: employee.date_of_joining ? daysSince(employee.date_of_joining) : null,
      engagement_score: Number(h.engagement_score ?? 70),
      data_confidence_score: Number(h.data_confidence_score ?? 20),
      risk_label: h.risk_label ?? "stable",
      risk_reason: drivers[0] ?? "No critical driver",
      top_risk_drivers: drivers,
      recommended_action: actions[0] ?? "Continue monitoring",
      support_open_count: Number(h.support_open_count ?? 0),
      grievance_flag: scope.canSeeConfidentialGrievanceIdentity ? Number(h.grievance_open_count ?? 0) > 0 : undefined,
      owner: employee.manager_name ?? "HR",
      due_date: dueDateForRisk(h.risk_label),
      action_status: "open",
    };
  });

  const total = rows.length;
  const avgScore = total ? Math.round(rows.reduce((sum, row) => sum + row.engagement_score, 0) / total) : 0;
  const watchlist = rows.filter((row) => row.risk_label === "watchlist").length;
  const attritionRisk = rows.filter((row) => ["attrition_risk", "critical_people_risk"].includes(row.risk_label)).length;
  const highlyEngaged = rows.filter((row) => row.risk_label === "highly_engaged").length;

  const scopedEmployeeFilter = employeeIds.length
    ? `employee_id IN (${employeeIds.map(() => "?").join(",")})`
    : "1 = 0";
  const supportParams = employeeIds;
  const openTickets = await scalar(`SELECT COUNT(*) FROM helpdesk_ticket WHERE ${scopedEmployeeFilter} AND status NOT IN ('resolved','closed','cancelled')`, supportParams);
  const breachedTickets = await scalar(
    `SELECT COUNT(*) FROM helpdesk_ticket
      WHERE ${scopedEmployeeFilter}
        AND status NOT IN ('resolved','closed','cancelled')
        AND (
          (priority = 'urgent' AND TIMESTAMPDIFF(HOUR, created_at, NOW()) > 2)
          OR (priority = 'high' AND TIMESTAMPDIFF(HOUR, created_at, NOW()) > 24)
          OR (priority = 'medium' AND TIMESTAMPDIFF(HOUR, created_at, NOW()) > 48)
          OR (priority = 'low' AND TIMESTAMPDIFF(HOUR, created_at, NOW()) > 72)
        )`,
    supportParams
  );
  const openGrievances = await scalar(`SELECT COUNT(*) FROM grievance WHERE ${scopedEmployeeFilter} AND status NOT IN ('resolved','closed')`, supportParams);
  const criticalGrievances = await scalar(
    `SELECT COUNT(*) FROM grievance WHERE ${scopedEmployeeFilter} AND status NOT IN ('resolved','closed') AND category IN ('harassment','safety','security','discrimination')`,
    supportParams
  );
  const kudosMonth = await scalar(
    `SELECT COUNT(*) FROM kudos_transaction WHERE receiver_id IN (${employeeIds.length ? employeeIds.map(() => "?").join(",") : "NULL"}) AND sent_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
    supportParams
  );
  const pulseResponses = await scalar(
    `SELECT COUNT(DISTINCT employee_id) FROM pulse_check WHERE employee_id IN (${employeeIds.length ? employeeIds.map(() => "?").join(",") : "NULL"}) AND submitted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    supportParams
  );
  const pulseParticipation = total ? Math.round((pulseResponses / total) * 100) : 0;
  const eNps = await calculateEnps(employeeIds);

  return {
    generated_at: new Date().toISOString(),
    scope: { kind: scope.kind, label: scope.label },
    filters,
    executive_summary: {
      employees_scanned: total,
      average_engagement_score: avgScore,
      highly_engaged_count: highlyEngaged,
      watchlist_count: watchlist,
      attrition_risk_count: attritionRisk,
      open_support_tickets: openTickets,
      sla_breached_tickets: breachedTickets,
      open_grievances: scope.canManageGrievances ? openGrievances : undefined,
      critical_grievances: scope.canManageGrievances ? criticalGrievances : undefined,
      pending_manager_actions: await countOpenActions(employeeIds),
      pulse_participation_rate: pulseParticipation,
      enps_score: eNps,
      kudos_given_this_month: kudosMonth,
      recognition_coverage_percentage: total ? Math.round((new Set(rows.filter((row) => row.recommended_action !== "Continue monitoring").map((row) => row.employee_id)).size / total) * 100) : 0,
    },
    heatmap: buildHeatmap(rows),
    watchlist: rows
      .filter((row) => ["watchlist", "attrition_risk", "critical_people_risk"].includes(row.risk_label))
      .sort((a, b) => a.engagement_score - b.engagement_score)
      .slice(0, 100),
    support_health: await supportHealth(employeeIds),
    grievance_health: scope.canManageGrievances ? await grievanceHealth(employeeIds) : { restricted: true },
    recognition_health: await recognitionHealth(employeeIds),
    pulse_health: await pulseHealth(employeeIds, total),
    action_queue: await listActions(scope, filters),
  };
}

export async function listActions(scope: PeopleExperienceScope, filters: FilterMap = {}) {
  if (!(await tableExists("people_experience_action"))) return [];
  const employees = await scopedEmployees(scope, filters);
  if (employees.length === 0) return [];
  const ids = employees.map((employee: any) => employee.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.*, e.full_name AS employee_name, e.employee_code
       FROM people_experience_action a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.employee_id IN (${ids.map(() => "?").join(",")})
      ORDER BY FIELD(a.priority, 'critical','high','medium','low'), a.due_date ASC
      LIMIT 200`,
    ids
  );
  return rows;
}

export async function createAction(scope: PeopleExperienceScope, body: any) {
  if (!body?.employee_id || !body?.action_type) {
    throw Object.assign(new Error("employee_id and action_type required"), { statusCode: 400 });
  }
  const condition = buildEmployeeScopeCondition(scope, "e");
  const [allowed] = await db.execute<RowDataPacket[]>(
    `SELECT e.id FROM employees e WHERE e.id = ? AND ${condition.sql} LIMIT 1`,
    [body.employee_id, ...condition.params]
  );
  if (allowed.length === 0) throw Object.assign(new Error("Employee outside your people-experience scope"), { statusCode: 403 });
  const id = randomUUID();
  await db.execute(
    `INSERT INTO people_experience_action
       (id, employee_id, source_type, source_id, action_type, priority, owner_user_id, due_date, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    [
      id,
      body.employee_id,
      body.source_type ?? "manual",
      body.source_id ?? null,
      body.action_type,
      body.priority ?? "medium",
      body.owner_user_id ?? scope.userId,
      body.due_date ?? dueDateForRisk(body.priority === "critical" ? "critical_people_risk" : "watchlist"),
      body.notes ?? null,
    ]
  );
  return { id };
}

export async function updateActionStatus(scope: PeopleExperienceScope, id: string, body: any) {
  const actions = await listActions(scope);
  if (!actions.some((action: any) => action.id === id)) {
    throw Object.assign(new Error("Action outside your people-experience scope"), { statusCode: 403 });
  }
  await db.execute(
    `UPDATE people_experience_action
        SET status = COALESCE(?, status),
            notes = COALESCE(?, notes),
            completed_at = CASE WHEN ? = 'completed' THEN NOW() ELSE completed_at END,
            updated_at = NOW()
      WHERE id = ?`,
    [body.status ?? null, body.notes ?? null, body.status ?? null, id]
  );
  return { id, status: body.status ?? "updated" };
}

function safeJson(value: any, fallback: any) {
  if (Array.isArray(value)) return value;
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}

function daysSince(dateValue: string | Date) {
  const ts = new Date(dateValue).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function dueDateForRisk(risk: string) {
  const days = risk === "critical_people_risk" ? 1 : risk === "attrition_risk" ? 2 : risk === "watchlist" ? 7 : 14;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildHeatmap(rows: any[]) {
  const group = (key: string, label: string) => {
    const map = new Map<string, any>();
    for (const row of rows) {
      const name = row[key] ?? "Unassigned";
      const existing = map.get(name) ?? { label: name, healthy: 0, watchlist: 0, risk: 0, total: 0, dimension: label };
      existing.total += 1;
      if (row.risk_label === "highly_engaged" || row.risk_label === "stable") existing.healthy += 1;
      else if (row.risk_label === "watchlist") existing.watchlist += 1;
      else existing.risk += 1;
      map.set(name, existing);
    }
    return [...map.values()].sort((a, b) => b.risk - a.risk || b.watchlist - a.watchlist).slice(0, 12);
  };
  return {
    branch: group("branch_name", "Branch"),
    process: group("process_name", "Process"),
    manager: group("manager_name", "Manager"),
  };
}

async function supportHealth(employeeIds: string[]) {
  if (employeeIds.length === 0) return { total_open: 0, by_category: [], by_priority: [], by_status: [] };
  const placeholders = employeeIds.map(() => "?").join(",");
  const [category] = await db.execute<RowDataPacket[]>(
    `SELECT category AS label, COUNT(*) AS value FROM helpdesk_ticket WHERE employee_id IN (${placeholders}) GROUP BY category`,
    employeeIds
  );
  const [priority] = await db.execute<RowDataPacket[]>(
    `SELECT priority AS label, COUNT(*) AS value FROM helpdesk_ticket WHERE employee_id IN (${placeholders}) GROUP BY priority`,
    employeeIds
  );
  const [status] = await db.execute<RowDataPacket[]>(
    `SELECT status AS label, COUNT(*) AS value FROM helpdesk_ticket WHERE employee_id IN (${placeholders}) GROUP BY status`,
    employeeIds
  );
  return {
    total_open: await scalar(`SELECT COUNT(*) FROM helpdesk_ticket WHERE employee_id IN (${placeholders}) AND status NOT IN ('resolved','closed','cancelled')`, employeeIds),
    sla_breached: await scalar(`SELECT COUNT(*) FROM helpdesk_ticket WHERE employee_id IN (${placeholders}) AND status NOT IN ('resolved','closed','cancelled') AND TIMESTAMPDIFF(HOUR, created_at, NOW()) > 48`, employeeIds),
    by_category: category,
    by_priority: priority,
    by_status: status,
  };
}

async function grievanceHealth(employeeIds: string[]) {
  if (employeeIds.length === 0) return { open: 0, anonymous: 0, critical: 0, by_category: [] };
  const placeholders = employeeIds.map(() => "?").join(",");
  const [category] = await db.execute<RowDataPacket[]>(
    `SELECT category AS label, COUNT(*) AS value FROM grievance WHERE employee_id IN (${placeholders}) GROUP BY category`,
    employeeIds
  );
  return {
    open: await scalar(`SELECT COUNT(*) FROM grievance WHERE employee_id IN (${placeholders}) AND status NOT IN ('resolved','closed')`, employeeIds),
    anonymous: await scalar(`SELECT COUNT(*) FROM grievance WHERE employee_id IN (${placeholders}) AND is_anonymous = 1`, employeeIds),
    critical: await scalar(`SELECT COUNT(*) FROM grievance WHERE employee_id IN (${placeholders}) AND category IN ('harassment','safety','security','discrimination')`, employeeIds),
    by_category: category,
  };
}

async function recognitionHealth(employeeIds: string[]) {
  if (employeeIds.length === 0) return { kudos_given: 0, kudos_received: 0, zero_recognition_90d: 0 };
  const placeholders = employeeIds.map(() => "?").join(",");
  return {
    kudos_given: await scalar(`SELECT COUNT(*) FROM kudos_transaction WHERE sender_id IN (${placeholders}) AND sent_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`, employeeIds),
    kudos_received: await scalar(`SELECT COUNT(*) FROM kudos_transaction WHERE receiver_id IN (${placeholders}) AND sent_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`, employeeIds),
    zero_recognition_90d: await scalar(
      `SELECT COUNT(*) FROM employees e
        WHERE e.id IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1 FROM kudos_transaction kt
             WHERE kt.receiver_id = e.id AND kt.sent_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          )`,
      employeeIds
    ),
  };
}

async function pulseHealth(employeeIds: string[], total: number) {
  if (employeeIds.length === 0) return { response_rate: 0, average_mood_score: 0, enps_score: 0 };
  const placeholders = employeeIds.map(() => "?").join(",");
  const responses = await scalar(`SELECT COUNT(DISTINCT employee_id) FROM pulse_check WHERE employee_id IN (${placeholders}) AND submitted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`, employeeIds);
  return {
    response_rate: total ? Math.round((responses / total) * 100) : 0,
    average_mood_score: await scalar(`SELECT AVG(COALESCE(mood_score, mood_rating)) FROM pulse_check WHERE employee_id IN (${placeholders}) AND submitted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`, employeeIds),
    enps_score: await calculateEnps(employeeIds),
  };
}

async function calculateEnps(employeeIds: string[]) {
  if (employeeIds.length === 0) return 0;
  const placeholders = employeeIds.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN response_value >= 9 THEN 1 ELSE 0 END) AS promoters,
       SUM(CASE WHEN response_value <= 6 THEN 1 ELSE 0 END) AS detractors,
       COUNT(*) AS total
     FROM survey_response
     WHERE employee_id IN (${placeholders})
       AND submitted_at >= DATE_SUB(NOW(), INTERVAL 180 DAY)
       AND response_value IS NOT NULL`,
    employeeIds
  );
  const row: any = rows[0] ?? {};
  const total = Number(row.total ?? 0);
  if (!total) return 0;
  return Math.round(((Number(row.promoters ?? 0) / total) - (Number(row.detractors ?? 0) / total)) * 100);
}

async function countOpenActions(employeeIds: string[]) {
  if (employeeIds.length === 0 || !(await tableExists("people_experience_action"))) return 0;
  return scalar(
    `SELECT COUNT(*) FROM people_experience_action WHERE employee_id IN (${employeeIds.map(() => "?").join(",")}) AND status IN ('open','in_progress','overdue')`,
    employeeIds
  );
}
