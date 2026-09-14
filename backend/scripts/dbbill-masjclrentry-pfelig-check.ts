/** READ-ONLY. masjclrentry is db_bill's JOINING CLEARANCE table — recorded once, at hire, not
 * per payroll month like salary_data. It carries its own pfelig column. If PF opt-out is really
 * decided by HR at joining/offer time (as described), this is the more likely authoritative
 * record than salary_data.PFELig, which reflects what a given month's payroll run applied. */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { getBillPool, closeBillPool } from "../src/db/billDb.js";
import { resolvePfApplicabilityForPeriod } from "../src/modules/payroll/pf-applicability.service.js";

const runMonth = "2026-07";

async function main() {
  const pool = await getBillPool();

  const [pfeligCounts] = await pool.query<any[]>(
    `SELECT pfelig, COUNT(*) AS c FROM masjclrentry GROUP BY pfelig ORDER BY c DESC`,
  );
  console.log("masjclrentry.pfelig value distribution (all 33,211 rows):");
  for (const r of pfeligCounts) console.log(`  '${r.pfelig}': ${r.c}`);

  const [emCounts] = await pool.query<any[]>(
    `SELECT pfelig, COUNT(*) AS c FROM employee_master GROUP BY pfelig ORDER BY c DESC`,
  );
  console.log("\nemployee_master.pfelig value distribution (all 35,902 rows):");
  for (const r of emCounts) console.log(`  '${r.pfelig}': ${r.c}`);

  // Now cross-reference the 333 HRMS/resolver disagreement population against masjclrentry.
  const [activeRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code FROM employees WHERE active_status = 1 AND employee_code IS NOT NULL`,
  );
  const codes = (activeRows as Array<{ employee_code: string }>).map((r) => r.employee_code.trim().toUpperCase());

  const resolved = await resolvePfApplicabilityForPeriod(runMonth);
  const disagreementCodes = codes.filter((c) => resolved.get(c)?.status === "PF_NOT_APPLICABLE");
  console.log(`\n${disagreementCodes.length} disagreement employee codes to check against masjclrentry.`);

  const placeholders = disagreementCodes.map(() => "?").join(",");
  const [mjRows] = await pool.query<any[]>(
    `SELECT TRIM(EmpCode) AS code, pfelig, EPF, EpfDate, EPFNo
       FROM masjclrentry WHERE TRIM(EmpCode) IN (${placeholders})`,
    disagreementCodes,
  );
  const mjByCode = new Map<string, any>();
  for (const r of mjRows) mjByCode.set(String(r.code).trim().toUpperCase(), r);
  console.log(`Found in masjclrentry: ${mjByCode.size} of ${disagreementCodes.length}`);

  const pfeligBuckets: Record<string, number> = {};
  for (const code of disagreementCodes) {
    const row = mjByCode.get(code);
    const key = row ? `pfelig='${row.pfelig}'` : "NOT_IN_MASJCLRENTRY";
    pfeligBuckets[key] = (pfeligBuckets[key] ?? 0) + 1;
  }
  console.log("\nWhat masjclrentry says for the 333 disagreement employees:");
  for (const [k, c] of Object.entries(pfeligBuckets).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${c}`);

  console.log("\nSample of 20 matched rows:");
  let shown = 0;
  for (const code of disagreementCodes) {
    const row = mjByCode.get(code);
    if (!row) continue;
    console.log(`  ${code}  masjclrentry.pfelig='${row.pfelig}' EPF='${row.EPF}' EpfDate='${row.EpfDate}' EPFNo='${row.EPFNo}'`);
    if (++shown >= 20) break;
  }
}

main()
  .catch((err) => { console.error("FATAL", err); process.exitCode = 1; })
  .finally(async () => { await db.end().catch(() => {}); await closeBillPool().catch(() => {}); });
