/**
 * Credits PAN for candidates whose DigiLocker session already completed but whose PAN check was
 * never marked verified, because the old rule only looked at the downloaded file's name.
 *
 * The provider only returns full PII once per transaction, so the session cannot be re-polled; this
 * reads the status payload already stored in ats_provider_transaction_log instead.
 *
 * Dry-run by default (prints what it would do). Writes only with --apply.
 *   npx tsx scripts/backfill-digilocker-pan.ts            # report
 *   npx tsx scripts/backfill-digilocker-pan.ts --apply    # credit PAN + recompute BGV verdict
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { documentTypesFromStatusPayload } from "../src/modules/ats/digilocker-evidence.js";
import { autoCreateDigilockerVerifiedChecks, computeAndSaveScore } from "../src/modules/ats/bgv-verification.service.js";

const apply = process.argv.includes("--apply");

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT l.candidate_id, l.response_payload
       FROM ats_provider_transaction_log l
      WHERE l.provider = 'luckpay' AND l.service_type = 'digilocker'
        AND l.status IN ('documents_received', 'completed')
        AND l.candidate_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM candidate_bgv_check c
           WHERE c.candidate_id = l.candidate_id AND c.check_type = 'pan' AND c.status = 'verified'
        )`,
  );

  const seen = new Set<string>();
  let eligible = 0;
  for (const row of rows) {
    const candidateId = String(row.candidate_id);
    if (seen.has(candidateId)) continue;
    let payload: unknown = row.response_payload;
    if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { payload = null; } }
    const types = documentTypesFromStatusPayload(payload);
    if (!types.some((t) => /^pan(\s*card)?$/i.test(t.trim()))) continue;
    seen.add(candidateId);
    eligible++;
    console.log(`${apply ? "CREDIT" : "WOULD CREDIT"} PAN  candidate=${candidateId}  types=${types.join(",")}`);
    if (!apply) continue;
    await autoCreateDigilockerVerifiedChecks(candidateId, { documentTypes: types });
    await computeAndSaveScore(candidateId);
  }
  console.log(`\n${eligible} candidate(s) ${apply ? "updated" : "eligible (dry run — re-run with --apply)"}; ${rows.length} completed session(s) without a verified PAN scanned.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
