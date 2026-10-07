/**
 * Intervention cases: shared list builder, GET /cases, GET /:id (drill-down detail) and the
 * extra aggregates appended to GET /outcomes. Split from intervention-recommendation.service.ts
 * (already >800 lines). Table: employee_retention_recommendation (see migration 1556).
 */
import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db as pool } from "../../db/mysql.js";
import { readLobFilter } from "../../shared/lobFilter.js";
import { buildInterventionEmployeeFilter } from "./intervention-recommendation.service.js";
import {
  type CaseBucket,
  SLA_HOURS_SQL,
  TIERS,
  clampLimit,
  normalizeBucket,
  normalizeOwner,
  normalizeTier,
  NON_WORKING_STATUSES,
  isValidDateOnly,
  pctOf,
  slaHoursFor,
} from "./intervention-calc.js";

type Row = RowDataPacket & Record<string, any>;

const ACTIVE_EMPLOYEE_SQL = `e.employment_status = 'Active' AND e.active_status = 1`;
/** Only the newest case per employee counts as "open" — older rows are superseded. */
const LATEST_CASE_SQL = `NOT EXISTS (
  SELECT 1 FROM mas_hrms.employee_retention_recommendation r2
  WHERE r2.employee_id = r.employee_id
    AND (r2.generated_at > r.generated_at OR (r2.generated_at = r.generated_at AND r2.id > r.id)))`;
const OVERDUE_SQL = `TIMESTAMPDIFF(HOUR, r.generated_at, NOW()) > (${SLA_HOURS_SQL})`;

export function bucketWhere(bucket: CaseBucket): string {
  const open = `r.action_taken = 0 AND r.outcome = 'pending' AND ${ACTIVE_EMPLOYEE_SQL} AND ${LATEST_CASE_SQL}`;
  switch (bucket) {
    case "open":
      return open;
    case "overdue":
      return `${open} AND ${OVERDUE_SQL}`;
    case "actioned":
      return "r.action_taken = 1";
    case "retained":
      return `r.outcome = 'retained'`;
    case "exited":
      return `r.outcome = 'exited'`;
    default:
      return "1=1";
  }
}

export interface CaseQuery {
  bucket: CaseBucket;
  tier: string | null;
  owner: string | null;
  limit: number;
  weekStart?: string | null;
  emp: { sql: string; params: string[] };
}

export function buildCasesQuery(q: CaseQuery): {
  sql: string;
  params: (string | number)[];
} {
  const params: (string | number)[] = [];
  let extra = "";
  if (q.tier) {
    extra += " AND r.risk_tier = ?";
    params.push(q.tier);
  }
  if (q.owner) {
    extra += ` AND JSON_SEARCH(r.recommendations, 'one', ?, NULL, '$[*].owner') IS NOT NULL`;
    params.push(q.owner);
  }
  if (q.weekStart) {
    extra +=
      " AND r.generated_at >= ? AND r.generated_at < DATE_ADD(?, INTERVAL 7 DAY)";
    params.push(q.weekStart, q.weekStart);
  }
  params.push(...q.emp.params, q.limit);
  const sql = `
    SELECT r.id, r.employee_id, e.employee_code,
      COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
      COALESCE(bm.branch_name, '') AS branch_name, COALESCE(p.process_name, '') AS process_name,
      COALESCE(d.designation_name, '') AS designation_name,
      r.generated_at, DATEDIFF(NOW(), r.generated_at) AS days_since_generated,
      r.risk_tier, r.prediction_score, r.recommendations,
      r.action_taken, r.action_taken_at, r.outcome, r.outcome_date,
      (${SLA_HOURS_SQL}) AS sla_hours,
      CASE WHEN r.action_taken = 0 AND r.outcome = 'pending' AND ${OVERDUE_SQL} THEN 1 ELSE 0 END AS is_overdue
    FROM mas_hrms.employee_retention_recommendation r
    JOIN mas_hrms.employees e ON e.id = r.employee_id
    LEFT JOIN mas_hrms.branch_master bm ON bm.id = e.branch_id
    LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
    LEFT JOIN mas_hrms.designation_master d ON d.id = e.designation_id
    WHERE ${bucketWhere(q.bucket)}${extra} ${q.emp.sql}
    ORDER BY FIELD(r.risk_tier, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), r.prediction_score DESC, r.generated_at ASC
    LIMIT ?`;
  return { sql, params };
}

export function parseRecommendations(raw: unknown): any[] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** GET /cases?bucket=open|actioned|retained|exited|overdue|all&tier=&owner=&limit= */
export async function listInterventionCases(req: Request, res: Response) {
  try {
    const lob = readLobFilter(req, res);
    if (!lob) return;
    const bucket = normalizeBucket(req.query.bucket, "open");
    const q: CaseQuery = {
      bucket,
      tier: normalizeTier(req.query.tier),
      owner: normalizeOwner(req.query.owner),
      limit: clampLimit(req.query.limit),
      weekStart: isValidDateOnly(req.query.weekStart)
        ? req.query.weekStart
        : null,
      emp: buildInterventionEmployeeFilter(req.query, lob),
    };
    const { sql, params } = buildCasesQuery(q);
    const [rows] = await pool.query<Row[]>(sql, params);
    const data = rows.map((r) => ({
      ...r,
      recommendations: parseRecommendations(r.recommendations),
    }));
    res.json({
      success: true,
      bucket,
      count: data.length,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in listInterventionCases:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch intervention cases" });
  }
}

/** Extra aggregates for GET /outcomes (additive fields only). */
export async function getSummaryExtras(emp: { sql: string; params: string[] }) {
  const openWhere = bucketWhere("open");
  const base = `FROM mas_hrms.employee_retention_recommendation r
    JOIN mas_hrms.employees e ON e.id = r.employee_id WHERE `;
  const [tierRows] = await pool.query<Row[]>(
    `SELECT r.risk_tier AS tier, COUNT(*) AS n, SUM(CASE WHEN ${OVERDUE_SQL} THEN 1 ELSE 0 END) AS overdue
     ${base} ${openWhere} ${emp.sql} GROUP BY r.risk_tier`,
    emp.params,
  );
  const [ownerRows] = await pool.query<Row[]>(
    `SELECT
       SUM(JSON_SEARCH(r.recommendations,'one','hr_admin',NULL,'$[*].owner') IS NOT NULL) AS hr_admin,
       SUM(JSON_SEARCH(r.recommendations,'one','manager',NULL,'$[*].owner') IS NOT NULL) AS manager,
       SUM(JSON_SEARCH(r.recommendations,'one','wfm',NULL,'$[*].owner') IS NOT NULL) AS wfm,
       SUM(JSON_SEARCH(r.recommendations,'one','process_head',NULL,'$[*].owner') IS NOT NULL) AS process_head
     ${base} ${openWhere} ${emp.sql}`,
    emp.params,
  );
  // Weekly (Monday-start) generated vs actioned, last 12 weeks incl. current, filled with zeros.
  const [trendRows] = await pool.query<Row[]>(
    `SELECT DATE_FORMAT(DATE_SUB(DATE(r.generated_at), INTERVAL WEEKDAY(r.generated_at) DAY), '%Y-%m-%d') AS week_start,
            COUNT(*) AS gen_n, SUM(r.action_taken) AS act_n
     ${base} r.generated_at >= DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 11 WEEK) ${emp.sql}
     GROUP BY week_start ORDER BY week_start`,
    emp.params,
  );
  const [win] = await pool.query<Row[]>(
    `SELECT
       SUM(r.generated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS gen_7d,
       SUM(r.generated_at <  DATE_SUB(NOW(), INTERVAL 7 DAY) AND r.generated_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)) AS gen_prev_7d,
       SUM(r.action_taken_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS act_7d,
       SUM(r.action_taken_at <  DATE_SUB(NOW(), INTERVAL 7 DAY) AND r.action_taken_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)) AS act_prev_7d
     ${base} (r.generated_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) OR r.action_taken_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)) ${emp.sql}`,
    emp.params,
  );

  const byTier: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };
  let overdue = 0;
  for (const r of tierRows) {
    if (r.tier in byTier) byTier[r.tier] = Number(r.n) || 0;
    overdue += Number(r.overdue) || 0;
  }
  const o = ownerRows[0] ?? {};
  const w = win[0] ?? {};
  const num = (v: unknown) => Number(v) || 0;
  const openTotal = TIERS.reduce((s, t) => s + byTier[t], 0);
  return {
    open_total: openTotal,
    overdue_count: overdue,
    by_tier_open: byTier,
    by_owner_open: {
      hr_admin: num(o.hr_admin),
      manager: num(o.manager),
      wfm: num(o.wfm),
      process_head: num(o.process_head),
    },
    trend: trendRows.map((r) => ({
      week_start: r.week_start,
      generated: num(r.gen_n),
      actioned: num(r.act_n),
    })),
    windows: {
      generated_7d: num(w.gen_7d),
      generated_prev_7d: num(w.gen_prev_7d),
      actioned_7d: num(w.act_7d),
      actioned_prev_7d: num(w.act_prev_7d),
    },
    overdue_pct: pctOf(overdue, openTotal),
  };
}

/** GET /:id — full case detail for the drill-down drawer. */
export async function getInterventionDetail(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? "").trim();
    if (!id || id.length > 64)
      return res.status(400).json({ success: false, error: "Invalid id" });

    const [recRows] = await pool.query<Row[]>(
      `SELECT r.*, (${SLA_HOURS_SQL}) AS sla_hours
       FROM mas_hrms.employee_retention_recommendation r WHERE r.id = ? LIMIT 1`,
      [id],
    );
    const rec = recRows[0];
    if (!rec)
      return res
        .status(404)
        .json({ success: false, error: `Recommendation not found: ${id}` });
    const recommendations = parseRecommendations(rec.recommendations);
    const empId = rec.employee_id;

    const [empRows] = await pool.query<Row[]>(
      `SELECT e.id, e.employee_code,
         COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
         e.date_of_joining, DATEDIFF(NOW(), e.date_of_joining) AS aon_days, e.employment_status, e.active_status,
         e.reporting_manager_id, COALESCE(bm.branch_name, '') AS branch_name,
         COALESCE(p.process_name, '') AS process_name, COALESCE(d.designation_name, '') AS designation_name
       FROM mas_hrms.employees e
       LEFT JOIN mas_hrms.branch_master bm ON bm.id = e.branch_id
       LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
       LEFT JOIN mas_hrms.designation_master d ON d.id = e.designation_id
       WHERE e.id = ? LIMIT 1`,
      [empId],
    );
    const employee = empRows[0] ?? null;

    let managerName: string | null = null;
    if (employee?.reporting_manager_id) {
      const [m] = await pool.query<Row[]>(
        `SELECT COALESCE(NULLIF(TRIM(full_name), ''), TRIM(CONCAT(first_name, ' ', COALESCE(last_name, '')))) AS n
         FROM mas_hrms.employees WHERE id = ? LIMIT 1`,
        [employee.reporting_manager_id],
      );
      managerName = m[0]?.n ?? null;
    }

    const nw = NON_WORKING_STATUSES.map((s) => `'${s}'`).join(",");
    const [sig] = await pool.query<Row[]>(
      `SELECT
         SUM(CASE WHEN record_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY) AND attendance_status NOT IN (${nw}) THEN 1 ELSE 0 END) AS days60,
         SUM(CASE WHEN record_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY) AND attendance_status = 'present' THEN 1
                  WHEN record_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY) AND attendance_status = 'half_day' THEN 0.5 ELSE 0 END) AS credit60,
         SUM(CASE WHEN record_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND late_mark = 1 THEN 1 ELSE 0 END) AS late30
       FROM mas_hrms.attendance_daily_record
       WHERE employee_id = ? AND record_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)`,
      [empId],
    );
    const [weekly] = await pool.query<Row[]>(
      `SELECT DATE_FORMAT(DATE_SUB(record_date, INTERVAL WEEKDAY(record_date) DAY), '%Y-%m-%d') AS week_start,
         SUM(CASE WHEN attendance_status NOT IN (${nw}) THEN 1 ELSE 0 END) AS working,
         SUM(CASE WHEN attendance_status = 'present' THEN 1 WHEN attendance_status = 'half_day' THEN 0.5 ELSE 0 END) AS credit
       FROM mas_hrms.attendance_daily_record
       WHERE employee_id = ? AND record_date >= DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 WEEK)
       GROUP BY week_start ORDER BY week_start`,
      [empId],
    );
    let qualityPct: number | null = null;
    try {
      const [q] = await pool.query<Row[]>(
        `SELECT AVG(cqa.quality_percentage) AS q FROM db_audit.call_quality_assessment cqa
         JOIN mas_hrms.employees e ON e.employee_code = cqa.User
         WHERE e.id = ? AND cqa.CallDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [empId],
      );
      qualityPct =
        q[0]?.q == null ? null : Math.round(Number(q[0].q) * 10) / 10;
    } catch {
      qualityPct = null;
    }

    const [history] = await pool.query<Row[]>(
      `SELECT id, generated_at, risk_tier, prediction_score, action_taken, action_taken_at, outcome, outcome_date
       FROM mas_hrms.employee_retention_recommendation WHERE employee_id = ? ORDER BY generated_at DESC LIMIT 20`,
      [empId],
    );

    const [audit] = await pool.query<Row[]>(
      `SELECT id, actor_user_id, action_type, metadata_json, created_at FROM audit_action_log
       WHERE entity_type = 'employee_retention_recommendation' AND entity_id = ? ORDER BY created_at DESC LIMIT 20`,
      [id],
    );
    const actorIds = [
      ...new Set(
        [rec.action_taken_by, ...audit.map((a) => a.actor_user_id)].filter(
          Boolean,
        ),
      ),
    ];
    const actorNames: Record<string, string> = {};
    if (actorIds.length) {
      const [a] = await pool.query<Row[]>(
        `SELECT user_id, COALESCE(NULLIF(TRIM(full_name), ''), TRIM(CONCAT(first_name, ' ', COALESCE(last_name, '')))) AS n
         FROM mas_hrms.employees WHERE user_id IN (?)`,
        [actorIds],
      );
      for (const r of a) if (r.user_id) actorNames[r.user_id] = r.n;
    }
    const auditEntries = audit.map((a) => {
      let meta: any = null;
      try {
        meta =
          typeof a.metadata_json === "string"
            ? JSON.parse(a.metadata_json)
            : a.metadata_json;
      } catch {
        meta = null;
      }
      return {
        id: a.id,
        actor: actorNames[a.actor_user_id] ?? a.actor_user_id ?? null,
        action: a.action_type,
        at: a.created_at,
        notes: meta?.notes ?? null,
        outcome: meta?.outcome ?? null,
      };
    });

    const s = sig[0] ?? {};
    const days60 = Number(s.days60) || 0;
    const latestNotes =
      auditEntries.find(
        (a) => a.action === "intervention_action_taken" && a.notes,
      )?.notes ?? null;
    const timeline: Array<{
      at: string;
      event: string;
      actor: string | null;
      decision: string | null;
      remarks: string | null;
    }> = [
      {
        at: rec.generated_at,
        event: "Recommendation generated",
        actor: "System",
        decision: `${rec.risk_tier} (score ${rec.prediction_score})`,
        remarks: null,
      },
    ];
    if (rec.action_taken)
      timeline.push({
        at: rec.action_taken_at,
        event: "Action taken",
        actor: actorNames[rec.action_taken_by] ?? rec.action_taken_by ?? null,
        decision: "Actioned",
        remarks: latestNotes,
      });
    if (rec.outcome !== "pending")
      timeline.push({
        at: rec.outcome_date ?? rec.updated_at,
        event: "Outcome recorded",
        actor: null,
        decision: rec.outcome,
        remarks: null,
      });

    res.json({
      success: true,
      data: {
        record: {
          id: rec.id,
          employee_id: empId,
          generated_at: rec.generated_at,
          risk_tier: rec.risk_tier,
          prediction_score: rec.prediction_score,
          recommendations,
          action_taken: !!rec.action_taken,
          action_taken_at: rec.action_taken_at,
          action_taken_by: rec.action_taken_by,
          action_taken_by_name: actorNames[rec.action_taken_by] ?? null,
          action_notes: latestNotes,
          outcome: rec.outcome,
          outcome_date: rec.outcome_date,
          created_at: rec.created_at,
          updated_at: rec.updated_at,
          sla_hours:
            Number(rec.sla_hours) ||
            slaHoursFor(recommendations.map((r) => r.priority)),
        },
        employee: employee && { ...employee, manager_name: managerName },
        signals: {
          attendance_pct_60d: pctOf(Number(s.credit60) || 0, days60),
          quality_pct_30d: qualityPct,
          late_marks_30d: Number(s.late30) || 0,
          aon_days: employee?.aon_days ?? null,
        },
        attendance_trend: weekly.map((w) => ({
          week_start: w.week_start,
          pct: pctOf(Number(w.credit) || 0, Number(w.working) || 0),
        })),
        history,
        timeline,
        audit: auditEntries,
      },
    });
  } catch (error) {
    console.error("Error in getInterventionDetail:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch intervention detail" });
  }
}
