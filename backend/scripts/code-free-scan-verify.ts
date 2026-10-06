/**
 * STRICTLY READ-ONLY. Is an employee code used anywhere? Scans every HRMS base table's code-like text columns
 * (name matches code / employee_code / emp_code / bio / biometric / user_id / legacy ...) and every db_bill table's
 * EmpCode-like columns, for an exact (case/space-insensitive) match. Prints table.column and a count only.
 *   npx tsx scripts/code-free-scan-verify.ts MAS63449
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const CODE = (process.argv[2] ?? "").trim().toUpperCase();
const id = (s: string) => `\`${s.replace(/`/g, "")}\``;
const LIKE = /(code|emp_?id|empid|biometric|bio_?|cosec|user_?id|legacy|badge|token_no|q_token|employee_no|empno)/i;

async function main() {
  if (!/^[A-Z0-9-]{3,20}$/.test(CODE)) throw new Error("give one employee code");
  const [cols] = await db.execute<RowDataPacket[]>(
    `SELECT c.TABLE_NAME t, c.COLUMN_NAME c FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.DATA_TYPE IN ('varchar','char','text','tinytext','mediumtext')`);
  const hc = (cols as RowDataPacket[]).filter((r) => LIKE.test(String(r.c)));
  console.log(`HRMS: scanning ${hc.length} code-like columns across ${new Set(hc.map((r) => r.t)).size} tables for ${CODE}`);
  let hits = 0, failed = 0;
  for (const r of hc) {
    try {
      const [n] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${id(String(r.t))} WHERE UPPER(TRIM(${id(String(r.c))})) = ?`, [CODE]);
      if (Number(n[0].n) > 0) { hits++; console.log(`  HIT  ${r.t}.${r.c}: ${n[0].n}`); }
    } catch { failed++; }
  }
  console.log(`HRMS hits: ${hits}, unreadable columns: ${failed}`);

  const bcols = await billQuery<RowDataPacket>(
    `SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE IN ('varchar','char','text','tinytext','mediumtext')`);
  const bh = bcols.filter((r) => /(empcode|emp_?code|empid|employee|bio|code)/i.test(String(r.c)));
  console.log(`\ndb_bill: scanning ${bh.length} code-like columns across ${new Set(bh.map((r) => r.t)).size} tables`);
  let bhits = 0, bfailed = 0;
  for (const r of bh) {
    try {
      const n = await billQuery<RowDataPacket>(`SELECT COUNT(*) n FROM ${id(String(r.t))} WHERE UPPER(TRIM(${id(String(r.c))})) = ?`, [CODE]);
      if (Number(n[0].n) > 0) { bhits++; console.log(`  HIT  ${r.t}.${r.c}: ${n[0].n}`); }
    } catch { bfailed++; }
  }
  console.log(`db_bill hits: ${bhits}, unreadable columns: ${bfailed}`);
  console.log(hits + bhits === 0 ? `\nRESULT: ${CODE} is not used in any scanned column.` : `\nRESULT: ${CODE} IS USED - see hits above.`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
