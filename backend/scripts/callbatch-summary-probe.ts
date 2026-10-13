/** The calling-file batches of the last day with their whole summary (portal upload result, counts, errors). STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
(async () => {
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT id, slot_key, mode_tag, status, row_count, created_at, CAST(summary AS CHAR) summary FROM qualified_followup_call_batch
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) ORDER BY created_at DESC LIMIT 14`);
  for (const x of r) console.log(JSON.stringify({ ...x, summary: String(x.summary ?? "").slice(0, 700) }));
  const env = (k: string) => (process.env[k] ? "SET" : "unset");
  console.log("env", ["SUPERBOT_EMAIL", "SUPERBOT_PASSWORD", "SUPERBOT_ACCOUNT_ID", "SUPERBOT_CAMPAIGN_ID"].map((k) => `${k}=${env(k)}`).join(" "), "upload_mode=", process.env.SUPERBOT_UPLOAD_MODE ?? "(unset)");
  await db.end?.();
})();
