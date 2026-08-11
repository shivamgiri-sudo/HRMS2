/**
 * Enrol active employees who are punching at the COSEC device but have no
 * employee_biometric_enrollment row, so the sync discards every punch they make.
 *
 * WHY THIS EXISTS
 *
 * Measured 2026-08-11 against the device DB directly. On that date 769 active
 * employees punched at COSEC. 114 of them had ZERO rows in
 * employee_biometric_enrollment — not inactive rows, none at all — so
 * classifySourceUser() returns "unmapped" and the punch is thrown away.
 *
 * The consequence is not a wrong status, it is no record whatsoever: those 114 have
 * no attendance_daily_record row for 2026-08-11 at all (not missing_punch, not
 * absent — an empty result), and exactly 1 ADR row between all of them for the whole
 * of August. Attendance is what payroll is computed from, so as things stand these
 * people have nothing to be paid on despite coming to work every day.
 *
 * They are July-August 2026 hires at NOIDA-2 (62), NOIDA (38) and
 * AHMEDABAD-JALDARSHAN (14). Their device UserID is their employee_code verbatim
 * (e.g. 63107C, MAS63085), so the mapping is unambiguous and mechanical.
 *
 * This is also what made ingestion coverage look like it was decaying — mirror against
 * upstream ran 96% in early July, 90% mid-July, 84% late July, 75% on 11 August. The
 * sync was never at fault; the denominator was filling up with people nobody enrolled.
 *
 * SAFETY
 *
 * Dry run by default — prints what it would do and changes nothing. Pass --apply to
 * write. Writes inside one transaction and rolls back unless every inserted row is
 * accounted for and no target is left unenrolled. Rollback afterwards is
 * `UPDATE employee_biometric_enrollment SET is_active = 0 WHERE enrolled_by = 'gap-closure-2026-08-11'`.
 *
 * Enrolling only makes future and re-processed punches resolve. To materialise the
 * attendance that already happened, run scripts/cosec-sync-backfill.ts over the
 * affected range afterwards.
 *
 * The device is reachable on-LAN at 172.10.10.146:1433; the public address in
 * NCOSEC_DB_HOST is firewalled. Override at invocation if needed:
 *   NCOSEC_DB_HOST=172.10.10.146 npx tsx scripts/enrol-unenrolled-punchers.ts
 *   NCOSEC_DB_HOST=172.10.10.146 npx tsx scripts/enrol-unenrolled-punchers.ts --apply
 */
import sql from "mssql";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const FROM = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2026-07-01";
const TO = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))[1] ?? "2026-08-12";

async function punchingUserIds(): Promise<string[]> {
  const pool = await sql.connect({
    server: process.env.NCOSEC_DB_HOST!,
    port: Number(process.env.NCOSEC_DB_PORT ?? 1433),
    user: process.env.NCOSEC_DB_USER!,
    password: process.env.NCOSEC_DB_PASSWORD!,
    database: process.env.NCOSEC_DB_NAME?.trim() || "NCOSEC",
    options: { encrypt: false, trustServerCertificate: true },
    // TCP connects fast but the TDS handshake is slow; 12s fails against a healthy box.
    connectionTimeout: 45_000,
    requestTimeout: 180_000,
  });
  const r = await pool.request().query(`
    SELECT DISTINCT CAST([UserID] AS NVARCHAR(100)) AS uid
      FROM dbo.Mx_ATDEventTrn
     WHERE [Edatetime] >= '${FROM}' AND [Edatetime] < '${TO}' AND [UserID] IS NOT NULL`);
  await pool.close();
  return [...new Set(r.recordset.map((x: any) => String(x.uid).trim()))];
}

(async () => {
  console.log(`window ${FROM} .. ${TO}   mode=${APPLY ? "APPLY" : "DRY RUN"}`);
  const punching = await punchingUserIds();
  console.log(`distinct device UserIDs punching in window: ${punching.length}`);
  if (!punching.length) { await db.end(); return; }

  const ph = punching.map(() => "?").join(", ");
  // LOWER() on the status deliberately: employment_status holds BOTH casings
  // ('Active' 273 vs 'active' 1039). MySQL's collation is case-insensitive so this is
  // belt and braces here, but the same comparison written in JS silently drops 273
  // people — which is exactly how this gap first read as "1 employee" instead of 114.
  const [targets] = await db.query<any[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.date_of_joining, bm.branch_name
       FROM employees e
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE LOWER(e.employment_status) = 'active'
        AND e.employee_code IN (${ph})
        AND NOT EXISTS (
          SELECT 1 FROM employee_biometric_enrollment b WHERE b.employee_id = e.id
        )
      ORDER BY bm.branch_name, e.employee_code`,
    punching,
  );

  console.log(`\nactive employees punching with NO enrollment row: ${targets.length}`);
  const byBranch: Record<string, number> = {};
  for (const t of targets) byBranch[t.branch_name ?? "(none)"] = (byBranch[t.branch_name ?? "(none)"] ?? 0) + 1;
  console.log("by branch:", JSON.stringify(byBranch));
  console.table(targets.slice(0, 15).map((t) => ({
    code: t.employee_code, name: String(t.full_name ?? "").trim(),
    doj: t.date_of_joining, branch: t.branch_name,
  })));

  if (!targets.length) { console.log("nothing to do"); await db.end(); return; }
  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to enrol these ${targets.length}.`);
    await db.end();
    return;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let inserted = 0;
    for (const t of targets) {
      const [res]: any = await conn.execute(
        `INSERT INTO employee_biometric_enrollment
           (employee_id, cosec_user_id, is_active, enrolled_at, enrolled_by)
         VALUES (?, ?, 1, NOW(), 'gap-closure-2026-08-11')`,
        [t.id, t.employee_code],
      );
      inserted += res.affectedRows;
    }
    const [left]: any = await conn.query(
      `SELECT COUNT(*) AS n FROM employees e
        WHERE LOWER(e.employment_status) = 'active'
          AND e.employee_code IN (${ph})
          AND NOT EXISTS (
            SELECT 1 FROM employee_biometric_enrollment b
             WHERE b.employee_id = e.id AND b.is_active = 1)`,
      punching,
    );
    console.log(`\ninserted=${inserted} expected=${targets.length} stillUnenrolled=${left[0].n}`);
    if (inserted === targets.length && Number(left[0].n) === 0) {
      await conn.commit();
      console.log("*** COMMITTED ***");
      console.log("Next: npx tsx scripts/cosec-sync-backfill.ts <from> <to> to materialise their attendance.");
    } else {
      await conn.rollback();
      console.log("*** ROLLED BACK — counts did not reconcile, nothing changed ***");
    }
  } catch (e: any) {
    await conn.rollback();
    console.log("ERROR -> ROLLED BACK:", e?.message ?? e);
  } finally {
    conn.release();
  }
  await db.end();
})().catch(async (e) => {
  console.error("ERR", e?.message ?? e);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
