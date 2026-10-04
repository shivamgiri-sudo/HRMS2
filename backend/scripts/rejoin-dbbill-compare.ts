/**
 * Rejoin cases visible in db_bill but not reflected in mas_hrms. STRICTLY READ-ONLY on both databases:
 * HRMS queries go through readOnly() (single SELECT / WITH only), db_bill queries through readOnly() AND
 * billQuery() (SELECT/SHOW allowlist). Output is employee codes only (no names, mobile, PAN, Aadhaar,
 * email); every listed section is capped at 50 with totals always printed. Takes no write flags;
 * --apply / --dry-run are ignored.
 *
 *   npx tsx scripts/rejoin-dbbill-compare.ts
 *
 * Detection and classification rules live in scripts/lib/rejoinCompare.ts (unit-tested).
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import {
  ATTENTION_CLASSES, BILL_COLUMNS, CAP, REJOIN_CLASSES, chunk, classifyCase, detectCandidates, formatCapped,
  normCode, readOnly, shapeOf, toCandidates,
  type Candidate, type HrmsFacts, type LegacyRow, type RejoinClass,
} from "./lib/rejoinCompare.js";

type Row = Record<string, unknown>;
type Exec = (sql: string, p?: unknown[]) => Promise<[unknown, unknown]>;

const PAGE = 10_000;
const CHUNK = 400;
const MARKER_COLUMN_RE = /rejoin|re_join|reactiv|prev|old.?code|join.?count|rehire/i;
const MARKER_TABLE_RE = /rejoin|reactiv|rehire|stint/i;

let hrmsExec: Exec | null = null;
let billExec: ((sql: string, p?: unknown[]) => Promise<Row[]>) | null = null;

const hq = async (sql: string, p: unknown[] = []): Promise<Row[]> => {
  const [rows] = (await hrmsExec!(readOnly(sql), p)) as [RowDataPacket[], unknown];
  return rows as Row[];
};
const bq = async (sql: string, p: unknown[] = []): Promise<Row[]> => billExec!(readOnly(sql), p);

const out = (s = "") => console.log(s);
const list = (items: string[]) => formatCapped(items).forEach((l) => out(l));
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");

function topShapes(values: unknown[]): string {
  const m = new Map<string, number>();
  for (const v of values) { const s = shapeOf(v); m.set(s, (m.get(s) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, n]) => `"${s}"=${n}`).join(", ");
}

/** (0) schema discovery. Returns the masjclrentry column names. */
async function discoverBill(): Promise<string[]> {
  out("== (0) db_bill schema discovery ==");
  const cols = (await bq(
    `SELECT COLUMN_NAME c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'masjclrentry' ORDER BY ORDINAL_POSITION`)).map((r) => String(r.c));
  out(`  masjclrentry columns (${cols.length}):`);
  for (let i = 0; i < cols.length; i += 10) out("    " + cols.slice(i, i + 10).join(", "));
  const all = await bq(`SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`);
  const marked = all.filter((r) => MARKER_COLUMN_RE.test(String(r.c))).map((r) => `${r.t}.${r.c}`).sort();
  out(`  columns anywhere in db_bill matching ${MARKER_COLUMN_RE}: ${marked.length}`);
  list(marked);
  const tables = (await bq(`SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`))
    .map((r) => String(r.t)).filter((t) => MARKER_TABLE_RE.test(t)).sort();
  out(`  tables in db_bill matching ${MARKER_TABLE_RE}: ${tables.length}`);
  list(tables);
  const cnt = await bq(`SELECT COUNT(*) n FROM masjclrentry`);
  out(`  masjclrentry rows: ${cnt[0]?.n}`);
  out("  Status value distribution (value | rows):");
  const dist = await bq(`SELECT Status s, COUNT(*) n FROM masjclrentry GROUP BY Status ORDER BY n DESC`);
  list(dist.map((r) => `${r.s === null ? "NULL" : `'${String(r.s).slice(0, 20)}'`} | ${r.n}`));
  const missing = BILL_COLUMNS.filter((c) => !cols.some((x) => x.toLowerCase() === c.toLowerCase()));
  if (missing.length) out(`  WARNING: expected columns missing from masjclrentry (read as NULL): ${missing.join(", ")}`);
  out();
  return cols;
}

/** (1) page through masjclrentry with only the needed columns. */
async function loadBillRows(cols: string[]): Promise<LegacyRow[]> {
  const has = (c: string) => cols.find((x) => x.toLowerCase() === c.toLowerCase());
  if (!has("id") || !has("EmpCode")) throw new Error("masjclrentry has no id or EmpCode column; cannot page");
  // Identifiers come from the fixed BILL_COLUMNS list, matched against information_schema; never from input.
  const sel = (c: string, alias: string) => (has(c) ? `\`${has(c)}\` AS ${alias}` : `NULL AS ${alias}`);
  const select = [
    "id", "UPPER(TRIM(EmpCode)) AS code", sel("DOJ", "doj"), sel("DOL", "dol"), sel("Status", "status"),
    sel("PanNo", "pan"), sel("AdharId", "aadhaar"), sel("lastUpdated", "lastUpdated"),
    sel("ResignationDate", "resignationDate"), sel("left_type", "leftType"),
  ].join(", ");
  const rows: LegacyRow[] = [];
  let last: number | string = -1, pages = 0;
  for (;;) {
    const page = await bq(`SELECT ${select} FROM masjclrentry WHERE id > ? ORDER BY id LIMIT ${PAGE}`, [last]);
    pages++;
    for (const r of page) rows.push({ ...(r as unknown as LegacyRow), code: normCode(r.code), id: Number(r.id) });
    if (page.length < PAGE) break;
    last = page[page.length - 1].id as number;
  }
  out(`  scanned ${rows.length} rows in ${pages} page(s) of up to ${PAGE}`);
  return rows;
}

async function tableExists(name: string): Promise<boolean> {
  const r = await hq(`SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [name]);
  return Number(r[0]?.n) > 0;
}

/** HRMS facts per UPPER(TRIM(employee_code)); codes without an employees row are absent from the map. */
async function loadHrms(codes: string[]): Promise<{ facts: Map<string, HrmsFacts>; dupCodes: number }> {
  const empCols = new Set((await hq(
    `SELECT COLUMN_NAME c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME IN ('reactivation_count','previous_exit_date')`))
    .map((r) => String(r.c)));
  const hasStint = await tableExists("employment_stint");
  const hasExit = await tableExists("exit_request");
  const hasReact = await tableExists("employee_reactivation_requests");
  out(`  trace sources present: employment_stint=${hasStint ? "yes" : "NO"}, exit_request=${hasExit ? "yes" : "NO"}, `
    + `employee_reactivation_requests=${hasReact ? "yes" : "NO"}, employees.reactivation_count=${empCols.has("reactivation_count") ? "yes" : "NO"}, `
    + `employees.previous_exit_date=${empCols.has("previous_exit_date") ? "yes" : "NO"}`);
  const rc = empCols.has("reactivation_count") ? "e.reactivation_count" : "NULL";
  const pe = empCols.has("previous_exit_date") ? "DATE_FORMAT(e.previous_exit_date, '%Y-%m-%d')" : "NULL";

  const facts = new Map<string, HrmsFacts>();
  let dupCodes = 0;
  for (const part of chunk(codes, CHUNK)) {
    const emps = await hq(
      `SELECT e.id, UPPER(TRIM(e.employee_code)) code, e.employment_status, e.active_status,
              DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') doj, DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') dox,
              ${rc} reactivation_count, ${pe} previous_exit_date
         FROM employees e WHERE UPPER(TRIM(e.employee_code)) IN (${ph(part.length)})`, part);
    const byId = new Map<string, HrmsFacts>();
    for (const r of emps) {
      const code = String(r.code);
      const prev = facts.get(code);
      if (prev) {
        dupCodes++;
        if (Number(prev.activeStatus) === 1 || Number(r.active_status) !== 1) continue; // keep the active row
      }
      const f: HrmsFacts = {
        employmentStatus: r.employment_status == null ? null : String(r.employment_status),
        activeStatus: r.active_status == null ? null : Number(r.active_status),
        dateOfJoining: (r.doj as string) ?? null, dateOfExit: (r.dox as string) ?? null,
        reactivationCount: r.reactivation_count == null ? null : Number(r.reactivation_count),
        previousExitDate: (r.previous_exit_date as string) ?? null,
        rejoinStints: 0, rejoinedExits: 0, approvedReactivations: 0,
      };
      facts.set(code, f);
      byId.set(String(r.id), f);
    }
    const ids = [...byId.keys()];
    if (ids.length === 0) continue;
    const apply = (rows: Row[], key: "rejoinStints" | "rejoinedExits" | "approvedReactivations") => {
      for (const r of rows) { const f = byId.get(String(r.employee_id)); if (f) f[key] += Number(r.n ?? 0); }
    };
    if (hasStint) apply(await hq(
      `SELECT employee_id, SUM(stint_no >= 2) n FROM employment_stint WHERE employee_id IN (${ph(ids.length)}) GROUP BY employee_id`, ids), "rejoinStints");
    if (hasExit) apply(await hq(
      `SELECT employee_id, COUNT(*) n FROM exit_request WHERE employee_id IN (${ph(ids.length)}) AND LOWER(status) = 'rejoined' GROUP BY employee_id`, ids), "rejoinedExits");
    if (hasReact) apply(await hq(
      `SELECT employee_id, COUNT(*) n FROM employee_reactivation_requests WHERE employee_id IN (${ph(ids.length)}) AND LOWER(status) = 'approved' GROUP BY employee_id`, ids), "approvedReactivations");
  }
  return { facts, dupCodes };
}

const label = (c: Candidate) => (c.pattern === "P2" ? `${c.oldCode} -> ${c.code}` : `${c.code} [${c.pattern}]`);

export async function main(): Promise<void> {
  const mysqlMod = await import("../src/db/mysql.js");
  const billMod = await import("../src/db/billDb.js");
  hrmsExec = mysqlMod.db.execute.bind(mysqlMod.db) as unknown as Exec;
  billExec = (sql, p) => billMod.billQuery<Row>(sql, p as never);

  out("REJOIN db_bill vs mas_hrms COMPARE (read-only; any --apply/--dry-run flag is ignored)");
  out("Output is employee codes only.\n");

  const cols = await discoverBill();

  out("== (1) db_bill rejoin candidates ==");
  const rows = await loadBillRows(cols);
  const d = detectCandidates(rows);
  out(`  distinct codes: ${d.stats.codes}; rows with a valid PAN: ${d.stats.validPan}; with a valid Aadhaar: ${d.stats.validAadhaar}; `
    + `identifiers shared by >10 codes ignored as placeholders: ${d.stats.placeholderIdentifiers}`);
  out(`  value shapes (d=digit, a=letter) DOJ: ${topShapes(rows.map((r) => r.doj))}`);
  out(`  value shapes DOL: ${topShapes(rows.map((r) => r.dol))}`);
  out(`  value shapes ResignationDate: ${topShapes(rows.map((r) => r.resignationDate))}`);
  out(`  P1 same code on 2+ rows with different DOJ (rehired under the same code): ${d.p1.length}`);
  list(d.p1.map((c) => `${c.code} (rows ${c.rows}, current stint ${c.currentActive ? "active" : "not active"})`));
  out(`  P1-excluded: same code on 2+ rows with the SAME DOJ (duplicate entry, not a rejoin): ${d.p1DuplicateOnly.length}`);
  list(d.p1DuplicateOnly);
  out(`  P2 same PAN/Aadhaar under different codes, later stint joined after the earlier one left (OLD -> NEW): ${d.p2.length}`);
  list(d.p2.map((p) => `${p.oldCode} -> ${p.newCode} (via ${p.via.join("+")}, new ${p.newActive ? "active" : "not active"})`));
  out(`  P3 single active row with no DOL but exit data present (ResignationDate / left_type): ${d.p3.length}`);
  list(d.p3.map((c) => c.code));
  out("  NOTE: mobile-number matching is deliberately NOT used (numbers are shared and recycled; too low quality).");
  out("        A person whose PAN and Aadhaar are both missing, invalid or changed between stints is not found by P2.\n");

  out("== (2) mas_hrms comparison ==");
  const cands = toCandidates(d);
  const codes = [...new Set(cands.flatMap((c) => (c.oldCode ? [c.code, c.oldCode] : [c.code])))];
  out(`  candidates: ${cands.length} (P1 ${d.p1.length}, P2 ${d.p2.length}, P3 ${d.p3.length}); distinct codes looked up: ${codes.length}`);
  const { facts, dupCodes } = await loadHrms(codes);
  out(`  codes found in HRMS employees: ${[...facts.keys()].length}; extra duplicate employees rows for a code: ${dupCodes}`);

  const byClass = new Map<RejoinClass, Candidate[]>(REJOIN_CLASSES.map((k) => [k, []]));
  const unclassified: Candidate[] = [];
  for (const c of cands) {
    const cls = classifyCase(c, facts.get(c.code) ?? null, c.oldCode ? facts.get(c.oldCode) ?? null : undefined);
    if (cls.length === 0) unclassified.push(c);
    for (const k of cls) byClass.get(k)!.push(c);
  }
  const attention = new Set<string>();
  for (const k of REJOIN_CLASSES) {
    const items = byClass.get(k)!;
    const distinct = new Set(items.map((c) => (k === "OLD_CODE_MISSING_IN_HRMS" ? c.oldCode! : c.code)));
    if (ATTENTION_CLASSES.includes(k)) distinct.forEach((x) => attention.add(x));
    out(`  ${k}: ${items.length} case(s), ${distinct.size} distinct code(s)`);
    if (k === "PAIR_UNLINKED_INFO") continue; // informational: counts only
    list(items.map(label));
  }
  out(`  no class (db_bill current stint not active and HRMS not active, no trace): ${unclassified.length}`);
  out();

  out("== VERDICT ==");
  const nonZero = ATTENTION_CLASSES.filter((k) => byClass.get(k)!.length > 0);
  if (nonZero.length === 0) {
    out("  Every db_bill rejoin candidate is present and consistent in HRMS (or informational only).");
  } else {
    out(`  Non-zero classes needing attention: ${nonZero.map((k) => `${k}=${byClass.get(k)!.length}`).join(", ")}`);
    out(`  Distinct employee codes needing attention: ${attention.size}`);
  }
  out(`  Informational: PAIR_UNLINKED_INFO=${byClass.get("PAIR_UNLINKED_INFO")!.length} (HRMS has no field linking an old and a new code), `
    + `REFLECTED=${byClass.get("REFLECTED")!.length}`);
  out(`  (lists capped at ${CAP}; totals are complete)`);
  out();
  out("READ-ONLY: nothing was changed in db_bill or mas_hrms.");
  await billMod.closeBillPool().catch(() => {});
  await mysqlMod.closePool().catch(() => {});
}

const invoked = process.argv[1] ?? "";
if (/rejoin-dbbill-compare\.[tj]s$/.test(invoked)) {
  main().then(() => process.exit(0), (e) => { console.error("compare failed:", (e as Error).message); process.exit(1); });
}
