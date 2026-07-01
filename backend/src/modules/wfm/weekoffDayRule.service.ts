import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { randomUUID } from "crypto";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export interface DayCapacityCheck {
  day_of_week: number;       // 0-6
  day_name: string;
  min_hc_required: number;   // from process_weekoff_day_rule
  max_weekoff_allowed: number | null; // from process_weekoff_day_rule override, else process_weekoff_capacity
  current_allocated: number; // from weekoff_allocation_log
  slots_remaining: number | null;
  is_safe: boolean;          // min_hc_required check will pass if we add one more week-off
}

export const weekoffDayRuleService = {

  async list(processId: string, weekStartDate?: string): Promise<RowDataPacket[]> {
    const params: unknown[] = [processId];
    let weekWhere = "";
    if (weekStartDate) { weekWhere = " AND week_start_date = ?"; params.push(weekStartDate); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*, pm.process_name
         FROM process_weekoff_day_rule r
         JOIN process_master pm ON pm.id = r.process_id
        WHERE r.process_id = ? AND r.is_active = 1${weekWhere}
        ORDER BY r.week_start_date DESC`,
      params
    );
    return rows;
  },

  async getForWeek(processId: string, weekStartDate: string, branchId?: string): Promise<RowDataPacket | null> {
    const params: unknown[] = [processId, weekStartDate];
    let branchCond = "AND branch_id IS NULL";
    if (branchId) { branchCond = "AND (branch_id = ? OR branch_id IS NULL)"; params.push(branchId); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM process_weekoff_day_rule
        WHERE process_id = ? AND week_start_date = ? AND is_active = 1 ${branchCond}
        ORDER BY branch_id DESC LIMIT 1`,
      params
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  async upsert(input: Record<string, unknown>, userId: string): Promise<RowDataPacket> {
    const { process_id, week_start_date } = input as any;
    if (!process_id || !week_start_date) throw new Error("process_id and week_start_date are required");

    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM process_weekoff_day_rule WHERE process_id = ? AND week_start_date = ? AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL)) AND is_active = 1 LIMIT 1",
      [process_id, week_start_date, input.branch_id ?? null, input.branch_id ?? null]
    );

    const id = (existing as RowDataPacket[])[0]?.id ?? randomUUID();
    const isNew = !(existing as RowDataPacket[])[0];

    const WRITABLE = new Set([
      "branch_id",
      "min_hc_monday", "min_hc_tuesday", "min_hc_wednesday", "min_hc_thursday",
      "min_hc_friday", "min_hc_saturday", "min_hc_sunday",
      "max_weekoff_monday", "max_weekoff_tuesday", "max_weekoff_wednesday",
      "max_weekoff_thursday", "max_weekoff_friday", "max_weekoff_saturday", "max_weekoff_sunday",
      "weekend_weekoff_allowed", "fcfs_enabled", "preference_priority_enabled",
      "fairness_rotation_enabled", "skill_based_restriction_enabled",
      "manager_override_allowed", "employee_rejection_allowed", "force_approval_allowed", "notes",
    ]);

    if (isNew) {
      const cols = ["id", "process_id", "week_start_date", "created_by"];
      const vals: unknown[] = [id, process_id, week_start_date, userId];
      for (const [k, v] of Object.entries(input)) {
        if (WRITABLE.has(k) && v !== undefined) { cols.push(k); vals.push(v); }
      }
      await db.execute(
        `INSERT INTO process_weekoff_day_rule (${cols.join(", ")}) VALUES (${vals.map(() => "?").join(", ")})`,
        vals
      );
    } else {
      const sets = ["updated_by = ?"];
      const vals: unknown[] = [userId];
      for (const [k, v] of Object.entries(input)) {
        if (WRITABLE.has(k) && v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
      }
      vals.push(id);
      await db.execute(`UPDATE process_weekoff_day_rule SET ${sets.join(", ")} WHERE id = ?`, vals);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM process_weekoff_day_rule WHERE id = ? LIMIT 1", [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  async delete(id: string, userId: string, reason: string): Promise<void> {
    if (!reason || reason.trim().length < 5) {
      throw new Error("delete_reason is required (minimum 5 characters)");
    }
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE process_weekoff_day_rule
          SET is_active = 0, deleted_by = ?, deleted_at = NOW(), delete_reason = ?
        WHERE id = ? AND is_active = 1`,
      [userId, reason.trim(), id]
    );
    if (!result.affectedRows) {
      throw new Error("Week-off day rule not found or already deleted");
    }
  },

  /**
   * Returns a 7-element capacity check array used by the auto week-off engine.
   * Combines process_weekoff_day_rule (min_hc floor) with
   * process_weekoff_capacity (max_weekoff_count ceiling) and
   * current weekoff_allocation_log counts.
   *
   * is_safe = (current_allocated < max_weekoff) AND (rostered_hc - 1 >= min_hc_required)
   * rostered_hc comes from wfm_roster_assignment count for that day — passed in by caller.
   */
  async getDayCapacityGrid(
    processId: string,
    weekStartDate: string,
    rosteredHcByDay: Record<number, number> // dayOfWeek 0-6 → count of scheduled employees
  ): Promise<DayCapacityCheck[]> {
    const rule = await this.getForWeek(processId, weekStartDate);

    // Process capacity limits
    const [capacityRows] = await db.execute<RowDataPacket[]>(
      "SELECT day_of_week, max_weekoff_count, max_weekoff_percentage FROM process_weekoff_capacity WHERE process_id = ?",
      [processId]
    );
    const capacityByDay = new Map((capacityRows as RowDataPacket[]).map((r) => [r.day_of_week, r]));

    // Current allocation counts for this week
    const [allocRows] = await db.execute<RowDataPacket[]>(
      `SELECT day_of_week, COUNT(*) AS allocated
         FROM weekoff_allocation_log
        WHERE process_id = ? AND allocation_date = ? AND allocation_status = 'allocated'
        GROUP BY day_of_week`,
      [processId, weekStartDate]
    );
    const allocByDay = new Map((allocRows as RowDataPacket[]).map((r) => [r.day_of_week, Number(r.allocated)]));

    return Array.from({ length: 7 }, (_, dow) => {
      const dayName = DAY_NAMES[dow];
      const minHcKey = `min_hc_${dayName}` as keyof typeof rule;
      const maxWoKey = `max_weekoff_${dayName}` as keyof typeof rule;

      const min_hc = rule ? (Number(rule[minHcKey]) || 0) : 0;

      // Use day_rule override if set, else fall back to process_weekoff_capacity
      const cap = capacityByDay.get(dow);
      const maxFromRule = rule ? (rule[maxWoKey] != null ? Number(rule[maxWoKey]) : null) : null;
      const maxFromCap = cap ? Number(cap.max_weekoff_count) : null;
      const max_weekoff_allowed = maxFromRule ?? maxFromCap;

      const current_allocated = allocByDay.get(dow) ?? 0;
      const rostered = rosteredHcByDay[dow] ?? 0;

      const underMaxWo = max_weekoff_allowed === null ? true : current_allocated < max_weekoff_allowed;
      const aboveMinHc = rostered - 1 >= min_hc;

      return {
        day_of_week: dow,
        day_name: DAY_NAMES[dow],
        min_hc_required: min_hc,
        max_weekoff_allowed,
        current_allocated,
        slots_remaining: max_weekoff_allowed !== null ? max_weekoff_allowed - current_allocated : null,
        is_safe: underMaxWo && aboveMinHc,
      };
    });
  },
};
