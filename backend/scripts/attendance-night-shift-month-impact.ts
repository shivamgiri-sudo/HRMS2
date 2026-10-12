// READ-ONLY. Per-employee payable-days impact of attributing night shifts to their start date,
// for a whole month (Aug / Sep 2026), using the exact attributeNightShifts() the sync now runs.
//   - locked rows (regularisations, payroll locks) and leave / holiday / week_off_worked rows
//     keep their current value in BOTH columns, because the fix never touches them
//   - unlocked biometric rows are regraded from the attributed shifts
//   - payable days = min(paid base + week-offs from the slab capped at Sundays, days in month)
//     holidays and leave are not re-derived; this is a comparison, not a payroll run
// Usage: npx tsx scripts/attendance-night-shift-month-impact.ts <ignored> <from> <to>
import "dotenv/config";
import sql from "mssql";
import { db } from "../src/db/mysql.js";
import { getNcosecPool } from "../src/db/ncosecDb.js";
import { attributeNightShifts, type PunchBlock } from "../src/modules/wfm/cosec-sync.service.js";
import { findSlabMaxWeekoffs } from "../src/modules/payroll/weekoff-eligibility.service.js";

const FROM = process.argv[3] ?? "2026-09-01";
const TO = process.argv[4] ?? "2026-09-30";
const FULL = 540, HALF = 270;
const SLABS = JSON.parse('[{"from":0,"to":6,"max_weekoffs":0},{"from":7,"to":11,"max_weekoffs":1},{"from":12,"to":17,"max_weekoffs":2},{"from":18,"to":23,"max_weekoffs":3},{"from":24,"to":25,"max_weekoffs":4},{"from":26,"to":31,"max_weekoffs":5}]');
const paidOf = (st: string) => (st === "present" || st === "week_off_worked" || st === "leave_approved" || st === "holiday") ? 1 : st === "half_day" ? 0.5 : 0;
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffMin = (a: string, b: string) => Math.round((new Date(b.replace(" ", "T") + "Z").getTime() - new Date(a.replace(" ", "T") + "Z").getTime()) / 60000);

(async () => {
  const [flag] = await db.execute<any[]>(
    `SELECT DISTINCT t.employee_id
       FROM attendance_daily_record t
      WHERE t.record_date BETWEEN ? AND ?
        AND (t.raw_minutes > 840
             OR (t.attendance_status IN ('absent','half_day') AND t.clock_in_time IS NOT NULL
                 AND TIME(t.clock_in_time) < '09:00:00' AND (t.clock_out_time IS NULL OR TIME(t.clock_out_time) < '11:00:00')))`,
    [FROM, TO]);
  const empIds = (flag as any[]).map((r) => r.employee_id);
  console.log(`flagged employees in ${FROM}..${TO}: ${empIds.length}`);
  if (!empIds.length) { await db.end(); return; }

  const info = new Map<string, { code: string; ids: string[] }>();
  for (let i = 0; i < empIds.length; i += 500) {
    const slice = empIds.slice(i, i + 500);
    const [rows] = await db.query<any[]>(
      `SELECT e.id, e.employee_code, e.biometric_code, GROUP_CONCAT(DISTINCT ebe.cosec_user_id) AS cosec_ids
         FROM employees e LEFT JOIN employee_biometric_enrollment ebe ON ebe.employee_id = e.id
        WHERE e.id IN (?) GROUP BY e.id, e.employee_code, e.biometric_code`, [slice]);
    for (const r of rows as any[]) {
      const ids = [...new Set([r.employee_code, r.biometric_code, ...String(r.cosec_ids ?? "").split(",")].map((x) => String(x ?? "").trim()).filter(Boolean))];
      info.set(r.id, { code: r.employee_code, ids });
    }
  }
  const idToEmp = new Map<string, string>();
  for (const [eid, v] of info) for (const id of v.ids) idToEmp.set(id, eid);

  // ---- raw AM/PM blocks from COSEC ----
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
  console.log(`COSEC blocks pulled: ${blocks.length}`);

  // one user id per employee: the one with most blocks
  const perEmpUsers = new Map<string, Map<string, PunchBlock[]>>();
  for (const b of blocks) {
    const eid = idToEmp.get(b.cosecUserId); if (!eid) continue;
    const m = perEmpUsers.get(eid) ?? new Map(); const a = m.get(b.cosecUserId) ?? []; a.push(b); m.set(b.cosecUserId, a); perEmpUsers.set(eid, m);
  }
  const attributed = new Map<string, Map<string, { minutes: number; punches: number }>>();
  for (const [eid, users] of perEmpUsers) {
    const best = [...users.values()].sort((a, b) => b.length - a.length)[0];
    const { groups } = attributeNightShifts(best, "cosec_sqlserver", table);
    const m = new Map<string, { minutes: number; punches: number }>();
    for (const g of groups) if (g.punchDate >= FROM && g.punchDate <= TO) m.set(g.punchDate, { minutes: diffMin(g.firstPunch, g.lastPunch), punches: g.totalPunches });
    attributed.set(eid, m);
  }

  // ---- current rows ----
  const cur = new Map<string, Map<string, { st: string; lk: number; src: string }>>();
  for (let i = 0; i < empIds.length; i += 500) {
    const [rows] = await db.query<any[]>(
      `SELECT employee_id, DATE_FORMAT(record_date,'%Y-%m-%d') d, attendance_status st, is_locked lk, COALESCE(source_system,'') src
         FROM attendance_daily_record WHERE employee_id IN (?) AND record_date BETWEEN ? AND ?`, [empIds.slice(i, i + 500), FROM, TO]);
    for (const r of rows as any[]) { const m = cur.get(r.employee_id) ?? new Map(); m.set(r.d, { st: r.st, lk: Number(r.lk), src: r.src }); cur.set(r.employee_id, m); }
  }

  const [y, mo] = FROM.split("-").map(Number);
  const dim = new Date(y, mo, 0).getDate();
  let sundays = 0; for (let i = 1; i <= dim; i++) if (new Date(y, mo - 1, i).getDay() === 0) sundays++;
  const payable = (pb: number) => Math.min(pb + Math.min(findSlabMaxWeekoffs(pb, SLABS) ?? sundays, sundays), dim);

  const out: any[] = [];
  let gain = 0, loss = 0, same = 0, sumDelta = 0, lockedKept = 0;
  for (const eid of empIds) {
    const rows = cur.get(eid) ?? new Map();
    const att = attributed.get(eid);
    if (!att) continue;
    let pbCur = 0, pbNew = 0, changedDays = 0;
    const detail: any[] = [];
    for (let d = FROM; d <= TO; d = addDays(d, 1)) {
      const c = rows.get(d);
      const curSt = c?.st ?? "missing_punch";
      pbCur += paidOf(curSt);
      const keep = c && (c.lk === 1 || ["leave_approved", "holiday", "week_off_worked", "week_off"].includes(c.st)
        || !/cosec|wfm_attendance_session|biometric|policy_absence/i.test(c.src));
      if (c?.lk === 1) lockedKept++;
      let newSt = curSt;
      if (!keep) {
        const a = att.get(d);
        newSt = !a || a.punches < 2 ? (a ? "missing_punch" : "missing_punch") : a.minutes >= FULL ? "present" : a.minutes >= HALF ? "half_day" : "absent";
      }
      if (newSt !== curSt) {
        changedDays++;
        const a = att.get(d);
        detail.push({ date: d, cur: `${curSt}${c?.lk ? '/L' : ''}`, now: newSt, minutes: a?.minutes ?? '', punches: a?.punches ?? 0 });
      }
      pbNew += paidOf(newSt);
    }
    const dCur = payable(pbCur), dNew = payable(pbNew), delta = Math.round((dNew - dCur) * 100) / 100;
    sumDelta += delta; if (delta > 0) gain++; else if (delta < 0) loss++; else same++;
    out.push({ code: info.get(eid)!.code, paidBaseCur: pbCur, paidBaseNew: pbNew, payableCur: dCur, payableNew: dNew, delta, changedDays, detail });
  }
  out.sort((a, b) => b.delta - a.delta);
  console.log(`\n=== ${FROM}..${TO}: employees compared ${out.length} | payable days UP ${gain} | DOWN ${loss} | same ${same} | net payable-day delta ${Math.round(sumDelta * 100) / 100} | locked rows kept ${lockedKept} ===`);
  console.log("top gains"); console.table(out.slice(0, 25));
  console.log("top losses"); console.table(out.slice(-25).reverse().map(({ detail, ...r }) => r));
  const lossDetail = out.filter((r) => r.delta < 0);
  let evOnly = 0, other = 0;
  for (const r of lossDetail) for (const d of r.detail) { if (d.cur.startsWith("present") && d.now !== "present") { if (Number(d.minutes || 0) < 270) evOnly++; else other++; } }
  console.log(`present->not-present days among employees with loss: short-or-open shift (<270 min or none) ${evOnly}, other ${other}`);
  for (const r of lossDetail.slice(0, 8)) { console.log(`--- ${r.code} delta ${r.delta}`); console.table(r.detail); }
  await db.end();
  process.exit(0);
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
