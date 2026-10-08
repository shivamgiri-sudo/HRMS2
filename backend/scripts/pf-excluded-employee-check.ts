/** READ-ONLY. Checks employee_epf_compliance_profile.excluded_employee / pf_applicable —
 * the real opt-out mechanism, distinct from the empty employee_statutory_override table —
 * against the 333-employee resolver-disagreement population found earlier. */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { closeBillPool } from "../src/db/billDb.js";
import { resolvePfApplicabilityForPeriod } from "../src/modules/payroll/pf-applicability.service.js";

const runMonth = "2026-07";

async function main() {
  const [totalRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM employee_epf_compliance_profile`,
  );
  console.log(`employee_epf_compliance_profile total rows: ${(totalRows as any[])[0].c}`);

  const [byFlags] = await db.execute<RowDataPacket[]>(
    `SELECT excluded_employee, pf_applicable, COUNT(*) AS c
       FROM employee_epf_compliance_profile
      GROUP BY excluded_employee, pf_applicable`,
  );
  console.log("\nBy (excluded_employee, pf_applicable):");
  for (const r of byFlags as any[]) console.log(`  excluded=${r.excluded_employee} pf_applicable=${r.pf_applicable}: ${r.c}`);

  // Join to active employees so we can compare against the resolver population.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, p.excluded_employee, p.pf_applicable, p.previous_pf_member, p.gross_monthly_wage
       FROM employees e
       JOIN employee_epf_compliance_profile p ON p.employee_id = e.id
      WHERE e.active_status = 1`,
  );
  const profiles = rows as Array<{ employee_code: string; excluded_employee: number; pf_applicable: number; previous_pf_member: number; gross_monthly_wage: number | null }>;
  console.log(`\nActive employees WITH an epf_compliance_profile row: ${profiles.length}`);

  const resolved = await resolvePfApplicabilityForPeriod(runMonth);

  // Cross-tab: resolver status vs excluded_employee flag, for employees who have a profile row.
  const crosstab: Record<string, number> = {};
  for (const p of profiles) {
    const code = p.employee_code.trim().toUpperCase();
    const r = resolved.get(code);
    const rStatus = r?.status ?? "PF_APPLICABILITY_UNRESOLVED";
    const key = `resolver=${rStatus} / excluded_employee=${p.excluded_employee} / pf_applicable=${p.pf_applicable}`;
    crosstab[key] = (crosstab[key] ?? 0) + 1;
  }
  console.log("\nCross-tab (resolver status vs compliance-profile flags):");
  for (const [k, c] of Object.entries(crosstab).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${c}`);

  // How many active employees have NO epf_compliance_profile row at all?
  const [activeCountRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM employees WHERE active_status = 1`,
  );
  const activeCount = (activeCountRows as any[])[0].c;
  console.log(`\nActive employees total: ${activeCount}, with a compliance profile row: ${profiles.length}, WITHOUT one: ${activeCount - profiles.length}`);
}

main()
  .catch((err) => { console.error("FATAL", err); process.exitCode = 1; })
  .finally(async () => { await db.end().catch(() => {}); await closeBillPool().catch(() => {}); });
