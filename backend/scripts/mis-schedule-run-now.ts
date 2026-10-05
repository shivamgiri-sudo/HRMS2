/**
 * Send an existing MIS email schedule immediately (the same path as the drawer's "Run now": the scheduled time does not move).
 * Runs on the prod host (SMTP credentials live there). Dry-run unless --send.
 *
 *   npx tsx scripts/mis-schedule-run-now.ts [<schedule id>] [--send]
 *
 * Without an id it targets the only active schedule and refuses if there is more than one.
 * Dry-run only lists the schedule (recipients, subject, range); it sends nothing.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { runScheduleNow } from "../src/modules/process-performance/mis-schedule.service.js";

const SEND = process.argv.includes("--send");
const idArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

(async () => {
  const [rows] = await db.execute(
    `SELECT id, dashboard_key, report_title, lob, to_addresses, cc_addresses, subject, range_mode, range_from, range_to,
            frequency, send_time, next_run_at, status, last_status
       FROM mis_email_schedule WHERE ${idArg ? "id = ?" : "status = 'active'"}`,
    idArg ? [idArg] : [],
  ) as unknown as [Array<Record<string, unknown>>, unknown];
  if (!rows.length) { console.log("no matching schedule"); process.exit(1); }
  if (!idArg && rows.length > 1) { console.log(`${rows.length} active schedules; pass an id`); console.log(JSON.stringify(rows, null, 2)); process.exit(1); }
  const row = rows[0];
  console.log(JSON.stringify(row, null, 2));
  if (!SEND) { console.log("DRY-RUN: nothing sent. Re-run with mode=apply to send."); process.exit(0); }
  const result = await runScheduleNow(String(row.id));
  console.log(`SENT result: ${JSON.stringify(result)}`);
  process.exit(result?.status === "sent" ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
