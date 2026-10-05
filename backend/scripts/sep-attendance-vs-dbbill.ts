/**
 * Sep 2026 attendance: HRMS vs db_bill (I-spark) for a fixed list of disputed employee-days.
 * READ-ONLY: HRMS SELECTs + billQuery SELECTs. For each row prints HRMS daily record, its
 * evidence (biometric, dialer, APR, regularization, leave, manual override) and db_bill
 * Attandence / masjclrentry.
 *
 *   npx tsx scripts/sep-attendance-vs-dbbill.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

// date|code|hrms|ispark (as given by payroll; ispark blank = no value in their sheet)
const ROWS = `
2026-09-17|MAS62199|HD|
2026-09-19|MAS63306|HD|
2026-09-26|MAS63618|HD|
2026-09-27|MAS63618|HD|
2026-09-28|MAS63618|HD|
2026-09-30|MAS63632|HD|
2026-09-30|MAS63636|HD|
2026-09-30|MAS63640|HD|
2026-09-09|MAS62260|P|
2026-09-09|MAS62264|P|
2026-09-09|MAS62368|P|
2026-09-09|MAS63299|P|
2026-09-09|MAS63306|P|
2026-09-10|MAS62260|P|
2026-09-10|MAS62264|P|
2026-09-10|MAS62368|P|
2026-09-10|MAS63299|P|
2026-09-10|MAS63306|P|
2026-09-11|MAS62260|P|
2026-09-11|MAS62264|P|
2026-09-11|MAS62368|P|
2026-09-11|MAS63299|P|
2026-09-12|MAS62260|P|
2026-09-12|MAS62264|P|
2026-09-12|MAS62368|P|
2026-09-12|MAS63299|P|
2026-09-14|MAS62260|P|
2026-09-14|MAS62264|P|
2026-09-14|MAS62368|P|
2026-09-14|MAS63299|P|
2026-09-14|MAS63306|P|
2026-09-15|MAS63306|P|
2026-09-16|MAS63306|P|
2026-09-17|MAS63306|P|
2026-09-18|MAS63306|P|
2026-09-03|MAS54280|HD|A
2026-09-06|MAS57521|HD|A
2026-09-06|MAS61446|HD|A
2026-09-10|MAS62323|HD|A
2026-09-12|MAS59596|HD|A
2026-09-13|MAS48872|HD|A
2026-09-16|MAS50704|HD|A
2026-09-17|MAS54920|HD|A
2026-09-17|MAS61446|HD|A
2026-09-21|MAS54280|HD|A
2026-09-25|MAS48068|HD|A
2026-09-25|MAS48872|HD|A
2026-09-25|MAS49781|HD|A
2026-09-26|MAS47157|HD|A
2026-09-27|MAS47780|HD|A
2026-09-27|MAS48828|HD|A
2026-09-27|MAS57637|HD|A
2026-09-28|MAS54920|HD|A
2026-09-29|MAS48872|HD|A
2026-09-30|MAS54280|HD|A
2026-09-05|MAS59596|P|A
2026-09-06|MAS62323|P|A
2026-09-09|MAS62846|HD|0
2026-09-13|MAS63252|HD|0
2026-09-03|MAS62338|P|0
2026-09-07|MAS63252|P|0
2026-09-11|MAS62338|P|0
2026-09-01|MAS63367|HD|A
2026-09-02|MAS63368|HD|A
2026-09-04|MAS60719|HD|A
2026-09-05|MAS60344|HD|A
2026-09-05|MAS61978|HD|A
2026-09-05|MAS63367|HD|A
2026-09-05|MAS63368|HD|A
2026-09-07|MAS63359|HD|A
2026-09-08|MAS54994|HD|A
2026-09-08|MAS61971|HD|A
2026-09-08|MAS63367|HD|A
2026-09-09|MAS63163|HD|A
2026-09-10|MAS63158|HD|A
2026-09-21|MAS63454|HD|A
2026-09-22|MAS63158|HD|A
2026-09-24|MAS55281|HD|A
2026-09-26|MAS63451|HD|A
2026-09-01|MAS52903|P|A
2026-09-01|MAS62587|P|A
2026-09-02|MAS60601|P|A
2026-09-02|MAS63132|P|A
2026-09-02|MAS63157|P|A
2026-09-02|MAS63158|P|A
2026-09-02|MAS63160|P|A
2026-09-03|MAS60673|P|A
2026-09-03|MAS63363|P|A
2026-09-04|MAS55718|P|A
2026-09-04|MAS62759|P|A
2026-09-04|MAS63323|P|A
2026-09-05|MAS54483|P|A
2026-09-05|MAS55281|P|A
2026-09-05|MAS56887|P|A
2026-09-05|MAS58555|P|A
2026-09-05|MAS60671|P|A
2026-09-05|MAS60673|P|A
2026-09-05|MAS62094|P|A
2026-09-05|MAS62496|P|A
2026-09-05|MAS62587|P|A
2026-09-05|MAS62860|P|A
2026-09-05|MAS62885|P|A
2026-09-05|MAS62888|P|A
2026-09-05|MAS63359|P|A
2026-09-06|MAS57040|P|A
2026-09-06|MAS60048|P|A
2026-09-06|MAS62759|P|A
2026-09-06|MAS62865|P|A
2026-09-06|MAS63205|P|A
2026-09-06|MAS63335|P|A
2026-09-07|MAS63139|P|A
2026-09-08|MAS56119|P|A
2026-09-08|MAS61377|P|A
2026-09-09|MAS61735|P|A
2026-09-09|MAS63205|P|A
2026-09-09|MAS63368|P|A
2026-09-10|MAS60719|P|A
2026-09-10|MAS63164|P|A
2026-09-11|MAS63179|P|A
2026-09-12|MAS59570|P|A
2026-09-12|MAS60601|P|A
2026-09-12|MAS62094|P|A
2026-09-13|MAS63156|P|A
2026-09-13|MAS63204|P|A
2026-09-13|MAS63323|P|A
2026-09-21|MAS60673|P|A
2026-09-21|MAS61735|P|A
2026-09-22|MAS60601|P|A
2026-09-22|MAS62759|P|A
2026-09-22|MAS63062|P|A
2026-09-23|MAS62094|P|A
2026-09-23|MAS63139|P|A
2026-09-23|MAS63163|P|A
2026-09-24|MAS61377|P|A
2026-09-24|MAS61735|P|A
2026-09-24|MAS63179|P|A
2026-09-25|MAS63158|P|A
2026-09-26|MAS63454|P|A
`.trim().split("\n").map((l) => { const [date, code, hrms, bill] = l.split("|"); return { date, code, hrms, bill }; });

const pick = (r: Record<string, unknown> | undefined, keys: string[]) => {
  if (!r) return null;
  const o: Record<string, unknown> = {};
  for (const k of keys) if (k in r && r[k] !== null && r[k] !== "") o[k] = r[k];
  return o;
};

async function q(sql: string, args: unknown[]): Promise<any[]> {
  try { const [r] = await db.query<RowDataPacket[]>(sql, args); return r as any[]; }
  catch (e: any) { return [{ error: e.code || e.message }]; }
}

(async () => {
  const codes = [...new Set(ROWS.map((r) => r.code))];
  const [emps] = await db.query<RowDataPacket[]>(
    `SELECT e.*, b.branch_name FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id WHERE e.employee_code IN (?)`, [codes]);
  const emp = new Map((emps as any[]).map((e) => [e.employee_code, e]));

  console.log("== employees ==");
  for (const c of codes) {
    const e = emp.get(c);
    const bm = (await billQuery(`SELECT EmpCode, EmpName, Status, DOJ, BioCode, CostCenter, BranchName FROM masjclrentry WHERE EmpCode = '${c}'`)) as any[];
    const bc = (await billQuery(`SELECT COUNT(*) n, MIN(AttandDate) mn, MAX(AttandDate) mx FROM Attandence WHERE EmpCode = '${c}' AND AttandDate BETWEEN '2026-09-01' AND '2026-09-30'`)) as any[];
    console.log("EMP", c, JSON.stringify({
      hrms: e ? pick(e, ["employment_status", "employee_status", "status", "date_of_joining", "joining_date", "doj", "date_of_exit", "exit_date", "last_working_date", "lwd", "branch_name", "biometric_code", "bio_code"]) : "NOT IN HRMS",
      bill: bm[0] ?? "NOT IN masjclrentry", billSepRows: bc[0],
    }));
  }

  console.log("== rows ==");
  for (const r of ROWS) {
    const e = emp.get(r.code);
    const id = e?.id ?? "-";
    const adr = await q(`SELECT * FROM attendance_daily_record WHERE employee_id = ? AND record_date = ?`, [id, r.date]);
    const bio = await q(`SELECT punch_date, first_punch_in, last_punch_out, raw_minutes, source_system FROM biometric_attendance_log WHERE employee_id = ? AND punch_date = ?`, [id, r.date]);
    const dial = await q(`SELECT session_date, login_minutes, integration_key FROM dialer_session_log WHERE (employee_id = ? OR employee_code = ?) AND session_date = ?`, [id, r.code, r.date]);
    const apr = await q(`SELECT COUNT(*) n, SUM(Net_Login) net FROM (SELECT DISTINCT UserID, ReportDate, Net_Login FROM apr WHERE UserID = ? AND ReportDate = ?) x`, [r.code, r.date]);
    const reg = await q(`SELECT * FROM attendance_regularization WHERE employee_id = ? AND session_date = ?`, [id, r.date]);
    const lv = await q(`SELECT id, from_date, to_date, total_days, status FROM leave_request WHERE employee_id = ? AND ? BETWEEN from_date AND to_date`, [id, r.date]);
    const ovr = await q(`SELECT * FROM attendance_manual_override WHERE employee_id = ? AND attendance_date = ?`, [id, r.date]);
    const ba = (await billQuery(
      `SELECT Id, Status, OldStatus, PendingStatus, Intime, OutTime, EmpStatus, ImportDate FROM Attandence WHERE EmpCode = '${r.code}' AND AttandDate = '${r.date}'`)) as any[];
    const a = adr[0];
    console.log("ROW", JSON.stringify({
      date: r.date, code: r.code, sheet: { hrms: r.hrms, bill: r.bill },
      adr: a ? pick(a, ["attendance_status", "attendance_source", "source_system", "source_record_date", "dialler_minutes", "biometric_minutes", "raw_minutes", "late_by_minutes", "is_regularized", "regularization_id", "override_reason", "remarks", "processed_at", "created_at", "updated_at", "error"]) : null,
      bio: bio.map((x) => pick(x, Object.keys(x))),
      dial, apr: apr[0],
      reg: reg.map((x) => pick(x, ["status", "requested_status", "reason", "regularization_type", "requested_in", "requested_out", "reviewed_at", "created_at", "error"])),
      leave: lv, ovr: ovr.map((x) => pick(x, ["old_status", "new_status", "reason", "created_at", "error"])),
      bill: ba,
    }));
  }
  await closeBillPool();
  process.exit(0);
})().catch(async (e) => { console.error(e); await closeBillPool().catch(() => {}); process.exit(1); });
