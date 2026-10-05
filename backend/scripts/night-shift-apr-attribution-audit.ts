/**
 * Night-shift APR attribution audit. READ-ONLY (HRMS SELECTs + billQuery SELECTs).
 * Prints COUNTS ONLY - no employee codes, names or per-person rows.
 *
 * Question: the engine credits a cross-midnight roster day D with APR of ReportDate D AND D+1.
 * Which date does the dialler file a night shift under, and how often does one APR day feed two
 * attendance records?
 *
 *   npx tsx scripts/night-shift-apr-attribution-audit.ts 2026-09
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

const MONTH = process.argv[2] ?? "2026-09";
const first = `${MONTH}-01`;
const last = new Date(Date.UTC(+MONTH.slice(0, 4), +MONTH.slice(5, 7), 0)).toISOString().slice(0, 10);
const shift = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const credit = (s: string) => (s === "present" ? 1 : s === "half_day" ? 0.5 : 0);
const grade = (m: number) => (m >= 480 ? 1 : m >= 240 ? 0.5 : 0);
const inc = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };

(async () => {
  const [night] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT e.employee_code code FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
      WHERE adr.record_date BETWEEN ? AND ? AND adr.source_system LIKE '%night_shift_window'`, [first, last]);
  const codes = (night as any[]).map((r) => r.code);
  console.log(`month ${MONTH}: employees with >=1 night_shift_window record: ${codes.length}`);
  if (!codes.length) { await closeBillPool(); process.exit(0); }

  const [adrRows] = await db.query<RowDataPacket[]>(
    `SELECT e.employee_code code, DATE_FORMAT(adr.record_date,'%Y-%m-%d') d, adr.attendance_status st, COALESCE(adr.source_system,'') src
       FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
      WHERE adr.record_date BETWEEN ? AND ? AND e.employee_code IN (?)`, [shift(first, -1), shift(last, 1), codes]);
  const [aprRows] = await db.query<RowDataPacket[]>(
    `SELECT UserID code, DATE_FORMAT(ReportDate,'%Y-%m-%d') d,
            SUM(TIME_TO_SEC(Net_Login)) DIV 60 m
       FROM (SELECT DISTINCT UserID, ReportDate, Net_Login FROM apr WHERE ReportDate BETWEEN ? AND ? AND UserID IN (?)) x
      GROUP BY UserID, ReportDate`, [shift(first, -1), shift(last, 1), codes]);
  const [bioRows] = await db.query<RowDataPacket[]>(
    `SELECT e.employee_code code, DATE_FORMAT(b.punch_date,'%Y-%m-%d') d, HOUR(b.first_punch_in) hi, HOUR(b.last_punch_out) ho, b.raw_minutes m
       FROM biometric_attendance_log b JOIN employees e ON e.id = b.employee_id
      WHERE b.punch_date BETWEEN ? AND ? AND e.employee_code IN (?)`, [first, last, codes]);
  const bill: any[] = [];
  for (let i = 0; i < codes.length; i += 200) {
    const part = codes.slice(i, i + 200);
    bill.push(...(await billQuery<any>(
      `SELECT EmpCode code, DATE_FORMAT(AttandDate,'%Y-%m-%d') d, Status st FROM Attandence
        WHERE AttandDate BETWEEN ? AND ? AND EmpCode IN (${part.map(() => "?").join(",")})`, [first, last, ...part])));
  }

  const adr = new Map((adrRows as any[]).map((r) => [`${r.code}|${r.d}`, r]));
  const apr = new Map((aprRows as any[]).map((r) => [`${r.code}|${r.d}`, Number(r.m)]));
  const bst = new Map(bill.map((r) => [`${r.code}|${r.d}`, String(r.st ?? "")]));
  const A = (c: string, d: string) => apr.get(`${c}|${d}`) ?? 0;

  // 1. Night records and where their minutes came from.
  const n: Record<string, number> = {};
  let curDays = 0, sameDayDays = 0;
  const doubleUse: Record<string, number> = {};
  for (const r of adrRows as any[]) {
    if (r.d < first || r.d > last || !String(r.src).endsWith("night_shift_window")) continue;
    inc(n, "night records");
    const same = A(r.code, r.d), next = A(r.code, shift(r.d, 1));
    inc(n, same > 0 && next > 0 ? "APR on D and D+1 (summed)" : same > 0 ? "APR on D only" : next > 0 ? "APR on D+1 only (borrowed)" : "no APR either day");
    curDays += credit(r.st); sameDayDays += grade(same);
    // Is D+1's APR also credited to the D+1 record?
    if (next > 0) {
      const nx = adr.get(`${r.code}|${shift(r.d, 1)}`);
      const nxUses = nx && credit(nx.st) > 0 && /apr|dialer/.test(nx.src);
      inc(doubleUse, nxUses ? "D+1 APR ALSO credited to D+1 record (double use)" : "D+1 APR used only by D");
      // bill view of the same two days
      const bD = bst.get(`${r.code}|${r.d}`) ?? "(no row)", bN = bst.get(`${r.code}|${shift(r.d, 1)}`) ?? "(no row)";
      inc(doubleUse, `db_bill D=${bD} / D+1=${bN}`);
    }
  }
  console.log("== 1. night_shift_window records by APR origin ==", n);
  console.log("== 2. reuse of the next day's APR ==", doubleUse);
  console.log(`== 3. paid-day credit on night records: current engine ${curDays}, if APR counted on its own ReportDate only ${sameDayDays}`);

  // 4. Which ReportDate carries an early-morning (00-06h in, out by 10h) biometric presence?
  const conv: Record<string, number> = {};
  for (const b of bioRows as any[]) {
    if (b.hi === null || b.hi > 6 || b.ho === null || b.ho > 10 || Number(b.m) < 240) continue;
    const s = A(b.code, b.d) > 0, p = A(b.code, shift(b.d, -1)) > 0, x = A(b.code, shift(b.d, 1)) > 0;
    inc(conv, "early-morning punch days");
    inc(conv, `APR same date=${s ? "Y" : "N"} prev date=${p ? "Y" : "N"} next date=${x ? "Y" : "N"}`);
  }
  console.log("== 4. early-morning biometric presence vs APR ReportDate ==", conv);

  // 5. db_bill agreement with APR-on-own-date for every day of these employees.
  const agree: Record<string, number> = {};
  for (const [k, st] of bst) {
    const [c, d] = k.split("|");
    inc(agree, `db_bill ${st || "(blank)"} & APR on that date ${A(c, d) > 0 ? "Y" : "N"}`);
  }
  console.log("== 5. db_bill Status vs APR present on the same date ==", agree);
  await closeBillPool();
  process.exit(0);
})().catch(async (e) => { console.error(e); await closeBillPool().catch(() => {}); process.exit(1); });
