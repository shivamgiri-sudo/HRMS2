/** Process Dashboard -- auto-suggest a column_map from a table's headers and sample values (pure). */
import { CANONICAL_FIELDS, SENSITIVE_COLUMN_RE, type TimeUnit, type FieldKind } from "./pd.fields.js";

export interface ColumnInfo { name: string; dataType: string; columnType?: string }
export type TypeClass = "numeric" | "date" | "time" | "text" | "other";

export function typeClass(dataType: string): TypeClass {
  const t = dataType.toLowerCase();
  if (/^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real)$/.test(t)) return "numeric";
  if (/^(date|datetime|timestamp)$/.test(t)) return "date";
  if (t === "time") return "time";
  if (/^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)$/.test(t)) return "text";
  return "other";
}

/** Which source column types may back a canonical field kind. Text is tolerated for numerics/times (sheets often store them as text); preview then counts bad values. */
export function compatible(kind: FieldKind, tc: TypeClass): boolean {
  switch (kind) {
    case "date": return tc === "date";
    case "text": return tc === "text" || tc === "numeric";
    case "count": case "money": return tc === "numeric" || tc === "text";
    case "time": return tc === "numeric" || tc === "time" || tc === "text";
    case "hour": return tc === "numeric" || tc === "time" || tc === "date" || tc === "text";
  }
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** 0-100: 100 exact synonym, 80 header contains a synonym / synonym contains header (>=4 chars), 0 otherwise. Earlier synonyms score slightly higher. */
export function scoreHeader(header: string, synonyms: string[]): number {
  const h = norm(header);
  if (!h) return 0;
  let best = 0;
  synonyms.forEach((syn, i) => {
    const s = norm(syn);
    let sc = 0;
    if (h === s) sc = 100 - Math.min(i, 9);
    else if (h.length >= 4 && s.length >= 4 && (h.includes(s) || s.includes(h))) sc = 75 - Math.min(i, 9);
    if (sc > best) best = sc;
  });
  return best;
}

export interface Suggestion { columnMap: Record<string, string>; scores: Record<string, number>; unmatched: string[] }

/** Greedy best-first assignment: each column backs at most one field, each field gets its best compatible column (score >= 60). Sensitive columns are never suggested. */
export function suggestColumnMap(columns: ColumnInfo[]): Suggestion {
  const cands: Array<{ field: string; col: string; score: number }> = [];
  for (const f of CANONICAL_FIELDS) {
    for (const c of columns) {
      if (SENSITIVE_COLUMN_RE.test(c.name)) continue;
      if (!compatible(f.kind, typeClass(c.dataType))) continue;
      const score = scoreHeader(c.name, f.synonyms);
      if (score >= 60) cands.push({ field: f.key, col: c.name, score });
    }
  }
  cands.sort((a, b) => b.score - a.score || a.field.localeCompare(b.field) || a.col.localeCompare(b.col));
  const columnMap: Record<string, string> = {}; const scores: Record<string, number> = {}; const used = new Set<string>();
  for (const c of cands) {
    if (columnMap[c.field] || used.has(c.col)) continue;
    columnMap[c.field] = c.col; scores[c.field] = c.score; used.add(c.col);
  }
  return { columnMap, scores, unmatched: CANONICAL_FIELDS.filter((f) => !columnMap[f.key]).map((f) => f.key) };
}

/**
 * Guess the time unit of the mapped time columns. TIME columns / clock-shaped text -> hhmmss. Otherwise look at the numeric samples:
 * every value within [0, 1.5] and at least one fractional -> day_fraction (an Excel duration); else sec.
 */
export function guessTimeUnit(timeCols: Array<{ dataType: string; samples: unknown[] }>): TimeUnit {
  let clock = 0; let numeric: number[] = [];
  for (const c of timeCols) {
    if (typeClass(c.dataType) === "time") { clock += 1; continue; }
    const vals = c.samples.filter((v) => v !== null && v !== undefined && v !== "");
    if (vals.length && vals.every((v) => typeof v === "string" && /^\d{1,4}:\d{2}(:\d{2})?/.test(v))) { clock += 1; continue; }
    for (const v of vals) { const n = Number(v); if (Number.isFinite(n)) numeric.push(n); }
  }
  if (clock > 0 && numeric.length === 0) return "hhmmss";
  if (numeric.length >= 3 && numeric.every((n) => n >= 0 && n <= 1.5) && numeric.some((n) => n > 0 && n < 1)) return "day_fraction";
  return "sec";
}

/** Columns whose name suggests they split a table between processes / clients / campaigns. */
export const PROCESS_FILTER_NAME_RE = /(process|client|campaign|project|account|dashboard_label|cost_?centre|cc_code|program|vertical|queue)/i;
