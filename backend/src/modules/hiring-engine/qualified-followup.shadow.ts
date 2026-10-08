/** What a dry_run journey would have sent, for the shadow comparison with the engine and legacy sends (one row per row+step+verdict per IST day). */
import { db } from "../../db/mysql.js";
import { istDayBounds } from "./followup-guards.service.js";
import type { FollowupRow } from "./qualified-followup.context.js";

export async function recordShadow(row: FollowupRow, step: string, verdict: string, templateKey: string | null, at: Date): Promise<void> {
  const [start] = istDayBounds(at);
  await db.execute(
    `INSERT INTO followup_shadow (followup_id, mobile10, requisition_id, source_type, step, template_key, verdict, would_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ? FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM followup_shadow s WHERE s.followup_id = ? AND s.step = ? AND s.verdict = ? AND s.would_at >= ?)`,
    [row.id, row.mobile10, row.requisitionId, row.sourceType, step, templateKey, verdict.slice(0, 40), at, row.id, step, verdict.slice(0, 40), start]);
}
