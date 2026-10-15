/**
 * Answers from db_bill, READ-ONLY, aggregates only (no names):
 *  A. Employees paid in db_bill salary_data for a month but with no line on the HRMS payroll run of that month:
 *     split by db_bill LeftStatus / FnfStatus / earned days, and what HRMS knows about them (employee row, exit date,
 *     F&F rows) so the cost can be placed: in payroll, in F&F, or nowhere.
 *  B. The db_bill master row of a cost centre code (process, process name, client, branch) and the HRMS process it maps to.
 *
 *   npx tsx scripts/dbbill-leavers-and-cc.ts YYYY-MM "<cost centre code>"
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { nonVoidRunSql } from "../src/modules/payroll/run-status.js";

const r0 = (v: unknown) => Math.round(Number(v ?? 0));
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

(async () => {
  const period = process.argv[2];
  const ccCode = process.argv[3] ?? "";
  if (!/^\d{4}-\d{2}$/.test(period ?? "")) throw new Error("pass YYYY-MM");

  // ---- B: cost centre master
  if (ccCode) {
    const [h] = await db.query<RowDataPacket[]>(
      `SELECT ccm.id, ccm.bill_source_id, ccm.company_name, ccm.active_status, bm.branch_name, pm.process_name, pm.process_code, pm.client_name
         FROM cost_centre_master ccm LEFT JOIN branch_master bm ON bm.id = ccm.branch_id LEFT JOIN process_master pm ON pm.id = ccm.process_id
        WHERE ccm.cost_centre_code = ?`, [ccCode]);
    for (const r of h) console.log("LV_CC_HRMS " + JSON.stringify({ code: ccCode, billSourceId: r.bill_source_id, company: r.company_name, active: r.active_status, branch: r.branch_name, process: r.process_name, processCode: r.process_code, client: r.client_name }));
    for (const r of h) {
      if (!r.bill_source_id) continue;
      const rows = await billQuery<any>("SELECT * FROM cost_master WHERE id = ? LIMIT 1", [r.bill_source_id]);
      for (const x of rows) {
        const slim: Record<string, unknown> = {};
        for (const k of ["id", "branch", "OPBranch", "process", "process_name", "client", "stream", "category", "type", "tower", "dialdesk_client_id", "company", "cost_company_name", "status", "Status", "active"]) if (x[k] !== undefined && x[k] !== null) slim[k] = typeof x[k] === "string" ? x[k].trim().slice(0, 90) : x[k];
        console.log("LV_CC_DBBILL " + JSON.stringify(slim));
      }
    }
  }

  // ---- A: db_bill-only employees
  const cols = (await billQuery<any>("SHOW COLUMNS FROM salary_data")).map((c: any) => String(c.Field));
  const lower = new Map(cols.map((c) => [c.toLowerCase(), c]));
  const col = (n: string) => lower.get(n.toLowerCase());
  const dec = (c: string) => `COALESCE(CAST(NULLIF(TRIM(\`${c}\`), '') AS DECIMAL(18,2)), 0)`;
  const code = col("EmpCode")!;
  const bill = await billQuery<any>(
    `SELECT TRIM(\`${code}\`) AS code, TRIM(COALESCE(\`${col("LeftStatus")!}\`, '')) AS left_status, TRIM(COALESCE(\`${col("FnfStatus")!}\`, '')) AS fnf_status,
            SUM(${dec(col("CTC")!)}) AS ctc, SUM(${dec(col("EarnedDays")!)}) AS earned_days, SUM(${dec(col("Gross1")!)}) AS earned_gross,
            MAX(TRIM(COALESCE(\`${col("Branch")!}\`, ''))) AS branch
       FROM salary_data WHERE DATE_FORMAT(SalayDate,'%Y-%m') = ? GROUP BY TRIM(\`${code}\`)`, [period]);
  const [hl] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT e.employee_code AS code FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id AND r.run_month = ? AND ${nonVoidRunSql("r")}
       JOIN employees e ON e.id = l.employee_id`, [period]);
  const inHrms = new Set(hl.map((r) => String(r.code)));
  const only = bill.filter((b: any) => !inHrms.has(String(b.code)));
  const codes = only.map((b: any) => String(b.code));

  // What HRMS knows about them.
  const empCols = new Set(((await db.query<RowDataPacket[]>("SHOW COLUMNS FROM employees"))[0]).map((c) => String(c.Field)));
  const exitCol = ["last_working_date", "last_working_day", "exit_date", "relieving_date", "date_of_exit", "resignation_last_day", "separation_date"].find((c) => empCols.has(c)) ?? null;
  const known = new Map<string, { active: number; exit: string | null }>();
  for (let i = 0; i < codes.length; i += 500) {
    const chunk = codes.slice(i, i + 500);
    if (!chunk.length) continue;
    const [er] = await db.query<RowDataPacket[]>(
      `SELECT employee_code AS code, active_status AS active${exitCol ? `, \`${exitCol}\` AS exit_date` : ", NULL AS exit_date"} FROM employees WHERE employee_code IN (${chunk.map(() => "?").join(",")})`, chunk);
    for (const r of er) known.set(String(r.code), { active: Number(r.active), exit: r.exit_date ? String(r.exit_date).slice(0, 10) : null });
  }
  const fnfTables = ((await db.query<RowDataPacket[]>("SHOW TABLES"))[0]).map((r) => String(Object.values(r)[0])).filter((t) => /fnf|full.?final|settlement/i.test(t));
  console.log("LV_META " + JSON.stringify({ period, dbbillEmployees: bill.length, hrmsEmployees: inHrms.size, onlyInDbBill: only.length, exitColumn: exitCol, fnfTables }));

  const groups = new Map<string, { n: number; ctc: number; gross: number; days: number; inEmployees: number; exitInPeriod: number; inactive: number }>();
  for (const b of only) {
    const left = /^(0|no|false|active|n)?$/i.test(String(b.left_status)) ? "not-left" : "left";
    const fnf = /^(0|no|false|none|n)?$/i.test(String(b.fnf_status)) ? "no-fnf" : "fnf";
    const paid = num(b.earned_days) > 0 ? "earned-days>0" : "zero-days";
    const key = `${left} | ${fnf} | ${paid}`;
    const g = groups.get(key) ?? { n: 0, ctc: 0, gross: 0, days: 0, inEmployees: 0, exitInPeriod: 0, inactive: 0 };
    g.n++; g.ctc += num(b.ctc); g.gross += num(b.earned_gross); g.days += num(b.earned_days);
    const k = known.get(String(b.code));
    if (k) { g.inEmployees++; if (k.active === 0) g.inactive++; if (k.exit && k.exit.slice(0, 7) === period) g.exitInPeriod++; }
    groups.set(key, g);
  }
  for (const [k, g] of [...groups].sort((a, b) => b[1].ctc - a[1].ctc)) {
    console.log("LV_GROUP " + JSON.stringify({ group: k, employees: g.n, dbbillCtc: r0(g.ctc), dbbillEarnedGross: r0(g.gross), earnedDays: r0(g.days), foundInHrmsEmployees: g.inEmployees, inactiveInHrms: g.inactive, hrmsExitInPeriod: g.exitInPeriod }));
  }
  const byBranch = new Map<string, { n: number; ctc: number }>();
  for (const b of only) { const k = String(b.branch || "?"); const g = byBranch.get(k) ?? { n: 0, ctc: 0 }; g.n++; g.ctc += num(b.ctc); byBranch.set(k, g); }
  for (const [k, g] of [...byBranch].sort((a, b) => b[1].ctc - a[1].ctc).slice(0, 8)) console.log("LV_BRANCH " + JSON.stringify({ branch: k, employees: g.n, dbbillCtc: r0(g.ctc) }));

  // F&F rows in HRMS for these people (counts and sums only).
  for (const t of fnfTables) {
    try {
      const tc = ((await db.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${t}\``))[0]).map((c) => String(c.Field));
      const amountCols = tc.filter((c) => /net|total|payable|amount|salary/i.test(c)).slice(0, 5);
      console.log("LV_FNF_TABLE " + JSON.stringify({ table: t, columns: tc.slice(0, 40), amountCols }));
    } catch (e) { console.log("LV_FNF_ERR " + JSON.stringify({ table: t, error: String(e).slice(0, 80) })); }
  }
  await closeBillPool?.();
  await new Promise((resolve) => process.stdout.write("LV_DONE\n", resolve));
  process.exit(0);
})();
