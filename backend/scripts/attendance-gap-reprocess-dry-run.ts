/**
 * READ-ONLY preview of what reprocessing would do for the 171 employees enrolled by
 * enrol-unenrolled-punchers.ts (marker 'gap-closure-2026-08-11'), 104 of whom still have
 * ZERO attendance_daily_record rows because the enrollment write was never followed by a
 * sync/backfill over their affected date range.
 *
 * WHY A CUSTOM PREVIEW INSTEAD OF RUNNING THE REAL SYNC
 *
 * The real path (cosec-sync.service.ts migratePunchGroup) writes to five tables per punch
 * group and calls attendanceEngineService.processEmployee + upsertDailyRecord, with no
 * transaction wrapper — every statement autocommits individually. There is no safe way to
 * invoke it and roll back.
 *
 * This script instead composes the READ-ONLY pieces of that same pipeline directly:
 *   - the exact NCOSEC punch-grouping query from pullCosecAttendance (verbatim, read-only)
 *   - assessAggregatePunches (pure function, no DB) — the real punch-interpretation logic
 *   - attendanceEngineService.classifyMinutes (pure function, no DB — its own comment says so)
 *   - attendanceEngineService.resolveRule (SELECT only) — the real full/half-day thresholds
 *
 * FIDELITY CAVEAT — read before trusting the numbers
 *
 * This does NOT replicate attendanceEngineService.processEmployee's override handling:
 * approved leave, holiday, roster week-off (incl. week_off_worked), night-shift rollover
 * merge, or the APR/dialler fallback path for Operations staff. Every day below is priced
 * as a plain biometric day against the resolved rule's thresholds. Where an employee has an
 * approved leave or holiday on a gap date, the real engine will price it differently (better,
 * usually) than shown here. Days flagged status=absent are the ones most likely to move once
 * overrides are applied — treat this as a ceiling on LWP exposure, not a floor.
 *
 * SAFETY: zero writes. Connects to NCOSEC read-only (SELECT) and mas_hrms read-only.
 *
 * Usage:
 *   NCOSEC_DB_HOST=172.10.10.146 npx tsx scripts/attendance-gap-reprocess-dry-run.ts
 *   NCOSEC_DB_HOST=172.10.10.146 npx tsx scripts/attendance-gap-reprocess-dry-run.ts 2026-07-01 2026-08-11
 */
import sql from "mssql";
import { db } from "../src/db/mysql.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";
import { assessAggregatePunches } from "../src/modules/wfm/cosec-punch-interpretation.service.js";

const FROM = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2026-07-01";
const TO = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))[1] ?? "2026-08-11"; // yesterday relative to 2026-08-12

type PunchGroup = {
  cosecUserId: string;
  punchDate: string;
  firstPunch: string;
  lastPunch: string;
  totalPunches: number;
  workingMinutes: number;
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
  }));
}

(async () => {
  console.log(`DRY RUN — NO WRITES. window ${FROM} .. ${TO}`);

  const [employees] = await db.query<any[]>(
    `SELECT e.id, e.employee_code, e.date_of_joining, e.designation_id, e.process_id, e.branch_id,
            bm.branch_name
       FROM employee_biometric_enrollment b
       JOIN employees e ON e.id = b.employee_id
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE b.enrolled_by = 'gap-closure-2026-08-11'`,
  );
  console.log(`enrolled cohort: ${employees.length}`);
  const byCode = new Map(employees.map((e) => [e.employee_code, e]));

  const punches = await pullCosecPunches(FROM, TO);
  console.log(`raw NCOSEC punch-groups in window: ${punches.length}`);
  const punchesByCode = new Map<string, PunchGroup[]>();
  for (const p of punches) {
    if (!byCode.has(p.cosecUserId)) continue; // not one of our targets
    if (!punchesByCode.has(p.cosecUserId)) punchesByCode.set(p.cosecUserId, []);
    punchesByCode.get(p.cosecUserId)!.push(p);
  }
  console.log(`cohort employees with at least one punch in window: ${punchesByCode.size}`);

  const ids = employees.map((e) => e.id);
  const ph = ids.map(() => "?").join(",");
  const [existingAdr] = await db.query<any[]>(
    `SELECT employee_id, record_date, attendance_status, raw_minutes
       FROM attendance_daily_record WHERE employee_id IN (${ph})`,
    ids,
  );
  const adrKey = (empId: string, date: string) => `${empId}__${date}`;
  const existingAdrMap = new Map(existingAdr.map((r) => [adrKey(r.employee_id, r.record_date.toISOString?.().slice(0, 10) ?? r.record_date), r]));

  const ruleCache = new Map<string, any>();
  async function rule(designationId: string | null, processId: string | null, branchId: string | null, date: string) {
    const key = `${designationId}|${processId}|${branchId}|${date}`;
    if (!ruleCache.has(key)) ruleCache.set(key, await attendanceEngineService.resolveRule(designationId, processId, branchId, date));
    return ruleCache.get(key);
  }

  type EmpReport = {
    code: string; doj: string; branch: string;
    punchDays: number; alreadyInAdr: number; gapDaysToCreate: number;
    proposed: { present: number; half_day: number; absent: number };
    proposedLwpDays: number;
    zeroPunchesAtAll: boolean;
  };
  const reports: EmpReport[] = [];
  let totalGapDays = 0, totalProposedLwp = 0;
  const conflicts: any[] = [];

  for (const emp of employees) {
    const groups = punchesByCode.get(emp.employee_code) ?? [];
    let alreadyInAdr = 0, gapDaysToCreate = 0;
    const proposed = { present: 0, half_day: 0, absent: 0 };
    let empLwp = 0;

    for (const g of groups) {
      const existing = existingAdrMap.get(adrKey(emp.id, g.punchDate));
      if (existing) {
        alreadyInAdr++;
        continue;
      }
      const assessed = assessAggregatePunches({
        firstPunch: g.firstPunch, lastPunch: g.lastPunch,
        totalPunches: g.totalPunches, workingMinutes: g.workingMinutes,
        mode: "historical",
      });
      const rawMinutes = Math.round(assessed.effectiveWorkingMinutes);
      const r = await rule(emp.designation_id, emp.process_id, emp.branch_id, g.punchDate);
      const cls = attendanceEngineService.classifyMinutes(rawMinutes, r);
      proposed[cls.status]++;
      empLwp += cls.lwpValue;
      gapDaysToCreate++;
    }

    totalGapDays += gapDaysToCreate;
    totalProposedLwp += empLwp;
    reports.push({
      code: emp.employee_code, doj: emp.date_of_joining, branch: emp.branch_name,
      punchDays: groups.length, alreadyInAdr, gapDaysToCreate, proposed, proposedLwpDays: empLwp,
      zeroPunchesAtAll: groups.length === 0,
    });
  }

  const zeroPunchers = reports.filter((r) => r.zeroPunchesAtAll);
  const withGaps = reports.filter((r) => r.gapDaysToCreate > 0);

  console.log(`\n=== SUMMARY ===`);
  console.log(`employees with zero NCOSEC punches at all in window (still a real gap — device mapping or non-attendance): ${zeroPunchers.length}`);
  console.log(`employees with at least one gap day to create: ${withGaps.length}`);
  console.log(`total ADR rows that would be created: ${totalGapDays}`);
  console.log(`total proposed LWP-days across all created rows (ceiling, pre-override): ${totalProposedLwp.toFixed(1)}`);

  console.log(`\n=== PER-EMPLOYEE (only those with gap days) ===`);
  console.table(
    withGaps
      .sort((a, b) => b.gapDaysToCreate - a.gapDaysToCreate)
      .map((r) => ({
        code: r.code, branch: r.branch, doj: r.doj,
        punchDays: r.punchDays, alreadyInAdr: r.alreadyInAdr, gapDays: r.gapDaysToCreate,
        present: r.proposed.present, half_day: r.proposed.half_day, absent: r.proposed.absent,
        lwpDays: r.proposedLwpDays.toFixed(1),
      })),
  );

  if (zeroPunchers.length) {
    console.log(`\n=== ZERO-PUNCH EMPLOYEES (need separate investigation, not a reprocessing target) ===`);
    console.table(zeroPunchers.map((r) => ({ code: r.code, branch: r.branch, doj: r.doj })));
  }

  console.log(`\nDRY RUN COMPLETE — nothing written. Re-verify FIDELITY CAVEAT above before treating proposedLwpDays as final.`);
  await db.end();
})().catch(async (e) => {
  console.error("ERR", e?.message ?? e);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
