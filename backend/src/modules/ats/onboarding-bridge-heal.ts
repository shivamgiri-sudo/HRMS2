/**
 * Self-healing for ats_onboarding_bridge.
 *
 * The bridge mirrors DigiLocker / penny-drop results, written by the verification flows as they finish.
 * Any run that finished before that mirror existed, or whose mirror write failed (it is deliberately
 * swallowed, see onboarding-bridge-status.ts), leaves the bridge behind the evidence — and the Ops
 * Control Tower then lists a joiner as pending for a step they completed. This catches the bridge up from
 * the evidence recorded elsewhere. Local reads/writes only, no provider calls, forward-only, idempotent.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/** Completion evidence for DigiLocker, from every table that records it. `b` = ats_onboarding_bridge. */
export const DIGILOCKER_EVIDENCE_SQL = `(
  EXISTS (SELECT 1 FROM ats_provider_transaction_log dt
           WHERE dt.candidate_id = b.candidate_id AND dt.provider = 'luckpay' AND dt.service_type = 'digilocker'
             AND dt.status IN ('documents_received', 'completed'))
  OR EXISTS (SELECT 1 FROM candidate_bgv_check dc
              WHERE dc.candidate_id = b.candidate_id AND dc.check_type = 'digilocker' AND dc.status = 'verified')
  OR EXISTS (SELECT 1 FROM candidate_bgv_report dr
              WHERE dr.candidate_id = b.candidate_id AND dr.digilocker_status = 'passed')
  OR EXISTS (SELECT 1 FROM candidate_digilocker_sessions ds
              WHERE ds.candidate_id = b.candidate_id AND LOWER(COALESCE(ds.status, '')) IN ('completed', 'documents_received'))
)`;

/**
 * Address: the geo-tagged selfie result lives in candidate_bgv_address_verification. When it is 'verified' the
 * routes push it into candidate_bgv_check and candidate_bgv_report.address_status and re-score, but that push is
 * fire-and-forget. Re-apply it for any verified attempt the report has not picked up. Unlocked reports only.
 */
async function healAddress(): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT v.candidate_id
       FROM candidate_bgv_address_verification v
       JOIN candidate_bgv_report r ON r.candidate_id = v.candidate_id
      WHERE v.status = 'verified' AND (r.locked = 0 OR r.locked IS NULL)
        AND COALESCE(r.address_status, 'not_run') <> 'passed'`,
  );
  const { computeAndSaveScore } = await import("./bgv-verification.service.js");
  for (const row of rows as RowDataPacket[]) {
    const candidateId = String(row.candidate_id);
    await db.execute(
      `INSERT INTO candidate_bgv_check (candidate_id, check_type, status, verified_at, result_summary, updated_at)
         VALUES (?, 'address', 'verified', NOW(), 'Address verified via geo-tagged selfie', NOW())
         ON DUPLICATE KEY UPDATE status = 'verified', updated_at = NOW()`,
      [candidateId],
    );
    await db.execute(
      `UPDATE candidate_bgv_report SET address_status = 'passed', updated_at = NOW()
        WHERE candidate_id = ? AND (locked = 0 OR locked IS NULL)`,
      [candidateId],
    );
    await computeAndSaveScore(candidateId);
  }
  return (rows as RowDataPacket[]).length;
}

export async function healOnboardingBridge(): Promise<{ digilocker: number; pennyDrop: number; address: number }> {
  const [dl] = await db.execute(
    `UPDATE ats_onboarding_bridge b
        SET b.digilocker_status = 'documents_received',
            b.digilocker_completed_at = COALESCE(b.digilocker_completed_at, NOW())
      WHERE COALESCE(b.digilocker_status, '') <> 'documents_received'
        AND ${DIGILOCKER_EVIDENCE_SQL}`,
  );
  const [pd] = await db.execute(
    `UPDATE ats_onboarding_bridge b
        SET b.penny_drop_status = 'verified',
            b.penny_drop_verified_at = COALESCE(b.penny_drop_verified_at, NOW())
      WHERE COALESCE(b.penny_drop_status, '') <> 'verified'
        AND EXISTS (SELECT 1 FROM candidate_bank_verification pv
                     WHERE pv.candidate_id = b.candidate_id
                       AND LOWER(COALESCE(pv.verification_status, '')) = 'verified'
                       AND LOWER(COALESCE(pv.verification_method, '')) <> 'mock')`,
  );
  const affected = (r: unknown) => Number((r as { affectedRows?: number })?.affectedRows ?? 0);
  return { digilocker: affected(dl), pennyDrop: affected(pd), address: await healAddress() };
}
