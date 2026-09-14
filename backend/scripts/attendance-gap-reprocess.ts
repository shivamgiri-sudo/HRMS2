/**
 * Targeted attendance reprocessing for the 171 employees enrolled by
 * enrol-unenrolled-punchers.ts (marker 'gap-closure-2026-08-11'). Materialises the
 * attendance_daily_record rows for punch-days that already exist in NCOSEC but were never
 * migrated, because enrollment only makes FUTURE punches resolve.
 *
 * SCOPE — why this exists instead of just calling cosecSyncService.sync()
 *
 * sync({from, to}) sweeps every employee company-wide for the date range, not just this
 * cohort. Over a 6-week window that is a much bigger blast radius than this gap needs: it
 * would re-touch every already-correct employee's rows (harmless — everything is an
 * ON DUPLICATE KEY UPDATE upsert — but slow, and re-evaluates biometric-mismatch
 * notifications for the whole company, not just the 171 people this is about).
 *
 * This script instead calls the exact same exported migratePunchGroup() — the real
 * production write path, unmodified — but only for the specific (employee, punch-day) pairs
 * that this cohort is actually missing. Everyone else is untouched.
 *
 * SAFETY MODEL — read this before trusting "reconciled"
 *
 * There is no cross-table transaction here, because migratePunchGroup() itself has none —
 * it commits five per-table upserts as it goes, the same way the live sync always has. The
 * safety net is:
 *   1. idempotency — every write is ON DUPLICATE KEY UPDATE, so re-running this script (e.g.
 *      after a partial failure) is safe and will not double-count or duplicate rows;
 *   2. the is_locked=0 guard inside migratePunchGroup — it will not touch a payroll-locked
 *      attendance_daily_record row, so a finalized month cannot be silently rewritten;
 *   3. before/after reconciliation printed below — this does NOT roll back a partial run.
 *      If it stops partway, the completed rows stay written (correctly, since they're
 *      correct), and re-running finishes the rest.
 *
 * DRY RUN is the default and calls nothing but SELECTs — identical detection query to
 * attendance-gap-reprocess-dry-run.ts, always recomputed fresh (never trusts a stale list).
 *
 * Usage:
 *   NCOSEC_DB_HOST=172.10.10.146 npx tsx scripts/attendance-gap-reprocess.ts
 *   NCOSEC_DB_HOST=172.10.10.146 npx tsx scripts/attendance-gap-reprocess.ts --apply
 */
import sql from "mssql";
import { db } from "../src/db/mysql.js";
import { migratePunchGroup, assessmentModeForPunchDate } from "../src/modules/wfm/cosec-sync.service.js";

const APPLY = process.argv.includes("--apply");
const FROM = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2026-07-01";
const TO = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))[1] ?? "2026-08-11";

type PunchGroup = {
  cosecUserId: string; punchDate: string; firstPunch: string; lastPunch: string;
  totalPunches: number; workingMinutes: number; sourceSystem: string; sourceTable: string;
};

async function pullCosecPunches(from: string, to: string): Promise<PunchGroup[]> {
  const pool = await sql.connect({
    server: process.env.NCOSEC_DB_HOST!,
    port: Number(process.env.NCOSEC_DB_PORT ?? 1433),
    user: process.env.NCOSEC_DB_USER!,
    password: process.env.NCOSEC_DB_PASSWORD!,
    database: process.env.NCOSEC_DB_NAME?.trim() || "NCOSEC",
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 45_000,
    requestTimeout: 180_000,
  });
  const r = await pool.request().input("fromDate", sql.Date, from).input("toDate", sql.Date, to).query(`
    SELECT
      CAST([UserID] AS NVARCHAR(100)) AS user_id,
      CONVERT(CHAR(10), CAST([Edatetime] AS DATE), 23) AS punch_date,
      CONVERT(CHAR(19), MIN([Edatetime]), 120) AS first_punch,
      CONVERT(CHAR(19), MAX([Edatetime]), 120) AS last_punch,
      COUNT_BIG(*) AS total_punches,
      DATEDIFF(MINUTE, MIN([Edatetime]), MAX([Edatetime])) AS working_minutes
    FROM dbo.Mx_ATDEventTrn
    WHERE [Edatetime] >= @fromDate AND [Edatetime] < DATEADD(DAY, 1, @toDate) AND [UserID] IS NOT NULL
    GROUP BY [UserID], CAST([Edatetime] AS DATE)
    ORDER BY [UserID], punch_date`);
  await pool.close();
  return r.recordset.map((row: any) => ({
    cosecUserId: String(row.user_id ?? "").trim(),
    punchDate: String(row.punch_date ?? "").trim(),
    firstPunch: String(row.first_punch ?? "").trim(),
    lastPunch: String(row.last_punch ?? "").trim(),
    totalPunches: Math.max(0, Number(row.total_punches ?? 0)),
    workingMinutes: Math.max(0, Number(row.working_minutes ?? 0)),
    sourceSystem: "cosec_sqlserver",
    sourceTable: "dbo.Mx_ATDEventTrn",
  }));
}

async function detectGaps() {
  const [employees] = await db.query<any[]>(
    `SELECT e.id, e.employee_code FROM employee_biometric_enrollment b
       JOIN employees e ON e.id = b.employee_id
      WHERE b.enrolled_by = 'gap-closure-2026-08-11'`,
  );
  const codeSet = new Set(employees.map((e) => e.employee_code));
  const punches = await pullCosecPunches(FROM, TO);
  const cohortPunches = punches.filter((p) => codeSet.has(p.cosecUserId));

  const ids = employees.map((e) => e.id);
  const ph = ids.map(() => "?").join(",");
  const [existingAdr] = await db.query<any[]>(
    `SELECT employee_id, record_date FROM attendance_daily_record WHERE employee_id IN (${ph})`,
    ids,
  );
  const empIdByCode = new Map(employees.map((e) => [e.employee_code, e.id]));
  const existingKeys = new Set(
    existingAdr.map((r) => `${r.employee_id}__${r.record_date.toISOString?.().slice(0, 10) ?? r.record_date}`),
  );
  const gaps = cohortPunches.filter((p) => {
    const empId = empIdByCode.get(p.cosecUserId);
    return empId && !existingKeys.has(`${empId}__${p.punchDate}`);
  });
  return { employees, gaps, adrCountBefore: existingAdr.length };
}

(async () => {
  console.log(`window ${FROM} .. ${TO}   mode=${APPLY ? "APPLY" : "DRY RUN"}`);
  const { employees, gaps, adrCountBefore } = await detectGaps();
  console.log(`cohort: ${employees.length} employees`);
  console.log(`ADR rows for cohort BEFORE: ${adrCountBefore}`);
  console.log(`target gap rows (has NCOSEC punch, no ADR row): ${gaps.length}`);

  const byEmp: Record<string, number> = {};
  for (const g of gaps) byEmp[g.cosecUserId] = (byEmp[g.cosecUserId] ?? 0) + 1;
  console.log(`distinct employees with at least one gap: ${Object.keys(byEmp).length}`);

  if (!gaps.length) { console.log("nothing to do"); await db.end(); return; }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to migrate these ${gaps.length} rows`);
    console.log(`through the real production write path (migratePunchGroup), scoped to only`);
    console.log(`this cohort. Final status/LWP will reflect real overrides (leave/holiday/`);
    console.log(`week-off), unlike the ceiling estimate in attendance-gap-reprocess-dry-run.ts.`);
    await db.end();
    return;
  }

  console.log(`\n*** APPLYING — writing through migratePunchGroup for ${gaps.length} rows ***`);
  let migrated = 0, unmapped = 0, failed = 0;
  const failures: Array<{ cosecUserId: string; punchDate: string; error: string }> = [];
  let i = 0;
  for (const g of gaps) {
    i++;
    const mode = assessmentModeForPunchDate(g.punchDate, TO);
    try {
      const result = await migratePunchGroup(g, mode);
      if (result === "migrated") migrated++; else unmapped++;
    } catch (e: any) {
      failed++;
      failures.push({ cosecUserId: g.cosecUserId, punchDate: g.punchDate, error: e?.message ?? String(e) });
    }
    if (i % 200 === 0) console.log(`  ...${i}/${gaps.length}`);
  }

  console.log(`\nmigrated=${migrated} unmapped=${unmapped} failed=${failed}`);
  if (failures.length) {
    console.log("failures (first 20):", JSON.stringify(failures.slice(0, 20), null, 2));
  }

  const after = await detectGaps();
  console.log(`\nADR rows for cohort AFTER: ${after.adrCountBefore} (was ${adrCountBefore}, +${after.adrCountBefore - adrCountBefore})`);
  console.log(`remaining gap rows: ${after.gaps.length}`);
  if (after.gaps.length > 0) {
    console.log(`NOT reconciled — ${after.gaps.length} rows still missing. Re-run this script`);
    console.log(`(idempotent) to retry, or inspect the failures above.`);
  } else {
    console.log(`*** RECONCILED — zero remaining gaps for this cohort in this window ***`);
    console.log(`Next: recompute July payroll impact for these employees before the run closes.`);
  }

  await db.end();
})().catch(async (e) => {
  console.error("ERR", e?.message ?? e);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
