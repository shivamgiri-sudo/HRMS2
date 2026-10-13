// Rebuild night-shift attendance for a date range with the shift-attribution sync.
//   dry-run (default): pull, attribute, and report what WOULD be written. Writes nothing.
//   --apply          : runs cosecSyncService.sync() scoped to the flagged employees, in chunks.
//   --allow-closed-months : required to apply to a month whose payroll run is finalized/locked/disbursed.
// Locked rows (regularisations, payroll locks) are never overwritten by the sync's write path.
// Usage: npx tsx scripts/attendance-night-shift-rebuild.ts <from> <to> [--apply] [--allow-closed-months] [--all]
import "dotenv/config";
import sql from "mssql";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { getNcosecPool } from "../src/db/ncosecDb.js";
import {
  attributeNightShifts,
  cosecSyncService,
  filterUnchangedGroups,
  type PunchBlock,
} from "../src/modules/wfm/cosec-sync.service.js";
import { isRunClosed } from "../src/modules/payroll/run-status.js";

const [FROM, TO] = [process.argv[2], process.argv[3]];
const APPLY = process.argv.includes("--apply");
const ALLOW_CLOSED = process.argv.includes("--allow-closed-months");
// --all: scope = every employee with biometric-sourced rows in the range, not just the ones the
// old logic left looking inflated. Needed to repair days an earlier attribution got wrong.
const ALL = process.argv.includes("--all");
if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(TO ?? "")) {
  console.error("usage: attendance-night-shift-rebuild.ts <from> <to> [--apply] [--allow-closed-months]");
  process.exit(1);
}
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  // ---- payroll month guard ----
  const months = new Set<string>();
  for (let d = FROM; d <= TO; d = addDays(d, 1)) months.add(d.slice(0, 7));
  const closed: string[] = [];
  for (const m of months) {
    const [runs] = await db.execute<RowDataPacket[]>(`SELECT status FROM salary_prep_run WHERE run_month = ?`, [m]);
    const st = (runs as any[]).map((r) => r.status);
    const isClosed = st.some((s) => isRunClosed(s));
    console.log(`payroll ${m}: ${st.length ? st.join(",") : "no run"}${isClosed ? "  [CLOSED]" : ""}`);
    if (isClosed) closed.push(m);
  }
  if (APPLY && closed.length && !ALLOW_CLOSED) {
    console.error(`REFUSING to apply: payroll closed for ${closed.join(", ")}. Re-run with --allow-closed-months after the Payroll Head signs off.`);
    await db.end();
    process.exit(2);
  }

  // ---- flagged employees: inflated days or exit-only mornings graded absent/half ----
  const [flag] = await db.execute<any[]>(
    ALL
      ? `SELECT DISTINCT t.employee_id
           FROM attendance_daily_record t
          WHERE t.record_date BETWEEN ? AND ?
            AND (t.source_system LIKE '%cosec%' OR t.source_system = 'wfm_attendance_session'
                 OR t.source_system = 'regularization')`
      : `SELECT DISTINCT t.employee_id
           FROM attendance_daily_record t
          WHERE t.record_date BETWEEN ? AND ?
            AND (t.raw_minutes > 840
                 OR (t.attendance_status IN ('absent','half_day') AND t.clock_in_time IS NOT NULL
                     AND TIME(t.clock_in_time) < '09:00:00' AND (t.clock_out_time IS NULL OR TIME(t.clock_out_time) < '11:00:00')))`,
    [FROM, TO]);
  const empIds = (flag as any[]).map((r) => r.employee_id);
  console.log(`flagged employees: ${empIds.length}`);
  if (!empIds.length) { await db.end(); return; }

  const userIds = new Set<string>();
  for (let i = 0; i < empIds.length; i += 500) {
    const [rows] = await db.query<any[]>(
      `SELECT e.employee_code, e.biometric_code, GROUP_CONCAT(DISTINCT ebe.cosec_user_id) AS cosec_ids
         FROM employees e LEFT JOIN employee_biometric_enrollment ebe ON ebe.employee_id = e.id
        WHERE e.id IN (?) GROUP BY e.id, e.employee_code, e.biometric_code`, [empIds.slice(i, i + 500)]);
    for (const r of rows as any[]) {
      for (const v of [r.employee_code, r.biometric_code, ...String(r.cosec_ids ?? "").split(",")]) {
        const t = String(v ?? "").trim(); if (t) userIds.add(t);
      }
    }
  }
  const ids = [...userIds];

  // ---- what would be written ----
  const pool = await getNcosecPool();
  const table = process.env.NCOSEC_EVENT_TABLE?.trim() || "dbo.Mx_ATDEventTrn";
  const uc = process.env.NCOSEC_USER_ID_COLUMN?.trim() || "UserID";
  const dc = process.env.NCOSEC_DATETIME_COLUMN?.trim() || "Edatetime";
  const blocks: PunchBlock[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    const slice = ids.slice(i, i + 400);
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
  const attributed = attributeNightShifts(blocks, "cosec_sqlserver", table);
  const inRange = attributed.groups.filter((g) => g.punchDate >= FROM && g.punchDate <= TO);
  const crossLong = inRange.filter((g) => g.workingMinutes > 900 && g.firstPunch.slice(0, 10) !== g.lastPunch.slice(0, 10)).length;
  const sameDayLong = inRange.filter((g) => g.workingMinutes > 900 && g.firstPunch.slice(0, 10) === g.lastPunch.slice(0, 10)).length;
  const stillLong = crossLong;
  const changed = await filterUnchangedGroups(inRange, TO);
  console.log(`\nDRY RUN ${FROM}..${TO}`);
  console.log(`  shifts attributed          : ${inRange.length}`);
  console.log(`  shifts that differ stored  : ${changed.length}  (would be rewritten, unlocked rows only)`);
  console.log(`  exit-only dates to clear   : ${attributed.consumedDates.filter((d) => d.punchDate >= FROM && d.punchDate <= TO).length}`);
  console.log(`  overnight shifts over 15h  : ${crossLong}  (should be 0)`);
  console.log(`  same-date days over 15h    : ${sameDayLong}  (sparse punchers, legacy grouping, unchanged)`);

  // ---- why do the remaining "differ stored" shifts differ? ----
  if (changed.length) {
    const [excl] = await db.execute<RowDataPacket[]>(`SELECT cosec_user_id FROM attendance_reconciliation_cosec_exclusion WHERE active_status = 1`).catch(() => [[]] as any);
    const excluded = new Set((excl as any[]).map((r) => String(r.cosec_user_id ?? "").trim()));
    const cids = [...new Set(changed.map((g) => g.cosecUserId))];
    const known = new Map<string, { active: number; status: string }>();
    for (let i = 0; i < cids.length; i += 400) {
      const sl = cids.slice(i, i + 400);
      const [rows] = await db.query<any[]>(
        `SELECT COALESCE(ebe.cosec_user_id, e.biometric_code, e.employee_code) AS cid, e.employee_code, e.biometric_code, e.active_status, e.employment_status
           FROM employees e LEFT JOIN employee_biometric_enrollment ebe ON ebe.employee_id = e.id
          WHERE ebe.cosec_user_id IN (?) OR e.biometric_code IN (?) OR e.employee_code IN (?)`, [sl, sl, sl]);
      for (const r of rows as any[]) for (const k of [r.cid, r.employee_code, r.biometric_code]) if (k) known.set(String(k).trim(), { active: Number(r.active_status), status: String(r.employment_status) });
    }
    const [stored] = await db.query<any[]>(
      `SELECT cosec_user_id, DATE_FORMAT(punch_date,'%Y-%m-%d') AS d, total_punches, raw_minutes,
              DATE_FORMAT(first_punch_in,'%Y-%m-%d %H:%i') AS fi, DATE_FORMAT(last_punch_out,'%Y-%m-%d %H:%i') AS lo
         FROM biometric_attendance_log WHERE punch_date BETWEEN ? AND ?`, [FROM, TO]);
    const st = new Map((stored as any[]).map((r) => [`${r.cosec_user_id}|${r.d}`, r]));
    const reasons: Record<string, number> = {};
    const samples: Record<string, string[]> = {};
    const bump = (k: string, line: string) => { reasons[k] = (reasons[k] ?? 0) + 1; (samples[k] ??= []).length < 6 && samples[k].push(line); };
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    for (const g of changed) {
      const k = g.cosecUserId, row = st.get(`${k}|${g.punchDate}`);
      const line = `${k} ${g.punchDate} new ${g.firstPunch.slice(5, 16)}->${g.lastPunch.slice(5, 16)} (${g.totalPunches}p)` + (row ? ` | stored ${String(row.fi).slice(5)}->${String(row.lo ?? "-").slice(5)} (${row.total_punches}p, ${row.raw_minutes}m)` : " | stored: none");
      const emp = known.get(k);
      if (excluded.has(k)) bump("excluded cosec user (never written)", line);
      else if (!emp) bump("unmapped cosec user (never written)", line);
      else if (emp.active !== 1) bump(`inactive employee ${emp.status} (never written)`, line);
      else if (!row) bump("mapped+active but NO stored row", line);
      else if (g.punchDate >= today) bump("today / live shift", line);
      else bump("stored row differs from what the code writes", line);
    }
    console.log("\n  WHY the remaining shifts differ:");
    for (const [k, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${n}  ${k}`);
      for (const l of samples[k]) console.log(`        ${l}`);
    }
  }
  if (stillLong) {
    const long = inRange.filter((g) => g.workingMinutes > 900 && g.firstPunch.slice(0, 10) !== g.lastPunch.slice(0, 10)).slice(0, 12);
    console.log("  sample long shifts (user | date | first -> last | punches | hrs | blocks that day / day before):");
    for (const g of long) {
      const day = (d: string) => blocks
        .filter((b) => b.cosecUserId === g.cosecUserId && b.punchDate === d)
        .map((b) => `${b.part} ${b.firstPunch.slice(11, 16)}-${b.lastPunch.slice(11, 16)}(${b.totalPunches})`).join(" ") || "none";
      console.log(`    ${g.cosecUserId} | ${g.punchDate} | ${g.firstPunch.slice(5, 16)} -> ${g.lastPunch.slice(5, 16)} | ${g.totalPunches} | ${(g.workingMinutes / 60).toFixed(1)}h | D: ${day(g.punchDate)} | D-1: ${day(addDays(g.punchDate, -1))}`);
    }
  }

  if (!APPLY) { console.log("\nmode: dry-run, nothing written."); await db.end(); return; }

  // ---- apply: scoped sync in 7-day chunks ----
  let migrated = 0, failed = 0;
  // Chunks overlap by one day: the last evening of a chunk only gets its morning exit when the
  // NEXT chunk's window (which starts on that date) pulls it, so the next chunk begins on the
  // previous chunk's last date and rewrites that day with the exit included.
  let from = FROM;
  for (;;) {
    const to = addDays(from, 6) < TO ? addDays(from, 6) : TO;
    const res = await cosecSyncService.sync({ from, to, onlyUserIds: ids, minWriteDate: FROM });
    migrated += res.migratedDays; failed += res.failed.length;
    console.log(`chunk ${from}..${to}: migrated ${res.migratedDays}, unchanged ${res.skippedUnchanged}, failed ${res.failed.length}`);
    if (res.failed.length) console.log("  first failures:", JSON.stringify(res.failed.slice(0, 5)));
    if (to >= TO) break;
    from = to;
  }
  console.log(`\nAPPLIED ${FROM}..${TO}: migrated ${migrated}, failed ${failed}`);
  await db.end();
  process.exit(failed ? 3 : 0);
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
