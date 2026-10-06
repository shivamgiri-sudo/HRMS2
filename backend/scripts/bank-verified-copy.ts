/**
 * Copy verified bank accounts that never reached the employee record.
 *
 * From 2026-10-06 a verification that passes after a joiner became an employee is copied
 * automatically (copyVerifiedBankToEmployee, called from verifyBankForCandidate). This catches
 * the ones verified before that: their accounts sit on the onboarding record and the joiners
 * stay in the Ops Control Tower's penny-drop pending list. Only verified, non-mock latest
 * attempts are copied, and only when the stored number is the one the bank verified.
 * Prints employee codes and outcomes only, never account numbers.
 *
 *   npx tsx scripts/bank-verified-copy.ts            # dry run
 *   npx tsx scripts/bank-verified-copy.ts --apply
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  copyVerifiedBankToEmployee,
  findStrandedVerifiedCandidates,
} from "../src/modules/payroll/bank-manual-review.service.js";

const APPLY = process.argv.includes("--apply");

(async () => {
  const candidateIds = await findStrandedVerifiedCandidates();
  const tally: Record<string, number> = {};
  for (const candidateId of candidateIds) {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT employee_code FROM ats_candidate WHERE id = ?`, [candidateId]);
    const code = String((rows as RowDataPacket[])[0]?.employee_code ?? candidateId);
    try {
      const { status } = await copyVerifiedBankToEmployee(candidateId, { dryRun: !APPLY });
      tally[status] = (tally[status] ?? 0) + 1;
      console.log(`${code}\t${status}`);
    } catch (e) {
      tally.error = (tally.error ?? 0) + 1;
      console.log(`${code}\terror: ${(e as Error).message}`);
    }
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"}: ${candidateIds.length} verified with no employee bank record`, tally);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
