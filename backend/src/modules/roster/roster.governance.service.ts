import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { Request } from "express";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShiftTemplate extends RowDataPacket {
  id: string;
  shift_code: string;
  version: number;
  shift_name: string;
  process_id: string | null;
  branch_id: string | null;
  start_time: string;
  end_time: string;
  productive_minutes: number;
  grace_minutes: number;
  break_entitlement: number;
  weekly_off_pattern: string;
  night_shift: number;
  eligibility_rules: unknown;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateShiftTemplateInput {
  shift_code: string;
  version?: number;
  shift_name: string;
  process_id?: string | null;
  branch_id?: string | null;
  start_time: string;
  end_time: string;
  productive_minutes?: number;
  grace_minutes?: number;
  break_entitlement?: number;
  weekly_off_pattern?: string;
  night_shift?: number;
  eligibility_rules?: unknown;
  effective_from: string;
  effective_to?: string | null;
}

export interface RosterCycle extends RowDataPacket {
  id: string;
  process_id: string;
  branch_id: string | null;
  week_start_date: string;
  week_end_date: string;
  status: string;
  required_hc_json: unknown;
  published_by: string | null;
  published_at: string | null;
  locked_at: string | null;
  payroll_ready_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCycleInput {
  process_id: string;
  branch_id?: string | null;
  week_start_date: string;
  week_end_date: string;
  required_hc_json?: unknown;
}

export interface DailyAssignment extends RowDataPacket {
  id: string;
  cycle_id: string;
  employee_id: string;
  roster_date: string;
  shift_template_id: string | null;
  is_week_off: number;
  is_holiday: number;
  acknowledgement_status: string;
  acknowledged_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface BulkAssignRow {
  employee_id: string;
  roster_date: string;
  shift_template_id?: string | null;
  is_week_off?: number;
  is_holiday?: number;
  notes?: string | null;
}

export interface ChangeLog extends RowDataPacket {
  id: string;
  cycle_id: string;
  employee_id: string;
  change_type: string;
  old_value_json: unknown;
  new_value_json: unknown;
  reason: string;
  change_date: string;
  changed_by: string;
  created_at: string;
}

export interface CreateChangeLogInput {
  employee_id: string;
  change_type: "shift_change" | "week_off_change" | "swap" | "addition" | "removal";
  old_value_json?: unknown;
  new_value_json?: unknown;
  reason: string;
  change_date: string;
}

export interface CoverageAction extends RowDataPacket {
  id: string;
  cycle_id: string;
  action_date: string;
  process_id: string | null;
  coverage_gap: number;
  root_cause: string | null;
  recovery_plan: string | null;
  owner_user_id: string | null;
  due_by: string | null;
  status: string;
  resolved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCoverageActionInput {
  cycle_id: string;
  action_date: string;
  process_id?: string | null;
  coverage_gap?: number;
  root_cause?: string | null;
  recovery_plan?: string | null;
  owner_user_id?: string | null;
  due_by?: string | null;
}

export interface PortalAggregate extends RowDataPacket {
  id: string;
  cycle_id: string;
  process_id: string;
  week_start_date: string;
  required_hc: number;
  rostered_hc: number;
  coverage_pct: number | null;
  published_at: string | null;
}

// ── Valid status transitions ──────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:               ["submitted"],
  submitted:           ["reviewed", "draft"],
  reviewed:            ["published", "submitted"],
  published:           ["acknowledged", "reviewed"],
  acknowledged:        ["active"],
  active:              ["variance_review", "attendance_locked"],
  variance_review:     ["attendance_locked", "active"],
  attendance_locked:   ["payroll_input_ready"],
  payroll_input_ready: ["closed"],
  closed:              [],
};

const EDITABLE_ASSIGNMENT_STATUSES = new Set(["draft", "submitted", "reviewed"]);

// ── Service ───────────────────────────────────────────────────────────────────

export const rosterGovernanceService = {
  // ── Shift Templates ─────────────────────────────────────────────────────────

  async listShiftTemplates(filters: { process_id?: string; active_status?: string }): Promise<ShiftTemplate[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.process_id)    { conds.push("process_id = ?"); params.push(filters.process_id); }
    if (filters.active_status !== undefined) { conds.push("active_status = ?"); params.push(filters.active_status); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<ShiftTemplate[]>(
      `SELECT * FROM wfm_shift_template ${where} ORDER BY shift_code ASC, version DESC`,
      params
    );
    return rows;
  },

  async createShiftTemplate(input: CreateShiftTemplateInput, userId: string, req?: Request): Promise<ShiftTemplate> {
    if (!input.shift_code || !input.shift_name || !input.process_id || !input.start_time || !input.end_time || !input.effective_from) {
      throw Object.assign(new Error("shift_code, shift_name, process_id, start_time, end_time and effective_from are required"), { statusCode: 400 });
    }
    const id = randomUUID();
    await db.execute(
      `INSERT INTO wfm_shift_template
         (id, shift_code, version, shift_name, process_id, branch_id, start_time, end_time,
          productive_minutes, grace_minutes, break_entitlement, weekly_off_pattern, night_shift,
          eligibility_rules, effective_from, effective_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.shift_code,
        input.version ?? 1,
        input.shift_name,
        input.process_id,
        input.branch_id ?? null,
        input.start_time,
        input.end_time,
        input.productive_minutes ?? 420,
        input.grace_minutes ?? 5,
        input.break_entitlement ?? 30,
        input.weekly_off_pattern ?? "sunday",
        input.night_shift ?? 0,
        input.eligibility_rules ? JSON.stringify(input.eligibility_rules) : null,
        input.effective_from,
        input.effective_to ?? null,
        userId,
      ]
    );
    await logSensitiveAction({ actor_user_id: userId, action_type: "SHIFT_TEMPLATE_CREATED", module_key: "roster_gov", entity_type: "wfm_shift_template", entity_id: id, change_summary: { process_id: input.process_id, branch_id: input.branch_id ?? null }, req });
    const [rows] = await db.execute<ShiftTemplate[]>("SELECT * FROM wfm_shift_template WHERE id = ? LIMIT 1", [id]);
    return rows[0];
  },

  // ── Weekly Roster Cycles ────────────────────────────────────────────────────

  async listCycles(filters: { process_id?: string; status?: string; week_start_date?: string }): Promise<RosterCycle[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.process_id)      { conds.push("process_id = ?"); params.push(filters.process_id); }
    if (filters.status)          { conds.push("status = ?"); params.push(filters.status); }
    if (filters.week_start_date) { conds.push("week_start_date = ?"); params.push(filters.week_start_date); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RosterCycle[]>(
      `SELECT * FROM weekly_roster_cycle ${where} ORDER BY week_start_date DESC`,
      params
    );
    return rows;
  },

  async createCycle(input: CreateCycleInput, userId: string, req?: Request): Promise<RosterCycle> {
    if (!input.process_id || !input.week_start_date || !input.week_end_date) {
      throw Object.assign(new Error("process_id, week_start_date, week_end_date are required"), { statusCode: 400 });
    }
    if (input.week_end_date < input.week_start_date) {
      throw Object.assign(new Error("week_end_date must be >= week_start_date"), { statusCode: 400 });
    }
    const id = randomUUID();
    await db.execute(
      `INSERT INTO weekly_roster_cycle
         (id, process_id, branch_id, week_start_date, week_end_date, required_hc_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.process_id, input.branch_id ?? null, input.week_start_date, input.week_end_date, input.required_hc_json ? JSON.stringify(input.required_hc_json) : null, userId]
    );
    await logSensitiveAction({ actor_user_id: userId, action_type: "ROSTER_CYCLE_CREATED", module_key: "roster_gov", entity_type: "weekly_roster_cycle", entity_id: id, change_summary: { process_id: input.process_id, branch_id: input.branch_id ?? null, week_start_date: input.week_start_date, week_end_date: input.week_end_date }, req });
    const [rows] = await db.execute<RosterCycle[]>("SELECT * FROM weekly_roster_cycle WHERE id = ? LIMIT 1", [id]);
    return rows[0];
  },

  async getCycle(id: string): Promise<RosterCycle> {
    const [rows] = await db.execute<RosterCycle[]>("SELECT * FROM weekly_roster_cycle WHERE id = ? LIMIT 1", [id]);
    if (!rows[0]) throw Object.assign(new Error("Cycle not found"), { statusCode: 404 });
    return rows[0];
  },

  async advanceCycleStatus(id: string, newStatus: string, userId: string, req?: Request): Promise<RosterCycle> {
    const cycle = await this.getCycle(id);
    const allowed = VALID_TRANSITIONS[cycle.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw Object.assign(new Error(`Invalid transition: ${cycle.status} → ${newStatus}. Allowed: ${allowed.join(", ") || "none"}`), { statusCode: 400 });
    }

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const extra: string[] = [];
    const params: unknown[] = [];
    if (newStatus === "published") {
      extra.push("published_by = ?", "published_at = ?");
      params.push(userId, now);
    }
    if (newStatus === "attendance_locked") {
      extra.push("locked_at = ?");
      params.push(now);
    }
    if (newStatus === "payroll_input_ready") {
      extra.push("payroll_ready_at = ?");
      params.push(now);
    }

    const setClause = ["status = ?", ...extra].join(", ");
    await db.execute(`UPDATE weekly_roster_cycle SET ${setClause} WHERE id = ?`, [newStatus, ...params, id]);
    await logSensitiveAction({ actor_user_id: userId, action_type: "ROSTER_CYCLE_STATUS_CHANGED", module_key: "roster_gov", entity_type: "weekly_roster_cycle", entity_id: id, change_summary: { from: cycle.status, to: newStatus, process_id: cycle.process_id }, req });
    return this.getCycle(id);
  },

  // ── Daily Assignments ───────────────────────────────────────────────────────

  async getAssignments(cycleId: string, employeeIdFilter?: string): Promise<DailyAssignment[]> {
    const conds = ["cycle_id = ?"];
    const params: unknown[] = [cycleId];
    if (employeeIdFilter) { conds.push("employee_id = ?"); params.push(employeeIdFilter); }
    const [rows] = await db.execute<DailyAssignment[]>(`SELECT * FROM roster_daily_assignment WHERE ${conds.join(" AND ")} ORDER BY roster_date ASC, employee_id ASC`, params);
    return rows;
  },

  async validateAssignment(cycle: RosterCycle, row: BulkAssignRow): Promise<void> {
    if (!row.employee_id || !row.roster_date) {
      throw new Error("employee_id and roster_date are required");
    }
    if (row.roster_date < cycle.week_start_date || row.roster_date > cycle.week_end_date) {
      throw new Error("roster_date is outside the weekly cycle");
    }
    const [employees] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees
        WHERE id = ? AND process_id = ? AND active_status = 1
          AND (branch_id = ? OR ? IS NULL)
        LIMIT 1`,
      [row.employee_id, cycle.process_id, cycle.branch_id, cycle.branch_id]
    );
    if (!employees[0]) {
      throw new Error("employee is not active in the roster process/branch scope");
    }
    if (row.shift_template_id) {
      const [shifts] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM wfm_shift_template
          WHERE id = ? AND process_id = ? AND active_status = 1
            AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
          LIMIT 1`,
        [row.shift_template_id, cycle.process_id, row.roster_date, row.roster_date]
      );
      if (!shifts[0]) throw new Error("shift template is not active for the roster process/date");
    }
  },

  async bulkUpsertAssignments(cycleId: string, assignments: BulkAssignRow[], userId: string, req?: Request): Promise<{ upserted: number; errors: string[] }> {
    const cycle = await this.getCycle(cycleId);
    if (!EDITABLE_ASSIGNMENT_STATUSES.has(cycle.status)) {
      throw Object.assign(new Error("Published/active roster assignments cannot be bulk-overwritten; use controlled roster-change workflow"), { statusCode: 409 });
    }
    let upserted = 0;
    const errors: string[] = [];
    for (const row of assignments) {
      try {
        await this.validateAssignment(cycle, row);
        await db.execute(
          `INSERT INTO roster_daily_assignment
             (id, cycle_id, employee_id, roster_date, shift_template_id, is_week_off, is_holiday, notes)
           VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             shift_template_id = VALUES(shift_template_id),
             is_week_off       = VALUES(is_week_off),
             is_holiday        = VALUES(is_holiday),
             notes             = VALUES(notes)`,
          [cycleId, row.employee_id, row.roster_date, row.shift_template_id ?? null, row.is_week_off ?? 0, row.is_holiday ?? 0, row.notes ?? null]
        );
        upserted++;
      } catch (err) {
        errors.push(`${row.employee_id}/${row.roster_date}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await logSensitiveAction({ actor_user_id: userId, action_type: "ROSTER_ASSIGNMENTS_BULK_UPSERTED", module_key: "roster_gov", entity_type: "weekly_roster_cycle", entity_id: cycleId, change_summary: { upserted, errors: errors.length, process_id: cycle.process_id }, req });
    return { upserted, errors };
  },

  async acknowledgeRoster(cycleId: string, employeeId: string, userId: string, req?: Request): Promise<{ acknowledged: number }> {
    const cycle = await this.getCycle(cycleId);
    if (!["published", "acknowledged", "active"].includes(cycle.status)) {
      throw Object.assign(new Error("Roster is not published for acknowledgement"), { statusCode: 409 });
    }
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const [result] = (await db.execute(
      `UPDATE roster_daily_assignment
          SET acknowledgement_status = 'acknowledged', acknowledged_at = ?
        WHERE cycle_id = ? AND employee_id = ? AND acknowledgement_status = 'pending'`,
      [now, cycleId, employeeId]
    ) as unknown) as [{ affectedRows: number }, unknown];
    await logSensitiveAction({ actor_user_id: userId, action_type: "ROSTER_ACKNOWLEDGED", module_key: "roster_gov", entity_type: "weekly_roster_cycle", entity_id: cycleId, change_summary: { employee_id: employeeId, acknowledged: result.affectedRows }, req });
    return { acknowledged: result.affectedRows };
  },

  // ── Change Log ──────────────────────────────────────────────────────────────

  async listChangeLogs(cycleId: string, employeeId?: string): Promise<ChangeLog[]> {
    const conds = ["cycle_id = ?"];
    const params: unknown[] = [cycleId];
    if (employeeId) { conds.push("employee_id = ?"); params.push(employeeId); }
    const [rows] = await db.execute<ChangeLog[]>(`SELECT * FROM roster_change_log WHERE ${conds.join(" AND ")} ORDER BY created_at DESC`, params);
    return rows;
  },

  async logRosterChange(cycleId: string, input: CreateChangeLogInput, userId: string, req?: Request): Promise<ChangeLog> {
    const cycle = await this.getCycle(cycleId);
    if (!input.reason || !input.reason.trim()) {
      throw Object.assign(new Error("reason is required for roster change log"), { statusCode: 400 });
    }
    if (!["published", "acknowledged", "active", "variance_review"].includes(cycle.status)) {
      throw Object.assign(new Error("Post-publication change records are allowed only after roster publication"), { statusCode: 409 });
    }
    const id = randomUUID();
    await db.execute(
      `INSERT INTO roster_change_log
         (id, cycle_id, employee_id, change_type, old_value_json, new_value_json, reason, change_date, changed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, cycleId, input.employee_id, input.change_type, input.old_value_json ? JSON.stringify(input.old_value_json) : null, input.new_value_json ? JSON.stringify(input.new_value_json) : null, input.reason, input.change_date, userId]
    );
    await logSensitiveAction({ actor_user_id: userId, action_type: "ROSTER_POST_PUBLISH_CHANGE_RECORDED", module_key: "roster_gov", entity_type: "roster_change_log", entity_id: id, change_summary: { cycle_id: cycleId, employee_id: input.employee_id, change_type: input.change_type, process_id: cycle.process_id }, req });
    const [rows] = await db.execute<ChangeLog[]>("SELECT * FROM roster_change_log WHERE id = ? LIMIT 1", [id]);
    return rows[0];
  },

  // ── Coverage Actions ────────────────────────────────────────────────────────

  async getCoverageAction(id: string): Promise<CoverageAction> {
    const [rows] = await db.execute<CoverageAction[]>("SELECT * FROM roster_coverage_action WHERE id = ? LIMIT 1", [id]);
    if (!rows[0]) throw Object.assign(new Error("Coverage action not found"), { statusCode: 404 });
    return rows[0];
  },

  async createCoverageAction(input: CreateCoverageActionInput, userId: string, req?: Request): Promise<CoverageAction> {
    if (!input.cycle_id || !input.action_date) {
      throw Object.assign(new Error("cycle_id and action_date are required"), { statusCode: 400 });
    }
    const cycle = await this.getCycle(input.cycle_id);
    const id = randomUUID();
    await db.execute(
      `INSERT INTO roster_coverage_action
         (id, cycle_id, action_date, process_id, coverage_gap, root_cause, recovery_plan,
          owner_user_id, due_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.cycle_id, input.action_date, cycle.process_id, input.coverage_gap ?? 0, input.root_cause ?? null, input.recovery_plan ?? null, input.owner_user_id ?? null, input.due_by ?? null, userId]
    );
    await logSensitiveAction({ actor_user_id: userId, action_type: "ROSTER_COVERAGE_ACTION_CREATED", module_key: "roster_gov", entity_type: "roster_coverage_action", entity_id: id, change_summary: { cycle_id: input.cycle_id, process_id: cycle.process_id }, req });
    return this.getCoverageAction(id);
  },

  async resolveCoverageAction(id: string, userId: string, req?: Request): Promise<CoverageAction> {
    await this.getCoverageAction(id);
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    await db.execute("UPDATE roster_coverage_action SET status = 'resolved', resolved_at = ? WHERE id = ?", [now, id]);
    await logSensitiveAction({ actor_user_id: userId, action_type: "ROSTER_COVERAGE_ACTION_RESOLVED", module_key: "roster_gov", entity_type: "roster_coverage_action", entity_id: id, req });
    return this.getCoverageAction(id);
  },

  // ── Portal Aggregate ─────────────────────────────────────────────────────────

  async getPortalAggregate(filters: { process_id: string; week_start_date: string }): Promise<PortalAggregate[]> {
    if (!filters.process_id || !filters.week_start_date) {
      throw Object.assign(new Error("process_id and week_start_date are required"), { statusCode: 400 });
    }
    const [rows] = await db.execute<PortalAggregate[]>(
      `SELECT pra.*
         FROM portal_roster_aggregate pra
         JOIN weekly_roster_cycle wrc ON wrc.id = pra.cycle_id
        WHERE pra.process_id = ?
          AND pra.week_start_date = ?
          AND wrc.status IN ('published','acknowledged','active','attendance_locked','payroll_input_ready','closed')
          AND pra.published_at IS NOT NULL
        ORDER BY pra.published_at DESC`,
      [filters.process_id, filters.week_start_date]
    );
    return rows;
  },
};
