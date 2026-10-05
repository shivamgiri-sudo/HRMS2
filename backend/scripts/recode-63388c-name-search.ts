/**
 * STRICTLY READ-ONLY. Does Talabhai Thakor exist in db_bill under another code, and does Tina Valera exist in HRMS
 * under another code? Matches by name, and by DOB + mobile last-4. Prints codes, names, dates, status only.
 * HRMS via SELECT; db_bill via billQuery() (SELECT allowlist).
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const d10 = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

async function main() {
  console.log("== db_bill: anyone named THAKOR with first name TALABHAI, or DOB 1986-01-01 + mobile ending 6311 ==");
  const b1 = await billQuery<RowDataPacket>(
    `SELECT EmpCode, EmpName, DOB, DOJ, DOL, Status, left_type, RIGHT(Mobile,4) m4 FROM masjclrentry
      WHERE UPPER(EmpName) LIKE 'TALABHAI%' OR UPPER(EmpName) LIKE '%TALAB%THAKOR%'
         OR (DOB = '1986-01-01' AND RIGHT(Mobile,4) = '6311') LIMIT 20`);
  console.log("rows:", b1.length);
  for (const r of b1) console.log(" ", JSON.stringify({ ...r, DOB: d10(r.DOB), DOJ: d10(r.DOJ), DOL: d10(r.DOL) }));

  console.log("\n== HRMS: anyone named TINA ... VALERA, or DOB 2004-09-30 + mobile ending 1981 ==");
  const h = await q(
    `SELECT employee_code, first_name, last_name, date_of_birth, date_of_joining, date_of_exit, active_status, RIGHT(mobile,4) m4
       FROM employees WHERE (UPPER(first_name) = 'TINA' AND UPPER(last_name) LIKE '%VALERA%')
         OR (date_of_birth = '2004-09-30' AND RIGHT(mobile,4) = '1981') LIMIT 20`);
  console.log("rows:", h.length);
  for (const r of h) console.log(" ", JSON.stringify({ ...r, date_of_birth: d10(r.date_of_birth), date_of_joining: d10(r.date_of_joining), date_of_exit: d10(r.date_of_exit) }));

  console.log("\n== biometric_attendance_log columns ==");
  const cols = await q(`SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'biometric_attendance_log'`);
  console.log(cols.map((c) => c.c).join(","));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
