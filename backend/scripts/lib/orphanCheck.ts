/**
 * Pure logic for scripts/dbbill-orphan-check.ts (READ-ONLY investigation). No database access here.
 *
 * Classifies HRMS employees against db_bill.masjclrentry by the row id they were imported from
 * (employees.legacy_emp_id) and renders the report. The systemic renderers take codes only; names
 * appear only in the probe renderers, for rows the operator asked about by id / name / code.
 */

export const CAP_PROBE = 20;
export const CAP_SYSTEMIC = 100;
export const PAGE = 10000;

const MAX_INT = 2147483647;
const IGNORED_FLAGS = /^--(apply|dry-run|mode(=.*)?)$/;

export interface Args {
  ids: number[];
  names: string[];
  codes: string[];
  ignored: string[];
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** --ids / --name / --codes, each repeatable and comma-separated, as `--x v` or `--x=v`. */
export function parseArgs(argv: string[]): Args {
  const out: Args = { ids: [], names: [], codes: [], ignored: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (IGNORED_FLAGS.test(a)) { out.ignored.push(a); continue; }
    const m = /^--(ids|name|codes)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`unknown argument: ${a}`);
    let value = m[2];
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`--${m[1]} needs a value`);
    }
    const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) throw new Error(`--${m[1]} needs a value`);
    for (const p of parts) {
      if (m[1] === "ids") {
        if (!/^\d{1,10}$/.test(p) || Number(p) < 1 || Number(p) > MAX_INT) throw new Error(`invalid --ids value: ${p}`);
        out.ids.push(Number(p));
      } else if (m[1] === "name") {
        const t = p.toUpperCase();
        if (!/^[A-Z]{2,40}$/.test(t)) throw new Error(`invalid --name token (letters only, 2-40): ${p}`);
        out.names.push(t);
      } else {
        const c = p.toUpperCase();
        if (!/^[A-Z0-9]{1,20}$/.test(c)) throw new Error(`invalid --codes value (letters/digits only): ${p}`);
        out.codes.push(c);
      }
    }
  }
  out.ids = uniq(out.ids);
  out.names = uniq(out.names);
  out.codes = uniq(out.codes);
  return out;
}

/**
 * Every query goes through this. One SELECT / WITH ... SELECT only: no stacked statements, no
 * INTO OUTFILE / DUMPFILE / @var, no locking reads, no SELECT *.
 */
export function readOnly(sql: string): string {
  const s = String(sql).trim();
  const low = s.toLowerCase();
  const refuse = (why: string): never => {
    throw new Error(`dbbill-orphan-check is read-only; refused (${why}): ${low.slice(0, 60)}`);
  };
  if (!(low.startsWith("select") || low.startsWith("with"))) refuse("not a SELECT");
  if (low.replace(/;\s*$/, "").includes(";")) refuse("stacked statement");
  if (/\binto\s+(outfile|dumpfile|@)/.test(low)) refuse("INTO");
  if (/\bfor\s+update\b|\block\s+in\s+share\s+mode\b|\bfor\s+share\b/.test(low)) refuse("locking read");
  if (/\bselect\s+(distinct\s+)?([a-z_][a-z0-9_]*\.)?\*/.test(low) || /,\s*([a-z_][a-z0-9_]*\.)?\*/.test(low)) refuse("star column list");
  return sql;
}

export const norm = (code: unknown): string => String(code ?? "").trim().toUpperCase();

export type OrphanClass =
  | "OK"
  | "CODE_CHANGED_IN_DB_BILL"
  | "LEGACY_ID_MISSING_IN_DB_BILL"
  | "LEGACY_ID_INVALID"
  | "HRMS_NATIVE_NOT_IN_DB_BILL"
  | "HRMS_NATIVE_IN_DB_BILL";

export const CLASSES: OrphanClass[] = [
  "OK",
  "CODE_CHANGED_IN_DB_BILL",
  "LEGACY_ID_MISSING_IN_DB_BILL",
  "LEGACY_ID_INVALID",
  "HRMS_NATIVE_NOT_IN_DB_BILL",
  "HRMS_NATIVE_IN_DB_BILL",
];

export interface HrmsLegacyRow {
  employee_code: string;
  legacy_emp_id: string | number | null;
  employment_status: string | null;
  active_status: number | string | null;
  date_of_joining: string | null;
}

export interface Classified {
  cls: OrphanClass;
  code: string;
  legacyId: number | null;
  /** current db_bill code on the legacy row id (CODE_CHANGED / OK), else null */
  billCode: string | null;
  /** the HRMS code exists on some db_bill row (any id) */
  codeElsewhereInBill: boolean;
}

/** billById: masjclrentry.id -> EmpCode (any case/spacing); billCodes: normalised codes of all rows. */
export function classify(e: HrmsLegacyRow, billById: Map<number, string>, billCodes: Set<string>): Classified {
  const code = norm(e.employee_code);
  const inBill = billCodes.has(code);
  if (e.legacy_emp_id === null || e.legacy_emp_id === undefined || String(e.legacy_emp_id).trim() === "") {
    return { cls: inBill ? "HRMS_NATIVE_IN_DB_BILL" : "HRMS_NATIVE_NOT_IN_DB_BILL", code, legacyId: null, billCode: null, codeElsewhereInBill: inBill };
  }
  const raw = String(e.legacy_emp_id).trim();
  if (!/^\d{1,10}$/.test(raw)) {
    return { cls: "LEGACY_ID_INVALID", code, legacyId: null, billCode: null, codeElsewhereInBill: inBill };
  }
  const id = Number(raw);
  if (!billById.has(id)) {
    return { cls: "LEGACY_ID_MISSING_IN_DB_BILL", code, legacyId: id, billCode: null, codeElsewhereInBill: inBill };
  }
  const billCode = norm(billById.get(id));
  if (billCode === code) return { cls: "OK", code, legacyId: id, billCode, codeElsewhereInBill: true };
  return { cls: "CODE_CHANGED_IN_DB_BILL", code, legacyId: id, billCode, codeElsewhereInBill: inBill };
}

export function codeFamily(code: string): "MAS" | "IDC" | "NUMC" | "OTHER" {
  const c = norm(code);
  if (c.startsWith("MAS")) return "MAS";
  if (c.startsWith("IDC")) return "IDC";
  if (/^\d+C$/.test(c)) return "NUMC";
  return "OTHER";
}

/** Digits of the code without leading zeros ("MAS02602" -> "2602"); null when there are none. */
export function numericCore(code: string): string | null {
  const d = norm(code).replace(/\D/g, "").replace(/^0+/, "");
  return d.length ? d : null;
}

export function breakdown<T>(items: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) { const k = key(it); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function capLines(items: string[], cap: number): string[] {
  if (items.length === 0) return ["  (none)"];
  const out = items.slice(0, cap).map((s) => `  ${s}`);
  if (items.length > cap) out.push(`  ... ${items.length - cap} more not shown (cap ${cap})`);
  return out;
}

export interface ClassSummary {
  total: number;
  byStatus: [string, number][];
  byYear: [string, number][];
  byFamily: [string, number][];
  codeElsewhere: number;
  items: string[];
}

export interface Summary {
  counts: Record<OrphanClass, number>;
  byClass: Record<OrphanClass, ClassSummary>;
  classOf: Map<string, OrphanClass>;
}

const yearOf = (d: string | null): string => (d && /^\d{4}/.test(String(d)) ? String(d).slice(0, 4) : "unknown");

export function summarize(rows: HrmsLegacyRow[], billById: Map<number, string>, billCodes: Set<string>): Summary {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<OrphanClass, number>;
  const groups = Object.fromEntries(CLASSES.map((c) => [c, [] as { e: HrmsLegacyRow; r: Classified }[]])) as Record<
    OrphanClass, { e: HrmsLegacyRow; r: Classified }[]>;
  const classOf = new Map<string, OrphanClass>();
  for (const e of rows) {
    const r = classify(e, billById, billCodes);
    counts[r.cls]++;
    groups[r.cls].push({ e, r });
    classOf.set(r.code, r.cls);
  }
  const byClass = {} as Record<OrphanClass, ClassSummary>;
  for (const c of CLASSES) {
    const g = groups[c].slice().sort((a, b) => (a.r.code < b.r.code ? -1 : a.r.code > b.r.code ? 1 : 0));
    byClass[c] = {
      total: g.length,
      byStatus: breakdown(g, ({ e }) => `${String(e.employment_status ?? "null").toLowerCase()}/${e.active_status ?? "null"}`),
      byYear: breakdown(g, ({ e }) => yearOf(e.date_of_joining)),
      byFamily: breakdown(g, ({ r }) => codeFamily(r.code)),
      codeElsewhere: g.filter(({ r }) => r.codeElsewhereInBill).length,
      items: g.map(({ r }) =>
        c === "CODE_CHANGED_IN_DB_BILL" ? `${r.code} -> ${r.billCode} (legacy id ${r.legacyId})`
          : c === "LEGACY_ID_MISSING_IN_DB_BILL" ? `${r.code} (legacy id ${r.legacyId}${r.codeElsewhereInBill ? "; code still exists on another db_bill row" : ""})`
            : r.code),
    };
  }
  return { counts, byClass, classOf };
}

const v = (x: unknown): string => (x === null || x === undefined || x === "" ? "-" : String(x));

export interface BillProbeRow {
  id: number;
  code: string;
  Status?: unknown;
  DOJ?: unknown;
  DOL?: unknown;
  ResignationDate?: unknown;
  left_type?: unknown;
  lastUpdated?: unknown;
  EmpName?: unknown;
}

/** (1a) one line per requested id; names allowed (probe rows only). */
export function renderIdProbe(ids: number[], rows: BillProbeRow[]): string[] {
  const out = ["  columns: id | code | Status | DOJ | DOL | ResignationDate | left_type | lastUpdated | EmpName"];
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  for (const id of ids.slice(0, CAP_PROBE)) {
    const r = byId.get(id);
    out.push(r
      ? `  id ${id}: EXISTS  ${[r.id, r.code, r.Status, r.DOJ, r.DOL, r.ResignationDate, r.left_type, r.lastUpdated, r.EmpName].map(v).join(" | ")}`
      : `  id ${id}: NOT FOUND in masjclrentry (row deleted, or never existed)`);
  }
  if (ids.length > CAP_PROBE) out.push(`  ... ${ids.length - CAP_PROBE} more ids not probed (cap ${CAP_PROBE})`);
  return out;
}

/** (1b) rows whose EmpName contains every token. */
export function renderNameProbe(tokens: string[], rows: BillProbeRow[], total: number): string[] {
  const out = [`  name tokens (all must match): ${tokens.join(" + ")} -> ${total} row(s)`,
    "  columns: id | code | Status | DOJ | DOL | EmpName"];
  if (rows.length === 0) { out.push("  (none)"); return out; }
  for (const r of rows.slice(0, CAP_PROBE)) out.push(`  ${[r.id, r.code, r.Status, r.DOJ, r.DOL, r.EmpName].map(v).join(" | ")}`);
  if (total > Math.min(rows.length, CAP_PROBE)) out.push(`  ... ${total - Math.min(rows.length, CAP_PROBE)} more not shown (cap ${CAP_PROBE})`);
  return out;
}

/** (1c) exact matches (with name) and numeric-core LIKE matches (codes only). */
export function renderCodeProbe(code: string, exact: BillProbeRow[], like: BillProbeRow[], likeTotal: number): string[] {
  const core = numericCore(code);
  const out = [`  code ${code}: exact UPPER(TRIM(EmpCode)) matches: ${exact.length}`];
  for (const r of exact.slice(0, CAP_PROBE)) out.push(`    ${[r.id, r.code, r.Status, r.DOJ, r.DOL, r.EmpName].map(v).join(" | ")}`);
  if (core === null) { out.push("  (no numeric core; LIKE probe skipped)"); return out; }
  out.push(`  codes containing '${core}': ${likeTotal} (id | code only)`);
  if (like.length === 0) out.push("    (none)");
  for (const r of like.slice(0, CAP_PROBE)) out.push(`    ${r.id} | ${r.code}`);
  if (likeTotal > Math.min(like.length, CAP_PROBE)) out.push(`    ... ${likeTotal - Math.min(like.length, CAP_PROBE)} more not shown (cap ${CAP_PROBE})`);
  return out;
}

const fmtPairs = (p: [string, number][]): string => (p.length ? p.map(([k, n]) => `${k}: ${n}`).join(", ") : "(none)");

/** (3) codes and counts only. */
export function renderSystemic(s: Summary, probedCodes: string[]): string[] {
  const out: string[] = [];
  out.push("  totals by class:");
  for (const c of CLASSES) out.push(`    ${c}: ${s.counts[c]}`);
  const detail: OrphanClass[] = ["LEGACY_ID_MISSING_IN_DB_BILL", "CODE_CHANGED_IN_DB_BILL", "LEGACY_ID_INVALID", "HRMS_NATIVE_NOT_IN_DB_BILL"];
  for (const c of detail) {
    const g = s.byClass[c];
    out.push("");
    out.push(`  -- ${c}: ${g.total} --`);
    if (g.total === 0) continue;
    out.push(`  by employment_status/active_status: ${fmtPairs(g.byStatus)}`);
    out.push(`  by DOJ year: ${fmtPairs(g.byYear.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)))}`);
    out.push(`  by code family: ${fmtPairs(g.byFamily)}`);
    if (c === "LEGACY_ID_MISSING_IN_DB_BILL") out.push(`  of which the HRMS code still exists on another db_bill row: ${g.codeElsewhere}`);
    if (c === "CODE_CHANGED_IN_DB_BILL") out.push(`  of which the old HRMS code still exists on another db_bill row: ${g.codeElsewhere}`);
    out.push(...capLines(g.items, CAP_SYSTEMIC));
  }
  out.push("");
  for (const code of probedCodes) {
    const cls = s.classOf.get(norm(code));
    out.push(`  ${code} falls in: ${cls ?? "NOT IN HRMS employees"}`);
  }
  return out;
}
