/**
 * Rejoin stale-exit audit. STRICTLY READ-ONLY (SELECT / WITH ... SELECT only).
 *
 * Question: are there employees rejoined through the OLD Reactivation flow (which set the employee
 * Active but never touched the old exit_request) that payroll still treats as ended?
 * Payroll's resolver (payroll/employment-end-date.ts) takes the exit LWD first, so an Active
 * employee whose stale LWD is before the run month is excluded from that run.
 *
 * Output is employee_code only (no names, no other PII). Takes no write flags; --apply and
 * --dry-run are ignored. Works before the rejoin-v3 migration (employment_stint is optional).
 *
 *   npx tsx scripts/rejoin-stale-exit-audit.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { EMPLOYMENT_END_DATE_SQL } from "../src/modules/payroll/employment-end-date.js";

const CAP = 50;

/** Every query goes through this. Throws on anything that is not a SELECT / WITH ... SELECT. */
export function readOnly(sql: string): string {
  const s = String(sql).trim().toLowerCase();
  if (!(s.startsWith("select") || s.startsWith("with"))) {
    throw new Error(`rejoin-stale-exit-audit is read-only; refused: ${s.slice(0, 40)}`);
  }
  return sql;
}

type Row = Record<string, unknown>;
let dbRef: { execute: (sql: string, p?: unknown[]) => Promise<[unknown, unknown]> } | null = null;
const q = async (sql: string, p: unknown[] = []): Promise<Row[]> => {
  const safe = readOnly(sql);
  const [rows] = (await dbRef!.execute(safe, p)) as [RowDataPacket[], unknown];
  return rows as Row[];
};

const LWD = "COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed)";
const ACTIVE = "LOWER(e.employment_status) = 'active' AND e.active_status = 1";
const OPERATIVE = "LOWER(x.status) IN ('accepted','notice_serving','exited')";

function monthStr(y: number, m0: number): string {
  const d = new Date(Date.UTC(y, m0, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function show(rows: Row[], total: number): void {
  if (rows.length === 0) { console.log("  (none)"); return; }
  for (const r of rows) console.log("  " + Object.values(r).map((v) => (v === null ? "-" : String(v))).join(" | "));
  if (total > rows.length) console.log(`  ... ${total - rows.length} more not shown (cap ${CAP})`);
}

export async function main(): Promise<void> {
  const mod = await import("../src/db/mysql.js");
  dbRef = mod.db as unknown as typeof dbRef;

  const now = new Date();
  const cur = monthStr(now.getFullYear(), now.getMonth());
  const prev = monthStr(now.getFullYear(), now.getMonth() - 1);

  console.log("REJOIN STALE-EXIT AUDIT (read-only; any --apply/--dry-run flag is ignored)");
  console.log(`current month ${cur}, previous month ${prev}\n`);

  // (a)
  console.log("== (a) Active employees that still hold an operative exit_request ==");
  console.log("  columns: employee_code | exit_status | exit_sub_type | LWD | date_of_exit | date_of_joining | approved_reactivation | proposed_joining_date | hr_final_actioned_at");
  const fromA = `
      FROM employees e JOIN exit_request x ON x.employee_id = e.id
     WHERE ${ACTIVE} AND ${OPERATIVE}`;
  const aTot = await q(`SELECT COUNT(DISTINCT e.id) emps, COUNT(*) exits ${fromA}`);
  const aApp = await q(
    `SELECT COUNT(DISTINCT e.id) n ${fromA}
        AND EXISTS (SELECT 1 FROM employee_reactivation_requests r WHERE r.employee_id = e.id AND LOWER(r.status) = 'approved')`);
  const aRows = await q(
    `SELECT e.employee_code, x.status exit_status, x.exit_sub_type,
            DATE_FORMAT(${LWD}, '%Y-%m-%d') lwd,
            DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') date_of_exit,
            DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') date_of_joining,
            IF(EXISTS (SELECT 1 FROM employee_reactivation_requests r WHERE r.employee_id = e.id AND LOWER(r.status) = 'approved'), 'yes', 'no') approved_reactivation,
            (SELECT DATE_FORMAT(r.proposed_joining_date, '%Y-%m-%d') FROM employee_reactivation_requests r
              WHERE r.employee_id = e.id AND LOWER(r.status) = 'approved' ORDER BY r.hr_final_actioned_at DESC LIMIT 1) proposed_joining_date,
            (SELECT DATE_FORMAT(r.hr_final_actioned_at, '%Y-%m-%d %H:%i:%s') FROM employee_reactivation_requests r
              WHERE r.employee_id = e.id AND LOWER(r.status) = 'approved' ORDER BY r.hr_final_actioned_at DESC LIMIT 1) hr_final_actioned_at
       ${fromA} ORDER BY e.employee_code, x.created_at LIMIT ${CAP}`);
  const aEmps = Number(aTot[0]?.emps ?? 0);
  show(aRows, Number(aTot[0]?.exits ?? 0));
  console.log(`  TOTAL Active-with-operative-exit employees: ${aEmps} (exit rows: ${aTot[0]?.exits})`);
  console.log(`  of which with an APPROVED reactivation request: ${aApp[0]?.n}\n`);

  // (b)
  console.log("== (b) Of (a): resolved payroll end date earlier than the run-month start (wrongly excluded) ==");
  let wrongTotal = 0;
  const perMonth: string[] = [];
  for (const [label, month] of [["CURRENT", cur], ["PREVIOUS", prev]] as const) {
    const where = `FROM employees e WHERE ${ACTIVE}
        AND EXISTS (SELECT 1 FROM exit_request x WHERE x.employee_id = e.id AND ${OPERATIVE})
        AND ${EMPLOYMENT_END_DATE_SQL} < CONCAT(?, '-01')`;
    const tot = await q(`SELECT COUNT(*) n ${where}`, [month]);
    const rows = await q(
      `SELECT e.employee_code, DATE_FORMAT(${EMPLOYMENT_END_DATE_SQL}, '%Y-%m-%d') resolved_end_date ${where}
        ORDER BY e.employee_code LIMIT ${CAP}`, [month]);
    const n = Number(tot[0]?.n ?? 0);
    wrongTotal += n;
    perMonth.push(`${month}: ${n}`);
    console.log(`  ${label} month ${month}: ${n} wrongly excluded (employee_code | resolved_end_date)`);
    show(rows, n);
  }
  console.log("");

  // (c)
  console.log("== (c) employee_reactivation_requests ==");
  const byStatus = await q(`SELECT status, COUNT(*) n FROM employee_reactivation_requests GROUP BY status ORDER BY status`);
  for (const r of byStatus) console.log(`  status ${r.status}: ${r.n}`);
  const appr = await q(`SELECT COUNT(*) n FROM employee_reactivation_requests WHERE LOWER(status) = 'approved'`);
  console.log(`  approved total: ${appr[0]?.n}`);
  console.log("  last 10 approved (employee_code | proposed_joining_date | hr_final_actioned_at)");
  show(await q(
    `SELECT e.employee_code, DATE_FORMAT(r.proposed_joining_date, '%Y-%m-%d') proposed_joining_date,
            DATE_FORMAT(r.hr_final_actioned_at, '%Y-%m-%d %H:%i:%s') hr_final_actioned_at
       FROM employee_reactivation_requests r JOIN employees e ON e.id = r.employee_id
      WHERE LOWER(r.status) = 'approved' ORDER BY r.hr_final_actioned_at DESC LIMIT 10`), 0);
  console.log("");

  // (d)
  console.log("== (d) employment_stint ==");
  const has = await q(
    `SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employment_stint'`);
  if (Number(has[0]?.n) === 0) {
    console.log("  employment_stint not migrated yet");
  } else {
    const st = await q(`SELECT COUNT(*) n, COUNT(DISTINCT employee_id) emps FROM employment_stint`);
    console.log(`  rows: ${st[0]?.n}, distinct employees: ${st[0]?.emps}`);
  }
  console.log("");

  // (e)
  console.log("== (e) verdict ==");
  console.log(
    wrongTotal > 0
      ? `  VERDICT: Active employees wrongly excluded from payroll by a stale exit LWD - ${perMonth.join(", ")}. Fix needed.`
      : "  VERDICT: none found - no Active employee is excluded from the current or previous month by a stale exit LWD.");
  console.log("  READ-ONLY: nothing was changed.");
}

const invoked = process.argv[1] ?? "";
if (/rejoin-stale-exit-audit\.[tj]s$/.test(invoked)) {
  main().then(() => process.exit(0), (e) => { console.error("audit failed:", (e as Error).message); process.exit(1); });
}
