/**
 * Read-only: schema_migrations rows matching a filename fragment (success flag and stored error).
 *   npx tsx scripts/migration-status.ts <fragment>
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
(async () => {
  const frag = process.argv[2] ?? "";
  if (frag.length < 4) { console.log("fragment too short"); process.exit(1); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT filename, applied_at, success, duration_ms, LEFT(error_message, 1500) error_message FROM schema_migrations WHERE filename LIKE ? ORDER BY applied_at DESC LIMIT 10`, [`%${frag}%`]);
  for (const r of rows) console.log("MS_ROW " + JSON.stringify(r));
  const [v] = await db.execute<RowDataPacket[]>(`SELECT LEFT(VIEW_DEFINITION, 400) d FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vw_process_pnl_grn_allocation'`);
  console.log("MS_VIEW " + JSON.stringify(v));
  process.exit(0);
})();
