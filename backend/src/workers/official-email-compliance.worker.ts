import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";

const RUN_HOUR = 9;
let nextRun: NodeJS.Timeout | undefined;

export function millisecondsUntilNextOfficialEmailSweep(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export async function runOfficialEmailComplianceSweep(): Promise<{ notified: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.user_id
       FROM employees e
      WHERE e.active_status = 1
        AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
        AND e.user_id IS NOT NULL
        AND (
          COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.email), '')) IS NULL
          OR (
            LOWER(COALESCE(NULLIF(TRIM(e.official_email), ''), e.email)) NOT LIKE '%@teammas.in'
            AND LOWER(COALESCE(NULLIF(TRIM(e.official_email), ''), e.email)) NOT LIKE '%@teammas.co.in'
          )
        )`
  );

  let notified = 0;
  for (const row of rows as Array<{ id: string; user_id: string }>) {
    const [result] = await db.execute<any>(
      `INSERT INTO work_inbox_item
         (id, user_id, type, title, description, entity_type, entity_id, action_url, priority)
       SELECT UUID(), ?, 'alerts', 'Official email required',
              'Please update your official email address using @teammas.in or @teammas.co.in. This reminder will continue daily until your profile is compliant.',
              'official_email_compliance', ?, '/profile?tab=profile', 'high'
        WHERE NOT EXISTS (
          SELECT 1
            FROM work_inbox_item
           WHERE user_id = ?
             AND entity_type = 'official_email_compliance'
             AND entity_id = ?
             AND DATE(created_at) = CURDATE()
        )`,
      [row.user_id, row.id, row.user_id, row.id]
    );
    notified += Number(result.affectedRows ?? 0);
  }

  console.log(`[official-email] created ${notified} daily compliance reminder(s)`);
  return { notified };
}

export function startOfficialEmailComplianceScheduler(): void {
  if (nextRun) return;
  nextRun = setTimeout(async () => {
    try {
      await runOfficialEmailComplianceSweep();
    } catch (error) {
      console.error("[official-email] compliance sweep failed:", error);
    } finally {
      nextRun = undefined;
      startOfficialEmailComplianceScheduler();
    }
  }, millisecondsUntilNextOfficialEmailSweep());
  nextRun.unref();
}
