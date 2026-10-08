/** READ-ONLY. The real Form 11 PF opt-out record lives on ats_employment_offer.pf_opt_out
 * and candidate_onboarding_profile.pf_opt_out_elected, joined via
 * employees.employee_code = ats_candidate.employee_code = ats_candidate.id (candidate_id FK)
 * — NOT employee_statutory_override, which is empty. Checks real counts and cross-references
 * against the resolver's 333-employee disagreement population. */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { closeBillPool } from "../src/db/billDb.js";
import { resolvePfApplicabilityForPeriod } from "../src/modules/payroll/pf-applicability.service.js";

const runMonth = "2026-07";

async function main() {
  const [offerCounts] = await db.execute<RowDataPacket[]>(
    `SELECT pf_opt_out, COUNT(*) AS c FROM ats_employment_offer GROUP BY pf_opt_out`,
  );
  console.log("ats_employment_offer.pf_opt_out counts:");
  for (const r of offerCounts as any[]) console.log(`  pf_opt_out=${r.pf_opt_out}: ${r.c}`);

  const [profileCounts] = await db.execute<RowDataPacket[]>(
    `SELECT pf_opt_out_elected, COUNT(*) AS c FROM candidate_onboarding_profile GROUP BY pf_opt_out_elected`,
  );
  console.log("\ncandidate_onboarding_profile.pf_opt_out_elected counts:");
  for (const r of profileCounts as any[]) console.log(`  pf_opt_out_elected=${r.pf_opt_out_elected}: ${r.c}`);

  // Join to active employees via employee_code, pulling whichever opt-out signal exists.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code,
            MAX(off.pf_opt_out) AS offer_pf_opt_out,
            MAX(cop.pf_opt_out_elected) AS onboarding_pf_opt_out_elected
       FROM employees e
       LEFT JOIN ats_candidate ac ON ac.employee_code = e.employee_code
       LEFT JOIN ats_employment_offer off ON off.candidate_id = ac.id
       LEFT JOIN candidate_onboarding_profile cop ON cop.candidate_id = ac.id
      WHERE e.active_status = 1
      GROUP BY e.employee_code`,
  );
  const linked = rows as Array<{ employee_code: string; offer_pf_opt_out: number | null; onboarding_pf_opt_out_elected: number | null }>;
  const optedOut = linked.filter((r) => Number(r.offer_pf_opt_out) === 1 || Number(r.onboarding_pf_opt_out_elected) === 1);
  console.log(`\nActive employees with EITHER real opt-out signal = 1: ${optedOut.length} of ${linked.length}`);

  const resolved = await resolvePfApplicabilityForPeriod(runMonth);
  let matchNotApplicable = 0, mismatchApplicable = 0, mismatchUnresolved = 0;
  for (const r of optedOut) {
    const code = r.employee_code.trim().toUpperCase();
    const res = resolved.get(code);
    const status = res?.status ?? "PF_APPLICABILITY_UNRESOLVED";
    if (status === "PF_NOT_APPLICABLE") matchNotApplicable++;
    else if (status === "PF_APPLICABLE") mismatchApplicable++;
    else mismatchUnresolved++;
  }
  console.log(`\nOf the ${optedOut.length} really-opted-out employees:`);
  console.log(`  resolver agrees (PF_NOT_APPLICABLE): ${matchNotApplicable}`);
  console.log(`  resolver says PF_APPLICABLE anyway: ${mismatchApplicable}`);
  console.log(`  resolver UNRESOLVED: ${mismatchUnresolved}`);

  // And the reverse: of the 333 "current=applicable(default), resolver=not-applicable" set from
  // the earlier script, how many actually have a real opt-out record explaining the resolver's answer?
  const optedOutCodes = new Set(optedOut.map((r) => r.employee_code.trim().toUpperCase()));
  let disagreementExplainedByRealOptOut = 0, disagreementUnexplained = 0;
  for (const r of linked) {
    const code = r.employee_code.trim().toUpperCase();
    const res = resolved.get(code);
    if (res?.status === "PF_NOT_APPLICABLE") {
      if (optedOutCodes.has(code)) disagreementExplainedByRealOptOut++;
      else disagreementUnexplained++;
    }
  }
  console.log(`\nOf all employees where the resolver says PF_NOT_APPLICABLE:`);
  console.log(`  explained by a real Form 11 opt-out record: ${disagreementExplainedByRealOptOut}`);
  console.log(`  NOT explained by any opt-out record on file: ${disagreementUnexplained}`);
}

main()
  .catch((err) => { console.error("FATAL", err); process.exitCode = 1; })
  .finally(async () => { await db.end().catch(() => {}); await closeBillPool().catch(() => {}); });
