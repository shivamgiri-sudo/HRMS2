/**
 * Why joiners stay in the Ops Control Tower's DigiLocker pending list. READ-ONLY (SELECTs only).
 *
 * The list reads ats_onboarding_bridge.digilocker_status; this counts, for the joiners it lists,
 * what other evidence says DigiLocker finished. Prints employee codes and counts only.
 *
 *   npx tsx scripts/digilocker-pending-diagnose.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

(async () => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, COALESCE(b.digilocker_status, 'null') AS bridge,
            (SELECT t.status FROM ats_provider_transaction_log t
              WHERE t.candidate_id = b.candidate_id AND t.provider = 'luckpay' AND t.service_type = 'digilocker'
              ORDER BY t.updated_at DESC, t.created_at DESC LIMIT 1) AS txn,
            (SELECT COUNT(*) FROM ats_provider_transaction_log t
              WHERE t.candidate_id = b.candidate_id AND t.provider = 'luckpay' AND t.service_type = 'digilocker'
                AND t.status IN ('documents_received', 'completed')) AS txn_done_any,
            (SELECT COUNT(*) FROM candidate_bgv_check c
              WHERE c.candidate_id = b.candidate_id AND c.check_type = 'digilocker' AND c.status = 'verified') AS check_ok,
            (SELECT COUNT(*) FROM candidate_bgv_report r
              WHERE r.candidate_id = b.candidate_id AND r.digilocker_status = 'passed') AS report_ok,
            (SELECT COUNT(*) FROM candidate_bgv_check c
              WHERE c.candidate_id = b.candidate_id AND c.check_type IN ('aadhaar', 'pan') AND c.status = 'verified'
                AND c.provider_key LIKE '%digilocker%') AS id_via_dl,
            (SELECT COUNT(*) FROM candidate_digilocker_sessions s
              WHERE s.candidate_id = b.candidate_id AND LOWER(COALESCE(s.status, '')) IN ('completed', 'documents_received')) AS sess_ok
       FROM ats_onboarding_bridge b
       JOIN employees e ON e.id = b.employee_id
      WHERE e.created_at >= NOW() - INTERVAL 30 DAY
        AND (e.active_status = 1 OR LOWER(COALESCE(e.employment_status, '')) = 'preboarding')
        AND (b.digilocker_status IS NULL OR b.digilocker_status <> 'documents_received')`,
  );
  const tally = (key: (r: RowDataPacket) => string) => {
    const m = new Map<string, number>();
    for (const r of rows as RowDataPacket[]) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return Object.fromEntries(m);
  };
  console.log(`pending in list: ${rows.length}`);
  console.log("bridge status:", tally((r) => String(r.bridge)));
  console.log("latest luckpay txn:", tally((r) => String(r.txn ?? "none")));
  const evidence = (r: RowDataPacket) =>
    Number(r.txn_done_any) > 0 || Number(r.check_ok) > 0 || Number(r.report_ok) > 0 || Number(r.id_via_dl) > 0 || Number(r.sess_ok) > 0;
  const done = (rows as RowDataPacket[]).filter(evidence);
  console.log(`with completion evidence elsewhere: ${done.length}`);
  console.log("  txn done:", done.filter((r) => Number(r.txn_done_any) > 0).length,
    "| digilocker check verified:", done.filter((r) => Number(r.check_ok) > 0).length,
    "| bgv report passed:", done.filter((r) => Number(r.report_ok) > 0).length,
    "| aadhaar/pan via digilocker:", done.filter((r) => Number(r.id_via_dl) > 0).length,
    "| session table completed:", done.filter((r) => Number(r.sess_ok) > 0).length);
  console.log("codes with evidence:", done.map((r) => r.employee_code).join(" "));
  const initiatedNoEvidence = (rows as RowDataPacket[]).filter((r) => !evidence(r) && r.txn && !["failed", "expired"].includes(String(r.txn)));
  console.log(`started, no evidence yet (would need a provider poll): ${initiatedNoEvidence.length}`);
  console.log("codes:", initiatedNoEvidence.map((r) => r.employee_code).join(" "));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
