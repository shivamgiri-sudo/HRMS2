/** READ-ONLY diagnostic: why do the 333 "current=applicable, resolver=not-applicable" employees
 * disagree? Checks the override table's overall state and samples wage/joining-date for the
 * disagreement population, to see if it looks like a real wage-ceiling pattern or a data issue. */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { closeBillPool } from "../src/db/billDb.js";
import { resolvePfApplicabilityForPeriod } from "../src/modules/payroll/pf-applicability.service.js";

const runMonth = "2026-07";

async function main() {
  const [statusCounts] = await db.execute<RowDataPacket[]>(
    `SELECT status, override_type, COUNT(*) AS c FROM employee_statutory_override GROUP BY status, override_type`,
  );
  console.log("employee_statutory_override, all rows by status/type:");
  for (const r of statusCounts as any[]) console.log(` ${r.status} / ${r.override_type}: ${r.c}`);
  console.log();

  const [activeRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.date_of_joining, esa.ctc_annual
       FROM employees e
       LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
      WHERE e.active_status = 1 AND e.employee_code IS NOT NULL`,
  );
  const active = activeRows as Array<{ id: string; employee_code: string; date_of_joining: string; ctc_annual: number | null }>;

  const resolved = await resolvePfApplicabilityForPeriod(runMonth);
  const disagreement: typeof active = [];
  for (const emp of active) {
    const code = emp.employee_code.trim().toUpperCase();
    const r = resolved.get(code);
    if (r?.status === "PF_NOT_APPLICABLE") disagreement.push(emp);
  }

  console.log(`${disagreement.length} employees: live engine says PF_APPLICABLE, resolver says PF_NOT_APPLICABLE.\n`);
  console.log("Sample (code, joining date, ctc_annual):");
  for (const e of disagreement.slice(0, 20)) {
    console.log(`  ${e.employee_code}  joined=${e.date_of_joining}  ctc_annual=${e.ctc_annual}`);
  }

  const ctcs = disagreement.map((e) => Number(e.ctc_annual)).filter((n) => !isNaN(n) && n > 0);
  ctcs.sort((a, b) => a - b);
  if (ctcs.length) {
    const monthlyBasicApprox = ctcs.map((c) => c / 12 / 2); // rough: basic is often ~50% of CTC
    console.log(`\nctc_annual distribution among the ${ctcs.length} with a value: min=${ctcs[0]} median=${ctcs[Math.floor(ctcs.length / 2)]} max=${ctcs[ctcs.length - 1]}`);
    console.log(`  rough monthly-basic (ctc/12/2) <= 15000 (PF wage ceiling): ${monthlyBasicApprox.filter((n) => n <= 15000).length}`);
    console.log(`  rough monthly-basic (ctc/12/2) > 15000: ${monthlyBasicApprox.filter((n) => n > 15000).length}`);
  }
  console.log(`  no ctc_annual on record at all: ${disagreement.length - ctcs.length}`);

  const joinYears = disagreement.map((e) => String(e.date_of_joining).slice(0, 4)).filter(Boolean);
  const yearCounts: Record<string, number> = {};
  for (const y of joinYears) yearCounts[y] = (yearCounts[y] ?? 0) + 1;
  console.log("\njoining year distribution:", yearCounts);
}

main()
  .catch((err) => { console.error("FATAL", err); process.exitCode = 1; })
  .finally(async () => { await db.end().catch(() => {}); await closeBillPool().catch(() => {}); });
