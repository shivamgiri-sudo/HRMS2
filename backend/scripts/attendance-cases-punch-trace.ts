// READ-ONLY. Raw punch trace for a list of "<EMPLOYEE_CODE>:<YYYY-MM-DD>" cases.
// For each case prints every raw COSEC punch from the evening before to the end of the next day,
// plus the stored attendance rows for the day before / the day / the day after, the roster
// and any leave, so an exit-less evening start can be told from a genuine absence.
// Usage: npx tsx scripts/attendance-cases-punch-trace.ts "<CODE>:<DATE>,<CODE>:<DATE>,..."
import "dotenv/config";
import sql from "mssql";
import { db } from "../src/db/mysql.js";
import { getNcosecPool } from "../src/db/ncosecDb.js";

const cases = (process.argv[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
  const [code, date] = s.split(":"); return { code, date };
});
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  const pool = await getNcosecPool();
  const table = process.env.NCOSEC_EVENT_TABLE?.trim() || "dbo.Mx_ATDEventTrn";
  const uc = process.env.NCOSEC_USER_ID_COLUMN?.trim() || "UserID";
  const dc = process.env.NCOSEC_DATETIME_COLUMN?.trim() || "Edatetime";
  const [[nowRow]] = await db.query<any[]>(`SELECT DATE_FORMAT(CONVERT_TZ(NOW(),'+00:00','+05:30'),'%Y-%m-%d %H:%i') AS ist_now`).catch(() => [[{ ist_now: "?" }]] as any);
  console.log(`server IST now: ${(nowRow as any)?.ist_now}`);

  for (const c of cases) {
    const [emps] = await db.execute<any[]>(
      `SELECT id, employee_code, biometric_code, CONCAT(first_name,' ',COALESCE(last_name,'')) AS name, process_id FROM employees WHERE employee_code = ? LIMIT 1`, [c.code]);
    const e = (emps as any[])[0];
    console.log(`\n===== ${c.code} ${e?.name?.trim() ?? "?"}  case date ${c.date} =====`);
    if (!e) continue;
    const ids = [...new Set([e.employee_code, e.biometric_code].filter(Boolean))] as string[];
    const req = pool.request();
    req.input("f", sql.DateTime, `${addDays(c.date, -1)} 12:00:00`);
    req.input("t", sql.DateTime, `${addDays(c.date, 2)} 00:00:00`);
    ids.forEach((v, i) => req.input(`u${i}`, sql.NVarChar(100), v));
    const r = await req.query(
      `SELECT CONVERT(CHAR(16), [${dc}], 120) AS ts FROM ${table}
        WHERE CAST([${uc}] AS NVARCHAR(100)) IN (${ids.map((_, i) => `@u${i}`).join(",")}) AND [${dc}] >= @f AND [${dc}] < @t ORDER BY [${dc}]`);
    const byDay = new Map<string, string[]>();
    for (const row of r.recordset) { const d = String(row.ts).slice(0, 10); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(String(row.ts).slice(11)); }
    for (const d of [...byDay.keys()].sort()) console.log(`  punches ${d}: ${byDay.get(d)!.join(" ")}`);
    if (!r.recordset.length) console.log("  punches: none in window");

    const [adr] = await db.execute<any[]>(
      `SELECT DATE_FORMAT(record_date,'%Y-%m-%d') d, attendance_status st, lwp_value lwp, is_locked lk, raw_minutes rm,
              DATE_FORMAT(clock_in_time,'%H:%i') ci, DATE_FORMAT(clock_out_time,'%m-%d %H:%i') co, attendance_source src, source_system ss
         FROM attendance_daily_record WHERE employee_id = ? AND record_date BETWEEN ? AND ? ORDER BY record_date`,
      [e.id, addDays(c.date, -2), addDays(c.date, 1)]);
    for (const a of adr as any[]) console.log(`  ADR ${a.d}: ${a.st} lwp=${a.lwp}${a.lk ? " LOCKED" : ""} ${a.rm}min in=${a.ci ?? "-"} out=${a.co ?? "-"} src=${a.src}/${a.ss}`);

    const [ro] = await db.execute<any[]>(
      `SELECT DATE_FORMAT(roster_date,'%Y-%m-%d') d, shift_start_time s, shift_end_time en, is_week_off w, publish_status p
         FROM wfm_roster_assignment WHERE employee_id = ? AND roster_date BETWEEN ? AND ? ORDER BY roster_date`,
      [e.id, addDays(c.date, -1), addDays(c.date, 1)]);
    for (const x of ro as any[]) console.log(`  ROSTER ${x.d}: ${x.w ? "WEEK OFF" : `${x.s}-${x.en}`} (${x.p})`);
    const [lv] = await db.execute<any[]>(
      `SELECT DATE_FORMAT(from_date,'%Y-%m-%d') f, DATE_FORMAT(to_date,'%Y-%m-%d') t, total_days, status FROM leave_request
        WHERE employee_id = ? AND to_date >= ? AND from_date <= ?`, [e.id, c.date, c.date]);
    for (const x of lv as any[]) console.log(`  LEAVE ${x.f}..${x.t} ${x.total_days}d ${x.status}`);
    // APR / dialler for the day (procfor dialler-sourced employees)
    const [apr] = await db.execute<any[]>(
      `SELECT ReportDate d, Net_Login nl, Campaign c FROM apr WHERE UserID IN (?, ?) AND ReportDate = ? LIMIT 3`,
      [e.employee_code, e.biometric_code ?? e.employee_code, c.date]).catch(() => [[]] as any);
    for (const x of (apr as any[])) console.log(`  APR ${x.d}: net_login=${x.nl} campaign=${x.c}`);
  }
  await db.end();
  process.exit(0);
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
