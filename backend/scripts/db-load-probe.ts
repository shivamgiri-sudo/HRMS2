/** What is the database busy with? Running statements over 3 s, grouped by the first words of the query. STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
(async () => {
  for (let i = 0; i < 3; i++) {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT ID, TIME, STATE, LEFT(REGEXP_REPLACE(INFO, '\\\\s+', ' '), 160) q FROM information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' AND INFO IS NOT NULL AND TIME >= 3 ORDER BY TIME DESC LIMIT 25`);
    console.log(`== sample ${i + 1}: ${r.length} statements running 3 s or more`);
    for (const x of r) console.log(`${x.TIME}s ${x.STATE} | ${x.q}`);
    await new Promise((res) => setTimeout(res, 5000));
  }
  const [s] = await db.execute<RowDataPacket[]>("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_running','Threads_connected','Slow_queries')");
  for (const x of s) console.log(x.Variable_name, x.Value);
  await db.end?.();
})();
