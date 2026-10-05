/**
 * STRICTLY READ-ONLY. For the given employee codes (default 63388C, MAS61435): the db_bill masjclrentry row
 * (EmpCode, DOJ, DOL, Status, ResignationDate, left_type), other db_bill codes sharing the same PAN or Aadhaar
 * (codes and dates only - identifier values are never printed), and each code's HRMS employee row.
 * db_bill goes through billQuery() (SELECT allowlist); HRMS through SELECTs only.
 *   npx tsx scripts/lookup-two-codes-verify.ts [CODE ...]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

type Row = Record<string, unknown>;
const d10 = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);

async function hrms(code: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, e.active_status, e.employment_status, e.date_of_joining, e.date_of_exit,
            e.date_of_leaving, e.created_at,
            (SELECT COUNT(*) FROM attendance_daily_record a WHERE a.employee_id = e.id AND a.record_date >= '2026-09-01') AS att_rows_sep_on
       FROM employees e WHERE UPPER(TRIM(e.employee_code)) = ?`, [code.toUpperCase()]);
  return rows.map((r) => ({ ...r, date_of_joining: d10(r.date_of_joining), date_of_exit: d10(r.date_of_exit),
    date_of_leaving: d10(r.date_of_leaving), created_at: d10(r.created_at) }));
}

async function main() {
  const codes = process.argv.slice(2).length ? process.argv.slice(2) : ["63388C", "MAS61435"];
  for (const code of codes) {
    console.log(`\n=== ${code} ===`);
    const bill = await billQuery<Row>(
      `SELECT EmpCode, DOJ, DOL, Status, ResignationDate, left_type, lastUpdated, PanNo, AdharId
         FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = ? LIMIT 3`, [code.toUpperCase()]);
    console.log("db_bill rows:", bill.length);
    for (const b of bill) {
      const { PanNo, AdharId, ...rest } = b;
      console.log(JSON.stringify({ ...rest, DOJ: d10(b.DOJ), DOL: d10(b.DOL), ResignationDate: d10(b.ResignationDate), lastUpdated: d10(b.lastUpdated) }));
      const pan = String(PanNo ?? "").trim().toUpperCase(), aad = String(AdharId ?? "").replace(/\D/g, "");
      const hasPan = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan), hasAad = aad.length === 12;
      console.log(`  valid PAN: ${hasPan}, valid Aadhaar: ${hasAad}`);
      if (hasPan || hasAad) {
        const sib = await billQuery<Row>(
          `SELECT EmpCode, DOJ, DOL, Status, left_type FROM masjclrentry
            WHERE UPPER(TRIM(EmpCode)) <> ? AND ((? <> '' AND UPPER(TRIM(PanNo)) = ?) OR (? <> '' AND REPLACE(AdharId,' ','') = ?))
            ORDER BY DOJ LIMIT 10`, [code.toUpperCase(), hasPan ? pan : "", pan, hasAad ? aad : "", aad]);
        console.log("  db_bill other codes, same PAN/Aadhaar:", sib.length);
        for (const s of sib) {
          console.log("   ", JSON.stringify({ ...s, DOJ: d10(s.DOJ), DOL: d10(s.DOL) }));
          console.log("     HRMS:", JSON.stringify(await hrms(String(s.EmpCode))));
        }
      }
    }
    console.log("HRMS:", JSON.stringify(await hrms(code)));
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
