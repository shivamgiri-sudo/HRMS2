import "dotenv/config";
import type { RowDataPacket } from "mysql2";

type Args = {
  from: string;
  to: string;
  runMonth?: string;
  runId?: string;
  limit: number;
  apply: boolean;
  recalc: boolean;
};

type CandidateRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  start_date: string;
  next_date: string;
  apr_combined_minutes: number;
  adr_status: string | null;
  adr_source: string | null;
  adr_raw_minutes: number | null;
  is_locked: number | null;
  regularization_id: string | null;
  override_by: string | null;
  branch_id: string | null;
  process_id: string | null;
  inferred_expected_status: "present" | "half_day" | "absent";
  inferred_authority: "apr";
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { limit: 0, apply: false, recalc: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") out.from = argv[++i];
    else if (arg === "--to") out.to = argv[++i];
    else if (arg === "--run-month") out.runMonth = argv[++i];
    else if (arg === "--run-id") out.runId = argv[++i];
    else if (arg === "--limit") out.limit = Number(argv[++i]);
    else if (arg === "--apply") out.apply = true;
    else if (arg === "--recalc") out.recalc = true;
  }
  if (!out.from || !out.to) {
    throw new Error("Usage: npm run night-shift:repair -- --from YYYY-MM-DD --to YYYY-MM-DD [--run-month YYYY-MM] [--run-id ID] [--limit N] [--apply] [--recalc]");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.from) || !/^\d{4}-\d{2}-\d{2}$/.test(out.to)) {
    throw new Error("--from and --to must be YYYY-MM-DD");
  }
  if (out.runMonth && !/^\d{4}-\d{2}$/.test(out.runMonth)) {
    throw new Error("--run-month must be YYYY-MM");
  }
  if (!Number.isFinite(out.limit) || Number(out.limit) < 0) {
    throw new Error("--limit must be zero or a positive number");
  }
  return out as Args;
}

function classifyAprMinutes(minutes: number): { status: "present" | "half_day" | "absent"; lwpValue: number } {
  if (minutes >= 480) return { status: "present", lwpValue: 0 };
  if (minutes >= 240) return { status: "half_day", lwpValue: 0.5 };
  return { status: "absent", lwpValue: 1 };
}

async function latestRunIdForMonth(db: any, runMonth: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id
       FROM salary_prep_run
      WHERE run_month = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [runMonth],
  );
  return (rows[0] as any)?.id ?? null;
}

async function loadCandidates(db: any, from: string, to: string, limit: number): Promise<CandidateRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
        e.id AS employee_id,
        e.employee_code,
        TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name,
        DATE_FORMAT(apr1.report_date, '%Y-%m-%d') AS start_date,
        DATE_FORMAT(DATE_ADD(apr1.report_date, INTERVAL 1 DAY), '%Y-%m-%d') AS next_date,
        apr1.apr_minutes + COALESCE(apr2.apr_minutes, 0) AS apr_combined_minutes,
        adr.attendance_status AS adr_status,
        adr.attendance_source AS adr_source,
        adr.raw_minutes AS adr_raw_minutes,
        adr.is_locked,
        adr.regularization_id,
        adr.override_by,
        e.branch_id,
        e.process_id
     FROM (
       SELECT UserID, ReportDate AS report_date, SUM(COALESCE(TIME_TO_SEC(Net_Login), 0)) / 60 AS apr_minutes
         FROM apr
        WHERE ReportDate BETWEEN ? AND ?
        GROUP BY UserID, ReportDate
     ) apr1
     JOIN employees e
       ON e.employee_code = apr1.UserID
     LEFT JOIN department_master dept
       ON dept.id = e.department_id
     LEFT JOIN designation_master desig
       ON desig.id = e.designation_id
     LEFT JOIN (
       SELECT UserID, ReportDate AS report_date, SUM(COALESCE(TIME_TO_SEC(Net_Login), 0)) / 60 AS apr_minutes
         FROM apr
        WHERE ReportDate BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY UserID, ReportDate
     ) apr2
       ON apr2.UserID = apr1.UserID
      AND apr2.report_date = DATE_ADD(apr1.report_date, INTERVAL 1 DAY)
     LEFT JOIN attendance_daily_record adr
       ON adr.employee_id = e.id
      AND DATE(CONVERT_TZ(adr.record_date, '+00:00', '+05:30')) = apr1.report_date
     LEFT JOIN wfm_roster_assignment wra
       ON wra.employee_id = e.id
      AND wra.roster_date = apr1.report_date
     WHERE wra.id IS NULL
       AND apr1.report_date BETWEEN ? AND ?
       AND LOWER(COALESCE(dept.dept_name, '')) IN ('operations', 'operation')
       AND LOWER(COALESCE(desig.designation_name, '')) LIKE 'executive%'
       AND apr1.apr_minutes >= 60
       AND COALESCE(apr2.apr_minutes, 0) >= 60
       AND apr1.apr_minutes + COALESCE(apr2.apr_minutes, 0) >= 240
     ORDER BY apr1.report_date, e.employee_code`,
    [from, to, from, to, from, to],
  );

  const mapped = (rows as any[]).map((row) => {
    const aprCombinedMinutes = Number(row.apr_combined_minutes ?? 0);
    return {
      employee_id: String(row.employee_id),
      employee_code: String(row.employee_code),
      employee_name: String(row.employee_name ?? "").trim(),
      start_date: String(row.start_date),
      next_date: String(row.next_date),
      apr_combined_minutes: aprCombinedMinutes,
      adr_status: row.adr_status ? String(row.adr_status) : null,
      adr_source: row.adr_source ? String(row.adr_source) : null,
      adr_raw_minutes: row.adr_raw_minutes === null ? null : Number(row.adr_raw_minutes),
      is_locked: row.is_locked === null ? null : Number(row.is_locked),
      regularization_id: row.regularization_id ? String(row.regularization_id) : null,
      override_by: row.override_by ? String(row.override_by) : null,
      branch_id: row.branch_id ? String(row.branch_id) : null,
      process_id: row.process_id ? String(row.process_id) : null,
      inferred_expected_status: classifyAprMinutes(aprCombinedMinutes).status,
      inferred_authority: "apr" as const,
    } satisfies CandidateRow;
  });

  const truePayrollRisk = mapped.filter((row) => {
    const actual = row.adr_status;
    const expected = row.inferred_expected_status;
    if (actual === null) return true;
    if (["leave_approved", "holiday", "week_off", "week_off_worked"].includes(actual)) return false;
    if (expected === "present" && (actual === "half_day" || actual === "absent" || actual === "missing_punch")) return true;
    if (expected === "half_day" && (actual === "absent" || actual === "missing_punch")) return true;
    return false;
  });

  return limit > 0 ? truePayrollRisk.slice(0, limit) : truePayrollRisk;
}

async function repairCandidate(db: any, row: CandidateRow): Promise<"repaired" | "skipped"> {
  if (Number(row.is_locked ?? 0) === 1 || row.regularization_id || row.override_by) {
    return "skipped";
  }

  const classification = classifyAprMinutes(row.apr_combined_minutes);
  await db.execute(
    `INSERT INTO attendance_daily_record
       (id, employee_id, record_date, branch_id, process_id, attendance_source, source_system,
        source_record_date, source_reference, dialler_minutes, raw_minutes, attendance_status,
        lwp_value, late_mark, late_by_minutes, processed_at, created_by)
     VALUES (UUID(), ?, ?, ?, ?, 'dialler', 'apr.inferred_night_shift_window',
             ?, ?, ?, ?, ?, ?, 0, 0, NOW(), 'night_shift_apr_repair')
     ON DUPLICATE KEY UPDATE
       attendance_source  = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'dialler', attendance_source),
       source_system      = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'apr.inferred_night_shift_window', source_system),
       source_record_date = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(source_record_date), source_record_date),
       source_reference   = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(source_reference), source_reference),
       dialler_minutes    = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(dialler_minutes), dialler_minutes),
       raw_minutes        = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(raw_minutes), raw_minutes),
       attendance_status  = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(attendance_status), attendance_status),
       lwp_value          = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(lwp_value), lwp_value),
       processed_at       = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, NOW(), processed_at),
       created_by         = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'night_shift_apr_repair', created_by)`,
    [
      row.employee_id,
      row.start_date,
      row.branch_id,
      row.process_id,
      row.start_date,
      row.employee_code,
      Math.round(row.apr_combined_minutes),
      Math.round(row.apr_combined_minutes),
      classification.status,
      classification.lwpValue,
    ],
  );

  await db.execute(
    `INSERT INTO attendance_reconciliation_issue
       (id, issue_key, issue_date, employee_id, employee_code, issue_type, severity,
        source_minutes, hrms_minutes, adr_status, source_payload_json, auto_fix_status, resolved_at)
     VALUES (UUID(), ?, ?, ?, ?, 'salary_payable_days_mismatch', 'blocker',
             ?, ?, ?, ?, 'fixed', NOW())
     ON DUPLICATE KEY UPDATE
       source_minutes = VALUES(source_minutes),
       hrms_minutes = VALUES(hrms_minutes),
       adr_status = VALUES(adr_status),
       source_payload_json = VALUES(source_payload_json),
       auto_fix_status = 'fixed',
       resolved_at = NOW(),
       last_detected_at = NOW()`,
    [
      `night_shift_apr_repair__${row.start_date}__${row.employee_id}`,
      row.start_date,
      row.employee_id,
      row.employee_code,
      Math.round(row.apr_combined_minutes),
      row.adr_raw_minutes,
      row.adr_status,
      JSON.stringify({
        repairType: "night_shift_apr_inferred",
        previousStatus: row.adr_status,
        previousSource: row.adr_source,
        previousRawMinutes: row.adr_raw_minutes,
        repairedStatus: classification.status,
        repairedMinutes: Math.round(row.apr_combined_minutes),
      }),
    ],
  );

  return "repaired";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runMonth = args.runMonth ?? args.from.slice(0, 7);
  const { db, closePool } = await import("../src/db/mysql.js");
  const { calculatePayrollRunScoped } = await import("../src/modules/payroll/payrollCalculate.service.js");
  try {
    const runId = args.runId ?? await latestRunIdForMonth(db, runMonth);
    const candidates = await loadCandidates(db, args.from, args.to, args.limit);

    const protectedRows = candidates.filter((row) => Number(row.is_locked ?? 0) === 1 || row.regularization_id || row.override_by);
    const repairableRows = candidates.filter((row) => !protectedRows.includes(row));

    console.log(`Inferred APR night-shift repair audit — ${args.from} to ${args.to}`);
    console.log(`Run month: ${runMonth}`);
    console.log(`Run id: ${runId ?? "not found"}`);
    console.table([
      { metric: "true_payroll_risk_rows", count: candidates.length },
      { metric: "repairable_rows", count: repairableRows.length },
      { metric: "protected_rows_skipped", count: protectedRows.length },
    ]);
    console.log("Sample repairable rows:");
    console.table(repairableRows.slice(0, 20));
    console.log("Sample protected rows:");
    console.table(protectedRows.slice(0, 20));

    if (!args.apply) {
      console.log("Dry-run only. Re-run with --apply to update unlocked/unprotected ADR rows.");
      return;
    }

    let repaired = 0;
    let skipped = 0;
    const affectedEmployeeIds = new Set<string>();
    for (const row of candidates) {
      const result = await repairCandidate(db, row);
      if (result === "repaired") {
        repaired += 1;
        affectedEmployeeIds.add(row.employee_id);
      } else {
        skipped += 1;
      }
    }

    console.table([
      { metric: "repaired_rows", count: repaired },
      { metric: "skipped_rows", count: skipped },
      { metric: "affected_employees", count: affectedEmployeeIds.size },
    ]);

    if (args.recalc) {
      if (!runId) {
        throw new Error("Cannot recalculate payroll without a salary_prep_run id. Pass --run-id.");
      }
      const scoped = Array.from(affectedEmployeeIds);
      if (scoped.length > 0) {
        const recalc = await calculatePayrollRunScoped(runId, "night_shift_apr_repair", { employeeIds: scoped });
        console.log("Payroll recalculation result:");
        console.dir(recalc, { depth: null });
      } else {
        console.log("No repaired employees, so payroll recalculation was skipped.");
      }
    } else {
      console.log("ADR repair applied. Payroll recalculation not run because --recalc was not passed.");
    }
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
