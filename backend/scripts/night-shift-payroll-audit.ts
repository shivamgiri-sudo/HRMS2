import "dotenv/config";

type Args = {
  from: string;
  to: string;
  runMonth?: string;
  runId?: string;
  limit: number;
};

type AuditRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  roster_date: string;
  shift_start_time: string | null;
  shift_end_time: string | null;
  attendance_source: string | null;
  attendance_status: string | null;
  source_system: string | null;
  raw_minutes: number | null;
  dialler_minutes: number | null;
  biometric_minutes: number | null;
  lwp_value: number | null;
  is_locked: number | null;
  apr_total_minutes: number | null;
  dialler_total_minutes: number | null;
  expected_apr_status: string | null;
  payable_credit: number;
  run_id: string | null;
  final_payable_days: number | null;
  paid_working_days: number | null;
  eligible_weekoff_days: number | null;
  eligible_holiday_days: number | null;
};

type InferredNightShiftRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  designation_name: string | null;
  start_date: string;
  next_date: string;
  apr_day1_minutes: number;
  apr_day2_minutes: number;
  apr_combined_minutes: number;
  dialler_day1_minutes: number;
  dialler_day2_minutes: number;
  dialler_combined_minutes: number;
  adr_status: string | null;
  adr_source: string | null;
  adr_raw_minutes: number | null;
  inferred_expected_status: string;
  inferred_authority: "apr" | "biometric";
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { limit: 50 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") out.from = argv[++i];
    else if (arg === "--to") out.to = argv[++i];
    else if (arg === "--run-month") out.runMonth = argv[++i];
    else if (arg === "--run-id") out.runId = argv[++i];
    else if (arg === "--limit") out.limit = Number(argv[++i]);
  }
  if (!out.from || !out.to) {
    throw new Error("Usage: tsx scripts/night-shift-payroll-audit.ts --from YYYY-MM-DD --to YYYY-MM-DD [--run-month YYYY-MM] [--run-id ID] [--limit N]");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.from) || !/^\d{4}-\d{2}-\d{2}$/.test(out.to)) {
    throw new Error("--from and --to must be YYYY-MM-DD");
  }
  if (out.runMonth && !/^\d{4}-\d{2}$/.test(out.runMonth)) {
    throw new Error("--run-month must be YYYY-MM");
  }
  if (!Number.isFinite(out.limit) || Number(out.limit) <= 0) {
    throw new Error("--limit must be a positive number");
  }
  return out as Args;
}

function classifyAprMinutes(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes >= 480) return "present";
  if (minutes >= 240) return "half_day";
  return "absent";
}

function payableCredit(status: string | null): number {
  if (status === "present" || status === "leave_approved") return 1;
  if (status === "half_day") return 0.5;
  return 0;
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00+05:30`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { db, closePool } = await import("../src/db/mysql.js");
  try {
    const runMonth = args.runMonth ?? args.from.slice(0, 7);
    let runId = args.runId ?? null;

    if (!runId) {
      const [runRows] = await db.query<any[]>(
        `SELECT id
           FROM salary_prep_run
          WHERE run_month = ?
          ORDER BY created_at DESC
          LIMIT 1`,
        [runMonth],
      );
      runId = runRows[0]?.id ?? null;
    }

    const [rows] = await db.query<any[]>(
      `SELECT
          e.id AS employee_id,
          e.employee_code,
          TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name,
          DATE_FORMAT(wra.roster_date, '%Y-%m-%d') AS roster_date,
          COALESCE(wra.shift_start_time, wsm.start_time) AS shift_start_time,
          COALESCE(wra.shift_end_time, wsm.end_time) AS shift_end_time,
          adr.attendance_source,
          adr.attendance_status,
          adr.source_system,
          adr.raw_minutes,
          adr.dialler_minutes,
          adr.biometric_minutes,
          adr.lwp_value,
          adr.is_locked,
          apr.apr_total_minutes,
          dsl.dialler_total_minutes,
          spl.run_id,
          spl.final_payable_days,
          spl.paid_working_days,
          spl.eligible_weekoff_days,
          spl.eligible_holiday_days
       FROM wfm_roster_assignment wra
       JOIN employees e
         ON e.id = wra.employee_id
       LEFT JOIN wfm_shift_master wsm
         ON wsm.id = wra.shift_id
       LEFT JOIN attendance_daily_record adr
         ON adr.employee_id = wra.employee_id
        AND DATE(CONVERT_TZ(adr.record_date, '+00:00', '+05:30')) = wra.roster_date
       LEFT JOIN (
         SELECT
           a.UserID AS employee_code,
           base.roster_date,
           SUM(
             COALESCE(TIME_TO_SEC(a.Net_Login), 0)
           ) / 60 AS apr_total_minutes
         FROM apr a
         JOIN (
           SELECT
             e2.employee_code,
             wra2.roster_date,
             CASE
               WHEN COALESCE(wra2.shift_end_time, wsm2.end_time) < COALESCE(wra2.shift_start_time, wsm2.start_time)
                 THEN DATE_FORMAT(DATE_ADD(wra2.roster_date, INTERVAL 1 DAY), '%Y-%m-%d')
               ELSE DATE_FORMAT(wra2.roster_date, '%Y-%m-%d')
             END AS roster_end_date
           FROM wfm_roster_assignment wra2
           JOIN employees e2 ON e2.id = wra2.employee_id
           LEFT JOIN wfm_shift_master wsm2 ON wsm2.id = wra2.shift_id
           WHERE wra2.roster_date BETWEEN ? AND ?
             AND COALESCE(wra2.shift_end_time, wsm2.end_time) < COALESCE(wra2.shift_start_time, wsm2.start_time)
         ) base
           ON base.employee_code = a.UserID
          AND a.ReportDate IN (DATE_FORMAT(base.roster_date, '%Y-%m-%d'), base.roster_end_date)
         GROUP BY a.UserID, base.roster_date
       ) apr
         ON apr.employee_code = e.employee_code
        AND apr.roster_date = wra.roster_date
       LEFT JOIN (
         SELECT
           base.employee_id,
           base.roster_date,
           COALESCE(SUM(d.login_minutes), 0) AS dialler_total_minutes
         FROM (
           SELECT
             wra3.employee_id,
             wra3.roster_date,
             CASE
               WHEN COALESCE(wra3.shift_end_time, wsm3.end_time) < COALESCE(wra3.shift_start_time, wsm3.start_time)
                 THEN DATE_FORMAT(DATE_ADD(wra3.roster_date, INTERVAL 1 DAY), '%Y-%m-%d')
               ELSE DATE_FORMAT(wra3.roster_date, '%Y-%m-%d')
             END AS roster_end_date
           FROM wfm_roster_assignment wra3
           LEFT JOIN wfm_shift_master wsm3 ON wsm3.id = wra3.shift_id
           WHERE wra3.roster_date BETWEEN ? AND ?
             AND COALESCE(wra3.shift_end_time, wsm3.end_time) < COALESCE(wra3.shift_start_time, wsm3.start_time)
         ) base
         LEFT JOIN dialer_session_log d
           ON d.employee_id = base.employee_id
          AND d.session_date IN (DATE_FORMAT(base.roster_date, '%Y-%m-%d'), base.roster_end_date)
         GROUP BY base.employee_id, base.roster_date
       ) dsl
         ON dsl.employee_id = wra.employee_id
        AND dsl.roster_date = wra.roster_date
       LEFT JOIN salary_prep_line spl
         ON spl.employee_id = e.id
        AND (? IS NOT NULL AND spl.run_id = ?)
       WHERE wra.roster_date BETWEEN ? AND ?
         AND COALESCE(wra.shift_end_time, wsm.end_time) < COALESCE(wra.shift_start_time, wsm.start_time)
       ORDER BY wra.roster_date, e.employee_code`,
      [args.from, args.to, args.from, args.to, runId, runId, args.from, args.to],
    );

    const [inferredRows] = await db.query<any[]>(
      `SELECT
          e.id AS employee_id,
          e.employee_code,
          TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name,
          LOWER(COALESCE(dept.dept_name, '')) AS department_name,
          LOWER(COALESCE(desig.designation_name, '')) AS designation_name,
          apr1.report_date AS start_date,
          DATE_FORMAT(DATE_ADD(apr1.report_date, INTERVAL 1 DAY), '%Y-%m-%d') AS next_date,
          apr1.apr_minutes AS apr_day1_minutes,
          COALESCE(apr2.apr_minutes, 0) AS apr_day2_minutes,
          apr1.apr_minutes + COALESCE(apr2.apr_minutes, 0) AS apr_combined_minutes,
          COALESCE(d1.dialler_minutes, 0) AS dialler_day1_minutes,
          COALESCE(d2.dialler_minutes, 0) AS dialler_day2_minutes,
          COALESCE(d1.dialler_minutes, 0) + COALESCE(d2.dialler_minutes, 0) AS dialler_combined_minutes,
          adr.attendance_status AS adr_status,
          adr.attendance_source AS adr_source,
          adr.raw_minutes AS adr_raw_minutes
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
       LEFT JOIN (
         SELECT employee_id, session_date, SUM(login_minutes) AS dialler_minutes
           FROM dialer_session_log
          WHERE session_date BETWEEN ? AND ?
          GROUP BY employee_id, session_date
       ) d1
         ON d1.employee_id = e.id
        AND d1.session_date = apr1.report_date
       LEFT JOIN (
         SELECT employee_id, session_date, SUM(login_minutes) AS dialler_minutes
           FROM dialer_session_log
          WHERE session_date BETWEEN DATE_ADD(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)
          GROUP BY employee_id, session_date
       ) d2
         ON d2.employee_id = e.id
        AND d2.session_date = DATE_ADD(apr1.report_date, INTERVAL 1 DAY)
       LEFT JOIN attendance_daily_record adr
         ON adr.employee_id = e.id
        AND DATE(CONVERT_TZ(adr.record_date, '+00:00', '+05:30')) = apr1.report_date
       LEFT JOIN wfm_roster_assignment wra
         ON wra.employee_id = e.id
        AND wra.roster_date = apr1.report_date
       LEFT JOIN wfm_shift_master wsm
         ON wsm.id = wra.shift_id
       WHERE wra.id IS NULL
         AND apr1.report_date BETWEEN ? AND ?
         AND apr1.apr_minutes >= 60
         AND COALESCE(apr2.apr_minutes, 0) >= 60
         AND apr1.apr_minutes + COALESCE(apr2.apr_minutes, 0) >= 240
       ORDER BY apr1.report_date, e.employee_code`,
      [args.from, args.to, args.from, args.to, args.from, args.to, args.from, args.to, args.from, args.to],
    );

    const mapped: AuditRow[] = rows.map((row) => ({
      employee_id: String(row.employee_id),
      employee_code: String(row.employee_code),
      employee_name: String(row.employee_name ?? "").trim(),
      roster_date: String(row.roster_date),
      shift_start_time: row.shift_start_time ? String(row.shift_start_time) : null,
      shift_end_time: row.shift_end_time ? String(row.shift_end_time) : null,
      attendance_source: row.attendance_source ? String(row.attendance_source) : null,
      attendance_status: row.attendance_status ? String(row.attendance_status) : null,
      source_system: row.source_system ? String(row.source_system) : null,
      raw_minutes: row.raw_minutes === null ? null : Number(row.raw_minutes),
      dialler_minutes: row.dialler_minutes === null ? null : Number(row.dialler_minutes),
      biometric_minutes: row.biometric_minutes === null ? null : Number(row.biometric_minutes),
      lwp_value: row.lwp_value === null ? null : Number(row.lwp_value),
      is_locked: row.is_locked === null ? null : Number(row.is_locked),
      apr_total_minutes: row.apr_total_minutes === null ? null : Number(row.apr_total_minutes),
      dialler_total_minutes: row.dialler_total_minutes === null ? null : Number(row.dialler_total_minutes),
      expected_apr_status: classifyAprMinutes(row.apr_total_minutes === null ? null : Number(row.apr_total_minutes)),
      payable_credit: payableCredit(row.attendance_status ? String(row.attendance_status) : null),
      run_id: row.run_id ? String(row.run_id) : null,
      final_payable_days: row.final_payable_days === null ? null : Number(row.final_payable_days),
      paid_working_days: row.paid_working_days === null ? null : Number(row.paid_working_days),
      eligible_weekoff_days: row.eligible_weekoff_days === null ? null : Number(row.eligible_weekoff_days),
      eligible_holiday_days: row.eligible_holiday_days === null ? null : Number(row.eligible_holiday_days),
    }));

    const inferredNightShiftRows: InferredNightShiftRow[] = inferredRows.map((row) => {
      const aprCombinedMinutes = Number(row.apr_combined_minutes ?? 0);
      return {
        employee_id: String(row.employee_id),
        employee_code: String(row.employee_code),
        employee_name: String(row.employee_name ?? "").trim(),
        department_name: row.department_name ? String(row.department_name) : null,
        designation_name: row.designation_name ? String(row.designation_name) : null,
        start_date: String(row.start_date),
        next_date: String(row.next_date ?? nextDate(String(row.start_date))),
        apr_day1_minutes: Number(row.apr_day1_minutes ?? 0),
        apr_day2_minutes: Number(row.apr_day2_minutes ?? 0),
        apr_combined_minutes: aprCombinedMinutes,
        dialler_day1_minutes: Number(row.dialler_day1_minutes ?? 0),
        dialler_day2_minutes: Number(row.dialler_day2_minutes ?? 0),
        dialler_combined_minutes: Number(row.dialler_combined_minutes ?? 0),
        adr_status: row.adr_status ? String(row.adr_status) : null,
        adr_source: row.adr_source ? String(row.adr_source) : null,
        adr_raw_minutes: row.adr_raw_minutes === null ? null : Number(row.adr_raw_minutes),
        inferred_expected_status: classifyAprMinutes(aprCombinedMinutes) ?? "absent",
        inferred_authority:
          /operations?/.test(String(row.department_name ?? "")) && /^executive(?:\s*-\s*.+)?$/.test(String(row.designation_name ?? ""))
            ? "apr"
            : "biometric",
      };
    });

    const missingAdr = mapped.filter((row) => !row.attendance_status);
    const aprConflict = mapped.filter((row) =>
      row.attendance_source === "dialler" &&
      row.expected_apr_status !== null &&
      row.attendance_status !== null &&
      !["leave_approved", "holiday", "week_off", "week_off_worked"].includes(row.attendance_status) &&
      row.expected_apr_status !== row.attendance_status
    );
    const sourceWindowGap = mapped.filter((row) =>
      row.attendance_source === "dialler" &&
      (row.apr_total_minutes ?? row.dialler_total_minutes ?? 0) > 0 &&
      (row.raw_minutes ?? 0) === 0
    );
    const payrollLinesMissing = mapped.filter((row) => runId && !row.run_id);

    const monthlyEmployeeTotals = new Map<string, { employee_code: string; employee_name: string; payable: number }>();
    for (const row of mapped) {
      const key = row.employee_id;
      const existing = monthlyEmployeeTotals.get(key) ?? {
        employee_code: row.employee_code,
        employee_name: row.employee_name,
        payable: 0,
      };
      existing.payable += row.payable_credit;
      monthlyEmployeeTotals.set(key, existing);
    }

    const payrollMismatch: Array<Record<string, unknown>> = [];
    for (const row of mapped) {
      if (!runId || row.final_payable_days === null) continue;
      const total = monthlyEmployeeTotals.get(row.employee_id);
      if (!total) continue;
      const recomputedKnownNightShiftPaid = Math.round(total.payable * 100) / 100;
      const finalPayable = Math.round(Number(row.final_payable_days) * 100) / 100;
      if (Math.abs(finalPayable - recomputedKnownNightShiftPaid) >= 0.01) {
        payrollMismatch.push({
          employee_code: row.employee_code,
          employee_name: row.employee_name,
          final_payable_days: finalPayable,
          known_night_shift_paid_days: recomputedKnownNightShiftPaid,
        });
      }
    }

    const inferredAdrGap = inferredNightShiftRows.filter((row) => !row.adr_status);
    const inferredAdrConflict = inferredNightShiftRows.filter((row) =>
      row.adr_status !== null &&
      !["leave_approved", "holiday", "week_off", "week_off_worked"].includes(row.adr_status) &&
      row.adr_status !== row.inferred_expected_status
    );
    const aprAuthorityRows = inferredNightShiftRows.filter((row) => row.inferred_authority === "apr");
    const biometricAuthorityRows = inferredNightShiftRows.filter((row) => row.inferred_authority === "biometric");
    const truePayrollRisk = inferredNightShiftRows.filter((row) => {
      if (row.inferred_authority === "apr") {
        if (row.adr_status === null) return true;
        if (["leave_approved", "holiday", "week_off", "week_off_worked"].includes(row.adr_status)) return false;
        const actual = row.adr_status;
        const expected = row.inferred_expected_status;
        if (expected === "present" && (actual === "half_day" || actual === "absent" || actual === "missing_punch")) return true;
        if (expected === "half_day" && (actual === "absent" || actual === "missing_punch")) return true;
        return false;
      }
      if (row.inferred_authority === "biometric") {
        return row.adr_status === "missing_punch" && row.adr_source === "biometric";
      }
      return false;
    });
    const managerReviewCandidates = inferredNightShiftRows.filter((row) => {
      if (truePayrollRisk.includes(row)) return false;
      if (row.adr_status === null) return false;
      if (["leave_approved", "holiday", "week_off", "week_off_worked"].includes(row.adr_status)) return false;
      return row.adr_status !== row.inferred_expected_status;
    });

    console.log(`Night-shift payroll audit — ${args.from} to ${args.to}`);
    console.log(`Run month: ${runMonth}`);
    console.log(`Run id: ${runId ?? "not found"}`);
    console.table([
      { metric: "night_shift_roster_rows", count: mapped.length },
      { metric: "night_shift_rows_missing_adr", count: missingAdr.length },
      { metric: "night_shift_apr_status_conflicts", count: aprConflict.length },
      { metric: "night_shift_source_window_gaps", count: sourceWindowGap.length },
      { metric: "night_shift_rows_missing_payroll_line", count: payrollLinesMissing.length },
      { metric: "night_shift_employee_payroll_mismatch", count: payrollMismatch.length },
      { metric: "inferred_night_shift_rows_without_roster", count: inferredNightShiftRows.length },
      { metric: "inferred_apr_authority_rows", count: aprAuthorityRows.length },
      { metric: "inferred_biometric_authority_rows", count: biometricAuthorityRows.length },
      { metric: "inferred_night_shift_rows_missing_adr", count: inferredAdrGap.length },
      { metric: "inferred_night_shift_adr_conflicts", count: inferredAdrConflict.length },
      { metric: "true_payroll_risk_rows", count: truePayrollRisk.length },
      { metric: "manager_review_candidate_rows", count: managerReviewCandidates.length },
    ]);

    console.log("Sample missing ADR rows:");
    console.table(missingAdr.slice(0, args.limit));
    console.log("Sample APR conflicts:");
    console.table(aprConflict.slice(0, args.limit));
    console.log("Sample source window gaps:");
    console.table(sourceWindowGap.slice(0, args.limit));
    if (runId) {
      console.log("Sample payroll mismatches:");
      console.table(payrollMismatch.slice(0, args.limit));
    }
    console.log("Sample inferred night-shift rows without roster:");
    console.table(inferredNightShiftRows.slice(0, args.limit));
    console.log("Sample inferred night-shift ADR gaps:");
    console.table(inferredAdrGap.slice(0, args.limit));
    console.log("Sample inferred night-shift ADR conflicts:");
    console.table(inferredAdrConflict.slice(0, args.limit));
    console.log("Sample true payroll-risk rows:");
    console.table(truePayrollRisk.slice(0, args.limit));
    console.log("Sample manager review candidate rows:");
    console.table(managerReviewCandidates.slice(0, args.limit));
    console.log("Dry-run only. This script is read-only.");
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
