/**
 * address-reassess-dryrun.ts — READ-ONLY. Applies the two-signal address assessment to every submission still
 * waiting for HR and prints how many would auto-verify. Counts and employee-free candidate ids only; writes nothing.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { assessForCandidate } from "../src/modules/ats/address-verification-assessment.js";
import type { RowDataPacket } from "mysql2";

const [rows] = await db.execute<RowDataPacket[]>(
  `SELECT v.candidate_id, v.gps_distance_m, v.gps_accuracy_m
     FROM candidate_bgv_address_verification v
    WHERE v.status = 'submitted' AND v.hr_decision IS NULL
      AND NOT EXISTS (SELECT 1 FROM candidate_bgv_address_verification vv WHERE vv.candidate_id = v.candidate_id AND vv.status = 'verified')
    ORDER BY v.submitted_at DESC LIMIT 500`,
);
const tally: Record<string, number> = { verified: 0, needs_hr: 0, conflict: 0 };
const detail: Record<string, number> = {};
for (const r of rows) {
  const a = await assessForCandidate(
    String(r.candidate_id),
    r.gps_distance_m === null ? null : Number(r.gps_distance_m),
    r.gps_accuracy_m === null ? null : Number(r.gps_accuracy_m),
  );
  tally[a.tier]++;
  const key = `${a.tier} | location=${a.location} | documents=${a.documents}`;
  detail[key] = (detail[key] ?? 0) + 1;
}
console.log(`examined=${rows.length}`);
console.table(tally);
console.table(Object.entries(detail).sort((x, y) => y[1] - x[1]).map(([k, n]) => ({ outcome: k, n })));
await db.end();
