import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";

type ScopeFilter = { sql?: string; params?: unknown[] };

function monthBounds(month?: string) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
  const from = `${month}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const to = d.toISOString().slice(0, 10);
  return { from, to };
}

function exitTypeFromPayload(data: any): string {
  if (data.exit_type) return String(data.exit_type);
  const reason = String(data.reason_category ?? "");
  if (["absconding", "contract_end"].includes(reason)) return reason;
  if (reason === "termination") return "involuntary";
  return data.is_voluntary === false ? "involuntary" : "voluntary";
}

export const rosterSwapService = {
  async list(filters: { status?: string; employee_id?: string } & ScopeFilter) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.status) { conds.push("s.status = ?"); params.push(filters.status); }
    if (filters.employee_id) {
      conds.push("(s.requester_emp_id = ? OR s.swap_with_emp_id = ?)");
      params.push(filters.employee_id, filters.employee_id);
    }
    if (filters.sql) {
      conds.push(`(${filters.sql.replace(/\be\./g, "e1.")}) OR (${filters.sql.replace(/\be\./g, "e2.")})`);
      params.push(...(filters.params ?? []), ...(filters.params ?? []));
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT s.id,
              s.requester_emp_id AS requester_employee_id,
              s.swap_with_emp_id AS target_employee_id,
              DATE_FORMAT(s.swap_date, '%Y-%m-%d') AS swap_date,
              '' AS shift_id,
              '' AS shift_name,
              s.reason,
              s.status,
              s.created_at,
              COALESCE(NULLIF(e1.full_name, ''), CONCAT_WS(' ', e1.first_name, e1.last_name)) AS requester_name,
              COALESCE(NULLIF(e2.full_name, ''), CONCAT_WS(' ', e2.first_name, e2.last_name)) AS target_name
         FROM wfm_roster_swap_request s
         JOIN employees e1 ON e1.id = s.requester_emp_id
         JOIN employees e2 ON e2.id = s.swap_with_emp_id
        WHERE ${conds.join(" AND ")}
        ORDER BY s.created_at DESC
        LIMIT 200`,
      params,
    );
    return rows;
  },

  async create(data: { requester_emp_id: string; swap_with_emp_id: string; swap_date: string; reason?: string }) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO wfm_roster_swap_request
         (id, requester_emp_id, swap_with_emp_id, swap_date, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [id, data.requester_emp_id, data.swap_with_emp_id, data.swap_date, data.reason ?? null],
    );
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM wfm_roster_swap_request WHERE id = ? LIMIT 1", [id]);
    return rows[0];
  },

  async review(id: string, status: "approved" | "rejected", reviewedBy: string, req?: Request) {
    await db.execute(
      "UPDATE wfm_roster_swap_request SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
      [status, reviewedBy, id],
    );
    await logSensitiveAction({ actor_user_id: reviewedBy, action_type: "ROSTER_SWAP_REVIEWED", module_key: "WFM", entity_type: "wfm_roster_swap_request", entity_id: id, change_summary: { status }, req });
  },
};

export const rosterConflictService = {
  async list(filters: { status?: string; resolved?: boolean; employee_id?: string; date_from?: string; date_to?: string } & ScopeFilter) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.status === "open") { conds.push("c.resolved = 0"); }
    if (filters.status === "resolved") { conds.push("c.resolved = 1"); }
    if (filters.resolved !== undefined) { conds.push("c.resolved = ?"); params.push(filters.resolved ? 1 : 0); }
    if (filters.employee_id) { conds.push("c.employee_id = ?"); params.push(filters.employee_id); }
    if (filters.date_from) { conds.push("c.conflict_date >= ?"); params.push(filters.date_from); }
    if (filters.date_to) { conds.push("c.conflict_date <= ?"); params.push(filters.date_to); }
    if (filters.sql) { conds.push(`(${filters.sql})`); params.push(...(filters.params ?? [])); }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.*,
              DATE_FORMAT(c.conflict_date, '%Y-%m-%d') AS conflict_date,
              COALESCE(NULLIF(e.full_name, ''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
              e.employee_code
         FROM wfm_roster_conflict_log c
         JOIN employees e ON e.id = c.employee_id
        WHERE ${conds.join(" AND ")}
        ORDER BY c.conflict_date DESC, c.detected_at DESC
        LIMIT 200`,
      params,
    );

    return rows.map((row: any) => ({
      id: row.id,
      conflict_type: row.conflict_type,
      conflict_date: row.conflict_date,
      employees_involved: [row.employee_id],
      employee_names: [row.employee_name ?? row.employee_code ?? row.employee_id],
      severity: String(row.conflict_type ?? "").toLowerCase().includes("overlap") ? "high" : "medium",
      status: row.resolved ? "resolved" : "open",
      resolution_remarks: row.description ?? null,
      created_at: row.detected_at,
    }));
  },

  async log(data: { employee_id: string; conflict_date: string; conflict_type: string; description?: string }) {
    const id = randomUUID();
    await db.execute(
      "INSERT IGNORE INTO wfm_roster_conflict_log (id, employee_id, conflict_date, conflict_type, description) VALUES (?, ?, ?, ?, ?)",
      [id, data.employee_id, data.conflict_date, data.conflict_type, data.description ?? null],
    );
    return id;
  },

  async resolve(id: string, resolvedBy: string, req?: Request) {
    await db.execute("UPDATE wfm_roster_conflict_log SET resolved = 1 WHERE id = ?", [id]);
    await logSensitiveAction({ actor_user_id: resolvedBy, action_type: "ROSTER_CONFLICT_RESOLVED", module_key: "WFM", entity_type: "wfm_roster_conflict_log", entity_id: id, req });
  },
};

export const coverageService = {
  async summarize(filters: { date?: string; from_date?: string; to_date?: string; process_id?: string; branch_id?: string } & ScopeFilter) {
    const date = filters.date ?? filters.from_date ?? new Date().toISOString().slice(0, 10);
    const conds = ["s.snapshot_date = ?"];
    const params: unknown[] = [date];
    if (filters.process_id) { conds.push("s.process_id = ?"); params.push(filters.process_id); }
    if (filters.branch_id) { conds.push("s.branch_id = ?"); params.push(filters.branch_id); }

    const [snapshotRows] = await db.execute<RowDataPacket[]>(
      `SELECT s.*, p.process_name, b.branch_name
         FROM wfm_coverage_snapshot s
         LEFT JOIN process_master p ON p.id = s.process_id
         LEFT JOIN branch_master b ON b.id = s.branch_id
        WHERE ${conds.join(" AND ")}
        ORDER BY s.created_at DESC
        LIMIT 200`,
      params,
    );

    if (snapshotRows.length > 0) {
      const required = snapshotRows.reduce((sum: number, r: any) => sum + Number(r.planned_headcount ?? 0), 0);
      const available = snapshotRows.reduce((sum: number, r: any) => sum + Number(r.actual_headcount ?? 0), 0);
      return {
        required_headcount: required,
        available_headcount: available,
        coverage_pct: required > 0 ? Math.round((available / required) * 10000) / 100 : 0,
        gaps: snapshotRows
          .filter((r: any) => Number(r.planned_headcount ?? 0) > Number(r.actual_headcount ?? 0))
          .map((r: any) => ({
            process: r.process_name,
            branch: r.branch_name,
            gap_count: Math.max(0, Number(r.planned_headcount ?? 0) - Number(r.actual_headcount ?? 0)),
            note: `Shrinkage ${Number(r.shrinkage_pct ?? 0).toFixed(2)}%`,
          })),
        data: snapshotRows,
      };
    }

    const rosterConds = ["a.roster_date = ?"];
    const rosterParams: unknown[] = [date];
    if (filters.process_id) { rosterConds.push("e.process_id = ?"); rosterParams.push(filters.process_id); }
    if (filters.branch_id) { rosterConds.push("e.branch_id = ?"); rosterParams.push(filters.branch_id); }
    if (filters.sql) { rosterConds.push(`(${filters.sql})`); rosterParams.push(...(filters.params ?? [])); }

    const [liveRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.process_id, e.branch_id, p.process_name, b.branch_name,
              COUNT(DISTINCT a.employee_id) AS planned_headcount,
              COUNT(DISTINCT CASE WHEN ad.attendance_status IN ('present','half_day') THEN ad.employee_id END) AS actual_headcount,
              COUNT(DISTINCT CASE WHEN ad.attendance_status = 'absent' THEN ad.employee_id END) AS absent_count,
              COUNT(DISTINCT CASE WHEN ad.attendance_status = 'leave_approved' THEN ad.employee_id END) AS leave_count
         FROM wfm_roster_assignment a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN attendance_daily_record ad ON ad.employee_id = a.employee_id AND ad.record_date = a.roster_date
         LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE ${rosterConds.join(" AND ")}
        GROUP BY e.process_id, e.branch_id, p.process_name, b.branch_name`,
      rosterParams,
    );

    const required = liveRows.reduce((sum: number, r: any) => sum + Number(r.planned_headcount ?? 0), 0);
    const available = liveRows.reduce((sum: number, r: any) => sum + Number(r.actual_headcount ?? 0), 0);
    return {
      required_headcount: required,
      available_headcount: available,
      coverage_pct: required > 0 ? Math.round((available / required) * 10000) / 100 : 0,
      gaps: liveRows
        .filter((r: any) => Number(r.planned_headcount ?? 0) > Number(r.actual_headcount ?? 0))
        .map((r: any) => ({ process: r.process_name, branch: r.branch_name, gap_count: Math.max(0, Number(r.planned_headcount ?? 0) - Number(r.actual_headcount ?? 0)), note: "Computed from roster vs attendance" })),
      data: liveRows,
    };
  },

  async upsertSnapshot(data: { snapshot_date: string; process_id?: string; branch_id?: string; planned_headcount: number; actual_headcount: number; absent_count: number; leave_count: number }, createdBy?: string, req?: Request) {
    const id = randomUUID();
    const shrinkage = data.planned_headcount > 0 ? Math.round(((data.absent_count + data.leave_count) / data.planned_headcount) * 10000) / 100 : 0;
    const coverage = data.planned_headcount > 0 ? Math.round((data.actual_headcount / data.planned_headcount) * 10000) / 100 : 0;
    await db.execute(
      `INSERT INTO wfm_coverage_snapshot
         (id, snapshot_date, process_id, branch_id, planned_headcount, actual_headcount, absent_count, leave_count, shrinkage_pct, coverage_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         actual_headcount = VALUES(actual_headcount), absent_count = VALUES(absent_count), leave_count = VALUES(leave_count), shrinkage_pct = VALUES(shrinkage_pct), coverage_pct = VALUES(coverage_pct)`,
      [id, data.snapshot_date, data.process_id ?? null, data.branch_id ?? null, data.planned_headcount, data.actual_headcount, data.absent_count, data.leave_count, shrinkage, coverage],
    );
    if (createdBy) await logSensitiveAction({ actor_user_id: createdBy, action_type: "COVERAGE_SNAPSHOT_UPSERTED", module_key: "WFM", entity_type: "wfm_coverage_snapshot", entity_id: id, change_summary: { snapshot_date: data.snapshot_date }, req });
  },
};

export const attritionService = {
  async recordExit(data: any, req?: Request) {
    const [empRows] = await db.execute<RowDataPacket[]>("SELECT process_id, branch_id, date_of_joining FROM employees WHERE id = ? LIMIT 1", [data.employee_id]);
    const emp = empRows[0] as any;
    if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    const tenureDays = emp.date_of_joining ? Math.max(0, Math.floor((new Date(data.exit_date).getTime() - new Date(emp.date_of_joining).getTime()) / 86400000)) : null;
    const id = randomUUID();
    const exitType = exitTypeFromPayload(data);
    await db.execute(
      "INSERT INTO attrition_record (id, employee_id, process_id, branch_id, exit_date, exit_type, tenure_days, recorded_by, exit_request_id, is_provisional) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, data.employee_id, data.process_id ?? emp.process_id ?? null, data.branch_id ?? emp.branch_id ?? null, data.exit_date, exitType, data.tenure_days ?? tenureDays, data.recorded_by, data.exit_request_id ?? null, data.exit_request_id ? 0 : 1],
    );
    await logSensitiveAction({ actor_user_id: data.recorded_by, action_type: "ATTRITION_RECORDED", module_key: "WFM", entity_type: "attrition_record", entity_id: id, change_summary: { employee_id: data.employee_id, exit_type: exitType, reason_category: data.reason_category ?? null }, req });
    return id;
  },

  async getSummary(filters: { month?: string; from_date?: string; to_date?: string; process_id?: string } & ScopeFilter) {
    const bounds = monthBounds(filters.month);
    const from = filters.from_date ?? bounds?.from;
    const toExclusive = filters.to_date ?? bounds?.to;
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (from) { conds.push("ar.exit_date >= ?"); params.push(from); }
    if (toExclusive) { conds.push("ar.exit_date < ?"); params.push(toExclusive); }
    if (filters.process_id) { conds.push("ar.process_id = ?"); params.push(filters.process_id); }
    if (filters.sql) { conds.push(`(${filters.sql})`); params.push(...(filters.params ?? [])); }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ar.exit_type, COUNT(*) AS count
         FROM attrition_record ar
         JOIN employees e ON e.id = ar.employee_id
        WHERE ${conds.join(" AND ")}
        GROUP BY ar.exit_type
        ORDER BY count DESC`,
      params,
    );

    const total = rows.reduce((sum: number, row: any) => sum + Number(row.count ?? 0), 0);
    const voluntary = rows.filter((row: any) => row.exit_type === "voluntary").reduce((sum: number, row: any) => sum + Number(row.count ?? 0), 0);
    const involuntary = total - voluntary;

    const empConds = ["e.active_status = 1"];
    const empParams: unknown[] = [];
    if (filters.process_id) { empConds.push("e.process_id = ?"); empParams.push(filters.process_id); }
    if (filters.sql) { empConds.push(`(${filters.sql})`); empParams.push(...(filters.params ?? [])); }
    const [headRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total_active FROM employees e WHERE ${empConds.join(" AND ")}`, empParams);
    const denominator = Number(headRows[0]?.total_active ?? 0);

    return {
      total_exits: total,
      voluntary,
      involuntary,
      attrition_rate: denominator > 0 ? Math.round((total / denominator) * 10000) / 100 : 0,
      by_reason: rows.map((row: any) => ({ reason: row.exit_type, count: Number(row.count ?? 0), pct: total > 0 ? Math.round((Number(row.count ?? 0) / total) * 10000) / 100 : 0 })),
    };
  },
};
