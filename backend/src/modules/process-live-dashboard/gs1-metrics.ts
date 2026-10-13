/**
 * Pure GS1 dashboard calculations (no DB). Kept apart from gs1.service.ts so the
 * rules the requirements pin down are unit-tested:
 *   - percentages return null (shown as N/A), never 0, when the denominator is 0;
 *   - period percentages are volume-weighted, never an average of daily percentages;
 *   - the consolidated total reconciles exactly to Email + Data Card + Approval;
 *   - blank / unknown analysts are counted as a data-quality exception, not hidden.
 */

export type CountMap = Record<string, number>;

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** num / den * 100, or null when there is no denominator (KPI not applicable). */
export function safePct(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return round2((num / den) * 100);
}

/** num / den, or null when there is no denominator. */
export function safeRatio(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return round2(num / den);
}

/**
 * Volume-weighted mean of per-row values (e.g. a per-day SLA % weighted by that day's
 * tickets). Rows with a null value or a non-positive weight are left out; null when nothing
 * is left. A day with 1 ticket at 0% and a day with 99 tickets at 100% gives 99%, not 50%.
 */
export function weightedMean(rows: Array<{ value: number | null | undefined; weight: number }>): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (r.value === null || r.value === undefined || !Number.isFinite(r.value)) continue;
    if (!(r.weight > 0)) continue;
    num += r.value * r.weight;
    den += r.weight;
  }
  return den > 0 ? round2(num / den) : null;
}

/** Parse a JSON count map column (string or object); anything malformed is ignored. */
export function parseCountMap(raw: unknown): CountMap | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out: CountMap = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const x = Number(v);
    if (Number.isFinite(x) && x > 0) out[k] = x;
  }
  return out;
}

export function mergeCounts(into: CountMap, add: CountMap | null): CountMap {
  if (!add) return into;
  for (const [k, v] of Object.entries(add)) into[k] = (into[k] ?? 0) + v;
  return into;
}

export function countMapToRows(map: CountMap, limit = 15): Array<{ label: string; count: number }> {
  const rows = Object.entries(map).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  if (rows.length <= limit) return rows;
  const head = rows.slice(0, limit);
  head.push({ label: "(other)", count: rows.slice(limit).reduce((s, r) => s + r.count, 0) });
  return head;
}

export type StatusClass = "closed" | "pending" | "rejected" | "other";

/** Map an Email "Status" label to a closure class. Unrecognised labels stay "other". */
export function classifyEmailStatus(label: string): StatusClass {
  const v = label.trim().toLowerCase();
  if (!v || v === "(blank)") return "other";
  if (/reject|declin|invalid|cancel/.test(v)) return "rejected";
  if (/pend|\bopen|progress|in process|\bwip\b|hold|await|query raised|\bnew\b|assigned|reopen/.test(v)) return "pending";
  if (/clos|complet|done|resolv|process|sent|repl|finish|approv|submit/.test(v)) return "closed";
  return "other";
}

export function summariseStatuses(map: CountMap): Record<StatusClass, number> {
  const out: Record<StatusClass, number> = { closed: 0, pending: 0, rejected: 0, other: 0 };
  for (const [label, count] of Object.entries(map)) out[classifyEmailStatus(label)] += count;
  return out;
}

/** Sort SLA bucket labels by their leading number ("0-15" before "15-30" before ">60"). */
export function sortBuckets<T extends { label: string }>(rows: T[]): T[] {
  const key = (l: string) => {
    const m = /(\d+(?:\.\d+)?)/.exec(l);
    if (!m) return Number.MAX_SAFE_INTEGER;
    return Number(m[1]) + (/^\s*[>]/.test(l) ? 0.5 : 0);
  };
  return [...rows].sort((a, b) => key(a.label) - key(b.label));
}

const UNKNOWN_NAMES = new Set(["", "-", "--", "na", "n/a", "nil", "none", "null", "unknown", "(blank)", "0"]);

/** True for a blank or placeholder analyst / approver name. */
export function isUnknownName(raw: unknown): boolean {
  return UNKNOWN_NAMES.has(String(raw ?? "").trim().toLowerCase());
}

export interface ReconciliationRow {
  check: string;
  expected: number;
  actual: number;
  diff: number;
  ok: boolean;
}

/** One reconciliation check row; ok only when the two figures are exactly equal. */
export function reconRow(check: string, expected: number, actual: number): ReconciliationRow {
  const diff = round2(actual - expected);
  return { check, expected, actual, diff, ok: diff === 0 };
}

/** Overall must equal the sum of its LOB parts exactly (no double counting). */
export function reconcileTotal(parts: Array<{ lob: string; value: number }>, overall: number): ReconciliationRow {
  const sum = parts.reduce((s, p) => s + p.value, 0);
  return reconRow(`Overall = ${parts.map(p => p.lob).join(" + ")}`, sum, overall);
}

/** Items per analyst-day (productivity); null when no analyst worked in the period. */
export function perAnalystDay(items: number, analystDays: number): number | null {
  return safeRatio(items, analystDays);
}

/** "Which LOB is worst" helpers for the comparison layer; N/A values never win. */
export function pickExtreme<T>(rows: T[], get: (r: T) => number | null, mode: "max" | "min"): T | null {
  let best: T | null = null;
  let bestV = 0;
  for (const r of rows) {
    const v = get(r);
    if (v === null || !Number.isFinite(v)) continue;
    if (best === null || (mode === "max" ? v > bestV : v < bestV)) { best = r; bestV = v; }
  }
  return best;
}
