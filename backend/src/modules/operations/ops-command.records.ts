import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildScopeWhereEmployees } from "../../shared/dashboardScope.js";
import {
  addDays,
  realRoster,
  type OpsCtx,
  type OpsDimension,
} from "./ops-command.context.js";
import {
  QA_TARGET_PCT,
  type OpsRecordDomain,
} from "./ops-command.definitions.js";
import {
  exitDateOf,
  exitedIn,
  groupKey,
  isActiveAt,
  loadView,
  type DimEmp,
} from "./ops-command.dim.js";
import * as F from "./ops-command.facts.js";
import { computeRiskScores } from "./ops-command.risk.js";
import { resolveNames } from "./ops-command.names.js";

export interface RecordColumn {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "pct";
}

export interface RecordsResult {
  domain: OpsRecordDomain;
  title: string;
  columns: RecordColumn[];
  rows: Array<Record<string, string | number | null>>;
  total: number;
}

type Rec = Record<string, string | number | null>;

const IDENTITY_COLS: RecordColumn[] = [
  { key: "employee_code", label: "Code" },
  { key: "full_name", label: "Name" },
  { key: "branch_name", label: "Branch" },
  { key: "process_name", label: "Process" },
  { key: "manager_name", label: "Manager" },
];

const tenureDays = (doj: string | null, on: string) =>
  doj
    ? Math.round(
        (Date.parse(`${on}T00:00:00Z`) - Date.parse(`${doj}T00:00:00Z`)) /
          86_400_000,
      )
    : null;

interface Item {
  e: DimEmp;
  detail: Rec;
  sort: number | string;
}

function build(
  domain: OpsRecordDomain,
  ctx: OpsCtx,
): Promise<{
  title: string;
  columns: RecordColumn[];
  items: Item[];
  desc?: boolean;
} | null> {
  return buildAsync(domain, ctx);
}

async function buildAsync(domain: OpsRecordDomain, ctx: OpsCtx) {
  const { from, to } = ctx.f;
  const attTo = to < ctx.attThrough ? to : ctx.attThrough;
  const view = await loadView(ctx);
  const byId = view.byId;

  switch (domain) {
    case "headcount":
      return {
        title: `Headcount on ${to}`,
        columns: [
          ...IDENTITY_COLS,
          { key: "date_of_joining", label: "Joined", type: "date" as const },
          {
            key: "tenure_days",
            label: "Tenure (days)",
            type: "number" as const,
          },
        ],
        items: view.emps
          .filter((e) => isActiveAt(e, to))
          .map((e) => ({
            e,
            detail: {
              date_of_joining: e.doj,
              tenure_days: tenureDays(e.doj, to),
            },
            sort: e.name,
          })),
      };
    case "joiners":
      return {
        title: `Joiners ${from} → ${to}`,
        columns: [
          ...IDENTITY_COLS,
          { key: "date_of_joining", label: "Joined", type: "date" as const },
          { key: "employment_status", label: "Status" },
        ],
        items: view.emps
          .filter(
            (e) =>
              e.doj &&
              e.doj >= from &&
              e.doj <= to &&
              e.status !== "not_joined",
          )
          .map((e) => ({
            e,
            detail: { date_of_joining: e.doj, employment_status: e.status },
            sort: e.doj!,
          })),
        desc: true,
      };
    case "exits": {
      const reqs = await F.exitRequests();
      return {
        title: `Exits ${from} → ${to}`,
        columns: [
          ...IDENTITY_COLS,
          { key: "exit_date", label: "Exit date", type: "date" as const },
          {
            key: "tenure_days",
            label: "Tenure (days)",
            type: "number" as const,
          },
          { key: "exit_type", label: "Type" },
          { key: "exit_reason", label: "Reason" },
          { key: "exit_status", label: "Exit status" },
        ],
        items: view.emps
          .filter((e) => e.status !== "not_joined" && exitedIn(e, from, to))
          .map((e) => {
            const er = F.latestExit(reqs, e.id);
            const x = exitDateOf(e)!;
            return {
              e,
              sort: x,
              detail: {
                exit_date: x,
                tenure_days: tenureDays(e.doj, x),
                exit_type: er?.type ?? e.status,
                exit_reason: er?.reason ?? null,
                exit_status: er?.status ?? e.status,
              },
            };
          }),
        desc: true,
      };
    }
    case "notice": {
      const reqs = await F.exitRequests();
      const items: Item[] = [];
      for (const e of view.emps) {
        if (e.active !== 1) continue;
        const er = reqs
          .get(e.id)
          ?.find((r) => F.isOpenNotice(r.status) || F.isPendingExit(r.status));
        if (er)
          items.push({
            e,
            sort: er.lwd ?? er.lwdProposed ?? "9999",
            detail: {
              exit_status: er.status,
              exit_type: er.type,
              exit_reason: er.reason,
              lwd: er.lwd ?? er.lwdProposed,
            },
          });
      }
      return {
        title: "On notice / resignations pending",
        columns: [
          ...IDENTITY_COLS,
          { key: "exit_status", label: "Exit status" },
          { key: "exit_type", label: "Type" },
          { key: "exit_reason", label: "Reason" },
          { key: "lwd", label: "Last working day", type: "date" as const },
        ],
        items,
      };
    }
    case "absent":
    case "late": {
      if (from > attTo) return null;
      const late = domain === "late";
      const agg = new Map<
        string,
        { a: number; m: number; h: number; l: number; lt: number }
      >();
      for (const r of await F.adrRows(from, attTo)) {
        if (!byId.has(r.eid)) continue;
        const x = agg.get(r.eid) ?? { a: 0, m: 0, h: 0, l: 0, lt: 0 };
        if (r.st === "absent") x.a++;
        if (r.st === "missing_punch" || r.st === "unreconciled") x.m++;
        if (r.st === "half_day") x.h++;
        if (r.st === "leave_approved") x.l++;
        if (r.late) x.lt++;
        agg.set(r.eid, x);
      }
      const items: Item[] = [];
      for (const [id, x] of agg) {
        if (late ? x.lt === 0 : x.a + x.m + x.h === 0) continue;
        items.push({
          e: byId.get(id)!,
          sort: late ? x.lt : x.a + x.m,
          detail: {
            absent_days: x.a,
            missing_days: x.m,
            half_days: x.h,
            leave_days: x.l,
            late_marks: x.lt,
          },
        });
      }
      return {
        title: late
          ? `Late marks ${from} → ${attTo}`
          : `Absence & missing punch ${from} → ${attTo}`,
        columns: [
          ...IDENTITY_COLS,
          { key: "absent_days", label: "Absent", type: "number" as const },
          {
            key: "missing_days",
            label: "Missing punch",
            type: "number" as const,
          },
          { key: "half_days", label: "Half days", type: "number" as const },
          { key: "leave_days", label: "Leave", type: "number" as const },
          { key: "late_marks", label: "Late marks", type: "number" as const },
        ],
        items,
        desc: true,
      };
    }
    case "unrostered": {
      const rostered = await F.rosteredEmployees(from, to);
      return {
        title: `Active employees with no roster ${from} → ${to}`,
        columns: [
          ...IDENTITY_COLS,
          { key: "date_of_joining", label: "Joined", type: "date" as const },
        ],
        items: view.emps
          .filter((e) => isActiveAt(e, to) && !rostered.has(e.id))
          .map((e) => ({
            e,
            detail: { date_of_joining: e.doj },
            sort: e.name,
          })),
      };
    }
    case "warnings": {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, DATE_FORMAT(warning_date,'%Y-%m-%d') AS d, category, severity FROM employee_warning WHERE status = 'active' AND warning_date BETWEEN ? AND ?`,
        [from, to],
      );
      return {
        title: `Active warnings ${from} → ${to}`,
        columns: [
          ...IDENTITY_COLS,
          { key: "warning_date", label: "Date", type: "date" as const },
          { key: "category", label: "Category" },
          { key: "severity", label: "Severity" },
        ],
        items: rows
          .filter((r) => byId.has(String(r.employee_id)))
          .map((r) => ({
            e: byId.get(String(r.employee_id))!,
            sort: String(r.d),
            detail: {
              warning_date: r.d,
              category: r.category,
              severity: r.severity,
            },
          })),
        desc: true,
      };
    }
    case "pip": {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, DATE_FORMAT(start_date,'%Y-%m-%d') AS s, DATE_FORMAT(end_date,'%Y-%m-%d') AS en, reason FROM pip_record WHERE status = 'active'`,
      );
      return {
        title: "Active PIPs",
        columns: [
          ...IDENTITY_COLS,
          { key: "start_date", label: "Start", type: "date" as const },
          { key: "end_date", label: "End", type: "date" as const },
          { key: "reason", label: "Reason" },
        ],
        items: rows
          .filter((r) => byId.get(String(r.employee_id))?.active === 1)
          .map((r) => ({
            e: byId.get(String(r.employee_id))!,
            sort: String(r.s ?? ""),
            detail: { start_date: r.s, end_date: r.en, reason: r.reason },
          })),
        desc: true,
      };
    }
    case "training_risk": {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, batch_name, mcq_best_score, readiness_score FROM lms_learner_progress WHERE attrition_risk_signal = 'red'`,
      );
      return {
        title: "Training learners at risk",
        columns: [
          ...IDENTITY_COLS,
          { key: "batch_name", label: "Batch" },
          { key: "mcq_best_score", label: "Best MCQ", type: "pct" as const },
          { key: "readiness_score", label: "Readiness", type: "pct" as const },
        ],
        items: rows
          .filter((r) => byId.get(String(r.employee_id))?.active === 1)
          .map((r) => ({
            e: byId.get(String(r.employee_id))!,
            sort: Number(r.readiness_score ?? 0),
            detail: {
              batch_name: r.batch_name,
              mcq_best_score: r.mcq_best_score,
              readiness_score: r.readiness_score,
            },
          })),
      };
    }
    case "at_risk": {
      const scores = await computeRiskScores(ctx, view);
      const items: Item[] = [];
      for (const [id, r] of scores) {
        if (r.level === "low") continue;
        items.push({
          e: byId.get(id)!,
          sort: r.score,
          detail: {
            risk_score: r.score,
            risk_level: r.level,
            reasons: r.reasons.join(" · "),
          },
        });
      }
      return {
        title: "At-risk agents (retention risk score)",
        columns: [
          ...IDENTITY_COLS,
          { key: "risk_score", label: "Score", type: "number" as const },
          { key: "risk_level", label: "Level" },
          { key: "reasons", label: "Why" },
        ],
        items,
        desc: true,
      };
    }
    case "low_quality": {
      const ext = await F.externalQuality(from, to);
      const items: Item[] = [];
      for (const r of ext.rows) {
        const e = view.byCode.get(r.code);
        const avg = r.n ? r.sum / r.n : null;
        if (e && avg !== null && avg < QA_TARGET_PCT)
          items.push({
            e,
            sort: avg,
            detail: {
              audits: r.n,
              avg_score: Math.round(avg * 10) / 10,
              fatal: r.fatal,
            },
          });
      }
      return {
        title: `Audited calls below ${QA_TARGET_PCT}% ${from} → ${to}`,
        columns: [
          ...IDENTITY_COLS,
          { key: "audits", label: "Audits", type: "number" as const },
          { key: "avg_score", label: "Avg score", type: "pct" as const },
          { key: "fatal", label: "Fatal", type: "number" as const },
        ],
        items,
      };
    }
    default:
      return null;
  }
}

export async function computeRecords(
  ctx: OpsCtx,
  domain: OpsRecordDomain,
  group: { dim?: OpsDimension; id?: string },
  limit: number,
  offset: number,
): Promise<RecordsResult | null> {
  const b = await build(domain, ctx);
  if (!b)
    return {
      domain,
      title: "Nothing in range",
      columns: IDENTITY_COLS,
      rows: [],
      total: 0,
    };
  let items = b.items;
  if (group.dim && group.dim !== "all" && group.id)
    items = items.filter((i) => groupKey(i.e, group.dim!) === group.id);
  const dir = b.desc ? -1 : 1;
  items.sort((x, y) =>
    typeof x.sort === "number" && typeof y.sort === "number"
      ? (x.sort - y.sort) * dir
      : String(x.sort).localeCompare(String(y.sort)) * dir,
  );
  const page = items.slice(offset, offset + limit);
  const [bn, pn, mn] = await Promise.all([
    resolveNames("branch", [
      ...new Set(page.map((i) => i.e.branch).filter((x): x is string => !!x)),
    ]),
    resolveNames("process", [
      ...new Set(page.map((i) => i.e.process).filter((x): x is string => !!x)),
    ]),
    resolveNames("manager", [
      ...new Set(page.map((i) => i.e.mgr).filter((x): x is string => !!x)),
    ]),
  ]);
  return {
    domain,
    title: b.title,
    columns: b.columns,
    total: items.length,
    rows: page.map((i) => ({
      employee_id: i.e.id,
      employee_code: i.e.code,
      full_name: i.e.name,
      branch_name: i.e.branch ? (bn.get(i.e.branch)?.name ?? null) : null,
      process_name: i.e.process ? (pn.get(i.e.process)?.name ?? null) : null,
      manager_name: i.e.mgr ? (mn.get(i.e.mgr)?.name ?? null) : null,
      ...i.detail,
    })),
  };
}

/** Employee 360: everything Operations holds about one person, row-scope checked first. */
export async function computeEmployeeDetail(ctx: OpsCtx, employeeId: string) {
  const sc = buildScopeWhereEmployees(ctx.scope, "e");
  const [head] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.employment_status, e.active_status, e.employment_type,
            dsg.designation_name AS designation, DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') AS date_of_joining,
            DATE_FORMAT(COALESCE(e.date_of_exit, e.date_of_leaving),'%Y-%m-%d') AS exit_date,
            bm.branch_name, pm.process_name, lm.lob_name, mg.full_name AS manager_name, mg.employee_code AS manager_code
       FROM employees e
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN lob_master lm ON lm.id = e.lob_id
       LEFT JOIN designation_master dsg ON dsg.id = e.designation_id
       LEFT JOIN employees mg ON mg.id = e.reporting_manager_id
      WHERE e.id = ? AND ${sc.sql}`,
    [employeeId, ...sc.params],
  );
  if (!head[0]) return null;

  const to = ctx.f.to;
  const since = addDays(to, -29);
  const q = <T extends RowDataPacket>(sql: string, params: unknown[]) =>
    db.execute<T[]>(sql, params).then(([r]) => r);
  const [
    attendance,
    roster,
    exits,
    warnings,
    pips,
    learning,
    audits,
    kpis,
    breaks,
  ] = await Promise.all([
    q(
      `SELECT DATE_FORMAT(record_date,'%Y-%m-%d') AS date, attendance_status AS status, late_mark, late_by_minutes,
              DATE_FORMAT(clock_in_time,'%H:%i') AS clock_in, DATE_FORMAT(clock_out_time,'%H:%i') AS clock_out,
              COALESCE(raw_minutes, biometric_minutes, dialler_minutes) AS minutes
         FROM attendance_daily_record WHERE employee_id = ? AND record_date BETWEEN ? AND ? ORDER BY record_date DESC`,
      [employeeId, since, to],
    ),
    q(
      `SELECT DATE_FORMAT(ra.roster_date,'%Y-%m-%d') AS date, COALESCE(ra.assignment_type, IF(ra.is_week_off=1,'WEEK_OFF','SHIFT')) AS type,
              TIME_FORMAT(ra.shift_start_time,'%H:%i') AS shift_start, TIME_FORMAT(ra.shift_end_time,'%H:%i') AS shift_end,
              ra.publish_status, ra.employee_ack_status
         FROM wfm_roster_assignment ra
        WHERE ra.employee_id = ? AND ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")} ORDER BY ra.roster_date`,
      [employeeId, addDays(to, -6), addDays(to, 14)],
    ),
    q(
      `SELECT er.status, er.exit_type, er.exit_sub_type, er.exit_reason_category, er.resignation_reason,
              DATE_FORMAT(er.submitted_at,'%Y-%m-%d') AS submitted,
              DATE_FORMAT(er.last_working_day_confirmed,'%Y-%m-%d') AS lwd, er.notice_period_days
         FROM exit_request er WHERE er.employee_id = ? ORDER BY er.created_at DESC LIMIT 5`,
      [employeeId],
    ),
    q(
      `SELECT DATE_FORMAT(warning_date,'%Y-%m-%d') AS date, category, severity, status FROM employee_warning
        WHERE employee_id = ? ORDER BY warning_date DESC LIMIT 10`,
      [employeeId],
    ),
    q(
      `SELECT status, DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date, DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date, reason
         FROM pip_record WHERE employee_id = ? ORDER BY start_date DESC LIMIT 5`,
      [employeeId],
    ),
    q(
      `SELECT batch_name, mcq_best_score, readiness_score, attrition_risk_signal, ops_handover_ready
         FROM lms_learner_progress WHERE employee_id = ?`,
      [employeeId],
    ),
    q(
      `SELECT DATE_FORMAT(audit_date,'%Y-%m-%d') AS date, quality_percentage, fatal_triggered, status
         FROM qa_audit WHERE employee_id = ? ORDER BY audit_date DESC LIMIT 10`,
      [employeeId],
    ),
    q(
      `SELECT m.metric_code, m.metric_name, m.unit, COUNT(*) AS days, AVG(k.actual_value) AS avg_value,
              SUBSTRING_INDEX(GROUP_CONCAT(k.actual_value ORDER BY k.score_date DESC), ',', 1) AS latest
         FROM kpi_daily_actual k JOIN kpi_metric_master m ON m.id = k.metric_id
        WHERE k.employee_id = ? AND k.score_date BETWEEN ? AND ? GROUP BY m.id, m.metric_code, m.metric_name, m.unit
        ORDER BY m.metric_name`,
      [employeeId, since, to],
    ),
    q(
      `SELECT DATE_FORMAT(shift_date,'%Y-%m-%d') AS date, total_break_minutes, exceeded_break_count, final_status
         FROM break_daily_summary WHERE employee_id = ? AND shift_date BETWEEN ? AND ? ORDER BY shift_date DESC`,
      [employeeId, addDays(to, -13), to],
    ),
  ]);
  return {
    profile: head[0],
    attendance,
    roster,
    exits,
    warnings,
    pips,
    learning,
    audits,
    kpis,
    breaks,
    window: { from: since, to },
  };
}

/** Cheap row-scope probe: an out-of-scope employee is indistinguishable from a missing one. */
export async function employeeInScope(
  ctx: OpsCtx,
  employeeId: string,
): Promise<boolean> {
  const sc = buildScopeWhereEmployees(ctx.scope, "e");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM employees e WHERE e.id = ? AND ${sc.sql} LIMIT 1`,
    [employeeId, ...sc.params],
  );
  return rows.length > 0;
}
