/**
 * db_bill orphan check. READ-ONLY on BOTH databases (one SELECT per query, through readOnly()).
 *
 * Question: an HRMS employee imported from db_bill.masjclrentry (employees.legacy_emp_id = that
 * row's id) no longer appears in db_bill. Was the row deleted, or recoded to another EmpCode? And
 * how many imported employees are in the same state (a pattern, not a one-off)?
 *
 *   (1) PROBE      db_bill rows by --ids, --name tokens (all must match), --codes (exact + numeric core)
 *   (2) HRMS       the same people in mas_hrms: dates, status, exit_request count/statuses
 *   (3) SYSTEMIC   every HRMS employee classified by its legacy_emp_id against db_bill (codes only)
 *   (4) VERDICT
 *
 * Names are printed only in (1), for the probe rows, capped at 20. Takes no write flags;
 * --apply / --dry-run / --mode are ignored.
 *
 *   npx tsx scripts/dbbill-orphan-check.ts --ids 392 --name KRUNAL --name SOLANKI --codes MAS02602
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import {
  CAP_PROBE,
  PAGE,
  numericCore,
  norm,
  parseArgs,
  readOnly,
  renderCodeProbe,
  renderIdProbe,
  renderNameProbe,
  renderSystemic,
  summarize,
  type Args,
  type BillProbeRow,
  type HrmsLegacyRow,
} from "./lib/orphanCheck.js";

type Row = Record<string, unknown>;
type Hrms = { execute: (sql: string, p?: unknown[]) => Promise<[unknown, unknown]> };
type Bill = <T = Row>(sql: string, p?: unknown[]) => Promise<T[]>;

let hrmsRef: Hrms | null = null;
let billRef: Bill | null = null;

const hq = async (sql: string, p: unknown[] = []): Promise<Row[]> => {
  const [rows] = (await hrmsRef!.execute(readOnly(sql), p)) as [RowDataPacket[], unknown];
  return rows as Row[];
};
const bq = async (sql: string, p: unknown[] = []): Promise<Row[]> => billRef!<Row>(readOnly(sql), p);

const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** Fixed-whitelist columns: present -> CAST(col AS CHAR), absent -> NULL. Names come from code, never input. */
function colExpr(present: Set<string>, col: string, alias = col, cast = true): string {
  if (!present.has(col.toLowerCase())) return `NULL AS ${alias}`;
  return cast ? `CAST(${col} AS CHAR) AS ${alias}` : `${col} AS ${alias}`;
}

async function columnsOf(run: (sql: string, p?: unknown[]) => Promise<Row[]>, table: string): Promise<Set<string>> {
  const rows = await run(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
  return new Set(rows.map((r) => String(r.c).toLowerCase()));
}

export async function main(args: Args): Promise<void> {
  const mysqlMod = await import("../src/db/mysql.js");
  const billMod = await import("../src/db/billDb.js");
  hrmsRef = mysqlMod.db as unknown as Hrms;
  billRef = billMod.billQuery as unknown as Bill;

  try {
    console.log("DB_BILL ORPHAN CHECK (read-only on db_bill and mas_hrms)");
    if (args.ignored.length) console.log(`ignored flags: ${args.ignored.join(" ")} (this script never writes)`);
    console.log(`probe ids: ${args.ids.join(",") || "-"} | name tokens: ${args.names.join(" + ") || "-"} | codes: ${args.codes.join(",") || "-"}\n`);

    // ---------------------------------------------------------------- (1) PROBE
    const billCols = await columnsOf(bq, "masjclrentry");
    const probeCols = [
      "id",
      "UPPER(TRIM(EmpCode)) AS code",
      colExpr(billCols, "Status"),
      colExpr(billCols, "DOJ"),
      colExpr(billCols, "DOL"),
      colExpr(billCols, "ResignationDate"),
      colExpr(billCols, "left_type"),
      colExpr(billCols, "lastUpdated"),
      "EmpName",
    ].join(", ");

    console.log("== (1) PROBE: db_bill.masjclrentry ==");
    const foundCodes = new Set<string>();
    const idRows: BillProbeRow[] = [];
    if (args.ids.length) {
      const ids = args.ids.slice(0, CAP_PROBE);
      const rows = await bq(
        `SELECT ${probeCols} FROM masjclrentry WHERE id IN (${ph(ids.length)}) ORDER BY id LIMIT ${CAP_PROBE}`, ids);
      idRows.push(...(rows as unknown as BillProbeRow[]));
      for (const l of renderIdProbe(args.ids, idRows)) console.log(l);
      idRows.forEach((r) => foundCodes.add(norm(r.code)));
    } else console.log("  (no --ids)");

    let nameRows: BillProbeRow[] = [];
    if (args.names.length) {
      const where = args.names.map(() => "UPPER(EmpName) LIKE ?").join(" AND ");
      const params = args.names.map((t) => `%${t}%`);
      const tot = await bq(`SELECT COUNT(*) AS n FROM masjclrentry WHERE ${where}`, params);
      nameRows = (await bq(
        `SELECT ${probeCols} FROM masjclrentry WHERE ${where} ORDER BY id LIMIT ${CAP_PROBE}`, params)) as unknown as BillProbeRow[];
      console.log("");
      for (const l of renderNameProbe(args.names, nameRows, Number(tot[0]?.n ?? 0))) console.log(l);
      nameRows.forEach((r) => foundCodes.add(norm(r.code)));
    } else console.log("  (no --name)");

    const exactByCode = new Map<string, number>();
    for (const code of args.codes) {
      const exact = (await bq(
        `SELECT ${probeCols} FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = ? ORDER BY id LIMIT ${CAP_PROBE}`, [code])) as unknown as BillProbeRow[];
      exactByCode.set(code, exact.length);
      exact.forEach((r) => foundCodes.add(norm(r.code)));
      const core = numericCore(code);
      let like: BillProbeRow[] = [];
      let likeTotal = 0;
      if (core !== null) {
        const tot = await bq(`SELECT COUNT(*) AS n FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) LIKE ?`, [`%${core}%`]);
        likeTotal = Number(tot[0]?.n ?? 0);
        like = (await bq(
          `SELECT id, UPPER(TRIM(EmpCode)) AS code FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) LIKE ? ORDER BY id LIMIT ${CAP_PROBE}`,
          [`%${core}%`])) as unknown as BillProbeRow[];
      }
      console.log("");
      for (const l of renderCodeProbe(code, exact, like, likeTotal)) console.log(l);
    }
    if (!args.codes.length) console.log("  (no --codes)");
    console.log("");

    // ---------------------------------------------------------------- (2) HRMS
    console.log("== (2) HRMS: the same people in mas_hrms.employees ==");
    const empCols = await columnsOf(hq, "employees");
    const want = ["employee_code", "legacy_emp_id", "employment_status", "active_status", "date_of_joining", "date_of_exit",
      "date_of_leaving", "resignation_date", "created_at", "updated_at", "source"];
    console.log(`  ('source' column ${empCols.has("source") ? "present" : "absent; shown as -"})`);
    const hrmsCodes = [...new Set([...args.codes, ...foundCodes])].filter(Boolean);
    const conds: string[] = [];
    const params: unknown[] = [];
    if (hrmsCodes.length) { conds.push(`UPPER(TRIM(e.employee_code)) IN (${ph(hrmsCodes.length)})`); params.push(...hrmsCodes); }
    if (args.ids.length) { conds.push(`e.legacy_emp_id IN (${ph(args.ids.length)})`); params.push(...args.ids.map(String)); }
    const legacyById = new Map<number, string[]>();
    const hrmsFound = new Set<string>();
    if (conds.length) {
      const sel = want.map((c) => (empCols.has(c) ? `e.${c} AS ${c}` : `NULL AS ${c}`)).join(", ");
      const people = await hq(`SELECT e.id AS eid, ${sel} FROM employees e WHERE ${conds.join(" OR ")} ORDER BY e.employee_code LIMIT 50`, params);
      const hasExit = (await hq(
        `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exit_request'`))[0];
      const exits = new Map<string, string>();
      if (Number(hasExit?.n) > 0 && people.length) {
        const eids = people.map((p) => p.eid);
        const xr = await hq(
          `SELECT x.employee_id AS eid, COUNT(x.employee_id) AS n, GROUP_CONCAT(DISTINCT x.status ORDER BY x.status) AS statuses
             FROM exit_request x WHERE x.employee_id IN (${ph(eids.length)}) GROUP BY x.employee_id`, eids);
        for (const r of xr) exits.set(String(r.eid), `${r.n} (${r.statuses ?? "-"})`);
      }
      console.log(`  columns: ${want.join(" | ")} | exit_request`);
      if (!people.length) console.log("  (no HRMS employee matches these codes / legacy ids)");
      for (const p of people) {
        const code = norm(p.employee_code);
        hrmsFound.add(code);
        const lid = p.legacy_emp_id === null ? null : Number(p.legacy_emp_id);
        if (lid !== null && args.ids.includes(lid)) legacyById.set(lid, [...(legacyById.get(lid) ?? []), code]);
        const vals = want.map((c) => (p[c] === null || p[c] === undefined ? "-" : String(p[c])));
        console.log(`  ${vals.join(" | ")} | ${exits.get(String(p.eid)) ?? (Number(hasExit?.n) > 0 ? "0" : "n/a (no table)")}`);
      }
      for (const c of hrmsCodes) if (!hrmsFound.has(c)) console.log(`  ${c}: not in HRMS employees`);
    } else console.log("  (nothing to look up)");
    console.log("");

    // ---------------------------------------------------------------- (3) SYSTEMIC
    console.log("== (3) SYSTEMIC: HRMS employees vs db_bill by legacy_emp_id (codes only) ==");
    const billById = new Map<number, string>();
    const billCodes = new Set<string>();
    for (let cursor = 0; ;) {
      const page = await bq(`SELECT id, UPPER(TRIM(EmpCode)) AS code FROM masjclrentry WHERE id > ? ORDER BY id LIMIT ${PAGE}`, [cursor]);
      for (const r of page) { billById.set(Number(r.id), String(r.code ?? "")); billCodes.add(norm(r.code)); }
      if (page.length < PAGE) break;
      cursor = Number(page[page.length - 1].id);
    }
    const billIds = [...billById.keys()];
    const minId = billIds.reduce((m, x) => Math.min(m, x), billIds.length ? Infinity : 0);
    const maxId = billIds.reduce((m, x) => Math.max(m, x), 0);
    console.log(`  db_bill masjclrentry: ${billById.size} rows, id range ${minId}..${maxId} (${maxId - minId + 1 - billById.size} ids in that range have no row)`);

    const emps: HrmsLegacyRow[] = [];
    for (let cursor = ""; ;) {
      const page = await hq(
        `SELECT id, employee_code, legacy_emp_id, employment_status, active_status, date_of_joining
           FROM employees WHERE id > ? ORDER BY id LIMIT ${PAGE}`, [cursor]);
      for (const r of page) emps.push({
        employee_code: String(r.employee_code ?? ""),
        legacy_emp_id: r.legacy_emp_id as string | number | null,
        employment_status: (r.employment_status as string | null) ?? null,
        active_status: r.active_status as number | null,
        date_of_joining: r.date_of_joining === null || r.date_of_joining === undefined ? null : String(r.date_of_joining),
      });
      if (page.length < PAGE) break;
      cursor = String(page[page.length - 1].id);
    }
    const legacy = emps.filter((e) => e.legacy_emp_id !== null && e.legacy_emp_id !== undefined && String(e.legacy_emp_id).trim() !== "");
    const perId = new Map<string, number>();
    for (const e of legacy) perId.set(String(e.legacy_emp_id).trim(), (perId.get(String(e.legacy_emp_id).trim()) ?? 0) + 1);
    const shared = [...perId.values()].filter((n) => n > 1).length;
    const legacyNums = legacy.map((e) => Number(e.legacy_emp_id)).filter((n) => Number.isFinite(n));
    console.log(`  HRMS employees: ${emps.length}; with legacy_emp_id: ${legacy.length}` +
      (legacyNums.length
        ? ` (legacy id range ${legacyNums.reduce((m, x) => Math.min(m, x), Infinity)}..${legacyNums.reduce((m, x) => Math.max(m, x), 0)})`
        : "") +
      `; legacy ids shared by more than one HRMS employee: ${shared}`);

    const summary = summarize(emps, billById, billCodes);
    for (const l of renderSystemic(summary, args.codes)) console.log(l);
    console.log("");

    // ---------------------------------------------------------------- (4) VERDICT
    console.log("== (4) VERDICT ==");
    for (const id of args.ids) {
      const row = idRows.find((r) => Number(r.id) === id);
      const imported = legacyById.get(id) ?? [];
      const who = imported.length ? ` HRMS employee(s) imported from it: ${imported.join(", ")}.` : " No HRMS employee has this legacy_emp_id.";
      if (!row) console.log(`  db_bill row id ${id} no longer exists in masjclrentry (deleted).${who}`);
      else if (imported.length && imported.every((c) => c === norm(row.code))) console.log(`  db_bill row id ${id} still exists with the same code ${norm(row.code)}.${who}`);
      else console.log(`  db_bill row id ${id} exists but now carries code ${norm(row.code)}.${who}`);
    }
    if (args.names.length) {
      console.log(nameRows.length
        ? `  db_bill rows whose name contains ${args.names.join(" + ")}: codes ${[...new Set(nameRows.map((r) => norm(r.code)))].join(", ")} (ids ${nameRows.map((r) => r.id).join(", ")}).`
        : `  No db_bill row has a name containing ${args.names.join(" + ")}.`);
    }
    for (const code of args.codes) {
      const cls = summary.classOf.get(code);
      console.log(`  ${code}: ${exactByCode.get(code) ? "present" : "absent"} in db_bill by exact code; HRMS class: ${cls ?? "not in HRMS employees"}.`);
    }
    const gone = summary.counts.LEGACY_ID_MISSING_IN_DB_BILL;
    const changed = summary.counts.CODE_CHANGED_IN_DB_BILL;
    console.log(`  Of ${legacy.length} HRMS employees imported from db_bill, ${gone} point at a db_bill row that no longer exists ` +
      `(${summary.byClass.LEGACY_ID_MISSING_IN_DB_BILL.codeElsewhere} of them still have their code on another db_bill row), ` +
      `and ${changed} point at a row that now carries a different code.`);
    const probed = args.codes.filter((c) => {
      const k = summary.classOf.get(c);
      return k === "LEGACY_ID_MISSING_IN_DB_BILL" || k === "CODE_CHANGED_IN_DB_BILL";
    }).length;
    console.log(gone + changed > probed
      ? `  This is a PATTERN, not a one-off: ${gone + changed - probed} other imported employee(s) are in the same state.`
      : "  This looks like a ONE-OFF: no other imported employee is in the same state.");
    console.log(`  HRMS employees without legacy_emp_id whose code is not in db_bill (HRMS-native): ${summary.counts.HRMS_NATIVE_NOT_IN_DB_BILL}.`);
    console.log("READ-ONLY: nothing was changed in db_bill or mas_hrms.");
  } finally {
    await billMod.closeBillPool().catch(() => {});
    await mysqlMod.closePool().catch(() => {});
  }
}

const invoked = process.argv[1] ?? "";
if (/dbbill-orphan-check\.[tj]s$/.test(invoked)) {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error("dbbill-orphan-check:", (e as Error).message);
    process.exit(2);
  }
  main(args).then(() => process.exit(0), (e) => { console.error("dbbill-orphan-check failed:", (e as Error).message); process.exit(1); });
}
