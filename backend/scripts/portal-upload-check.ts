/** What the Superbot portal has received (its upload log) next to our calling-file batches of the last day. STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { botConfig, uploadLogs } from "../src/modules/hiring-engine/superbot-portal.client.js";
(async () => {
  const c = botConfig();
  if (!c) { console.log("portal not configured"); return; }
  const logs = await uploadLogs(c);
  console.log(`== portal upload log (${logs.length}, newest first as returned; times are portal UTC)`);
  for (const l of logs.slice(0, 15)) console.log(JSON.stringify(l));
  const [b] = await db.execute<RowDataPacket[]>(
    `SELECT b.id, b.slot_key, b.status, b.row_count, b.created_at, JSON_EXTRACT(b.summary,'$.portal.ok') portal_ok,
            (SELECT COUNT(*) FROM qualified_followup q WHERE q.call_file_batch_id = b.id) stamped,
            (SELECT COUNT(*) FROM qualified_followup q WHERE q.call_file_batch_id = b.id AND q.call_state = 'called') called
       FROM qualified_followup_call_batch b WHERE b.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) AND b.status = 'sent' ORDER BY b.created_at`);
  console.log("== our sent batches (last day)");
  for (const x of b) console.log(JSON.stringify(x));
  await db.end?.();
})();
