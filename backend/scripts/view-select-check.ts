/**
 * Read-only: run the SELECT body of a CREATE OR REPLACE VIEW file (no DDL executed) and compare per-month
 * totals with the live view. Proves the view SQL compiles and shows its effect before a deploy applies it.
 *   npx tsx scripts/view-select-check.ts scripts/view-2114.sql
 */
import "dotenv/config";
import fs from "fs";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
(async () => {
  const sql = fs.readFileSync(process.argv[2], "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const m = sql.match(/CREATE OR REPLACE VIEW\s+\S+\s+AS\s+([\s\S]*?);/i);
  if (!m) { console.log("VC_ERR no view body"); process.exit(1); }
  const body = m[1];
  const q = async (s: string) => (await db.query<RowDataPacket[]>(s))[0];
  const neu = await q(`SELECT period_code p, ROUND(SUM(ex_gst_amount)) ex, COUNT(*) n FROM (${body}) x WHERE period_code BETWEEN '2026-04' AND '2026-09' GROUP BY period_code ORDER BY period_code`);
  const old = await q(`SELECT period_code p, ROUND(SUM(ex_gst_amount)) ex, COUNT(*) n FROM vw_process_pnl_grn_allocation WHERE period_code BETWEEN '2026-04' AND '2026-09' GROUP BY period_code ORDER BY period_code`);
  console.log("VC_NEW " + JSON.stringify(neu)); console.log("VC_OLD " + JSON.stringify(old));
  process.exit(0);
})().catch((e) => { console.log("VC_ERR " + (e instanceof Error ? e.message : String(e))); process.exit(1); });
