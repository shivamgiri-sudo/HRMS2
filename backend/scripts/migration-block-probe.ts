/** Why does the new build not start? Which of the newest migrations are applied, and what waits on a table lock. STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
(async () => {
  const [m] = await db.execute<RowDataPacket[]>("SELECT * FROM schema_migrations WHERE filename LIKE '%218%' OR filename LIKE '%219%' ORDER BY 1 DESC LIMIT 20").catch(async () => db.execute<RowDataPacket[]>("SELECT * FROM schema_migrations ORDER BY 1 DESC LIMIT 15"));
  console.log("== newest schema_migrations rows"); for (const x of m) console.log(JSON.stringify(x).slice(0, 200));
  const [c] = await db.execute<RowDataPacket[]>("SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'pay_release_route') OR (TABLE_NAME = 'molecular_email_ticket' AND COLUMN_NAME = 'source') OR TABLE_NAME = 'absconder_pay_release_event')");
  console.log("== columns from 2187-2195 present"); for (const x of c) console.log(JSON.stringify(x));
  const [w] = await db.execute<RowDataPacket[]>("SELECT ID, TIME, STATE, LEFT(INFO, 160) q FROM information_schema.PROCESSLIST WHERE STATE LIKE '%lock%' OR INFO LIKE 'ALTER%' OR INFO LIKE 'CREATE%' ORDER BY TIME DESC LIMIT 20");
  console.log("== lock waits and DDL now"); for (const x of w) console.log(`${x.TIME}s ${x.STATE} | ${x.q}`);
  const [l] = await db.execute<RowDataPacket[]>("SELECT ID, TIME, LEFT(INFO, 140) q FROM information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' AND INFO IS NOT NULL AND TIME >= 60 AND (INFO LIKE '%exit_request%' OR INFO LIKE '%molecular_email%') ORDER BY TIME DESC LIMIT 10");
  console.log("== long reads on exit_request / molecular_email tables"); for (const x of l) console.log(`${x.TIME}s | ${x.q}`);
  await db.end?.();
})();
