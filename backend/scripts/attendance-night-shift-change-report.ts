// READ-ONLY. Employee-wise list of days whose attendance differs between the OLD calendar-date
// grouping and the NEW shift attribution, with the current stored record beside them.
// The pre-fix rows were overwritten and no history table exists, so "old" is reconstructed from the
// same raw COSEC punches (MIN/MAX per calendar date, what the old sync stored).
// Prints CSV lines prefixed "CSV," plus per-employee summary lines prefixed "SUM,".
// Usage: npx tsx scripts/attendance-night-shift-change-report.ts <ignored> <from> <to>
import "dotenv/config";
import sql from "mssql";
import { db } from "../src/db/mysql.js";
import { getNcosecPool } from "../src/db/ncosecDb.js";
import { attributeNightShifts, type PunchBlock } from "../src/modules/wfm/cosec-sync.service.js";

const FROM = process.argv[3] ?? "2026-10-01";
const TO = process.argv[4] ?? "2026-10-12";
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffMin = (a: string, b: string) => Math.round((new Date(b.replace(" ", "T") + "Z").getTime() - new Date(a.replace(" ", "T") + "Z").getTime()) / 60000);
const hrs = (m: number) => (m / 60).toFixed(1);
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

(async () => {
  const [emps] = await db.execute<any[]>(
    `SELECT DISTINCT adr.employee_id
       FROM attendance_daily_record adr
      WHERE adr.record_date BETWEEN ? AND ?
        AND (adr.source_system LIKE '%cosec%' OR adr.source_system = 'wfm_attendance_session' OR adr.source_system = 'regularization')`,
    [FROM, TO]);
  const empIds = (emps as any[]).map((r) => r.employee_id);
  console.log(`employees in scope: ${empIds.length}`);

  const info = new Map<string, { code: string; name: string; branch: string; ids: string[] }>();
  for (let i = 0; i < empIds.length; i += 500) {
    const [rows] = await db.query<any[]>(
      `SELECT e.id, e.employee_code, e.biometric_code, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS name,
              COALESCE(b.branch_name,'') AS branch, GROUP_CONCAT(DISTINCT ebe.cosec_user_id) AS cosec_ids
         FROM employees e
         LEFT JOIN employee_biometric_enrollment ebe ON ebe.employee_id = e.id
         LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE e.id IN (?) GROUP BY e.id, e.employee_code, e.biometric_code, name, branch`, [empIds.slice(i, i + 500)]);
    for (const r of rows as any[]) {
      const ids = [...new Set([r.employee_code, r.biometric_code, ...String(r.cosec_ids ?? "").split(",")].map((x) => String(x ?? "").trim()).filter(Boolean))];
      info.set(r.id, { code: r.employee_code, name: String(r.name).trim(), branch: r.branch, ids });
    }
  }
  const idToEmp = new Map<string, string>();
  for (const [eid, v] of info) for (const id of v.ids) idToEmp.set(id, eid);

  const pool = await getNcosecPool();
  const table = process.env.NCOSEC_EVENT_TABLE?.trim() || "dbo.Mx_ATDEventTrn";
  const uc = process.env.NCOSEC_USER_ID_COLUMN?.trim() || "UserID";
  const dc = process.env.NCOSEC_DATETIME_COLUMN?.trim() || "Edatetime";
  const allIds = [...idToEmp.keys()];
  const blocks: PunchBlock[] = [];
  for (let i = 0; i < allIds.length; i += 400) {
    const slice = allIds.slice(i, i + 400);
    const req = pool.request();
    req.input("f", sql.Date, addDays(FROM, -1));
    req.input("t", sql.Date, addDays(TO, 1));
    slice.forEach((v, j) => req.input(`u${j}`, sql.NVarChar(100), v));
    const r = await req.query(`
      SELECT CAST([${uc}] AS NVARCHAR(100)) AS user_id,
             CONVERT(CHAR(10), CAST([${dc}] AS DATE), 23) AS attendance_date,
             CONVERT(CHAR(19), MIN([${dc}]), 120) AS first_punch,
             CONVERT(CHAR(19), MAX([${dc}]), 120) AS last_punch,
             COUNT_BIG(*) AS total_punches
        FROM ${table}
       WHERE [${dc}] >= @f AND [${dc}] < @t AND CAST([${uc}] AS NVARCHAR(100)) IN (${slice.map((_, j) => `@u${j}`).join(",")})
       GROUP BY [${uc}], CAST([${dc}] AS DATE), DATEPART(HOUR, [${dc}])`);
    for (const row of r.recordset) blocks.push({
      cosecUserId: String(row.user_id).trim(), punchDate: String(row.attendance_date),
      firstPunch: String(row.first_punch), lastPunch: String(row.last_punch), totalPunches: Number(row.total_punches),
    });
  }

  // per employee: pick the cosec id with the most blocks
  const perEmp = new Map<string, Map<string, PunchBlock[]>>();
  for (const b of blocks) {
    const eid = idToEmp.get(b.cosecUserId); if (!eid) continue;
    const m = perEmp.get(eid) ?? new Map(); const a = m.get(b.cosecUserId) ?? []; a.push(b); m.set(b.cosecUserId, a); perEmp.set(eid, m);
  }

  // current stored rows
  const cur = new Map<string, Map<string, any>>();
  for (let i = 0; i < empIds.length; i += 500) {
    const [rows] = await db.query<any[]>(
      `SELECT employee_id, DATE_FORMAT(record_date,'%Y-%m-%d') d, attendance_status st, lwp_value lwp, is_locked lk,
              raw_minutes rm, clock_in_time ci, clock_out_time co
         FROM attendance_daily_record WHERE employee_id IN (?) AND record_date BETWEEN ? AND ?`, [empIds.slice(i, i + 500), FROM, TO]);
    for (const r of rows as any[]) { const m = cur.get(r.employee_id) ?? new Map(); m.set(r.d, r); cur.set(r.employee_id, m); }
  }

  console.log("CSV,employee_code,name,branch,date,change_type,old_in,old_out,old_hours,new_in,new_out,new_hours,current_status,current_lwp,locked");
  const summary: Array<{ code: string; name: string; branch: string; days: number; cleared: number; hoursFixed: number; lockedLeft: number; lwpLeft: number }> = [];
  let totalRows = 0;
  for (const [eid, users] of perEmp) {
    const best = [...users.values()].sort((a, b) => b.length - a.length)[0];
    const meta = info.get(eid)!;
    // OLD: calendar-date MIN/MAX
    const oldBy = new Map<string, { first: string; last: string; count: number }>();
    for (const b of best) {
      const o = oldBy.get(b.punchDate);
      if (!o) oldBy.set(b.punchDate, { first: b.firstPunch, last: b.lastPunch, count: b.totalPunches });
      else { if (b.firstPunch < o.first) o.first = b.firstPunch; if (b.lastPunch > o.last) o.last = b.lastPunch; o.count += b.totalPunches; }
    }
    const att = attributeNightShifts(best, "cosec_sqlserver", table);
    const newBy = new Map(att.groups.map((g) => [g.punchDate, g]));
    const sum = { code: meta.code, name: meta.name, branch: meta.branch, days: 0, cleared: 0, hoursFixed: 0, lockedLeft: 0, lwpLeft: 0 };
    for (let d = FROM; d <= TO; d = addDays(d, 1)) {
      const o = oldBy.get(d); const n = newBy.get(d); const c = cur.get(eid)?.get(d);
      const oldMin = o ? diffMin(o.first, o.last) : 0;
      const newMin = n ? n.workingMinutes : 0;
      let type = "";
      if (o && !n) type = "exit_only_day_cleared";
      else if (o && n && Math.abs(oldMin - newMin) > 30) type = "hours_corrected";
      else if (!o && n) type = "shift_attributed_from_other_date";
      if (!type) continue;
      const locked = c?.lk === 1 || c?.lk === "1";
      sum.days++; if (type === "exit_only_day_cleared") sum.cleared++; else sum.hoursFixed++;
      if (locked) sum.lockedLeft++;
      sum.lwpLeft += Number(c?.lwp ?? 0);
      totalRows++;
      console.log(["CSV", meta.code, meta.name, meta.branch, d, type,
        o?.first ?? "", o?.last ?? "", o ? hrs(oldMin) : "",
        n?.firstPunch ?? "", n?.lastPunch ?? "", n ? hrs(newMin) : "",
        c?.st ?? "", c?.lwp ?? "", locked ? "LOCKED" : ""].map(csv).join(","));
    }
    if (sum.days) summary.push(sum);
  }
  summary.sort((a, b) => b.days - a.days);
  console.log(`SUMMARY employees affected: ${summary.length}, day-rows: ${totalRows}`);
  for (const s of summary) console.log(["SUM", s.code, s.name, s.branch, s.days, s.hoursFixed, s.cleared, s.lockedLeft, s.lwpLeft].map(csv).join(","));
  await db.end();
  process.exit(0);
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
