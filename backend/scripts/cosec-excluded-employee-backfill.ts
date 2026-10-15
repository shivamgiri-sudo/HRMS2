/**
 * Repairs the damage done by the COSEC exclusion list holding ids that belong to employees
 * (WFM email 2026-10-15, "APR available but punching not showing").
 *
 *   DRY RUN (default)  - lists the affected employees and, per employee, how many October days have
 *                        raw COSEC punches but no HRMS punch row. Writes nothing.
 *   --apply            - re-runs the production COSEC sync for ONLY those employees, October only
 *                        (minWriteDate = 2026-10-01), in 3-day windows, through the same write path
 *                        the nightly sync uses (locked rows, employment window and payroll-month
 *                        guards all apply).
 *   --deactivate       - additionally sets active_status = 0 on the exclusion rows that belong to
 *                        employees (reversible: set it back to 1). With the classifier fix the rows
 *                        are inert; this only tidies the list and the reconciliation report.
 *
 * September and earlier are NEVER touched here: that month is payroll-finalised and needs a
 * Payroll Head decision. Counts for it are printed so the decision can be made.
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import sql from "mssql";
import { cosecSyncService } from "../src/modules/wfm/cosec-sync.service.js";
import { buildSourceUserMaps, classifySourceUser, conflictingExclusions } from "../src/modules/wfm/attendance-reconciliation-mapping.js";

const APPLY = process.argv.includes("--apply");
const DEACTIVATE = process.argv.includes("--deactivate");
const FROM = "2026-10-01";
const env = (n: string) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`${n} required`); return v; };
const ist = (d = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

(async () => {
  const c = await createConnection({ host: env("DB_HOST"), port: Number(process.env.DB_PORT || 3306), user: env("DB_USER"), password: env("DB_PASSWORD"), database: env("DB_NAME") });
  const q = async (s: string, p: unknown[] = []) => (await c.query<RowDataPacket[]>(s, p))[0] as any[];
  const today = ist();
  console.log(`mode: ${APPLY ? "APPLY" : "DRY RUN"}${DEACTIVATE ? " + deactivate exclusions" : ""} | window ${FROM}..${today}`);

  const employeeRows = await q(`SELECT e.id AS employee_id, e.employee_code, e.biometric_code, e.active_status, e.employment_status, ebe.cosec_user_id
                                  FROM employees e LEFT JOIN employee_biometric_enrollment ebe ON ebe.employee_id = e.id`);
  const excluded = await q(`SELECT cosec_user_id FROM attendance_reconciliation_cosec_exclusion WHERE active_status = 1`);
  const maps = buildSourceUserMaps(employeeRows as any[], excluded.map((r) => String(r.cosec_user_id)));
  const conflicts = conflictingExclusions(maps);
  const active = conflicts.filter((id) => classifySourceUser(id, maps).kind === "active");
  const inactive = conflicts.filter((id) => classifySourceUser(id, maps).kind === "inactive");
  console.log(`exclusions that belong to employees: ${conflicts.length} (active employees ${active.length}, leavers ${inactive.length})`);

  // raw punch days per affected id
  const pool = await new sql.ConnectionPool({
    server: env("NCOSEC_DB_HOST"), port: Number(process.env.NCOSEC_DB_PORT || 1433), user: env("NCOSEC_DB_USER"), password: env("NCOSEC_DB_PASSWORD"),
    database: process.env.NCOSEC_DB_NAME || "NCOSEC", options: { encrypt: process.env.NCOSEC_DB_ENCRYPT === "true", trustServerCertificate: true, readOnlyIntent: true },
    connectionTimeout: 15000, requestTimeout: 90000,
  }).connect();
  const list = active.map((x) => `'${x.replace(/'/g, "''")}'`).join(",");
  const raw = active.length
    ? (await pool.request().query(
        `SELECT CAST(UserID AS NVARCHAR(50)) UserID, CONVERT(CHAR(10), CAST(Edatetime AS DATE), 23) d, COUNT(*) n
           FROM dbo.Mx_ATDEventTrn WHERE UserID IN (${list}) AND Edatetime >= '${FROM}' GROUP BY UserID, CAST(Edatetime AS DATE)`)).recordset
    : [];
  await pool.close();
  const rawDays = new Map<string, number>();
  for (const r of raw) rawDays.set(String(r.UserID).trim(), (rawDays.get(String(r.UserID).trim()) ?? 0) + 1);
  const have = active.length
    ? await q(`SELECT cosec_user_id, COUNT(*) n FROM biometric_attendance_log WHERE cosec_user_id IN (?) AND punch_date >= ? GROUP BY cosec_user_id`, [active, FROM])
    : [];
  const haveMap = new Map(have.map((r) => [String(r.cosec_user_id), Number(r.n)]));
  let totalMissing = 0;
  const lines: string[] = [];
  for (const id of active) {
    const rd = rawDays.get(id) ?? 0, hd = haveMap.get(id) ?? 0;
    totalMissing += Math.max(0, rd - hd);
    if (rd) lines.push(`${id}: raw days ${rd}, HRMS punch rows ${hd}`);
  }
  console.log(lines.join("\n"));
  console.log(`October raw punch-days with no HRMS punch row: ${totalMissing} across ${lines.length} employees`);

  const sep = await q(
    `SELECT COUNT(*) n, SUM(adr.is_locked) locked FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
      WHERE (e.employee_code IN (?) OR e.biometric_code IN (?)) AND adr.record_date BETWEEN '2026-09-01' AND '2026-09-30'
        AND adr.attendance_status = 'missing_punch'`, [active.length ? active : [""], active.length ? active : [""]]);
  console.log("September 'missing_punch' rows of the same employees (NOT touched here):", JSON.stringify(sep[0]));

  if (!APPLY) {
    console.log("\nDRY RUN - nothing written. Re-run with --apply to backfill October (and --deactivate to tidy the list).");
    await c.end(); return;
  }

  // APPLY: scoped sync in 3-day windows, October only.
  let migrated = 0, failed = 0;
  const start = new Date(`${FROM}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 3)) {
    const w0 = d.toISOString().slice(0, 10);
    const w1e = new Date(d); w1e.setUTCDate(w1e.getUTCDate() + 2);
    const w1 = (w1e > end ? end : w1e).toISOString().slice(0, 10);
    const r = await cosecSyncService.sync({ from: w0, to: w1, onlyUserIds: active, minWriteDate: FROM });
    migrated += r.migratedDays; failed += r.failed.length;
    console.log(`  ${w0}..${w1}: pulled ${r.pulledEvents} events, migrated ${r.migratedDays} days, failed ${r.failed.length}, excluded ${r.ignoredExcludedUsers}, unmapped ${r.unmappedUsers.length}`);
  }
  console.log(`DONE backfill: migrated ${migrated} employee-days, failed ${failed}`);

  if (DEACTIVATE && conflicts.length) {
    const [res] = await c.query<any>(
      `UPDATE attendance_reconciliation_cosec_exclusion
          SET active_status = 0, notes = CONCAT(COALESCE(notes,''), ' | deactivated 2026-10-15: id belongs to an employee (WFM email APR failures)')
        WHERE active_status = 1 AND cosec_user_id IN (?)`, [conflicts]);
    console.log("exclusion rows deactivated:", res.affectedRows);
  }
  await c.end();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
