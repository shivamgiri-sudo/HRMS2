/**
 * Operations & Quality executor
 *
 * Covers codes: agent-performance-summary, team-performance-summary,
 * quality-audit-log, fatal-error-register
 *
 * Primary tenant guard uses ksr.company_id or e.company_id depending on the
 * driving table. appendScopeConditions (alias "e") is used where the
 * employees table is in scope; for kpi_score_record the scope conditions on
 * branch/process are applied via the employee join.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { querySource } from "../../../db/sourceDb.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  monthParam,
  applyPagination,
  ReportScopeAccessDeniedError,
  rethrowReportSchemaError,
} from "./types.js";

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows;
  } catch (err: unknown) {
    rethrowReportSchemaError("operations", err, sql);
  }
}

async function count(baseSql: string, params: unknown[]): Promise<number> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
      params
    );
    return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
  } catch (err: unknown) {
    // This one returned a literal 0 — the exact shape the readiness audit calls out. A
    // fatal-error-register or quality-audit-log that answers "0" because a column was
    // renamed is worse than one that errors: zero fatal errors is the result everybody
    // hopes for, so nobody checks it.
    rethrowReportSchemaError("operations", err, baseSql);
  }
}

// ---------------------------------------------------------------------------
// agent-performance-summary
// Source: Shivamgiri.v_call_master_unified_kpi (cross-DB via sourceDb)
// Columns: User (emp code), CallDate, quality_score, total_calls + db_audit for audited count
// Scope: resolve employee codes from mas_hrms first, then filter Shivamgiri view
// ---------------------------------------------------------------------------
export async function agentPerformanceSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const scoreMonth = monthParam(filters.month);
  const from = `${scoreMonth}-01`;
  const to   = new Date(new Date(from).getFullYear(),
    new Date(from).getMonth() + 1, 0).toISOString().slice(0, 10);

  // Resolve scoped employee codes from mas_hrms
  // active_status = 1 is load-bearing here, not cosmetic. Without it this resolved all 58,627
  // employee rows ever created and then sent an IN list of 58,627 placeholders to
  // Shivamgiri.v_call_master_unified_kpi — a 1.36M-row view on which an unbounded scan takes
  // ~248s. Both this report and team-performance-summary simply died at the client timeout.
  // Scoped to the 1,125 active employees the same query returns in milliseconds.
  const eClauses: string[] = ["e.active_status = 1"];
  const eParams: unknown[]  = [];
  appendScopeConditions(scope, eClauses, eParams);
  appendFilterConditions(filters, eClauses, eParams);

  const empSql = `SELECT e.employee_code,
    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
    FROM mas_hrms.employees e
    LEFT JOIN mas_hrms.branch_master b ON b.id = e.branch_id
    LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
    LEFT JOIN mas_hrms.cost_centre_master cc ON cc.id = e.cost_centre_id
   WHERE ${eClauses.join(" AND ")}`;
  const empRows = await querySource<{ employee_code: string; employee_name: string; branch_name: string; process_name: string; cost_centre_code: string; cost_centre_name: string }>(
    empSql, eParams as (string|number|null)[]
  );
  if (empRows.length === 0) return { rows: [], rowCount: 0, isTruncated: false };

  const empMap = new Map(empRows.map(r => [r.employee_code, r]));
  const codes = empRows.map(r => r.employee_code);
  const placeholders = codes.map(() => "?").join(",");
  const qParams: (string|number|null)[] = [...codes, from, to];

  let cursorClause = "";
  if (options.mode === "worker" && options.cursor != null) {
    // Cursor is employee_code (string), so filter by agent_employee_code in WHERE before GROUP BY.
    // The previous HAVING MIN(kpi.call_date) > employee_code always produced NULL and
    // silently truncated exports after the first chunk.
    cursorClause = ` AND kpi.agent_employee_code > ?`;
    qParams.push(options.cursor as string);
  }

  // Column names here are the Call Master view's, not this database's. The query referenced
  // kpi.User and kpi.CallDate — PascalCase names from an older shape of
  // Shivamgiri.v_call_master_unified_kpi — and the live view exposes neither, so both
  // agent-performance-summary and team-performance-summary 500'd with "Unknown column
  // 'kpi.User'". The view's 19 columns include agent_employee_code and call_date; verified
  // against the live source rather than inferred from the alias.
  const sql = `
    SELECT kpi.agent_employee_code AS employee_code,
           LEFT(kpi.call_date, 7) AS score_month,
           COUNT(*) AS total_calls,
           ROUND(AVG(kpi.quality_score) * 100, 2) AS avg_quality_score,
           MAX(kpi.quality_score) * 100 AS max_quality_score,
           MIN(kpi.quality_score) * 100 AS min_quality_score,
           CASE WHEN AVG(kpi.quality_score) >= 0.90 THEN 'Excellent'
                WHEN AVG(kpi.quality_score) >= 0.80 THEN 'Good'
                WHEN AVG(kpi.quality_score) >= 0.70 THEN 'Average'
                ELSE 'Poor' END AS quality_band
      FROM Shivamgiri.v_call_master_unified_kpi kpi
     WHERE kpi.agent_employee_code IN (${placeholders})
       AND kpi.call_date BETWEEN ? AND ?${cursorClause}
     GROUP BY kpi.agent_employee_code, LEFT(kpi.call_date, 7)
     ORDER BY kpi.agent_employee_code ASC
     LIMIT ${options.limit} OFFSET ${options.mode === "worker" ? 0 : options.offset}`;

  const rows = await querySource<Record<string,unknown>>(sql, qParams);
  // Enrich with employee name / branch / process from mas_hrms lookup
  const enriched = rows.map(r => {
    const info = empMap.get(r.employee_code as string);
    return { ...r, employee_name: info?.employee_name, branch_name: info?.branch_name,
            process_name: info?.process_name,
            cost_centre_code: info?.cost_centre_code, cost_centre_name: info?.cost_centre_name };
  });
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? String(rows[rows.length - 1].employee_code ?? "") : null;
  return { rows: enriched, rowCount: enriched.length, isTruncated: enriched.length === options.limit, nextCursor };
}

// ---------------------------------------------------------------------------
// team-performance-summary (aggregate — no cursor)
// Source: Shivamgiri.v_call_master_unified_kpi, grouped by team lead
// ---------------------------------------------------------------------------
export async function teamPerformanceSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const scoreMonth = monthParam(filters.month);
  const from = `${scoreMonth}-01`;
  const to   = new Date(new Date(from).getFullYear(),
    new Date(from).getMonth() + 1, 0).toISOString().slice(0, 10);

  // Resolve scoped employees with manager info
  // active_status = 1 is load-bearing here, not cosmetic. Without it this resolved all 58,627
  // employee rows ever created and then sent an IN list of 58,627 placeholders to
  // Shivamgiri.v_call_master_unified_kpi — a 1.36M-row view on which an unbounded scan takes
  // ~248s. Both this report and team-performance-summary simply died at the client timeout.
  // Scoped to the 1,125 active employees the same query returns in milliseconds.
  const eClauses: string[] = ["e.active_status = 1"];
  const eParams: unknown[]  = [];
  appendScopeConditions(scope, eClauses, eParams);
  appendFilterConditions(filters, eClauses, eParams);

  const empSql = `SELECT e.employee_code,
    COALESCE(NULLIF(tm.full_name,''), CONCAT(tm.first_name,' ',COALESCE(tm.last_name,''))) AS team_lead_name,
    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
    FROM mas_hrms.employees e
    LEFT JOIN mas_hrms.employees tm ON tm.id = COALESCE(e.reporting_manager_id, e.manager_id)
    LEFT JOIN mas_hrms.branch_master b ON b.id = e.branch_id
    LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
    LEFT JOIN mas_hrms.cost_centre_master cc ON cc.id = e.cost_centre_id
   WHERE ${eClauses.join(" AND ")}`;
  const empRows = await querySource<{ employee_code: string; team_lead_name: string; branch_name: string; process_name: string; cost_centre_code: string; cost_centre_name: string }>(
    empSql, eParams as (string|number|null)[]
  );
  if (empRows.length === 0) return { rows: [], rowCount: 0, isTruncated: false };

  const codes = empRows.map(r => r.employee_code);
  // Group by team lead using application-side grouping (avoids cross-DB GROUP BY complexity)
  const teamMap = new Map<string, { team_lead_name: string; branch_name: string; process_name: string; codes: string[] }>();
  for (const r of empRows) {
    const key = `${r.team_lead_name}||${r.branch_name}||${r.process_name}`;
    if (!teamMap.has(key)) teamMap.set(key, { team_lead_name: r.team_lead_name, branch_name: r.branch_name, process_name: r.process_name, codes: [] });
    teamMap.get(key)!.codes.push(r.employee_code);
  }

  const placeholders = codes.map(() => "?").join(",");
  const kpiSql = `
    SELECT kpi.agent_employee_code AS employee_code,
           ROUND(AVG(kpi.quality_score) * 100, 2) AS avg_score
      FROM Shivamgiri.v_call_master_unified_kpi kpi
     WHERE kpi.agent_employee_code IN (${placeholders})
       AND kpi.call_date BETWEEN ? AND ?
     GROUP BY kpi.agent_employee_code`;
  const kpiRows = await querySource<{ employee_code: string; avg_score: number }>(
    kpiSql, [...codes, from, to] as (string|number|null)[]
  );
  const kpiMap = new Map(kpiRows.map(r => [r.employee_code, r.avg_score]));

  const aggregated = Array.from(teamMap.values()).map(team => {
    const scores = team.codes.map(c => kpiMap.get(c) ?? null).filter((s): s is number => s !== null);
    return {
      score_month: scoreMonth,
      team_lead_name: team.team_lead_name,
      branch_name: team.branch_name,
      process_name: team.process_name,
      team_size: team.codes.length,
      avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100 : null,
      max_score: scores.length ? Math.max(...scores) : null,
      min_score: scores.length ? Math.min(...scores) : null,
    };
  });

  const paged = aggregated.slice(options.offset, options.offset + options.limit);
  return { rows: paged, rowCount: aggregated.length, isTruncated: aggregated.length > paged.length };
}

/**
 * What makes an audit a fatal error. Shared so the page query and the count that describes it
 * cannot drift — which is exactly what had happened: countAudits reproduced only the IN-list and
 * date range, so fatal-error-register counted EVERY audit in the window while displaying only
 * the fatal ones. Measured live 2026-08-10 on the default range: 28,982 fatal rows reported as a
 * total of 77,433, a 2.7x overstatement, and it fires today because 28,982 exceeds the 2,000-row
 * probe that triggers the count.
 */
/**
 * A keyset cursor value has to survive a round trip through the worker queue as text and come
 * back comparable to a MySQL DATETIME. mysql2 returns DATETIME as a JS Date; its default
 * toString ("Mon Aug 10 2026 ...") does not compare correctly, so format to 'YYYY-MM-DD HH:MM:SS'
 * in local time — the same wall-clock the server stored, with no timezone reinterpretation.
 */
function formatAuditDate(v: unknown): string {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ` +
           `${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  return String(v ?? "");
}

const FATAL_ERROR_PREDICATE =
  ` AND cqa.quality_percentage < 50
       AND (cqa.professionalism_maintained = 0 OR cqa.active_listening = 0)`;

/**
 * Total matching audit rows, for the case where a page probe came back full.
 *
 * `filterClause` must carry EVERY predicate the page query applied beyond the IN-list and date
 * range — the cursor clause, and any report-specific filter. A count that describes a wider set
 * than the rows it accompanies is worse than no count: the grid offers pages that do not exist.
 */
async function countAudits(
  placeholders: string,
  qParams: (string | number | null)[],
  filterClause: string
): Promise<number> {
  const sql = `
    SELECT COUNT(*) AS total
      FROM db_audit.call_quality_assessment cqa
     WHERE cqa.User IN (${placeholders})
       AND cqa.CallDate BETWEEN ? AND ?
       ${filterClause}`;
  const rows = await querySource<{ total: number }>(sql, qParams);
  return Number(rows[0]?.total ?? 0);
}


// ---------------------------------------------------------------------------
// quality-audit-log
// Source: db_audit.call_quality_assessment (cross-DB via sourceDb / qualified refs)
// Joins to mas_hrms.employees on employee_code = cqa.User for scope filtering.
// ---------------------------------------------------------------------------
export async function qualityAuditLog(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  // active_status = 1 is load-bearing here, not cosmetic. Without it this resolved all 58,627
  // employee rows ever created and then sent an IN list of 58,627 placeholders to
  // Shivamgiri.v_call_master_unified_kpi — a 1.36M-row view on which an unbounded scan takes
  // ~248s. Both this report and team-performance-summary simply died at the client timeout.
  // Scoped to the 1,125 active employees the same query returns in milliseconds.
  const eClauses: string[] = ["e.active_status = 1"];
  const eParams: unknown[]  = [];
  appendScopeConditions(scope, eClauses, eParams);
  appendFilterConditions(filters, eClauses, eParams);

  // Build scoped employee code list then query db_audit
  // The audit rows come from db_audit and carry no org identity, so cost centre has to be
  // brought across from mas_hrms and attached per row — the same enrichment
  // agent-performance-summary does. Selecting it here costs nothing extra: this query
  // already runs to build the scoped employee-code list.
  const empSql = `SELECT e.employee_code,
    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
    FROM mas_hrms.employees e
    LEFT JOIN mas_hrms.branch_master b ON b.id = e.branch_id
    LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
    LEFT JOIN mas_hrms.cost_centre_master cc ON cc.id = e.cost_centre_id
   WHERE ${eClauses.join(" AND ")}`;
  const empRows = await querySource<{ employee_code: string; cost_centre_code: string; cost_centre_name: string }>(empSql, eParams as (string|number|null)[]);
  if (empRows.length === 0) return { rows: [], rowCount: 0, isTruncated: false };

  const codes = empRows.map(r => r.employee_code);
  const placeholders = codes.map(() => "?").join(",");
  const qParams: (string|number|null)[] = [...codes, from, to];
  const cursor = options.cursor;
  let cursorClause = "";
  if (options.mode === "worker" && cursor != null) {
    // The keyset must walk the same sequence the ORDER BY produces. That order is now
    // (CallDate DESC, id DESC); a bare `id >` cursor would page a different sequence from the
    // one the rows arrive in, skipping some export chunks and repeating others — silently, in
    // a file nobody re-counts. Hence a composite cursor "<CallDate>|<id>"; ExecOptions.cursor
    // already accepts a string. lastIndexOf, not split, because the datetime contains no pipe
    // but this stays correct if it ever does.
    const raw = String(cursor);
    const sep = raw.lastIndexOf("|");
    cursorClause = ` AND (cqa.CallDate < ? OR (cqa.CallDate = ? AND cqa.id < ?))`;
    qParams.push(raw.slice(0, sep), raw.slice(0, sep), raw.slice(sep + 1));
  }

  // Fetch beyond the page so the true total comes from the same round trip.
  //
  // These two reported rowCount: rows.length — the size of the page, not the size of the
  // result. The grid reads that as the total, so a register with thousands of audits showed
  // "100 total", offered one page, and put the rest out of reach. Confirmed live: page 1 and
  // page 2 each returned 100 different rows while both declared a total of 100.
  //
  // Same shape as the payroll-register pagination defect fixed earlier in this audit, and the
  // same remedy: over-fetch a bounded amount, slice the caller's page from it, and only pay for
  // a COUNT when the result genuinely exceeds the probe.
  const PROBE_ROWS = 2000;
  const probeLimit = Math.max(options.limit, PROBE_ROWS);

  const sql = `
    SELECT cqa.id AS call_id,
           cqa.User AS employee_code,
           cqa.CallDate AS audit_date,
           ROUND(cqa.quality_percentage, 2) AS score,
           CASE WHEN cqa.quality_percentage < 50
                 AND (cqa.professionalism_maintained = 0 OR cqa.active_listening = 0)
                THEN 1 ELSE 0 END AS fatal_error,
           cqa.Campaign AS process_name
      FROM db_audit.call_quality_assessment cqa
     WHERE cqa.User IN (${placeholders})
       AND cqa.CallDate BETWEEN ? AND ?
       ${cursorClause}
     ORDER BY cqa.CallDate DESC, cqa.id DESC${options.mode === "worker" ? ` LIMIT ${options.limit}` : ` LIMIT ${probeLimit} OFFSET ${options.offset}`}`;

  // This report filters on nothing beyond the IN-list and date range, so its count needs only
  // the cursor clause. Named the same as its sibling's so the two stay visibly parallel.
  const countClause = cursorClause;

  const ccByCode = new Map(empRows.map(r => [r.employee_code, r]));
  const rawRows = await querySource<Record<string,unknown>>(sql, qParams);
  const rows: Record<string, unknown>[] = rawRows.map(r => ({
    ...r,
    cost_centre_code: ccByCode.get(r.employee_code as string)?.cost_centre_code ?? 'UNASSIGNED',
    cost_centre_name: ccByCode.get(r.employee_code as string)?.cost_centre_name ?? 'UNASSIGNED',
  }));
  // Composite, to match the (CallDate DESC, id DESC) keyset above. mysql2 hands datetimes back
  // as Date objects, so format explicitly rather than relying on toString().
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? `${formatAuditDate(rows[rows.length - 1].audit_date)}|${rows[rows.length - 1].call_id}`
    : null;

  // Worker mode keysets and takes what it asked for; preview slices its page out of the probe.
  if (options.mode === "worker") {
    return { rows, rowCount: rows.length, isTruncated: rows.length === options.limit, nextCursor };
  }

  const page = rows.slice(0, options.limit);

  // Short of the probe AND non-empty means the result ends here, so the total is exact. An
  // offset past the end returns nothing, where offset + 0 would report the offset itself as the
  // total — the same trap found when paging monthly-shrinkage-trend.
  //
  // When the probe fills, the result is genuinely larger and only a COUNT can say by how much.
  // Reporting the probe size instead would understate the total, which is the very defect this
  // change exists to remove — just with a bigger wrong number.
  let total: number;
  if (rows.length > 0 && rows.length < probeLimit) {
    total = options.offset + rows.length;
  } else if (rows.length === 0) {
    total = options.offset === 0 ? 0 : await countAudits(placeholders, qParams, countClause);
  } else {
    total = await countAudits(placeholders, qParams, countClause);
  }

  return {
    rows: page,
    rowCount: total,
    isTruncated: total > options.offset + page.length,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// fatal-error-register
// Source: db_audit.call_quality_assessment — fatal = low score + missing competency
// ---------------------------------------------------------------------------
export async function fatalErrorRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  // active_status = 1 is load-bearing here, not cosmetic. Without it this resolved all 58,627
  // employee rows ever created and then sent an IN list of 58,627 placeholders to
  // Shivamgiri.v_call_master_unified_kpi — a 1.36M-row view on which an unbounded scan takes
  // ~248s. Both this report and team-performance-summary simply died at the client timeout.
  // Scoped to the 1,125 active employees the same query returns in milliseconds.
  const eClauses: string[] = ["e.active_status = 1"];
  const eParams: unknown[]  = [];
  appendScopeConditions(scope, eClauses, eParams);
  appendFilterConditions(filters, eClauses, eParams);

  // The audit rows come from db_audit and carry no org identity, so cost centre has to be
  // brought across from mas_hrms and attached per row — the same enrichment
  // agent-performance-summary does. Selecting it here costs nothing extra: this query
  // already runs to build the scoped employee-code list.
  const empSql = `SELECT e.employee_code,
    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
    FROM mas_hrms.employees e
    LEFT JOIN mas_hrms.branch_master b ON b.id = e.branch_id
    LEFT JOIN mas_hrms.process_master p ON p.id = e.process_id
    LEFT JOIN mas_hrms.cost_centre_master cc ON cc.id = e.cost_centre_id
   WHERE ${eClauses.join(" AND ")}`;
  const empRows = await querySource<{ employee_code: string; cost_centre_code: string; cost_centre_name: string }>(empSql, eParams as (string|number|null)[]);
  if (empRows.length === 0) return { rows: [], rowCount: 0, isTruncated: false };

  const codes = empRows.map(r => r.employee_code);
  const placeholders = codes.map(() => "?").join(",");
  const qParams: (string|number|null)[] = [...codes, from, to];
  const cursor = options.cursor;
  let cursorClause = "";
  if (options.mode === "worker" && cursor != null) {
    // The keyset must walk the same sequence the ORDER BY produces. That order is now
    // (CallDate DESC, id DESC); a bare `id >` cursor would page a different sequence from the
    // one the rows arrive in, skipping some export chunks and repeating others — silently, in
    // a file nobody re-counts. Hence a composite cursor "<CallDate>|<id>"; ExecOptions.cursor
    // already accepts a string. lastIndexOf, not split, because the datetime contains no pipe
    // but this stays correct if it ever does.
    const raw = String(cursor);
    const sep = raw.lastIndexOf("|");
    cursorClause = ` AND (cqa.CallDate < ? OR (cqa.CallDate = ? AND cqa.id < ?))`;
    qParams.push(raw.slice(0, sep), raw.slice(0, sep), raw.slice(sep + 1));
  }

  // Fetch beyond the page so the true total comes from the same round trip.
  //
  // These two reported rowCount: rows.length — the size of the page, not the size of the
  // result. The grid reads that as the total, so a register with thousands of audits showed
  // "100 total", offered one page, and put the rest out of reach. Confirmed live: page 1 and
  // page 2 each returned 100 different rows while both declared a total of 100.
  //
  // Same shape as the payroll-register pagination defect fixed earlier in this audit, and the
  // same remedy: over-fetch a bounded amount, slice the caller's page from it, and only pay for
  // a COUNT when the result genuinely exceeds the probe.
  const PROBE_ROWS = 2000;
  const probeLimit = Math.max(options.limit, PROBE_ROWS);

  const sql = `
    SELECT cqa.id AS call_id,
           cqa.User AS employee_code,
           cqa.CallDate AS audit_date,
           ROUND(cqa.quality_percentage, 2) AS score,
           cqa.Campaign AS process_name
      FROM db_audit.call_quality_assessment cqa
     WHERE cqa.User IN (${placeholders})
       AND cqa.CallDate BETWEEN ? AND ?
       ${FATAL_ERROR_PREDICATE}
       ${cursorClause}
     ORDER BY cqa.CallDate DESC, cqa.id DESC${options.mode === "worker" ? ` LIMIT ${options.limit}` : ` LIMIT ${probeLimit} OFFSET ${options.offset}`}`;

  // The count must describe the SAME set the page came from — fatal rows only, not every audit
  // in the window. Omitting the fatal predicate here is what reported 28,982 rows as 77,433.
  const countClause = `${FATAL_ERROR_PREDICATE} ${cursorClause}`;

  const ccByCode = new Map(empRows.map(r => [r.employee_code, r]));
  const rawRows = await querySource<Record<string,unknown>>(sql, qParams);
  const rows: Record<string, unknown>[] = rawRows.map(r => ({
    ...r,
    cost_centre_code: ccByCode.get(r.employee_code as string)?.cost_centre_code ?? 'UNASSIGNED',
    cost_centre_name: ccByCode.get(r.employee_code as string)?.cost_centre_name ?? 'UNASSIGNED',
  }));
  // Composite, to match the (CallDate DESC, id DESC) keyset above. mysql2 hands datetimes back
  // as Date objects, so format explicitly rather than relying on toString().
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? `${formatAuditDate(rows[rows.length - 1].audit_date)}|${rows[rows.length - 1].call_id}`
    : null;

  // Worker mode keysets and takes what it asked for; preview slices its page out of the probe.
  if (options.mode === "worker") {
    return { rows, rowCount: rows.length, isTruncated: rows.length === options.limit, nextCursor };
  }

  const page = rows.slice(0, options.limit);

  // Short of the probe AND non-empty means the result ends here, so the total is exact. An
  // offset past the end returns nothing, where offset + 0 would report the offset itself as the
  // total — the same trap found when paging monthly-shrinkage-trend.
  //
  // When the probe fills, the result is genuinely larger and only a COUNT can say by how much.
  // Reporting the probe size instead would understate the total, which is the very defect this
  // change exists to remove — just with a bigger wrong number.
  let total: number;
  if (rows.length > 0 && rows.length < probeLimit) {
    total = options.offset + rows.length;
  } else if (rows.length === 0) {
    total = options.offset === 0 ? 0 : await countAudits(placeholders, qParams, countClause);
  } else {
    total = await countAudits(placeholders, qParams, countClause);
  }

  return {
    rows: page,
    rowCount: total,
    isTruncated: total > options.offset + page.length,
    nextCursor,
  };
}
