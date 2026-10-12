// READ-ONLY dry run. Rebuilds one employee's attendance by SHIFT window instead of calendar date
// and prints it beside the current attendance_daily_record, plus the payroll week-off slab effect.
// Writes nothing.
// Usage: npx tsx scripts/attendance-night-shift-rebuild-dryrun.ts <EMPLOYEE_CODE> [from] [to]
import "dotenv/config";
import sql from "mssql";
import { db } from "../src/db/mysql.js";
import { getNcosecPool } from "../src/db/ncosecDb.js";
import { findSlabMaxWeekoffs } from "../src/modules/payroll/weekoff-eligibility.service.js";

const CODE = (process.argv[2] ?? "").trim();
const FROM = process.argv[3] ?? "2026-09-01";
const TO = process.argv[4] ?? "2026-10-12";
const FULL = 540, HALF = 270;
const PRE_H = 3, POST_H = 3; // window padding around the rostered shift
const SLABS = JSON.parse('[{"from":0,"to":6,"max_weekoffs":0},{"from":7,"to":11,"max_weekoffs":1},{"from":12,"to":17,"max_weekoffs":2},{"from":18,"to":23,"max_weekoffs":3},{"from":24,"to":25,"max_weekoffs":4},{"from":26,"to":31,"max_weekoffs":5}]');

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
// Treat all wall-clock strings as naive IST; use UTC arithmetic on them consistently.
const ms = (s: string) => new Date(s.replace(" ", "T") + "Z").getTime();
const hm = (t: string | null) => { if (!t) return null; const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const fmt = (n: number) => `${Math.floor(n / 60)}h${pad(Math.round(n % 60))}`;

type Shift = { start: number; end: number; night: boolean; weekOff: boolean; inherited: boolean };

(async () => {
  const [emps] = await db.execute<any[]>(
    `SELECT id, employee_code, biometric_code FROM employees WHERE employee_code = ? OR biometric_code = ? LIMIT 1`, [CODE, CODE]);
  const emp = (emps as any[])[0];
  if (!emp) { console.log("employee not found"); await db.end(); return; }
  const ids = [...new Set([emp.employee_code, emp.biometric_code, CODE].filter(Boolean))] as string[];

  // ---- raw punches from COSEC SQL Server ----
  const punches: string[] = [];
  try {
    const pool = await getNcosecPool();
    const table = process.env.NCOSEC_EVENT_TABLE?.trim() || "dbo.Mx_ATDEventTrn";
    const uc = process.env.NCOSEC_USER_ID_COLUMN?.trim() || "UserID";
    const dc = process.env.NCOSEC_DATETIME_COLUMN?.trim() || "Edatetime";
    const req = pool.request();
    req.input("f", sql.Date, addDays(FROM, -1));
    req.input("t", sql.Date, addDays(TO, 2));
    ids.forEach((v, i) => req.input(`u${i}`, sql.NVarChar(100), v));
    const inList = ids.map((_, i) => `@u${i}`).join(",");
    const r = await req.query(
      `SELECT CONVERT(CHAR(19), [${dc}], 120) AS ts FROM ${table}
        WHERE CAST([${uc}] AS NVARCHAR(100)) IN (${inList}) AND [${dc}] >= @f AND [${dc}] < @t ORDER BY [${dc}]`);
    for (const row of r.recordset) punches.push(String(row.ts));
  } catch (e: any) {
    console.log("RAW COSEC PULL FAILED:", e?.message ?? e);
  }
  console.log(`raw punches pulled: ${punches.length}`);
  if (!punches.length) { await db.end(); return; }

  // ---- roster per date (latest publish status wins; draft counted, as the engine does) ----
  const [rr] = await db.execute<any[]>(
    `SELECT DATE_FORMAT(roster_date,'%Y-%m-%d') d, shift_start_time s, shift_end_time e, is_week_off w, publish_status p
       FROM wfm_roster_assignment WHERE employee_id = ? AND roster_date BETWEEN ? AND ?
       ORDER BY roster_date, FIELD(publish_status,'approved_final','published','draft'), updated_at DESC`,
    [emp.id, addDays(FROM, -7), TO]);
  const rosterRaw = new Map<string, any>();
  for (const r of rr as any[]) if (!rosterRaw.has(r.d)) rosterRaw.set(r.d, r);

  const shifts = new Map<string, Shift>();
  let lastWorking: Shift | null = null;
  for (let d = addDays(FROM, -7); d <= TO; d = addDays(d, 1)) {
    const r = rosterRaw.get(d);
    const s = hm(r?.s), e = hm(r?.e);
    if (r && !r.w && s != null && e != null) {
      const sh: Shift = { start: s, end: e, night: e <= s, weekOff: false, inherited: false };
      shifts.set(d, sh); lastWorking = sh;
    } else if (lastWorking) {
      shifts.set(d, { ...lastWorking, weekOff: !!r?.w, inherited: true });
    }
  }

  // ---- cluster punches into shifts: a gap of GAP_H or more starts a new shift ----
  // Roster-independent on purpose: rosters are often draft or stale, and break/door punches
  // inside a 9h shift can be 20-45 events. A shift is attributed to the date of its first punch.
  const GAP_H = 5;
  const bucket = new Map<string, string[]>();
  const orphan: string[] = [];
  let grp: string[] = [];
  const flush = () => {
    if (!grp.length) return;
    const d = grp[0].slice(0, 10);
    if (d >= FROM && d <= TO) {
      const k = bucket.has(d) ? `${d}#2` : d; // two shifts starting same date: keep both visible
      bucket.set(k, grp);
    } else orphan.push(...grp);
    grp = [];
  };
  for (const p of punches) {
    if (grp.length && ms(p) - ms(cur[grp.length - 1]) >= GAP_H * 3600000) flush();
    grp.push(p);
  }
  flush();
  for (const k of [...bucket.keys()]) if (k.endsWith("#2")) console.log("NOTE second shift starting same date:", k, bucket.get(k)![0], "->", bucket.get(k)!.slice(-1)[0]);

  // ---- current attendance_daily_record ----
  const [cur] = await db.execute<any[]>(
    `SELECT DATE_FORMAT(record_date,'%Y-%m-%d') d, attendance_status st, lwp_value lwp, raw_minutes rm, is_locked lk, source_system src
       FROM attendance_daily_record WHERE employee_id = ? AND record_date BETWEEN ? AND ?`, [emp.id, FROM, TO]);
  const curMap = new Map((cur as any[]).map(r => [r.d, r]));

  const rows: any[] = [];
  const paidNew: Record<string, number> = {}, paidCur: Record<string, number> = {};
  const paidOf = (st: string) => st === "present" || st === "week_off_worked" || st === "leave_approved" || st === "holiday" ? 1 : st === "half_day" ? 0.5 : 0;
  for (let d = FROM; d <= TO; d = addDays(d, 1)) {
    const sh = shifts.get(d);
    const ps = [...(bucket.get(d) ?? []), ...(bucket.get(d + "#2") ?? [])].sort();
    let inT: string | null = null, outT: string | null = null, mins = 0, st = "no_punch";
    if (ps.length) {
      inT = ps[0];
      if (ps.length >= 2) { outT = ps[ps.length - 1]; mins = Math.round((ms(outT) - ms(inT)) / 60000); }
      st = ps.length < 2 ? "single_punch" : mins >= FULL ? "present" : mins >= HALF ? "half_day" : "absent";
    }
    const c = curMap.get(d);
    const month = d.slice(0, 7);
    paidNew[month] = (paidNew[month] ?? 0) + paidOf(st);
    paidCur[month] = (paidCur[month] ?? 0) + paidOf(c?.st ?? "");
    rows.push({
      date: d, dow: new Date(d + "T00:00:00Z").getUTCDay(),
      roster: sh ? `${sh.weekOff ? "WO " : ""}${pad(Math.floor(sh.start / 60))}:${pad(sh.start % 60)}-${pad(Math.floor(sh.end / 60))}:${pad(sh.end % 60)}${sh.inherited ? "*" : ""}` : "-",
      punches: ps.length, in: inT?.slice(5, 16) ?? "", out: outT?.slice(5, 16) ?? "", span: mins ? fmt(mins) : "",
      NEW: st, CUR: c ? `${c.st}${c.lk ? "/L" : ""} ${c.lwp}` : "-", CUR_hrs: c ? fmt(Number(c.rm ?? 0)) : "",
    });
  }
  console.log("\n=== REBUILD (shift-window) vs CURRENT  [* roster inherited from last working day; /L = locked] ===");
  console.table(rows);
  console.log(`orphan punches outside every shift window: ${orphan.length}`, orphan.slice(0, 20));

  // ---- payroll effect (default slabs, no holidays, Sundays as weekoff cap) ----
  for (const m of Object.keys(paidNew)) {
    const [y, mo] = m.split("-").map(Number);
    const dim = new Date(y, mo, 0).getDate();
    let sundays = 0; for (let i = 1; i <= dim; i++) if (new Date(y, mo - 1, i).getDay() === 0) sundays++;
    const wo = (pb: number) => Math.min(findSlabMaxWeekoffs(pb, SLABS) ?? sundays, sundays);
    const calc = (pb: number) => Math.min(pb + wo(pb), dim);
    console.log(`PAYROLL ${m} (only dates in window): paidBase CUR=${paidCur[m]} -> payable≈${calc(paidCur[m])}; NEW=${paidNew[m]} -> payable≈${calc(paidNew[m])}; sundays=${sundays}`);
  }
  await db.end();
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
