// READ-ONLY. STORED daily record vs what the current shift attribution would store, for every
// employee with a biometric-sourced daily row in the window. Lists days where stored clock-in or
// clock-out is more than 30 min away from the attributed shift, or where a stored day has no shift
// (or a shift has no stored day). Shows stored status / LWP / lock so payroll impact is visible.
// Prints "CSV," rows and "SUM," per employee. Writes nothing.
// Usage: npx tsx scripts/attendance-stored-vs-attributed.ts <ignored> <from> <to>
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
              raw_minutes rm, DATE_FORMAT(clock_in_time,'%Y-%m-%d %H:%i:%s') ci, DATE_FORMAT(clock_out_time,'%Y-%m-%d %H:%i:%s') co
         FROM attendance_daily_record WHERE employee_id IN (?) AND record_date BETWEEN ? AND ?`, [empIds.slice(i, i + 500), FROM, TO]);
    for (const r of rows as any[]) { const m = cur.get(r.employee_id) ?? new Map(); m.set(r.d, r); cur.set(r.employee_id, m); }
  }

  console.log("CSV,employee_code,name,branch,date,change_type,stored_in,stored_out,stored_hours,new_in,new_out,new_hours,current_status,current_lwp,locked");
  const summary: Array<{ code: string; name: string; branch: string; days: number; cleared: number; hoursFixed: number; lockedLeft: number; lwpLeft: number }> = [];
  let totalRows = 0;
  for (const [eid, users] of perEmp) {
    const best = [...users.values()].sort((a, b) => b.length - a.length)[0];
    const meta = info.get(eid)!;
    const att = attributeNightShifts(best, "cosec_sqlserver", table);
    const newBy = new Map(att.groups.map((g) => [g.punchDate, g]));
    const sum = { code: meta.code, name: meta.name, branch: meta.branch, days: 0, cleared: 0, hoursFixed: 0, lockedLeft: 0, lwpLeft: 0 };
    for (let d = FROM; d <= TO; d = addDays(d, 1)) {
      const n = newBy.get(d); const c = cur.get(eid)?.get(d);
      const storedIn = c?.ci ? String(c.ci).slice(0, 19).replace("T", " ") : "";
      const storedOut = c?.co ? String(c.co).slice(0, 19).replace("T", " ") : "";
      const sIn = storedIn || null; const sOut = storedOut || null;
      let type = "";
      if (n && !c) type = "shift_without_stored_day";
      else if (!n && sIn) type = "stored_day_without_shift";
      else if (n && sIn && (Math.abs(diffMin(sIn, n.firstPunch)) > 30 || (sOut && Math.abs(diffMin(sOut, n.lastPunch)) > 30))) type = "stored_differs";
      if (!type) continue;
      const locked = c?.lk === 1 || c?.lk === "1";
      sum.days++; if (type === "stored_day_without_shift") sum.cleared++; else sum.hoursFixed++;
      if (locked) sum.lockedLeft++;
      sum.lwpLeft += Number(c?.lwp ?? 0);
      totalRows++;
      console.log(["CSV", meta.code, meta.name, meta.branch, d, type,
        storedIn, storedOut, c ? hrs(Number(c.rm ?? 0)) : "",
        n?.firstPunch ?? "", n?.lastPunch ?? "", n ? hrs(n.workingMinutes) : "",
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
