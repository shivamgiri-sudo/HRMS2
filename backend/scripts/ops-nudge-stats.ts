/**
 * How Ops Control Tower nudges have gone. READ-ONLY (SELECTs only; counts and error text, no names or numbers).
 *
 *   npx tsx scripts/ops-nudge-stats.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const q = async (sql: string) => (await db.execute<RowDataPacket[]>(sql))[0] as RowDataPacket[];

(async () => {
  console.log("== by status / trigger, last 30 days ==");
  for (const r of await q(`SELECT status, trigger_type, COUNT(*) n, MAX(created_at) last_at FROM ops_nudge_log
                             WHERE created_at >= NOW() - INTERVAL 30 DAY GROUP BY status, trigger_type ORDER BY n DESC`)) {
    console.log(`NUDGE\t${r.status}\t${r.trigger_type}\t${r.n}\tlast=${r.last_at}`);
  }
  console.log("== most common errors ==");
  for (const r of await q(`SELECT LEFT(error_message, 160) e, COUNT(*) n FROM ops_nudge_log
                             WHERE status = 'failed' AND created_at >= NOW() - INTERVAL 30 DAY GROUP BY e ORDER BY n DESC LIMIT 5`)) {
    console.log(`ERR\t${r.n}\t${r.e}`);
  }
  console.log(`env OPS_AUTO_NUDGE_ENABLED=${process.env.OPS_AUTO_NUDGE_ENABLED ?? "(unset)"}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
