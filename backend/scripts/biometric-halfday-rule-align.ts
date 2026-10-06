/**
 * Owner decision 2026-10-06: the biometric half day is 270 minutes - the live setting
 * (feature flag biometric_half_day_floor_minutes) that classifyCosecMinutes applies. 27 of 28 active
 * biometric rows in attendance_rule_config still showed 240, so the rules screen disagreed with grading.
 * This sets half_day_minutes on active biometric rules to the live value. COUNTS ONLY.
 *
 *   npx tsx scripts/biometric-halfday-rule-align.ts           # dry run
 *   npx tsx scripts/biometric-halfday-rule-align.ts --apply
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { resolveHalfDayFloorMinutes } from "../src/modules/wfm/attendance-engine.service.js";

const APPLY = process.argv.includes("--apply");
(async () => {
  const live = await resolveHalfDayFloorMinutes("biometric_half_day_floor_minutes");
  console.log(`mode: ${APPLY ? "APPLY" : "dry-run (nothing written)"}  live biometric half-day floor = ${live} min`);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT half_day_minutes h, COUNT(*) n FROM attendance_rule_config
      WHERE active_status = 1 AND attendance_source = 'biometric' GROUP BY h`);
  for (const r of rows as any[]) console.log(`  active biometric rules with half_day_minutes=${r.h}: ${r.n}`);
  if (APPLY) {
    const [res] = await db.execute<any>(
      `UPDATE attendance_rule_config SET half_day_minutes = ?
        WHERE active_status = 1 AND attendance_source = 'biometric' AND half_day_minutes <> ?`, [live, live]);
    console.log(`  updated=${res.affectedRows}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
