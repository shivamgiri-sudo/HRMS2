/**
 * Which statements cost the database most, and how often they run. STRICTLY READ-ONLY.
 *  1) performance_schema statement digests (since the server or the digest table was last reset): count, total and average time.
 *  2) the processlist sampled 6 times, 10 s apart: what is running 5 s or more right now.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
const sec = (ps: unknown) => Math.round(Number(ps ?? 0) / 1e12);
(async () => {
  try {
    const [up] = await db.execute<RowDataPacket[]>("SHOW GLOBAL STATUS LIKE 'Uptime'");
    console.log("uptime_hours", Math.round(Number(up[0]?.Value ?? 0) / 3600));
    const [d] = await db.execute<RowDataPacket[]>(
      `SELECT SCHEMA_NAME db, COUNT_STAR n, SUM_TIMER_WAIT tot, AVG_TIMER_WAIT avg, MAX_TIMER_WAIT mx, SUM_ROWS_EXAMINED rx, LAST_SEEN,
              LEFT(REGEXP_REPLACE(DIGEST_TEXT, '\\\\s+', ' '), 170) q
         FROM performance_schema.events_statements_summary_by_digest WHERE DIGEST_TEXT IS NOT NULL ORDER BY SUM_TIMER_WAIT DESC LIMIT 30`);
    console.log("== top statements by total time (count | total s | avg s | max s | rows examined | last seen | query)");
    for (const x of d) console.log(`${x.n} | ${sec(x.tot)} | ${(Number(x.avg) / 1e12).toFixed(1)} | ${sec(x.mx)} | ${x.rx} | ${String(x.LAST_SEEN).slice(0, 19)} | ${x.db}: ${x.q}`);
  } catch (e) { console.log("digests unavailable:", (e as Error).message.slice(0, 160)); }
  const seen = new Map<string, { hits: number; maxT: number }>();
  for (let i = 0; i < 6; i++) {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT TIME t, LEFT(REGEXP_REPLACE(INFO, '\\\\s+', ' '), 120) q FROM information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' AND INFO IS NOT NULL AND TIME >= 5`);
    for (const x of r) { const k = String(x.q).replace(/'[^']*'/g, "?").replace(/\d+/g, "#"); const v = seen.get(k) ?? { hits: 0, maxT: 0 }; v.hits++; v.maxT = Math.max(v.maxT, Number(x.t)); seen.set(k, v); }
    await new Promise((res) => setTimeout(res, 10_000));
  }
  console.log("== running 5 s or more across 6 samples (samples seen | longest s | query)");
  for (const [k, v] of [...seen].sort((a, b) => b[1].maxT - a[1].maxT).slice(0, 30)) console.log(`${v.hits} | ${v.maxT} | ${k}`);
  await db.end?.();
})();
