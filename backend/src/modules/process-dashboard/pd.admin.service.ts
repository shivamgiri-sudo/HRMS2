/** Process Dashboard -- admin helpers: suggest a mapping, preview a config before saving. Read-only against the source. */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { CANONICAL_FIELDS, REQUIRED_FIELDS, TIME_FIELDS, type TimeUnit } from "./pd.fields.js";
import { availableMetrics } from "./pd.metrics.js";
import { PROCESS_FILTER_NAME_RE, guessTimeUnit, suggestColumnMap, typeClass, type ColumnInfo } from "./pd.suggest.js";
import { PdError, assertSourceName, fetchRows, listColumns, quoteIdent, readFreshness, verifyColumnMap, withReadOnly, type ProcessFilter, type Resolved } from "./pd.source.js";
import { parseConfigShape, type ConfigInput } from "./pd.config.service.js";

export interface FilterCandidate { column: string; values: Array<{ value: string; rows: number }> }

export async function suggest(schema: string, table: string, processId?: string) {
  const src = assertSourceName(schema, table);
  const columns = await listColumns(src.schema, src.table);
  const s = suggestColumnMap(columns);
  const byName = new Map(columns.map((c) => [c.name, c]));
  const timeCols = TIME_FIELDS.filter((f) => s.columnMap[f]).map((f) => byName.get(s.columnMap[f])!);
  const cands = columns.filter((c) => PROCESS_FILTER_NAME_RE.test(c.name) && typeClass(c.dataType) !== "other" && typeClass(c.dataType) !== "date").slice(0, 5);
  const filterCandidates: FilterCandidate[] = [];
  let timeUnit: TimeUnit = "sec";
  await withReadOnly(async (conn) => {
    if (timeCols.length) {
      const list = timeCols.map((c) => quoteIdent(c.name)).join(", ");
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${list} FROM ${quoteIdent(src.schema)}.${quoteIdent(src.table)} LIMIT 200`);
      timeUnit = guessTimeUnit(timeCols.map((c) => ({ dataType: c.dataType, samples: rows.map((r) => r[c.name]) })));
    }
    for (const c of cands) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT ${quoteIdent(c.name)} AS v, COUNT(*) AS n FROM ${quoteIdent(src.schema)}.${quoteIdent(src.table)} WHERE ${quoteIdent(c.name)} IS NOT NULL GROUP BY ${quoteIdent(c.name)} ORDER BY n DESC LIMIT 51`);
      if (rows.length >= 1 && rows.length <= 50) filterCandidates.push({ column: c.name, values: rows.slice(0, 12).map((r) => ({ value: String(r.v), rows: Number(r.n) })) });
    }
  });
  let processFilter: ProcessFilter | null = null;
  if (processId) {
    const [p] = await db.execute<RowDataPacket[]>(`SELECT process_code, process_name FROM process_master WHERE id = ? LIMIT 1`, [processId]);
    const names = [processId, p[0]?.process_code, p[0]?.process_name].filter(Boolean).map((x) => String(x).toLowerCase());
    for (const c of filterCandidates) {
      const hit = c.values.find((v) => names.includes(v.value.toLowerCase()));
      if (hit) { processFilter = { column: c.column, value: hit.value }; break; }
    }
  }
  return {
    schema: src.schema, table: src.table, columnMap: s.columnMap, scores: s.scores, unmatched: s.unmatched, missingRequired: REQUIRED_FIELDS.filter((f) => !s.columnMap[f]),
    timeUnit, processFilter, processFilterCandidates: filterCandidates, columns,
    fields: CANONICAL_FIELDS.map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: f.required })),
  };
}

export interface PreviewProblem { severity: "error" | "warn"; code: string; field?: string; message: string }

export async function preview(processId: string, input: ConfigInput) {
  const { draft, problems: shapeProblems } = parseConfigShape(input);
  const problems: PreviewProblem[] = [];
  for (const m of shapeProblems) {
    const req = /^required field (\w+) is not mapped/.exec(m);
    problems.push({ severity: "error", code: req ? "UNMAPPED_REQUIRED" : "INVALID_CONFIG", field: req?.[1], message: m });
  }
  if (!draft.aprSchema || !draft.aprTable) return { rows: [], problems, dateRange: null, unknownAgents: null, metricAvailability: {}, mapped: [] };
  const [p] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE id = ? LIMIT 1`, [processId]);
  if (!p.length) throw new PdError(404, "PROCESS_NOT_FOUND", "Process not found");
  const columns: ColumnInfo[] = await listColumns(draft.aprSchema, draft.aprTable);
  const v = verifyColumnMap(draft.columnMap, columns, draft.processFilter);
  for (const x of v.problems) problems.push({ severity: "error", code: "BAD_MAPPING", field: x.field, message: x.message });
  const mapped = new Set(Object.keys(v.map));
  const out = { rows: [] as unknown[], problems, dateRange: null as unknown, unknownAgents: null as unknown, metricAvailability: availableMetrics(mapped), mapped: [...mapped] };
  if (!v.map.agent_code || !v.map.date || v.problems.length) return out;
  const r: Resolved = { cfg: { ...draft, processId, configuredBy: null, updatedAt: null, aprSchema: draft.aprSchema, aprTable: draft.aprTable }, map: v.map, filterColumn: v.filterColumn, mapped };
  const [sample, fresh] = await Promise.all([fetchRows(r, { limit: 2000, order: "desc" }), readFreshness(r)]);
  out.rows = sample.rows.slice(0, 20);
  out.dateRange = { earliest: fresh.earliestDate, latest: fresh.latestDate, rows: fresh.rows };
  if (fresh.rows === 0) problems.push({ severity: "warn", code: "NO_ROWS", message: draft.processFilter ? "No rows match the process filter" : "The table has no rows" });
  if (sample.rows.length === 0 && fresh.rows > 0) problems.push({ severity: "error", code: "NO_USABLE_ROWS", message: "Rows exist but none has a usable agent_code and date" });
  for (const [field, n] of Object.entries(sample.stats.badValues)) {
    problems.push({ severity: "warn", code: "NON_NUMERIC", field, message: `${n} of ${sample.stats.rows} sampled rows have a non-${TIME_FIELDS.includes(field) ? "time" : "numeric"} value in ${v.map[field]} (e.g. ${(sample.stats.badSamples[field] ?? []).map((x) => JSON.stringify(x)).join(", ")})${TIME_FIELDS.includes(field) ? `; check time_unit (${draft.timeUnit})` : ""}` });
  }
  const codes = [...new Set(sample.rows.map((x) => x.agent_code))];
  const known = new Set<string>();
  for (let i = 0; i < codes.length; i += 500) {
    const chunk = codes.slice(i, i + 500);
    const [e] = await db.execute<RowDataPacket[]>(`SELECT UPPER(employee_code) AS c FROM employees WHERE employee_code IN (${chunk.map(() => "?").join(",")})`, chunk);
    for (const x of e) known.add(String(x.c));
  }
  const unknown = codes.filter((c) => !known.has(c));
  out.unknownAgents = { checked: codes.length, count: unknown.length, sample: unknown.slice(0, 20) };
  if (unknown.length) problems.push({ severity: "warn", code: "UNKNOWN_AGENTS", field: "agent_code", message: `${unknown.length} of ${codes.length} sampled agent codes are not in employees (QA scores and names will not join)` });
  if (sample.truncated) problems.push({ severity: "warn", code: "SAMPLE_TRUNCATED", message: "Sampled the newest 2000 rows only" });
  return out;
}
