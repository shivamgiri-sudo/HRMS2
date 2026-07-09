import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

type AnyRow = Record<string, any>;

const CORE_TABLES = [
  "employees",
  "process_master",
  "branch_master",
  "wfm_shift",
  "wfm_roster_plan",
  "wfm_roster_assignment",
  "roster_template",
  "week_off_preference",
  "process_weekoff_capacity",
  "weekoff_allocation_log",
  "leave_request",
];

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dateRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function toTime(value: any): string | null {
  if (!value) return null;
  const s = String(value);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function safePct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((num / den) * 10000) / 100;
}

function plannedWithShrinkage(required: number, shrinkagePct: number): number {
  const denominator = Math.max(0.01, 1 - (shrinkagePct / 100));
  return Math.ceil(required / denominator);
}

class SchemaMap {
  private cache = new Map<string, Set<string>>();
  async columns(table: string): Promise<Set<string>> {
    if (this.cache.has(table)) return this.cache.get(table)!;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    const set = new Set((rows as AnyRow[]).map((r) => String(r.COLUMN_NAME)));
    this.cache.set(table, set);
    return set;
  }

  async hasTable(table: string): Promise<boolean> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
      [table]
    );
    return rows.length > 0;
  }

  async hasColumn(table: string, column: string): Promise<boolean> {
    return (await this.columns(table)).has(column);
  }

  async pick(table: string, candidates: string[], fallback?: string): Promise<string | null> {
    const cols = await this.columns(table);
    for (const c of candidates) if (cols.has(c)) return c;
    return fallback ?? null;
  }
}

const schema = new SchemaMap();

export interface SlotRequirementInput {
  process_id?: string | null;
  branch_id?: string | null;
  requirement_date?: string | null;
  day_of_week?: number | null;
  slot_start: string;
  slot_end: string;
  required_hc: number;
  shrinkage_pct?: number | null;
}

export interface CreateAutoRosterPlanInput {
  plan_name: string;
  process_id?: string | null;
  branch_id?: string | null;
  from_date: string;
  to_date: string;
  required_headcount?: number;
  shrinkage_pct?: number;
}

async function getPlan(planId: string): Promise<AnyRow> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_roster_plan WHERE id = ? LIMIT 1`,
    [planId]
  );
  const plan = rows[0] as AnyRow | undefined;
  if (!plan) throw Object.assign(new Error("Roster plan not found"), { statusCode: 404 });
  return plan;
}

async function getPlanControl(planId: string): Promise<AnyRow> {
  await db.execute(
    `INSERT IGNORE INTO wfm_roster_plan_control (plan_id, planning_mode, approval_status)
     VALUES (?, 'auto', 'draft')`,
    [planId]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_roster_plan_control WHERE plan_id = ? LIMIT 1`,
    [planId]
  );
  return rows[0] as AnyRow;
}

async function getProcessName(processId?: string | null): Promise<string | null> {
  if (!processId || !(await schema.hasTable("process_master"))) return null;
  const cols = await schema.columns("process_master");
  const nameCol = cols.has("process_name") ? "process_name" : cols.has("name") ? "name" : null;
  if (!nameCol) return null;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${nameCol} AS name FROM process_master WHERE id = ? LIMIT 1`, [processId]);
  return (rows[0] as AnyRow | undefined)?.name ?? null;
}

async function getBranchName(branchId?: string | null): Promise<string | null> {
  if (!branchId || !(await schema.hasTable("branch_master"))) return null;
  const cols = await schema.columns("branch_master");
  const nameCol = cols.has("branch_name") ? "branch_name" : cols.has("name") ? "name" : null;
  if (!nameCol) return null;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${nameCol} AS name FROM branch_master WHERE id = ? LIMIT 1`, [branchId]);
  return (rows[0] as AnyRow | undefined)?.name ?? null;
}

async function logEvent(input: {
  plan_id?: string | null;
  assignment_id?: string | null;
  event_type: string;
  event_title: string;
  event_message: string;
  severity?: "info" | "medium" | "high" | "critical";
  target_role?: string | null;
  target_employee_id?: string | null;
  process_id?: string | null;
  branch_id?: string | null;
}) {
  await db.execute(
    `INSERT INTO wfm_roster_event_log
     (id, plan_id, assignment_id, event_type, event_title, event_message, severity, target_role, target_employee_id, process_id, branch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.plan_id ?? null,
      input.assignment_id ?? null,
      input.event_type,
      input.event_title,
      input.event_message,
      input.severity ?? "info",
      input.target_role ?? null,
      input.target_employee_id ?? null,
      input.process_id ?? null,
      input.branch_id ?? null,
    ]
  );
}

async function queueLockedNotification(input: {
  plan_id?: string | null;
  assignment_id?: string | null;
  change_request_id?: string | null;
  employee_id?: string | null;
  recipient_email?: string | null;
  notification_type: string;
  subject: string;
  body_preview: string;
}) {
  await db.execute(
    `INSERT INTO wfm_roster_notification_log
     (id, plan_id, assignment_id, change_request_id, employee_id, recipient_email, notification_type, subject, body_preview, status, locked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)`,
    [
      randomUUID(),
      input.plan_id ?? null,
      input.assignment_id ?? null,
      input.change_request_id ?? null,
      input.employee_id ?? null,
      input.recipient_email ?? null,
      input.notification_type,
      input.subject,
      input.body_preview.slice(0, 1000),
    ]
  );
}

async function insertConflict(input: {
  plan_id: string;
  assignment_id?: string | null;
  employee_id?: string | null;
  roster_date?: string | null;
  conflict_type: string;
  severity?: "info" | "medium" | "high" | "critical";
  message: string;
}) {
  await db.execute(
    `INSERT INTO wfm_roster_conflict_log
     (id, plan_id, assignment_id, employee_id, roster_date, conflict_type, severity, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.plan_id,
      input.assignment_id ?? null,
      input.employee_id ?? null,
      input.roster_date ?? null,
      input.conflict_type,
      input.severity ?? "medium",
      input.message,
    ]
  );
}

async function getEmployeePool(plan: AnyRow, rosterDate: string): Promise<AnyRow[]> {
  const cols = await schema.columns("employees");
  const select: string[] = ["id"];
  if (cols.has("employee_code")) select.push("employee_code");
  if (cols.has("email")) select.push("email");
  if (cols.has("process_id")) select.push("process_id");
  if (cols.has("branch_id")) select.push("branch_id");
  if (cols.has("manager_employee_id")) select.push("manager_employee_id");
  if (cols.has("reporting_manager_id")) select.push("reporting_manager_id");
  if (cols.has("designation")) select.push("designation");
  if (cols.has("designation_name")) select.push("designation_name");
  if (cols.has("department")) select.push("department");
  if (cols.has("department_id")) select.push("department_id");

  if (cols.has("full_name")) {
    select.push("full_name");
  } else if (cols.has("first_name")) {
    select.push(`TRIM(CONCAT(COALESCE(first_name,''),' ',COALESCE(last_name,''))) AS full_name`);
  } else {
    select.push("employee_code AS full_name");
  }

  const conds: string[] = [];
  const params: unknown[] = [];

  if (cols.has("active_status")) conds.push("active_status = 1");
  if (cols.has("process_id") && plan.process_id) { conds.push("process_id = ?"); params.push(plan.process_id); }
  if (cols.has("branch_id") && plan.branch_id) { conds.push("branch_id = ?"); params.push(plan.branch_id); }

  if (cols.has("employment_status")) conds.push("(employment_status IS NULL OR LOWER(employment_status) IN ('active','probation','confirmed'))");
  else if (cols.has("employee_status")) conds.push("(employee_status IS NULL OR LOWER(employee_status) IN ('active','probation','confirmed'))");
  else if (cols.has("status")) conds.push("(status IS NULL OR LOWER(status) IN ('active','probation','confirmed'))");

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${select.join(", ")} FROM employees ${where} ORDER BY employee_code ASC`, params);
  const employees = rows as AnyRow[];

  if (!(await schema.hasTable("leave_request"))) return employees;
  const leaveCols = await schema.columns("leave_request");
  if (!leaveCols.has("employee_id") || !leaveCols.has("from_date") || !leaveCols.has("to_date")) return employees;

  const statusCol = leaveCols.has("status") ? "status" : null;
  const leaveSql = `SELECT employee_id FROM leave_request WHERE from_date <= ? AND to_date >= ?${statusCol ? " AND LOWER(status) IN ('approved','accepted')" : ""}`;
  const [leaveRows] = await db.execute<RowDataPacket[]>(leaveSql, [rosterDate, rosterDate]);
  const leaveSet = new Set((leaveRows as AnyRow[]).map((r) => String(r.employee_id)));
  return employees.filter((e) => !leaveSet.has(String(e.id)));
}

async function getWeekOffPreferences(processId: string | null | undefined): Promise<Map<string, number>> {
  if (!(await schema.hasTable("week_off_preference"))) return new Map();
  const cols = await schema.columns("week_off_preference");
  if (!cols.has("employee_id") || !cols.has("preferred_day")) return new Map();

  let sql = `SELECT wp.employee_id, wp.preferred_day FROM week_off_preference wp`;
  const params: unknown[] = [];
  const conds: string[] = [];
  if (cols.has("approved")) conds.push("wp.approved = 1");

  const empCols = await schema.columns("employees");
  if (processId && empCols.has("process_id")) {
    sql += ` JOIN employees e ON e.id = wp.employee_id`;
    conds.push("e.process_id = ?");
    params.push(processId);
  }

  if (conds.length) sql += ` WHERE ${conds.join(" AND ")}`;
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  const map = new Map<string, number>();
  for (const r of rows as AnyRow[]) map.set(String(r.employee_id), Number(r.preferred_day));
  return map;
}

async function getShiftForSlot(slotStart: string, slotEnd: string): Promise<AnyRow | null> {
  if (!(await schema.hasTable("wfm_shift"))) return null;
  const cols = await schema.columns("wfm_shift");
  const startCol = cols.has("start_time") ? "start_time" : null;
  const endCol = cols.has("end_time") ? "end_time" : null;
  if (!startCol || !endCol) return null;

  const select = ["id"];
  if (cols.has("shift_code")) select.push("shift_code");
  if (cols.has("shift_name")) select.push("shift_name");
  select.push(`${startCol} AS start_time`, `${endCol} AS end_time`);

  const [exact] = await db.execute<RowDataPacket[]>(
    `SELECT ${select.join(", ")} FROM wfm_shift WHERE ${startCol} = ? AND ${endCol} = ? LIMIT 1`,
    [`${slotStart}:00`.slice(0, 8), `${slotEnd}:00`.slice(0, 8)]
  );
  if (exact[0]) return exact[0] as AnyRow;

  const [fallback] = await db.execute<RowDataPacket[]>(
    `SELECT ${select.join(", ")} FROM wfm_shift ORDER BY active_status DESC, start_time ASC LIMIT 1`
  );
  return (fallback[0] as AnyRow | undefined) ?? null;
}

async function getRequirementsForPlan(plan: AnyRow, rosterDate?: string): Promise<AnyRow[]> {
  const params: unknown[] = [plan.process_id ?? "", plan.branch_id ?? ""];
  let sql = `SELECT * FROM wfm_client_slot_requirement WHERE active_status = 1
             AND (process_id = ? OR process_id IS NULL)
             AND (branch_id = ? OR branch_id IS NULL)`;

  if (rosterDate) {
    const dow = new Date(`${rosterDate}T00:00:00`).getDay();
    sql += ` AND (requirement_date = ? OR (requirement_date IS NULL AND day_of_week = ?))`;
    params.push(rosterDate, dow);
  }

  sql += ` ORDER BY COALESCE(requirement_date, '9999-12-31'), day_of_week, slot_start`;
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows as AnyRow[];
}

async function recomputeCoverage(planId: string): Promise<{ rows: AnyRow[]; score: number; openCriticalGaps: number }> {
  const plan = await getPlan(planId);
  await db.execute(`DELETE FROM wfm_roster_coverage_matrix WHERE plan_id = ?`, [planId]);
  await db.execute(`DELETE FROM wfm_roster_conflict_log WHERE plan_id = ? AND conflict_type IN ('slot_shortage','no_requirement','low_coverage')`, [planId]);

  const dates = dateRange(String(plan.from_date).slice(0, 10), String(plan.to_date).slice(0, 10));
  const coverageRows: AnyRow[] = [];
  let requiredTotal = 0;
  let plannedTotal = 0;
  let openCriticalGaps = 0;

  const control = await getPlanControl(planId);
  const shrinkagePct = Number(control.shrinkage_pct ?? 15);

  for (const rosterDate of dates) {
    const reqs = await getRequirementsForPlan(plan, rosterDate);
    if (reqs.length === 0) {
      await insertConflict({
        plan_id: planId,
        roster_date: rosterDate,
        conflict_type: "no_requirement",
        severity: "high",
        message: `No client slot requirement configured for ${rosterDate}.`,
      });
      continue;
    }

    for (const req of reqs) {
      const effectiveShrink = Number(req.shrinkage_pct ?? shrinkagePct);
      const plannedTarget = plannedWithShrinkage(Number(req.required_hc ?? 0), effectiveShrink);
      const slotStart = toTime(req.slot_start)!;
      const slotEnd = toTime(req.slot_end)!;
      const [countRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS c
         FROM wfm_roster_assignment
         WHERE plan_id = ?
           AND roster_date = ?
           AND publish_status IN ('draft','published')
           AND roster_status NOT IN ('Week Off','Leave','Absent')
           AND (
             (shift_start_time IS NULL AND shift_end_time IS NULL)
             OR (shift_start_time <= ? AND shift_end_time >= ?)
             OR (shift_start_time = ? AND shift_end_time = ?)
           )`,
        [planId, rosterDate, `${slotStart}:00`.slice(0, 8), `${slotEnd}:00`.slice(0, 8), `${slotStart}:00`.slice(0, 8), `${slotEnd}:00`.slice(0, 8)]
      );
      const planned = Number((countRows[0] as AnyRow)?.c ?? 0);
      const gap = Math.max(0, plannedTarget - planned);
      const coveragePct = safePct(planned, plannedTarget);
      const bufferHc = Math.max(0, plannedTarget - Number(req.required_hc ?? 0));
      requiredTotal += plannedTarget;
      plannedTotal += planned;
      if (gap > 0) openCriticalGaps++;

      const row = {
        id: randomUUID(),
        plan_id: planId,
        roster_date: rosterDate,
        slot_start: `${slotStart}:00`.slice(0, 8),
        slot_end: `${slotEnd}:00`.slice(0, 8),
        required_hc: Number(req.required_hc ?? 0),
        planned_hc: planned,
        buffer_hc: bufferHc,
        gap_hc: gap,
        coverage_pct: coveragePct,
        shrinkage_pct: effectiveShrink,
      };
      coverageRows.push(row);
      await db.execute(
        `INSERT INTO wfm_roster_coverage_matrix
         (id, plan_id, roster_date, slot_start, slot_end, required_hc, planned_hc, buffer_hc, gap_hc, coverage_pct, shrinkage_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.plan_id, row.roster_date, row.slot_start, row.slot_end, row.required_hc, row.planned_hc, row.buffer_hc, row.gap_hc, row.coverage_pct, row.shrinkage_pct]
      );

      if (gap > 0) {
        await insertConflict({
          plan_id: planId,
          roster_date: rosterDate,
          conflict_type: "slot_shortage",
          severity: gap >= 3 ? "critical" : "high",
          message: `${rosterDate} ${slotStart}-${slotEnd}: planned ${planned}, target ${plannedTarget}, gap ${gap}.`,
        });
      }
    }
  }

  const score = Math.min(100, safePct(Math.min(plannedTotal, requiredTotal), requiredTotal));
  await db.execute(`UPDATE wfm_roster_plan_control SET last_coverage_score = ?, updated_at = NOW() WHERE plan_id = ?`, [score, planId]);
  return { rows: coverageRows, score, openCriticalGaps };
}

export const autoRosterSyncedService = {
  async introspect() {
    const tables: Array<{ table: string; exists: boolean; mode: string; columns: string[] }> = [];
    for (const table of CORE_TABLES) {
      const exists = await schema.hasTable(table);
      tables.push({
        table,
        exists,
        mode: exists ? "reuse_existing" : "missing",
        columns: exists ? Array.from(await schema.columns(table)) : [],
      });
    }
    const newTables = [
      "wfm_client_slot_requirement",
      "wfm_roster_plan_control",
      "wfm_roster_assignment_control",
      "wfm_roster_coverage_matrix",
      "wfm_roster_conflict_log",
      "wfm_roster_change_request",
      "wfm_roster_event_log",
      "wfm_roster_approval_log",
      "wfm_roster_notification_log",
      "wfm_roster_manager_task",
      "wfm_roster_acknowledgement",
    ];
    for (const table of newTables) {
      const exists = await schema.hasTable(table);
      tables.push({
        table,
        exists,
        mode: exists ? "available" : "run_migration_052",
        columns: exists ? Array.from(await schema.columns(table)) : [],
      });
    }
    return { tables };
  },

  async masters() {
    const [processes] = await db.execute<RowDataPacket[]>(
      await schema.hasTable("process_master")
        ? `SELECT id, ${((await schema.columns("process_master")).has("process_name") ? "process_name" : "id")} AS process_name FROM process_master ORDER BY process_name`
        : `SELECT NULL AS id, 'No process_master table found' AS process_name`
    );
    const [branches] = await db.execute<RowDataPacket[]>(
      await schema.hasTable("branch_master")
        ? `SELECT id, ${((await schema.columns("branch_master")).has("branch_name") ? "branch_name" : "id")} AS branch_name FROM branch_master ORDER BY branch_name`
        : `SELECT NULL AS id, 'No branch_master table found' AS branch_name`
    );
    const [shifts] = await db.execute<RowDataPacket[]>(
      await schema.hasTable("wfm_shift")
        ? `SELECT * FROM wfm_shift ORDER BY active_status DESC, start_time ASC`
        : `SELECT NULL AS id, 'No wfm_shift table found' AS shift_name`
    );
    return { processes, branches, shifts };
  },

  async upsertRequirement(input: SlotRequirementInput, actorId: string) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO wfm_client_slot_requirement
       (id, process_id, branch_id, requirement_date, day_of_week, slot_start, slot_end, required_hc, shrinkage_pct, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.process_id ?? null,
        input.branch_id ?? null,
        input.requirement_date ?? null,
        input.day_of_week ?? null,
        `${input.slot_start}:00`.slice(0, 8),
        `${input.slot_end}:00`.slice(0, 8),
        input.required_hc,
        input.shrinkage_pct ?? null,
        actorId,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM wfm_client_slot_requirement WHERE id = ?`, [id]);
    return rows[0] as AnyRow;
  },

  async listRequirements(filters: { process_id?: string; branch_id?: string }) {
    const conds = ["active_status = 1"];
    const params: unknown[] = [];
    if (filters.process_id) { conds.push("(process_id = ? OR process_id IS NULL)"); params.push(filters.process_id); }
    if (filters.branch_id) { conds.push("(branch_id = ? OR branch_id IS NULL)"); params.push(filters.branch_id); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_client_slot_requirement WHERE ${conds.join(" AND ")} ORDER BY requirement_date, day_of_week, slot_start`,
      params
    );
    return rows as AnyRow[];
  },

  async createPlan(input: CreateAutoRosterPlanInput, actorId: string) {
    const id = randomUUID();
    const processName = await getProcessName(input.process_id);
    const branchName = await getBranchName(input.branch_id);
    await db.execute(
      `INSERT INTO wfm_roster_plan
       (id, plan_name, process_id, branch_id, shift_id, from_date, to_date, required_headcount, created_by)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        id,
        input.plan_name,
        input.process_id ?? null,
        input.branch_id ?? null,
        input.from_date,
        input.to_date,
        input.required_headcount ?? 0,
        actorId,
      ]
    );
    await db.execute(
      `INSERT INTO wfm_roster_plan_control
       (plan_id, planning_mode, shrinkage_pct, approval_status)
       VALUES (?, 'auto', ?, 'draft')`,
      [id, input.shrinkage_pct ?? 15]
    );
    await logEvent({
      plan_id: id,
      event_type: "plan_created",
      event_title: "Auto roster cycle created",
      event_message: `${input.plan_name} created for ${processName ?? "selected process"} / ${branchName ?? "selected branch"}.`,
      target_role: "wfm",
      process_id: input.process_id ?? null,
      branch_id: input.branch_id ?? null,
    });
    return { ...(await getPlan(id)), control: await getPlanControl(id) };
  },

  async listPlans(filters: { process_id?: string; branch_id?: string; from_date?: string; to_date?: string }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.process_id) { conds.push("p.process_id = ?"); params.push(filters.process_id); }
    if (filters.branch_id) { conds.push("p.branch_id = ?"); params.push(filters.branch_id); }
    if (filters.from_date) { conds.push("p.to_date >= ?"); params.push(filters.from_date); }
    if (filters.to_date) { conds.push("p.from_date <= ?"); params.push(filters.to_date); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT p.*, c.approval_status, c.shrinkage_pct, c.publish_lock_status, c.last_coverage_score, c.notification_status
       FROM wfm_roster_plan p
       LEFT JOIN wfm_roster_plan_control c ON c.plan_id = p.id
       ${where}
       ORDER BY p.from_date DESC, p.created_at DESC
       LIMIT 100`,
      params
    );
    return rows as AnyRow[];
  },

  async generateDraft(planId: string, actorId: string) {
    const plan = await getPlan(planId);
    const control = await getPlanControl(planId);
    if (["published", "locked"].includes(String(control.approval_status))) {
      throw Object.assign(new Error("Published/locked roster cannot be regenerated."), { statusCode: 409 });
    }

    await db.execute(`DELETE FROM wfm_roster_assignment WHERE plan_id = ? AND publish_status <> 'published'`, [planId]);
    await db.execute(`DELETE FROM wfm_roster_assignment_control WHERE plan_id = ?`, [planId]);
    await db.execute(`DELETE FROM wfm_roster_conflict_log WHERE plan_id = ?`, [planId]);

    const processName = await getProcessName(plan.process_id);
    const branchName = await getBranchName(plan.branch_id);
    const dates = dateRange(String(plan.from_date).slice(0, 10), String(plan.to_date).slice(0, 10));
    const prefs = await getWeekOffPreferences(plan.process_id);
    const shrinkagePct = Number(control.shrinkage_pct ?? 15);
    let created = 0;
    let skipped = 0;

    for (const rosterDate of dates) {
      const dow = new Date(`${rosterDate}T00:00:00`).getDay();
      const reqs = await getRequirementsForPlan(plan, rosterDate);
      const pool = await getEmployeePool(plan, rosterDate);
      const assignedToday = new Set<string>();

      if (reqs.length === 0) {
        await insertConflict({
          plan_id: planId,
          roster_date: rosterDate,
          conflict_type: "no_requirement",
          severity: "high",
          message: `No client slot requirement configured for ${rosterDate} (${dayNames[dow]}).`,
        });
        continue;
      }

      for (const req of reqs) {
        const effectiveShrink = Number(req.shrinkage_pct ?? shrinkagePct);
        const target = plannedWithShrinkage(Number(req.required_hc ?? 0), effectiveShrink);
        const slotStart = toTime(req.slot_start)!;
        const slotEnd = toTime(req.slot_end)!;
        const shift = await getShiftForSlot(slotStart, slotEnd);

        const candidates = pool
          .filter((e) => !assignedToday.has(String(e.id)))
          .sort((a, b) => {
            const prefA = prefs.get(String(a.id)) === dow ? 1 : 0;
            const prefB = prefs.get(String(b.id)) === dow ? 1 : 0;
            return prefA - prefB || String(a.employee_code ?? a.id).localeCompare(String(b.employee_code ?? b.id));
          });

        const selected = candidates.slice(0, target);
        if (selected.length < target) {
          await insertConflict({
            plan_id: planId,
            roster_date: rosterDate,
            conflict_type: "slot_shortage",
            severity: "critical",
            message: `${rosterDate} ${slotStart}-${slotEnd}: eligible pool shortage. Required with shrinkage ${target}, available ${selected.length}.`,
          });
        }

        for (const emp of selected) {
          assignedToday.add(String(emp.id));
          const assignmentId = randomUUID();
          await db.execute(
            `INSERT INTO wfm_roster_assignment
             (id, employee_id, shift_id, plan_id, roster_date, roster_status, shift_start_time, shift_end_time, branch_name, process_name, publish_status)
             VALUES (?, ?, ?, ?, ?, 'Rostered', ?, ?, ?, ?, 'draft')
             ON DUPLICATE KEY UPDATE
               shift_id = VALUES(shift_id),
               shift_start_time = VALUES(shift_start_time),
               shift_end_time = VALUES(shift_end_time),
               roster_status = VALUES(roster_status),
               publish_status = 'draft'`,
            [
              assignmentId,
              emp.id,
              shift?.id ?? null,
              planId,
              rosterDate,
              `${slotStart}:00`.slice(0, 8),
              `${slotEnd}:00`.slice(0, 8),
              branchName,
              processName,
            ]
          );
          await db.execute(
            `INSERT IGNORE INTO wfm_roster_assignment_control
             (assignment_id, plan_id, change_lock_status, acknowledgement_required, acknowledgement_status)
             VALUES (?, ?, 'draft_editable', 0, 'not_required')`,
            [assignmentId, planId]
          );
          created++;
        }
      }

      for (const emp of pool.filter((e) => !assignedToday.has(String(e.id)) && prefs.get(String(e.id)) === dow)) {
        const assignmentId = randomUUID();
        await db.execute(
          `INSERT INTO wfm_roster_assignment
           (id, employee_id, shift_id, plan_id, roster_date, roster_status, shift_start_time, shift_end_time, branch_name, process_name, publish_status)
           VALUES (?, ?, NULL, ?, ?, 'Week Off', NULL, NULL, ?, ?, 'draft')
           ON DUPLICATE KEY UPDATE roster_status = 'Week Off', shift_id = NULL, shift_start_time = NULL, shift_end_time = NULL, publish_status = 'draft'`,
          [assignmentId, emp.id, planId, rosterDate, branchName, processName]
        );
        await db.execute(
          `INSERT IGNORE INTO wfm_roster_assignment_control
           (assignment_id, plan_id, change_lock_status, acknowledgement_required, acknowledgement_status)
           VALUES (?, ?, 'draft_editable', 0, 'not_required')`,
          [assignmentId, planId]
        );
        skipped++;
      }
    }

    const coverage = await recomputeCoverage(planId);
    await db.execute(
      `UPDATE wfm_roster_plan_control SET approval_status = 'generated', generated_at = NOW(), last_coverage_score = ?, updated_at = NOW() WHERE plan_id = ?`,
      [coverage.score, planId]
    );
    await logEvent({
      plan_id: planId,
      event_type: "draft_generated",
      event_title: "Auto roster draft generated",
      event_message: `Draft generated with ${created} shift assignments. Coverage score ${coverage.score}%.`,
      target_role: "wfm",
      process_id: plan.process_id,
      branch_id: plan.branch_id,
    });
    return { created, week_off_rows: skipped, coverage_score: coverage.score, open_critical_gaps: coverage.openCriticalGaps };
  },

  async getCoverage(planId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_roster_coverage_matrix WHERE plan_id = ? ORDER BY roster_date, slot_start`,
      [planId]
    );
    return rows as AnyRow[];
  },

  async getConflicts(planId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_roster_conflict_log WHERE plan_id = ? ORDER BY FIELD(severity,'critical','high','medium','info'), created_at DESC`,
      [planId]
    );
    return rows as AnyRow[];
  },

  async getAssignments(planId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT a.*, ac.change_lock_status, ac.acknowledgement_required, ac.acknowledgement_status, e.employee_code,
              COALESCE(e.full_name, TRIM(CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')))) AS employee_name
       FROM wfm_roster_assignment a
       LEFT JOIN wfm_roster_assignment_control ac ON ac.assignment_id = a.id
       LEFT JOIN employees e ON e.id = a.employee_id
       WHERE a.plan_id = ?
       ORDER BY a.roster_date, a.shift_start_time, e.employee_code`,
      [planId]
    );
    return rows as AnyRow[];
  },

  async submitForApproval(planId: string, actorId: string) {
    const coverage = await recomputeCoverage(planId);
    await db.execute(
      `UPDATE wfm_roster_plan_control SET approval_status = 'submitted', submitted_by = ?, submitted_at = NOW(), last_coverage_score = ? WHERE plan_id = ?`,
      [actorId, coverage.score, planId]
    );
    await db.execute(
      `INSERT INTO wfm_roster_approval_log (id, plan_id, action, action_by, action_role, remarks, coverage_snapshot_json)
       VALUES (?, ?, 'submitted', ?, 'wfm', 'Submitted to Process Manager for approval', ?)`,
      [randomUUID(), planId, actorId, JSON.stringify({ score: coverage.score, openCriticalGaps: coverage.openCriticalGaps })]
    );
    await logEvent({
      plan_id: planId,
      event_type: "submitted_for_pm_approval",
      event_title: "Roster submitted for Process Manager approval",
      event_message: `Coverage score ${coverage.score}%, open critical gaps ${coverage.openCriticalGaps}.`,
      severity: coverage.openCriticalGaps ? "high" : "info",
      target_role: "process_manager",
    });
    return { approval_status: "submitted", ...coverage };
  },

  async approve(planId: string, actorId: string, remarks?: string) {
    const coverage = await recomputeCoverage(planId);
    if (coverage.openCriticalGaps > 0) {
      throw Object.assign(new Error("Cannot approve roster while critical coverage gaps are open."), { statusCode: 409 });
    }
    await db.execute(
      `UPDATE wfm_roster_plan_control SET approval_status = 'approved', approved_by = ?, approved_at = NOW(), last_coverage_score = ? WHERE plan_id = ?`,
      [actorId, coverage.score, planId]
    );
    await db.execute(
      `INSERT INTO wfm_roster_approval_log (id, plan_id, action, action_by, action_role, remarks, coverage_snapshot_json)
       VALUES (?, ?, 'approved', ?, 'process_manager', ?, ?)`,
      [randomUUID(), planId, actorId, remarks ?? "Approved by Process Manager", JSON.stringify({ score: coverage.score })]
    );
    await logEvent({
      plan_id: planId,
      event_type: "pm_approved",
      event_title: "Process Manager approved roster",
      event_message: remarks ?? "Roster approved for publish.",
      target_role: "wfm",
    });
    return { approval_status: "approved", coverage_score: coverage.score };
  },

  async reject(planId: string, actorId: string, remarks: string) {
    await db.execute(
      `UPDATE wfm_roster_plan_control SET approval_status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_remarks = ? WHERE plan_id = ?`,
      [actorId, remarks, planId]
    );
    await db.execute(
      `INSERT INTO wfm_roster_approval_log (id, plan_id, action, action_by, action_role, remarks)
       VALUES (?, ?, 'rejected', ?, 'process_manager', ?)`,
      [randomUUID(), planId, actorId, remarks]
    );
    await logEvent({
      plan_id: planId,
      event_type: "pm_rejected",
      event_title: "Process Manager returned roster",
      event_message: remarks,
      severity: "medium",
      target_role: "wfm",
    });
    return { approval_status: "rejected" };
  },

  async publish(planId: string, actorId: string) {
    const plan = await getPlan(planId);
    const control = await getPlanControl(planId);
    if (control.approval_status !== "approved") {
      throw Object.assign(new Error("Only Process Manager approved roster can be published."), { statusCode: 409 });
    }
    const coverage = await recomputeCoverage(planId);
    if (coverage.openCriticalGaps > 0) {
      throw Object.assign(new Error("Cannot publish roster while critical coverage gaps are open."), { statusCode: 409 });
    }
    await db.execute(`UPDATE wfm_roster_plan SET plan_status = 'published' WHERE id = ?`, [planId]);
    await db.execute(`UPDATE wfm_roster_assignment SET publish_status = 'published' WHERE plan_id = ?`, [planId]);
    await db.execute(
      `UPDATE wfm_roster_plan_control
       SET approval_status = 'published', publish_lock_status = 'published_locked', notification_status = 'pending', updated_at = NOW()
       WHERE plan_id = ?`,
      [planId]
    );
    await db.execute(
      `UPDATE wfm_roster_assignment_control
       SET change_lock_status = 'pm_change_only', acknowledgement_required = 1, acknowledgement_status = 'pending', last_notification_status = 'pending'
       WHERE plan_id = ?`,
      [planId]
    );
    await db.execute(
      `INSERT INTO wfm_roster_approval_log (id, plan_id, action, action_by, action_role, remarks, coverage_snapshot_json)
       VALUES (?, ?, 'published', ?, 'process_manager', 'Published with locked notifications', ?)`,
      [randomUUID(), planId, actorId, JSON.stringify({ score: coverage.score })]
    );

    const assignments = await this.getAssignments(planId);
    for (const a of assignments) {
      await queueLockedNotification({
        plan_id: planId,
        assignment_id: a.id,
        employee_id: a.employee_id,
        recipient_email: a.email ?? null,
        notification_type: "roster_published",
        subject: `Roster published: ${String(plan.from_date).slice(0, 10)} to ${String(plan.to_date).slice(0, 10)}`,
        body_preview: `Your roster for ${a.roster_date} is ${a.roster_status}${a.shift_start_time ? ` (${toTime(a.shift_start_time)}-${toTime(a.shift_end_time)})` : ""}. Acknowledgement is required.`,
      });
    }
    await logEvent({
      plan_id: planId,
      event_type: "published_locked",
      event_title: "Roster published and locked",
      event_message: `Roster published. ${assignments.length} locked employee notifications queued.`,
      target_role: "employee",
      process_id: plan.process_id,
      branch_id: plan.branch_id,
    });
    return { approval_status: "published", notifications_queued: assignments.length, coverage_score: coverage.score };
  },

  async changePublishedAssignment(input: {
    assignment_id: string;
    new_shift_id?: string | null;
    new_shift_start_time?: string | null;
    new_shift_end_time?: string | null;
    new_roster_status?: string;
    change_category?: "shift_change" | "weekoff_change" | "leave_adjustment" | "emergency" | "support_staff_update";
    change_reason: string;
  }, actorId: string) {
    if (!input.change_reason || input.change_reason.trim().length < 8) {
      throw Object.assign(new Error("Change reason is mandatory and must be meaningful."), { statusCode: 400 });
    }
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM wfm_roster_assignment WHERE id = ? LIMIT 1`, [input.assignment_id]);
    const old = rows[0] as AnyRow | undefined;
    if (!old) throw Object.assign(new Error("Assignment not found"), { statusCode: 404 });
    const control = await getPlanControl(old.plan_id);
    if (control.approval_status !== "published") {
      throw Object.assign(new Error("PM-only change control applies only after roster is published. Draft changes should use draft edit."), { statusCode: 409 });
    }

    const changeId = randomUUID();
    const impactBefore = await recomputeCoverage(old.plan_id);
    const newStatus = input.new_roster_status ?? old.roster_status;
    const newStart = input.new_shift_start_time ? `${input.new_shift_start_time}:00`.slice(0, 8) : old.shift_start_time;
    const newEnd = input.new_shift_end_time ? `${input.new_shift_end_time}:00`.slice(0, 8) : old.shift_end_time;

    await db.execute(
      `UPDATE wfm_roster_assignment
       SET shift_id = ?, shift_start_time = ?, shift_end_time = ?, roster_status = ?, updated_at = NOW()
       WHERE id = ?`,
      [input.new_shift_id ?? old.shift_id ?? null, newStart, newEnd, newStatus, input.assignment_id]
    );

    const impactAfter = await recomputeCoverage(old.plan_id);
    const impact = {
      beforeScore: impactBefore.score,
      afterScore: impactAfter.score,
      beforeCriticalGaps: impactBefore.openCriticalGaps,
      afterCriticalGaps: impactAfter.openCriticalGaps,
    };

    await db.execute(
      `INSERT INTO wfm_roster_change_request
       (id, plan_id, assignment_id, employee_id, roster_date, old_shift_id, new_shift_id,
        old_shift_start_time, old_shift_end_time, new_shift_start_time, new_shift_end_time,
        old_roster_status, new_roster_status, change_category, change_reason,
        impact_summary_json, requested_by, approved_by, status, notification_locked, notification_status, approved_at, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', 1, 'pending', NOW(), NOW())`,
      [
        changeId,
        old.plan_id,
        old.id,
        old.employee_id,
        String(old.roster_date).slice(0, 10),
        old.shift_id,
        input.new_shift_id ?? old.shift_id ?? null,
        old.shift_start_time,
        old.shift_end_time,
        newStart,
        newEnd,
        old.roster_status,
        newStatus,
        input.change_category ?? "shift_change",
        input.change_reason,
        JSON.stringify(impact),
        actorId,
        actorId,
      ]
    );

    await db.execute(
      `UPDATE wfm_roster_assignment_control
       SET last_change_request_id = ?, acknowledgement_required = 1, acknowledgement_status = 'pending', last_notification_status = 'pending'
       WHERE assignment_id = ?`,
      [changeId, input.assignment_id]
    );

    await queueLockedNotification({
      plan_id: old.plan_id,
      assignment_id: old.id,
      change_request_id: changeId,
      employee_id: old.employee_id,
      notification_type: "roster_changed",
      subject: "Roster changed - acknowledgement required",
      body_preview: `Roster for ${String(old.roster_date).slice(0, 10)} changed from ${old.roster_status} ${toTime(old.shift_start_time) ?? ""}-${toTime(old.shift_end_time) ?? ""} to ${newStatus} ${toTime(newStart) ?? ""}-${toTime(newEnd) ?? ""}. Reason: ${input.change_reason}`,
    });
    await logEvent({
      plan_id: old.plan_id,
      assignment_id: old.id,
      event_type: "published_roster_changed",
      event_title: "Published roster changed by Process Manager",
      event_message: `Roster changed with locked notification. Reason: ${input.change_reason}`,
      severity: impactAfter.openCriticalGaps > impactBefore.openCriticalGaps ? "high" : "medium",
      target_employee_id: old.employee_id,
    });
    return { change_id: changeId, impact };
  },

  async queueManagerTasks(planId: string, actorId: string) {
    const plan = await getPlan(planId);
    const empCols = await schema.columns("employees");
    const managerCol = empCols.has("manager_employee_id") ? "manager_employee_id" : empCols.has("reporting_manager_id") ? "reporting_manager_id" : null;
    const designationCol = empCols.has("designation_name") ? "designation_name" : empCols.has("designation") ? "designation" : null;

    if (!managerCol) {
      await insertConflict({
        plan_id: planId,
        conflict_type: "manager_mapping_missing",
        severity: "high",
        message: "Support staff manager mapping column not found in employees table.",
      });
      return { created: 0, reason: "manager_mapping_missing" };
    }

    const conds: string[] = [`${managerCol} IS NOT NULL`];
    const params: unknown[] = [];
    if (empCols.has("process_id") && plan.process_id) { conds.push("process_id = ?"); params.push(plan.process_id); }
    if (empCols.has("branch_id") && plan.branch_id) { conds.push("branch_id = ?"); params.push(plan.branch_id); }
    if (empCols.has("active_status")) conds.push("active_status = 1");
    if (designationCol) {
      conds.push(`LOWER(COALESCE(${designationCol},'')) REGEXP 'support|qa|trainer|wfm|mis|hr|admin|tl|team lead|manager'`);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${managerCol} AS manager_employee_id, COUNT(*) AS support_staff_count
       FROM employees
       WHERE ${conds.join(" AND ")}
       GROUP BY ${managerCol}`,
      params
    );

    let created = 0;
    for (const r of rows as AnyRow[]) {
      const taskId = randomUUID();
      await db.execute(
        `INSERT INTO wfm_roster_manager_task
         (id, plan_id, manager_employee_id, support_staff_count, due_at, status, notes)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), 'email_queued', 'Manager must update support staff roster.')
         ON DUPLICATE KEY UPDATE support_staff_count = VALUES(support_staff_count), status = 'email_queued', last_email_sent_at = NOW()`,
        [taskId, planId, r.manager_employee_id, Number(r.support_staff_count ?? 0)]
      );
      await queueLockedNotification({
        plan_id: planId,
        employee_id: r.manager_employee_id,
        notification_type: "support_roster_update_required",
        subject: "Support staff roster update required",
        body_preview: `Please update support staff roster for plan ${plan.plan_name}. Due within 24 hours.`,
      });
      created++;
    }

    await logEvent({
      plan_id: planId,
      event_type: "support_manager_tasks_queued",
      event_title: "Support staff manager tasks queued",
      event_message: `${created} manager task(s) queued by ${actorId}.`,
      target_role: "process_manager",
    });
    return { created };
  },

  async listEvents(planId?: string, since?: string) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (planId) { conds.push("plan_id = ?"); params.push(planId); }
    if (since) { conds.push("created_at > ?"); params.push(since); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_roster_event_log ${where} ORDER BY created_at DESC LIMIT 100`,
      params
    );
    return rows as AnyRow[];
  },

  async listApprovalLog(planId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_roster_approval_log WHERE plan_id = ? ORDER BY created_at DESC`,
      [planId]
    );
    return rows as AnyRow[];
  },

  async listChangeRequests(planId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_roster_change_request WHERE plan_id = ? ORDER BY created_at DESC`,
      [planId]
    );
    return rows as AnyRow[];
  },

  async myRoster(employeeId: string | null, fromDate?: string, toDate?: string) {
    if (!employeeId) throw Object.assign(new Error("No employee record mapped to this user."), { statusCode: 403 });
    const conds = ["a.employee_id = ?"];
    const params: unknown[] = [employeeId];
    if (fromDate) { conds.push("a.roster_date >= ?"); params.push(fromDate); }
    if (toDate) { conds.push("a.roster_date <= ?"); params.push(toDate); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT a.*, ac.acknowledgement_required, ac.acknowledgement_status
       FROM wfm_roster_assignment a
       LEFT JOIN wfm_roster_assignment_control ac ON ac.assignment_id = a.id
       WHERE ${conds.join(" AND ")}
       ORDER BY a.roster_date ASC`,
      params
    );
    return rows as AnyRow[];
  },

  async acknowledge(assignmentId: string, employeeId: string | null, remarks?: string) {
    if (!employeeId) throw Object.assign(new Error("No employee record mapped to this user."), { statusCode: 403 });
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_roster_assignment WHERE id = ? AND employee_id = ? LIMIT 1`,
      [assignmentId, employeeId]
    );
    if (!rows[0]) throw Object.assign(new Error("Roster assignment not found for logged-in employee."), { statusCode: 404 });

    const [controlRows] = await db.execute<RowDataPacket[]>(
      `SELECT last_change_request_id FROM wfm_roster_assignment_control WHERE assignment_id = ? LIMIT 1`,
      [assignmentId]
    );
    const changeRequestId = (controlRows[0] as AnyRow | undefined)?.last_change_request_id ?? null;

    await db.execute(
      `INSERT INTO wfm_roster_acknowledgement (id, assignment_id, change_request_id, employee_id, acknowledgement_type, remarks)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE acknowledged_at = NOW(), remarks = VALUES(remarks)`,
      [randomUUID(), assignmentId, changeRequestId, employeeId, changeRequestId ? "change" : "publish", remarks ?? null]
    );
    await db.execute(
      `UPDATE wfm_roster_assignment_control SET acknowledgement_status = 'acknowledged', updated_at = NOW() WHERE assignment_id = ?`,
      [assignmentId]
    );
    return { acknowledged: true };
  },

  // Helper methods for scope resolution
  async getPlanById(planId: string) {
    const { db } = await import("../../db/mysql.js");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, process_id, branch_id FROM wfm_roster_plan WHERE id = ? LIMIT 1`,
      [planId]
    );
    return (rows[0] as AnyRow | undefined) ?? null;
  },

  async getAssignmentById(assignmentId: string) {
    const { db } = await import("../../db/mysql.js");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ra.id, rp.process_id, rp.branch_id
       FROM wfm_roster_assignment ra
       JOIN wfm_roster_plan rp ON rp.id = ra.plan_id
       WHERE ra.id = ? LIMIT 1`,
      [assignmentId]
    );
    return (rows[0] as AnyRow | undefined) ?? null;
  },
};
