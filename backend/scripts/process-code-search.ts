/**
 * Find process_master rows by code or name. READ-ONLY.
 *
 *   npx tsx scripts/process-code-search.ts "<pattern>"   (case-insensitive LIKE on code and name)
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const PATTERN = String(process.argv[2] ?? "").trim();
(async () => {
  if (PATTERN.length < 2) throw new Error("pattern too short");
  const like = `%${PATTERN}%`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.process_code, p.process_name, p.active_status, b.branch_name,
            (SELECT COUNT(*) FROM employees e WHERE e.process_id = p.id AND e.active_status = 1) AS active_staff
       FROM process_master p LEFT JOIN branch_master b ON b.id = p.branch_id
      WHERE p.process_code LIKE ? OR p.process_name LIKE ?
      ORDER BY active_staff DESC LIMIT 30`, [like, like]);
  for (const r of rows as RowDataPacket[]) {
    console.log(`PROC\t${r.process_code}\t${r.process_name}\tactive=${r.active_status}\t${r.branch_name ?? "-"}\tstaff=${r.active_staff}`);
  }
  console.log(`PROC_COUNT\t${(rows as RowDataPacket[]).length}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
