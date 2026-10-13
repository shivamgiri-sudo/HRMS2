/**
 * Ends specific runaway queries with KILL QUERY (the statement stops, the connection stays). Owner-approved 2026-10-13 for two ids.
 * Each id is re-checked immediately before it is killed, and left alone unless ALL of these hold:
 *   - the thread exists and is executing a statement (not asleep),
 *   - it has run for more than 120 s,
 *   - the statement text still matches the expected fragment (so a reused thread id is never killed by mistake),
 *   - its client host is not the application server.
 *   npx tsx scripts/ops-kill-runaway-query.ts <id> [<id> ...]        (expected fragment: "call_quality_assessment")
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const ids = process.argv.slice(2).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
const EXPECT = "call_quality_assessment";
const APP_HOST_PREFIX = "192.168.11.225";

(async () => {
  if (!ids.length || ids.length > 5) { console.log("KILL_STOP give 1 to 5 thread ids"); process.exit(1); }
  const conn = await db.getConnection();
  try {
    const [me] = await conn.query<RowDataPacket[]>("SELECT CONNECTION_ID() AS id");
    for (const id of ids) {
      if (id === Number(me[0].id)) { console.log("KILL_SKIP " + JSON.stringify({ id, reason: "own connection" })); continue; }
      const [rows] = await conn.query<RowDataPacket[]>("SELECT ID, USER, HOST, TIME, COMMAND, STATE, INFO FROM information_schema.PROCESSLIST WHERE ID = ?", [id]);
      const r = rows[0];
      if (!r) { console.log("KILL_SKIP " + JSON.stringify({ id, reason: "thread no longer exists (already finished)" })); continue; }
      const info = String(r.INFO ?? "");
      const checks = { executing: r.COMMAND !== "Sleep" && !!info, over120s: Number(r.TIME) > 120, sameStatement: info.includes(EXPECT), notAppServer: !String(r.HOST).startsWith(APP_HOST_PREFIX) };
      if (!Object.values(checks).every(Boolean)) { console.log("KILL_SKIP " + JSON.stringify({ id, reason: "check failed", checks, secs: r.TIME })); continue; }
      console.log("KILL_TARGET " + JSON.stringify({ id, user: r.USER, host: String(r.HOST).replace(/:\d+$/, ""), secs: r.TIME, state: r.STATE }));
      await conn.query(`KILL QUERY ${id}`);
      console.log("KILL_SENT " + JSON.stringify({ id }));
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const [after] = await conn.query<RowDataPacket[]>(`SELECT ID, TIME, COMMAND FROM information_schema.PROCESSLIST WHERE ID IN (${ids.map(() => "?").join(",")})`, ids);
    for (const id of ids) {
      const r = after.find((x) => Number(x.ID) === id);
      console.log("KILL_AFTER " + JSON.stringify({ id, still: r ? (r.COMMAND === "Sleep" ? "connection open, idle (query stopped)" : `still executing, ${r.TIME}s`) : "thread gone" }));
    }
  } finally { conn.release(); }
  await new Promise((resolve) => process.stdout.write("KILL_DONE\n", resolve));
  process.exit(0);
})();
