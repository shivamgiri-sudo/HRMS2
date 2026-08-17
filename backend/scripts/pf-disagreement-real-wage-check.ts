/** READ-ONLY. Re-checks the 333-employee PF disagreement against REAL basic wage
 * (employee_salary_snapshot.basic, not the earlier ctc/12/2 approximation) and whether
 * their own HRMS salary snapshot already shows PF configured as zero at hire time —
 * which would mean "didn't opt for PF" was already decided when they joined, not a lag. */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { closeBillPool } from "../src/db/billDb.js";
import { resolvePfApplicabilityForPeriod } from "../src/modules/payroll/pf-applicability.service.js";

const runMonth = "2026-07";
const PF_WAGE_CEILING = 15000;

async function main() {
  const [activeRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.date_of_joining,
            s.basic, s.gross, s.epf_employee, s.epf_employer
       FROM employees e
       LEFT JOIN employee_salary_snapshot s ON s.employee_id = e.id
      WHERE e.active_status = 1 AND e.employee_code IS NOT NULL`,
  );
  const active = activeRows as Array<{
    id: string; employee_code: string; date_of_joining: string;
    basic: number | null; gross: number | null; epf_employee: number | null; epf_employer: number | null;
  }>;

  const resolved = await resolvePfApplicabilityForPeriod(runMonth);
  const disagreement = active.filter((e) => {
    const code = e.employee_code.trim().toUpperCase();
    return resolved.get(code)?.status === "PF_NOT_APPLICABLE";
  });

  console.log(`${disagreement.length} employees: live default says PF applicable, resolver (db_bill) says NOT applicable.\n`);

  const withBasic = disagreement.filter((e) => e.basic != null && Number(e.basic) > 0);
  console.log(`Of those, ${withBasic.length} have a real basic wage on file in employee_salary_snapshot.basic (not estimated).`);

  const aboveCeiling = withBasic.filter((e) => Number(e.basic) > PF_WAGE_CEILING);
  const atOrBelowCeiling = withBasic.filter((e) => Number(e.basic) <= PF_WAGE_CEILING);
  console.log(`  basic > Rs 15,000/month (legally COULD opt out): ${aboveCeiling.length}`);
  console.log(`  basic <= Rs 15,000/month (legally MUST be covered, cannot opt out): ${atOrBelowCeiling.length}`);

  const zeroEpfAtHire = disagreement.filter((e) => e.epf_employee != null && Number(e.epf_employee) === 0);
  const nonZeroEpfAtHire = disagreement.filter((e) => e.epf_employee != null && Number(e.epf_employee) > 0);
  const noSnapshotRow = disagreement.filter((e) => e.epf_employee == null);
  console.log(`\nWhat their OWN HRMS salary snapshot (set at hire time) says about PF:`);
  console.log(`  epf_employee = 0 at hire (consistent with "opted out from day one"): ${zeroEpfAtHire.length}`);
  console.log(`  epf_employee > 0 at hire (HRMS itself expected PF to be deducted): ${nonZeroEpfAtHire.length}`);
  console.log(`  no salary snapshot row at all: ${noSnapshotRow.length}`);

  console.log(`\nSample of the 20 above the wage ceiling (basic > 15000) — the only group that could legitimately opt out:`);
  for (const e of aboveCeiling.slice(0, 20)) {
    console.log(`  ${e.employee_code}  joined=${e.date_of_joining}  basic=${e.basic}  epf_employee_at_hire=${e.epf_employee}`);
  }

  console.log(`\nSample of 20 AT/BELOW the ceiling (basic <= 15000) — should be mandatorily covered, cannot legally opt out:`);
  for (const e of atOrBelowCeiling.slice(0, 20)) {
    console.log(`  ${e.employee_code}  joined=${e.date_of_joining}  basic=${e.basic}  epf_employee_at_hire=${e.epf_employee}`);
  }
}

main()
  .catch((err) => { console.error("FATAL", err); process.exitCode = 1; })
  .finally(async () => { await db.end().catch(() => {}); await closeBillPool().catch(() => {}); });
