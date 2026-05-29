import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";

// ── Roster Swap ───────────────────────────────────────────────────────────────

export const rosterSwapService = {
  async list(filters: { status?: string; employee_id?: string }) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.status)      { conds.push("s.status = ?"); params.push(filters.status); }
    if (filters.employee_id) {
      conds.push("(s.requester_emp_id = ? OR s.swap_with_emp_id = ?)");
      params.push(filters.employee_id, filters.employee_id);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT s.*,
              CONCAT(e1.first_name, ' ', COALESCE(e1.last_name,'')) AS requester_name,
              CONCAT(e2.first_name, ' ', COALESCE(e2.last_name,'')) AS swap_with_name
       FROM wfm_roster_swap_request s
       JOIN employees e1 ON e1.id = s.requester_emp_id
       JOIN employees e2 ON e2.id = s.swap_with_emp_id
       WHERE ${conds.join(" AND ")} ORDER BY s.created_at DESC LIMIT 100`,
      params
    );
    return rows as RowDataPacket[];
  },

  async create(data: { requester_emp_id: string; swap_with_emp_id: string; swap_date: string; reason?: string }) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO wfm_roster_swap_request (id, requester_emp_id, swap_with_emp_id, swap_date, reason) VALUES (?, ?, ?, ?, ?)",
      [id, data.requester_emp_id, data.swap_with_emp_id, data.swap_date, data.reason ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM wfm_roster_swap_request WHERE id = ? LIMIT 1", [id]);
    return (rows as RowDataPacket[])[0];
  },

  async review(id: string, status: "approved" | "rejected", reviewedBy: string, req?: Request) {
    await db.execute(
      "UPDATE wfm_roster_swap_request SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
      [status, reviewedBy, id]
    );
    await logSensitiveAction({ actor_user_id: reviewedBy, action_type: "ROSTER_SWAP_REVIEWED", module_key: "WFM", entity_type: "wfm_roster_swap_request", entity_id: id, change_summary: { status }, req });
  },
};

// ── Roster Conflict Detection ─────────────────────────────────────────────────

export const rosterConflictService = {
  async list(filters: { resolved?: boolean; employee_id?: string }) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.resolved !== undefined) { conds.push("c.resolved = ?"); params.push(filters.resolved ? 1 : 0); }
    if (filters.employee_id) { conds.push("c.employee_id = ?"); params.push(filters.employee_id); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.*, CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS employee_name, e.employee_code
       FROM wfm_roster_conflict_log c JOIN employees e ON e.id = c.employee_id
       WHERE ${conds.join(" AND ")} ORDER BY c.conflict_date DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async log(data: { employee_id: string; conflict_date: string; conflict_type: string; description?: string }) {
    const id = randomUUID();
    await db.execute(
      "INSERT IGNORE INTO wfm_roster_conflict_log (id, employee_id, conflict_date, conflict_type, description) VALUES (?, ?, ?, ?, ?)",
      [id, data.employee_id, data.conflict_date, data.conflict_type, data.description ?? null]
    );
    return id;
  },

  async resolve(id: string, resolvedBy: string, req?: Request) {
    await db.execute("UPDATE wfm_roster_conflict_log SET resolved = 1 WHERE id = ?", [id]);
    await logSensitiveAction({ actor_user_id: resolvedBy, action_type: "ROSTER_CONFLICT_RESOLVED", module_key: "WFM", entity_type: "wfm_roster_conflict_log", entity_id: id, req });
  },
};

// ── Coverage / Shrinkage / Attrition ─────────────────────────────────────────

export const coverageService = {
  async upsertSnapshot(data: {
    snapshot_date: string;
    process_id?: string;
    branch_id?: string;
    planned_headcount: number;
    actual_headcount: number;
    absent_count: number;
    leave_count: number;
  }, createdBy?: string, req?: Request) {
    const id = randomUUID();
    const shrinkage = data.planned_headcount > 0
      ? Math.round(100 * (data.absent_count + data.leave_count) / data.planned_headcount * 100) / 100
      : 0;
    const coverage = data.planned_headcount > 0
      ? Math.round(100 * data.actual_headcount / data.planned_headcount * 100) / 100
      : 0;

    await db.execute(
      `INSERT INTO wfm_coverage_snapshot
         (id, snapshot_date, process_id, branch_id, planned_headcount, actual_headcount,
          absent_count, leave_count, shrinkage_pct, coverage_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         actual_headcount = VALUES(actual_headcount), absent_count = VALUES(absent_count),
         leave_count = VALUES(leave_count), shrinkage_pct = VALUES(shrinkage_pct),
         coverage_pct = VALUES(coverage_pct)`,
      [id, data.snapshot_date, data.process_id ?? null, data.branch_id ?? null,
       data.planned_headcount, data.actual_headcount, data.absent_count, data.leave_count,
       shrinkage, coverage]
    );
    if (createdBy) {
      await logSensitiveAction({ actor_user_id: createdBy, action_type: "COVERAGE_SNAPSHOT_UPSERTED", module_key: "WFM", entity_type: "wfm_coverage_snapshot", entity_id: id, change_summary: { snapshot_date: data.snapshot_date }, req });
    }
  },

  async getSnapshots(filters: { from_date?: string; to_date?: string; process_id?: string }) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.from_date)  { conds.push("snapshot_date >= ?");  params.push(filters.from_date); }
    if (filters.to_date)    { conds.push("snapshot_date <= ?");   params.push(filters.to_date); }
    if (filters.process_id) { conds.push("process_id = ?");       params.push(filters.process_id); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT s.*, p.process_name, b.branch_name FROM wfm_coverage_snapshot s
       LEFT JOIN process_master p ON p.id = s.process_id
       LEFT JOIN branch_master b ON b.id = s.branch_id
       WHERE ${conds.join(" AND ")} ORDER BY s.snapshot_date DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },
};

export const attritionService = {
  async recordExit(data: {
    employee_id: string;
    process_id?: string;
    branch_id?: string;
    exit_date: string;
    exit_type: string;
    tenure_days?: number;
    recorded_by: string;
    exit_request_id?: string;
  }, req?: Request) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO attrition_record (id, employee_id, process_id, branch_id, exit_date, exit_type, tenure_days, recorded_by, exit_request_id, is_provisional) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, data.employee_id, data.process_id ?? null, data.branch_id ?? null,
       data.exit_date, data.exit_type, data.tenure_days ?? null, data.recorded_by,
       data.exit_request_id ?? null, data.exit_request_id ? 0 : 1]
    );
    await logSensitiveAction({ actor_user_id: data.recorded_by, action_type: "ATTRITION_RECORDED", module_key: "WFM", entity_type: "attrition_record", entity_id: id, change_summary: { employee_id: data.employee_id, exit_type: data.exit_type }, req });
    return id;
  },

  async getSummary(filters: { from_date?: string; to_date?: string; process_id?: string }) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.from_date)  { conds.push("exit_date >= ?"); params.push(filters.from_date); }
    if (filters.to_date)    { conds.push("exit_date <= ?"); params.push(filters.to_date); }
    if (filters.process_id) { conds.push("process_id = ?"); params.push(filters.process_id); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT exit_type, COUNT(*) AS count,
              ROUND(AVG(tenure_days), 0) AS avg_tenure_days
       FROM attrition_record WHERE ${conds.join(" AND ")}
       GROUP BY exit_type ORDER BY count DESC`,
      params
    );
    return rows as RowDataPacket[];
  },
};
