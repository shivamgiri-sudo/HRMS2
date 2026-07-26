import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type AprIssueType =
  | "apr_missing_adr"
  | "apr_minutes_mismatch"
  | "apr_source_fallback_when_apr_exists"
  | "approved_regularization_missing_adr"
  | "salary_payable_days_mismatch";

type AprIssue = {
  issueDate: string;
  employeeId: string;
  employeeCode: string;
  issueType: AprIssueType;
  severity: "blocker" | "warning";
  sourceMinutes?: number;
  hrmsMinutes?: number | null;
  adrStatus?: string | null;
  payload?: Record<string, unknown>;
};

export type AprReconciliationResult = {
  from: string;
  to: string;
  runId: string | null;
  runMonth: string;
  scannedAprDays: number;
  detectedIssues: number;
  upsertedIssues: number;
  resolvedIssues: number;
  repairedRows: number;
  skippedRows: number;
  countsByType: Record<string, number>;
};

const APR_ISSUE_TYPES: AprIssueType[] = [
  "apr_missing_adr",
  "apr_minutes_mismatch",
  "apr_source_fallback_when_apr_exists",
  "approved_regularization_missing_adr",
  "salary_payable_days_mismatch",
];

export function parseAprNetLoginToMinutes(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Math.max(0, Math.round(value));
  const text = String(value).trim();
  const parts = text.split(":").map(Number);
  if (parts.length >= 2 && parts.every((part) => Number.isFinite(part))) {
    const [hours, minutes, seconds = 0] = parts;
    return Math.max(0, (hours * 60) + minutes + Math.round(seconds / 60));
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

export function classifyAprMinutes(minutes: number): { status: "present" | "half_day" | "absent"; lwpValue: number } {
  if (minutes >= 480) return { status: "present", lwpValue: 0 };
  if (minutes >= 240) return { status: "half_day", lwpValue: 0.5 };
  return { status: "absent", lwpValue: 1 };
}

function monthFromRange(from: string) {
  return from.slice(0, 7);
}

function monthRange(runMonth: string) {
  const [year, month] = runMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${runMonth}-01`, end: `${runMonth}-${String(lastDay).padStart(2, "0")}`, daysInMonth: lastDay };
}

function issueKey(issue: AprIssue): string {
  return [issue.issueDate, issue.issueType, issue.employeeId, issue.employeeCode, ""].join("__");
}

async function latestRunIdForMonth(runMonth: string): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM salary_prep_run
      WHERE run_month = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [runMonth],
  );
  return (rows[0] as any)?.id ?? null;
}

async function upsertIssues(issues: AprIssue[]): Promise<number> {
  let count = 0;
  for (const issue of issues) {
    await db.execute(
      `INSERT INTO attendance_reconciliation_issue
         (id, issue_key, issue_date, employee_id, employee_code, issue_type, severity,
          source_minutes, hrms_minutes, adr_status, source_payload_json, auto_fix_status)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_attempted')
       ON DUPLICATE KEY UPDATE
         severity = VALUES(severity),
         source_minutes = VALUES(source_minutes),
         hrms_minutes = VALUES(hrms_minutes),
         adr_status = VALUES(adr_status),
         source_payload_json = VALUES(source_payload_json),
         resolved_at = NULL,
         last_detected_at = NOW()`,
      [
        issueKey(issue),
        issue.issueDate,
        issue.employeeId,
        issue.employeeCode,
        issue.issueType,
        issue.severity,
        Math.round(issue.sourceMinutes ?? 0),
        issue.hrmsMinutes ?? null,
        issue.adrStatus ?? null,
        JSON.stringify(issue.payload ?? {}),
      ],
    );
    count += 1;
  }
  return count;
}

async function resolveGoneIssues(from: string, to: string, activeKeys: Set<string>) {
  const placeholders = APR_ISSUE_TYPES.map(() => "?").join(",");
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, issue_key
       FROM attendance_reconciliation_issue
      WHERE issue_date BETWEEN ? AND ?
        AND issue_type IN (${placeholders})
        AND resolved_at IS NULL`,
    [from, to, ...APR_ISSUE_TYPES],
  );

  let resolved = 0;
  for (const row of rows as any[]) {
    if (activeKeys.has(row.issue_key)) continue;
    await db.execute(
      `UPDATE attendance_reconciliation_issue
          SET resolved_at = NOW(),
              auto_fix_status = CASE WHEN auto_fix_status = 'not_attempted' THEN 'fixed' ELSE auto_fix_status END
        WHERE id = ?`,
      [row.id],
    );
    resolved += 1;
  }
  return resolved;
}

async function repairAdrFromApr(row: any): Promise<"repaired" | "skipped"> {
  const hasProtectedAdr = Number(row.is_locked ?? 0) === 1
    || Boolean(row.override_by)
    || Boolean(row.regularization_id)
    || Boolean(row.approved_regularization_id);
  if (hasProtectedAdr) return "skipped";

  const classification = classifyAprMinutes(Number(row.apr_minutes ?? 0));
  await db.execute(
    `INSERT INTO attendance_daily_record
       (id, employee_id, record_date, branch_id, process_id, attendance_source, source_system,
        source_record_date, source_reference, dialler_minutes, raw_minutes, attendance_status,
        lwp_value, late_mark, late_by_minutes, processed_at, created_by)
     VALUES (UUID(), ?, ?, ?, ?, 'dialler', 'apr.ReportDate',
             ?, ?, ?, ?, ?, ?, 0, 0, NOW(), 'apr_payroll_reconcile')
     ON DUPLICATE KEY UPDATE
       attendance_source  = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'dialler', attendance_source),
       source_system      = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'apr.ReportDate', source_system),
       source_record_date = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(source_record_date), source_record_date),
       source_reference   = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(source_reference), source_reference),
       dialler_minutes    = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(dialler_minutes), dialler_minutes),
       raw_minutes        = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(raw_minutes), raw_minutes),
       attendance_status  = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(attendance_status), attendance_status),
       lwp_value          = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(lwp_value), lwp_value),
       processed_at       = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, NOW(), processed_at),
       created_by         = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'apr_payroll_reconcile', created_by)`,
    [
      row.employee_id,
      row.record_date,
      row.branch_id ?? null,
      row.process_id ?? null,
      row.record_date,
      row.employee_code,
      Math.round(Number(row.apr_minutes ?? 0)),
      Math.round(Number(row.apr_minutes ?? 0)),
      classification.status,
      classification.lwpValue,
    ],
  );
  return "repaired";
}

export const aprPayrollReconciliationService = {
  async audit(options: { from: string; to: string; runId?: string | null; apply?: boolean }): Promise<AprReconciliationResult> {
    const runMonth = monthFromRange(options.from);
    const range = monthRange(runMonth);
    const runId = options.runId ?? await latestRunIdForMonth(runMonth);

    const [aprRows] = await db.query<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.employee_code, e.branch_id, e.process_id,
              DATE_FORMAT(a.ReportDate, '%Y-%m-%d') AS record_date,
              ROUND(SUM(TIME_TO_SEC(a.Net_Login)) / 60) AS apr_minutes
         FROM apr a
         JOIN employees e ON e.employee_code = a.UserID
        WHERE a.ReportDate BETWEEN ? AND ?
          AND e.active_status = 1
        GROUP BY e.id, e.employee_code, e.branch_id, e.process_id, a.ReportDate`,
      [options.from, options.to],
    );

    const [adrRows] = await db.query<RowDataPacket[]>(
      `SELECT employee_id, DATE_FORMAT(record_date, '%Y-%m-%d') AS record_date,
              attendance_source, source_system, raw_minutes, dialler_minutes,
              attendance_status, lwp_value, is_locked, regularization_id, override_by
         FROM attendance_daily_record
        WHERE record_date BETWEEN ? AND ?`,
      [options.from, options.to],
    );
    const adrByEmployeeDate = new Map<string, any>();
    for (const row of adrRows as any[]) adrByEmployeeDate.set(`${row.employee_id}__${row.record_date}`, row);

    const [regularizationRows] = await db.query<RowDataPacket[]>(
      `SELECT id, employee_id, DATE_FORMAT(session_date, '%Y-%m-%d') AS record_date
         FROM attendance_regularization
        WHERE status = 'approved'
          AND session_date BETWEEN ? AND ?`,
      [options.from, options.to],
    );
    const approvedRegularizationByEmployeeDate = new Map<string, any>();
    for (const row of regularizationRows as any[]) approvedRegularizationByEmployeeDate.set(`${row.employee_id}__${row.record_date}`, row);

    const issues: AprIssue[] = [];
    let repairedRows = 0;
    let skippedRows = 0;

    for (const apr of aprRows as any[]) {
      const key = `${apr.employee_id}__${apr.record_date}`;
      const adr = adrByEmployeeDate.get(key);
      const regularization = approvedRegularizationByEmployeeDate.get(key);
      if (regularization && !adr) {
        issues.push({
          issueDate: apr.record_date,
          employeeId: apr.employee_id,
          employeeCode: apr.employee_code,
          issueType: "approved_regularization_missing_adr",
          severity: "blocker",
          sourceMinutes: Number(apr.apr_minutes ?? 0),
          payload: { regularizationId: regularization.id },
        });
        continue;
      }
      if (regularization || Number(adr?.is_locked ?? 0) === 1 || adr?.override_by || adr?.regularization_id) {
        skippedRows += 1;
        continue;
      }

      const classification = classifyAprMinutes(Number(apr.apr_minutes ?? 0));
      const rowForRepair = {
        ...apr,
        ...adr,
        employee_id: apr.employee_id,
        employee_code: apr.employee_code,
        record_date: apr.record_date,
        branch_id: apr.branch_id,
        process_id: apr.process_id,
        apr_minutes: apr.apr_minutes,
        approved_regularization_id: regularization?.id ?? null,
      };

      if (!adr) {
        issues.push({
          issueDate: apr.record_date,
          employeeId: apr.employee_id,
          employeeCode: apr.employee_code,
          issueType: "apr_missing_adr",
          severity: "blocker",
          sourceMinutes: Number(apr.apr_minutes ?? 0),
          payload: { aprMinutes: Number(apr.apr_minutes ?? 0), expectedStatus: classification.status },
        });
        if (options.apply) {
          const repair = await repairAdrFromApr(rowForRepair);
          if (repair === "repaired") repairedRows += 1; else skippedRows += 1;
        }
        continue;
      }

      const adrMinutes = Number(adr.raw_minutes ?? adr.dialler_minutes ?? 0);
      if (adr.attendance_source === "dialler" && Math.abs(adrMinutes - Number(apr.apr_minutes ?? 0)) > 1) {
        issues.push({
          issueDate: apr.record_date,
          employeeId: apr.employee_id,
          employeeCode: apr.employee_code,
          issueType: "apr_minutes_mismatch",
          severity: "blocker",
          sourceMinutes: Number(apr.apr_minutes ?? 0),
          hrmsMinutes: adrMinutes,
          adrStatus: adr.attendance_status,
          payload: { sourceSystem: adr.source_system, expectedStatus: classification.status, actualStatus: adr.attendance_status },
        });
        if (options.apply) {
          const repair = await repairAdrFromApr(rowForRepair);
          if (repair === "repaired") repairedRows += 1; else skippedRows += 1;
        }
      }

      if (adr.attendance_source === "dialler" && adr.source_system !== "apr.ReportDate") {
        issues.push({
          issueDate: apr.record_date,
          employeeId: apr.employee_id,
          employeeCode: apr.employee_code,
          issueType: "apr_source_fallback_when_apr_exists",
          severity: "warning",
          sourceMinutes: Number(apr.apr_minutes ?? 0),
          hrmsMinutes: adrMinutes,
          adrStatus: adr.attendance_status,
          payload: { sourceSystem: adr.source_system },
        });
        if (options.apply) {
          const repair = await repairAdrFromApr(rowForRepair);
          if (repair === "repaired") repairedRows += 1; else skippedRows += 1;
        }
      }
    }

    if (runId) {
      const [lineRows] = await db.query<RowDataPacket[]>(
        `SELECT spl.employee_id,
                COALESCE(NULLIF(e.employee_code, ''), spl.employee_code) AS employee_code,
                spl.final_payable_days,
                LEAST(
                  COALESCE(adr_paid.paid_base, 0)
                  + COALESCE(spl.eligible_weekoff_days, 0)
                  + COALESCE(spl.eligible_holiday_days, 0),
                  ?
                ) AS recomputed_final_payable_days
           FROM salary_prep_line spl
           JOIN employees e ON e.id = spl.employee_id
           JOIN (
             SELECT DISTINCT e2.id AS employee_id
               FROM apr a
               JOIN employees e2 ON e2.employee_code = a.UserID
              WHERE a.ReportDate BETWEEN ? AND ?
           ) apr_emp ON apr_emp.employee_id = spl.employee_id
           LEFT JOIN (
             SELECT employee_id,
                    COALESCE(SUM(
                      CASE
                        WHEN attendance_status = 'present' THEN 1.0
                        WHEN attendance_status = 'half_day' THEN 0.5
                        WHEN attendance_status = 'leave_approved' THEN 1.0
                        ELSE 0
                      END
                    ), 0) AS paid_base
               FROM attendance_daily_record
              WHERE record_date BETWEEN ? AND ?
              GROUP BY employee_id
           ) adr_paid ON adr_paid.employee_id = spl.employee_id
          WHERE spl.run_id = ?
            AND ABS(COALESCE(spl.final_payable_days, 0) - LEAST(
              COALESCE(adr_paid.paid_base, 0)
              + COALESCE(spl.eligible_weekoff_days, 0)
              + COALESCE(spl.eligible_holiday_days, 0),
              ?
            )) > 0.01`,
        [range.daysInMonth, range.start, range.end, range.start, range.end, runId, range.daysInMonth],
      );
      for (const line of lineRows as any[]) {
        issues.push({
          issueDate: range.end,
          employeeId: line.employee_id,
          employeeCode: String(line.employee_code ?? ""),
          issueType: "salary_payable_days_mismatch",
          severity: "blocker",
          sourceMinutes: 0,
          hrmsMinutes: null,
          payload: {
            runId,
            storedFinalPayableDays: Number(line.final_payable_days ?? 0),
            recomputedFinalPayableDays: Number(line.recomputed_final_payable_days ?? 0),
          },
        });
      }
    }

    const activeKeys = new Set(issues.map(issueKey));
    const upsertedIssues = await upsertIssues(issues);
    const resolvedIssues = await resolveGoneIssues(options.from, options.to, activeKeys);
    const countsByType = issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.issueType] = (acc[issue.issueType] ?? 0) + 1;
      return acc;
    }, {});

    return {
      from: options.from,
      to: options.to,
      runId,
      runMonth,
      scannedAprDays: aprRows.length,
      detectedIssues: issues.length,
      upsertedIssues,
      resolvedIssues,
      repairedRows,
      skippedRows,
      countsByType,
    };
  },
};
