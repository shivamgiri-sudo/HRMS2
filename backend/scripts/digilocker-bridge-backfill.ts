/**
 * Joiners who finished DigiLocker before the bridge sync shipped still read 'not_started' on
 * ats_onboarding_bridge, so the Ops Control Tower keeps listing them as pending. The reconciler skips
 * already-finished sessions, so nothing heals them. Dry run lists them; --apply moves the bridge
 * forward (never backwards) to documents_received.
 *
 *   npx tsx scripts/digilocker-bridge-backfill.ts [--apply]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { syncBridgeDigilockerStatus } from "../src/modules/ats/onboarding-bridge-status.js";
import type { RowDataPacket } from "mysql2";

const APPLY = process.argv.includes("--apply");

(async () => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.candidate_id, e.employee_code, COALESCE(b.digilocker_status, 'null') AS bridge
       FROM ats_onboarding_bridge b
       LEFT JOIN employees e ON e.id = b.employee_id
      WHERE (b.digilocker_status IS NULL OR b.digilocker_status <> 'documents_received')
        AND (
          EXISTS (SELECT 1 FROM ats_provider_transaction_log t
                   WHERE t.candidate_id = b.candidate_id AND t.provider = 'luckpay' AND t.service_type = 'digilocker'
                     AND t.status IN ('documents_received', 'completed'))
          OR EXISTS (SELECT 1 FROM candidate_bgv_check c
                      WHERE c.candidate_id = b.candidate_id AND c.check_type = 'digilocker' AND c.status = 'verified')
          OR EXISTS (SELECT 1 FROM candidate_bgv_report r
                      WHERE r.candidate_id = b.candidate_id AND r.digilocker_status = 'passed')
          OR EXISTS (SELECT 1 FROM candidate_digilocker_sessions s
                      WHERE s.candidate_id = b.candidate_id AND LOWER(COALESCE(s.status, '')) IN ('completed', 'documents_received'))
        )`,
  );
  const list = rows as RowDataPacket[];
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${list.length} bridge row(s) with DigiLocker completion evidence but not documents_received`);
  for (const r of list) console.log(`  ${r.employee_code ?? "(no employee)"}  bridge=${r.bridge}`);
  if (APPLY) {
    for (const r of list) await syncBridgeDigilockerStatus(db, String(r.candidate_id), "completed");
    console.log(`APPLIED: ${list.length}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
