/**
 * Re-judge bank checks stuck in manual review against the current name matcher.
 *
 * Luckpay confirmed these accounts and returned the owner's name, but the old
 * comparison (one profile name, no KM honorific, no dropped-vowel spelling) sent
 * them to manual review, so the joiners sat in the Ops Control Tower's penny-drop
 * pending list. This replays the stored bank answer through verifyBankForCandidate,
 * which reuses it (findReusableBankAnswer) instead of buying a new penny drop.
 *
 * Only candidates whose stored answer is within the 29-day reuse window and was
 * given for the account currently on file are touched, so apply never calls the bank.
 * Prints employee codes and verdicts only, never names or account numbers.
 *
 *   npx tsx scripts/bank-verify-rejudge.ts            # dry run
 *   npx tsx scripts/bank-verify-rejudge.ts --apply
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { classifyNameMatch } from "../src/modules/ats/indian-name-match.js";
import { recordedIdentityNames, verifyBankForCandidate } from "../src/modules/ats/bgv-verification.service.js";

const APPLY = process.argv.includes("--apply");

(async () => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id AS candidate_id, c.employee_code, c.full_name, p.employee_name,
            (SELECT e.full_name FROM employees e WHERE e.employee_code = c.employee_code AND c.employee_code <> '' LIMIT 1) AS employee_record_name,
            v.provider_account_holder_name, v.verification_status, v.created_at
       FROM candidate_bank_verification v
       JOIN ats_candidate c ON c.id = v.candidate_id
       JOIN candidate_onboarding_bank_detail b ON b.candidate_id = c.id AND b.account_no_hash = v.account_no_hash
  LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
      WHERE v.verification_status IN ('manual_review', 'verified')
        AND COALESCE(v.provider_account_holder_name, '') <> ''
        AND COALESCE(v.provider_key, '') NOT LIKE '%mock%'
        AND v.created_at >= NOW() - INTERVAL 29 DAY
        AND v.created_at = (SELECT MAX(v2.created_at) FROM candidate_bank_verification v2
                             WHERE v2.candidate_id = v.candidate_id AND COALESCE(v2.provider_account_holder_name, '') <> '')
        -- still open: no verified attempt since
        AND NOT EXISTS (SELECT 1 FROM candidate_bank_verification v3
                         WHERE v3.candidate_id = v.candidate_id AND v3.verification_status = 'verified')`,
  );

  let clear = 0;
  let stay = 0;
  for (const r of rows) {
    const names = recordedIdentityNames(r);
    const hit = names.map((n) => classifyNameMatch(n, r.provider_account_holder_name)).find((m) => !m.suspicious && m.tier !== "unknown");
    const code = String(r.employee_code || r.candidate_id);
    if (!hit) {
      stay += 1;
      console.log(`${code}\tstays manual_review`);
      continue;
    }
    clear += 1;
    if (!APPLY) {
      console.log(`${code}\twould clear (${hit.tier}, ${hit.score})`);
      continue;
    }
    try {
      const status = await verifyBankForCandidate(String(r.candidate_id), {}, { actorType: "system" });
      const bank = (status as { checks?: Array<{ check_type?: string; status?: string }> })?.checks?.find((c) => c.check_type === "bank");
      console.log(`${code}\treplayed -> ${bank?.status ?? "done"}`);
    } catch (e) {
      console.log(`${code}\treplay failed: ${(e as Error).message}`);
    }
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"}: ${rows.length} open with a bank-returned name; ${clear} clear, ${stay} stay in manual review`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
