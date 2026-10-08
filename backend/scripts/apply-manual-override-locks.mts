/**
 * Marks every row this session's db_bill-alignment override touched as manual_override_locked=1
 * (migration 1697), so payrollCalculate.service.ts's new guard skips them on any future
 * recalculation instead of silently discarding the override.
 *
 * Population: every NOIDA-2/Ahmedabad row currently carrying an arrears_note from
 * force-match-dbbill-net.mts, force-match-dbbill-components.mts or heal-dbbill-alignment.mts,
 * PLUS MAS63131/MAS63178 (the July-2026 arrears catch-up, patched directly the same way and
 * equally vulnerable to a silent reversion, even though they were never force-matched to
 * db_bill).
 *
 * Dry-run by default; APPLY=1 to write.
 */
import { db } from "../src/db/mysql.js";
import "dotenv/config";

const APPLY = process.env.APPLY === "1";
const RUN = "5035d780-6cb4-4bb6-a0e3-3f282fed7575";
const ACTOR = "a4a4902e-6222-11f1-adb1-00155d0ab410";

const [rows]: any = await db.query(
  `SELECT id, employee_id FROM salary_prep_line
    WHERE run_id = ? AND manual_override_locked = 0
      AND (arrears_note LIKE '%force-match-dbbill%' OR arrears_note LIKE '%owner-directed%'
           OR arrears_note LIKE '%Healed by heal-dbbill-alignment%'
           OR arrears_note LIKE '%July 2026 arrears%')`, [RUN]);

console.log(`${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`Rows to lock: ${rows.length}`);
if (!APPLY || !rows.length) {
  if (!APPLY) console.log("No changes written. Re-run with APPLY=1.");
  process.exit(0);
}

const [res]: any = await db.query(
  `UPDATE salary_prep_line
      SET manual_override_locked = 1, manual_override_locked_at = NOW(), manual_override_locked_by = ?,
          manual_override_reason = 'db_bill reconciliation override / July-2026 arrears catch-up, 2026-09-08 -- see arrears_note for the full trail'
    WHERE run_id = ? AND manual_override_locked = 0
      AND (arrears_note LIKE '%force-match-dbbill%' OR arrears_note LIKE '%owner-directed%'
           OR arrears_note LIKE '%Healed by heal-dbbill-alignment%'
           OR arrears_note LIKE '%July 2026 arrears%')`, [ACTOR, RUN]);
console.log(`Locked ${res.affectedRows} rows.`);
process.exit(0);
