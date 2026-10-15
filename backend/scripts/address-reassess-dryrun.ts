/**
 * address-reassess-dryrun.ts — READ-ONLY unless APPLY=1 (workflow requires typing APPLY). Applies the two-signal address assessment to every submission still
 * waiting for HR and prints how many would auto-verify. With APPLY=1 it marks ONLY the auto-verifiable ones verified (same effect as the /reassess route).
 * Prints counts only.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { assessForCandidate, summarise } from "../src/modules/ats/address-verification-assessment.js";
const APPLY = process.env.APPLY === "1";
import type { RowDataPacket } from "mysql2";

const [rows] = await db.execute<RowDataPacket[]>(
  `SELECT v.id, v.candidate_id, v.gps_distance_m, v.gps_accuracy_m
     FROM candidate_bgv_address_verification v
    WHERE v.status = 'submitted' AND v.hr_decision IS NULL
      AND NOT EXISTS (SELECT 1 FROM candidate_bgv_address_verification vv WHERE vv.candidate_id = v.candidate_id AND vv.status = 'verified')
    ORDER BY v.submitted_at DESC LIMIT 500`,
);
let applied = 0;
const tally: Record<string, number> = { verified: 0, needs_hr: 0, conflict: 0 };
const detail: Record<string, number> = {};
for (const r of rows) {
  const a = await assessForCandidate(
    String(r.candidate_id),
    r.gps_distance_m === null ? null : Number(r.gps_distance_m),
    r.gps_accuracy_m === null ? null : Number(r.gps_accuracy_m),
  );
  tally[a.tier]++;
  if (APPLY && a.tier === "verified") {
    const { syncAddressBgvCheck } = await import("../src/modules/ats/bgv-address-verification.routes.js");
    const [res] = await db.execute(
      `UPDATE candidate_bgv_address_verification
          SET status = 'verified', auto_verified = 1, hr_notes = ?
        WHERE id = ? AND status = 'submitted' AND hr_decision IS NULL`,
      [`[auto] ${summarise(a)}`.slice(0, 1000), r.id],
    );
    if (Number((res as { affectedRows?: number }).affectedRows ?? 0) === 1) {
      await syncAddressBgvCheck(String(r.candidate_id), "verified", `Auto-verified: ${a.reasons.join("; ")}`);
      applied++;
    }
  }
  const key = `${a.tier} | location=${a.location} | documents=${a.documents}`;
  detail[key] = (detail[key] ?? 0) + 1;
}
console.log(`examined=${rows.length} apply=${APPLY} applied=${applied}`);
console.table(tally);
console.table(Object.entries(detail).sort((x, y) => y[1] - x[1]).map(([k, n]) => ({ outcome: k, n })));
if (APPLY) {
  // Re-apply any verified attempt the BGV report has not picked up (including ones left half-done by the
  // earlier sync bug), through the same heal the worker uses. Unlocked reports only.
  const { healAddress } = await import("../src/modules/ats/onboarding-bridge-heal.js");
  console.log(`healed_reports=${await healAddress()}`);
}
await db.end();
