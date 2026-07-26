import sql from "mssql";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getNcosecPool } from "../../db/ncosecDb.js";
import { env } from "../../config/env.js";
import { nowIST } from "../../shared/timezone.js";
import { cosecSyncService } from "./cosec-sync.service.js";

type IssueType =
  | "unmapped_cosec_user"
  | "missing_ibd"
  | "zero_minute_attendance"
  | "missing_punch_with_usable_source"
  | "missing_adr";

type ReconciliationIssue = {
  issueDate: string;
  employeeId?: string | null;
  employeeCode?: string | null;
  cosecUserId?: string | null;
  issueType: IssueType;
  severity: "blocker" | "warning";
  sourceMinutes?: number;
  hrmsMinutes?: number | null;
  adrStatus?: string | null;
  payload?: Record<string, unknown>;
};

type ReconciliationResult = {
  from: string;
  to: string;
  scannedSourceDays: number;
  detectedIssues: number;
  upsertedIssues: number;
  resolvedIssues: number;
  autoFix: {
    attempted: boolean;
    status: "not_attempted" | "fixed" | "skipped" | "failed";
    reason?: string;
  };
  countsByType: Record<string, number>;
};

function dateOnly(value: unknown): string {
  return String(value).slice(0, 10);
}

function issueKey(issue: ReconciliationIssue): string {
  return [
    issue.issueDate,
    issue.issueType,
    issue.employeeId ?? "",
    issue.employeeCode ?? "",
    issue.cosecUserId ?? "",
  ].join("__");
}

function employeeCandidates(row: any): string[] {
  return [row.cosec_user_id, row.biometric_code, row.employee_code]
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
    .map((value) => String(value).trim());
}

async function pullSourceGroups(from: string, to: string) {
  const pool = await getNcosecPool();
  const request = pool.request();
  request.input("fromDate", sql.Date, from);
  request.input("toDate", sql.Date, to);
  const result = await request.query(`
    SELECT
      CAST(UserID AS nvarchar(100)) AS cosec_user_id,
      CONVERT(varchar(10), CAST(Edatetime AS date), 120) AS punch_date,
      CONVERT(varchar(19), MIN(Edatetime), 120) AS first_punch,
      CONVERT(varchar(19), MAX(Edatetime), 120) AS last_punch,
      COUNT_BIG(*) AS total_punches,
      DATEDIFF(MINUTE, MIN(Edatetime), MAX(Edatetime)) AS working_minutes
    FROM dbo.Mx_ATDEventTrn WITH (NOLOCK)
    WHERE CAST(Edatetime AS date) BETWEEN @fromDate AND @toDate
    GROUP BY CAST(UserID AS nvarchar(100)), CAST(Edatetime AS date)
  `);

  return result.recordset.map((row: any) => ({
    cosecUserId: String(row.cosec_user_id),
    punchDate: dateOnly(row.punch_date),
    firstPunch: row.first_punch,
    lastPunch: row.last_punch,
    totalPunches: Number(row.total_punches ?? 0),
    workingMinutes: Number(row.working_minutes ?? 0),
  }));
}

async function upsertIssues(issues: ReconciliationIssue[]): Promise<number> {
  let upserted = 0;
  for (const issue of issues) {
    await db.execute(
      `INSERT INTO attendance_reconciliation_issue
         (id, issue_key, issue_date, employee_id, employee_code, cosec_user_id, issue_type, severity,
          source_minutes, hrms_minutes, adr_status, source_payload_json, auto_fix_status)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_attempted')
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
        issue.employeeId ?? null,
        issue.employeeCode ?? null,
        issue.cosecUserId ?? null,
        issue.issueType,
        issue.severity,
        Math.round(issue.sourceMinutes ?? 0),
        issue.hrmsMinutes ?? null,
        issue.adrStatus ?? null,
        JSON.stringify(issue.payload ?? {}),
      ],
    );
    upserted += 1;
  }
  return upserted;
}

async function resolveGoneIssues(from: string, to: string, activeKeys: Set<string>): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date, issue_type, employee_id, employee_code, cosec_user_id
       FROM attendance_reconciliation_issue
      WHERE issue_date BETWEEN ? AND ?
        AND resolved_at IS NULL`,
    [from, to],
  );

  let resolved = 0;
  for (const row of rows as any[]) {
    const key = [
      row.issue_date,
      row.issue_type,
      row.employee_id ?? "",
      row.employee_code ?? "",
      row.cosec_user_id ?? "",
    ].join("__");
    if (activeKeys.has(key)) continue;
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

export const attendanceReconciliationService = {
  async audit(options: { from: string; to: string; autoFix?: boolean }): Promise<ReconciliationResult> {
    const sourceGroups = await pullSourceGroups(options.from, options.to);
    const usableSource = sourceGroups.filter((row) => row.totalPunches > 1 && row.workingMinutes > 2);

    const [employeeRows] = await db.query<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.employee_code, e.biometric_code, ebe.cosec_user_id
         FROM employees e
         LEFT JOIN employee_biometric_enrollment ebe
           ON ebe.employee_id = e.id AND ebe.is_active = 1
        WHERE e.active_status = 1`,
    );
    const employeeBySourceUser = new Map<string, any>();
    for (const row of employeeRows as any[]) {
      for (const candidate of employeeCandidates(row)) {
        if (!employeeBySourceUser.has(candidate)) employeeBySourceUser.set(candidate, row);
      }
    }

    const [ibdRows] = await db.query<RowDataPacket[]>(
      `SELECT employee_code, DATE_FORMAT(activity_date, '%Y-%m-%d') AS record_date,
              biometric_minutes, total_punches
         FROM integration_biometric_daily
        WHERE activity_date BETWEEN ? AND ?`,
      [options.from, options.to],
    );
    const ibdByEmployeeDate = new Map<string, any>();
    for (const row of ibdRows as any[]) ibdByEmployeeDate.set(`${row.employee_code}__${row.record_date}`, row);

    const [adrRows] = await db.query<RowDataPacket[]>(
      `SELECT employee_id, DATE_FORMAT(record_date, '%Y-%m-%d') AS record_date,
              attendance_status, biometric_minutes, is_locked, mismatch_flag
         FROM attendance_daily_record
        WHERE record_date BETWEEN ? AND ?`,
      [options.from, options.to],
    );
    const adrByEmployeeDate = new Map<string, any>();
    for (const row of adrRows as any[]) adrByEmployeeDate.set(`${row.employee_id}__${row.record_date}`, row);

    const issues: ReconciliationIssue[] = [];
    for (const source of usableSource) {
      const employee = employeeBySourceUser.get(source.cosecUserId);
      if (!employee) {
        issues.push({
          issueDate: source.punchDate,
          cosecUserId: source.cosecUserId,
          issueType: "unmapped_cosec_user",
          severity: "warning",
          sourceMinutes: source.workingMinutes,
          payload: source,
        });
        continue;
      }

      const ibd = ibdByEmployeeDate.get(`${employee.employee_code}__${source.punchDate}`);
      const adr = adrByEmployeeDate.get(`${employee.employee_id}__${source.punchDate}`);
      if (!ibd) {
        issues.push({
          issueDate: source.punchDate,
          employeeId: employee.employee_id,
          employeeCode: employee.employee_code,
          cosecUserId: source.cosecUserId,
          issueType: "missing_ibd",
          severity: "blocker",
          sourceMinutes: source.workingMinutes,
          payload: source,
        });
      }

      const ibdMinutes = Number(ibd?.biometric_minutes ?? 0);
      const adrMinutes = Number(adr?.biometric_minutes ?? 0);
      if ((ibdMinutes === 0 || adrMinutes === 0) && source.workingMinutes > 2) {
        issues.push({
          issueDate: source.punchDate,
          employeeId: employee.employee_id,
          employeeCode: employee.employee_code,
          cosecUserId: source.cosecUserId,
          issueType: "zero_minute_attendance",
          severity: "blocker",
          sourceMinutes: source.workingMinutes,
          hrmsMinutes: Math.max(ibdMinutes, adrMinutes),
          adrStatus: adr?.attendance_status ?? null,
          payload: source,
        });
      }

      if (adr?.attendance_status === "missing_punch") {
        issues.push({
          issueDate: source.punchDate,
          employeeId: employee.employee_id,
          employeeCode: employee.employee_code,
          cosecUserId: source.cosecUserId,
          issueType: "missing_punch_with_usable_source",
          severity: "blocker",
          sourceMinutes: source.workingMinutes,
          hrmsMinutes: adrMinutes,
          adrStatus: adr.attendance_status,
          payload: source,
        });
      }
    }

    const [gapRows] = await db.query<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.employee_code, DATE_FORMAT(cal.record_date, '%Y-%m-%d') AS record_date
         FROM (
           SELECT DATE_ADD(?, INTERVAL n DAY) AS record_date
             FROM (
               SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
               UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
               UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14
               UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19
               UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24
               UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29
               UNION ALL SELECT 30
             ) days
            WHERE n <= DATEDIFF(?, ?)
         ) cal
         JOIN employees e
           ON e.active_status = 1
          AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
          AND cal.record_date BETWEEN COALESCE(e.salary_start_date, e.date_of_joining, ?)
                                  AND COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date, ?)
        WHERE NOT EXISTS (
          SELECT 1 FROM attendance_daily_record adr
           WHERE adr.employee_id = e.id AND adr.record_date = cal.record_date
        )`,
      [options.from, options.to, options.from, options.from, options.to],
    );
    for (const row of gapRows as any[]) {
      issues.push({
        issueDate: row.record_date,
        employeeId: row.employee_id,
        employeeCode: row.employee_code,
        issueType: "missing_adr",
        severity: "blocker",
      });
    }

    const activeKeys = new Set(issues.map(issueKey));
    const upsertedIssues = await upsertIssues(issues);
    const resolvedIssues = await resolveGoneIssues(options.from, options.to, activeKeys);
    const countsByType = issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.issueType] = (acc[issue.issueType] ?? 0) + 1;
      return acc;
    }, {});

    const result: ReconciliationResult = {
      from: options.from,
      to: options.to,
      scannedSourceDays: sourceGroups.length,
      detectedIssues: issues.length,
      upsertedIssues,
      resolvedIssues,
      countsByType,
      autoFix: { attempted: false, status: "not_attempted" },
    };

    if (options.autoFix) {
      if (cosecSyncService.isRunning()) {
        result.autoFix = { attempted: true, status: "skipped", reason: "COSEC sync already running" };
      } else {
        try {
          const sync = await cosecSyncService.sync({ from: options.from, to: options.to });
          await db.execute(
            `UPDATE attendance_reconciliation_issue
                SET auto_fix_status = ?
              WHERE issue_date BETWEEN ? AND ?
                AND resolved_at IS NULL
                AND issue_type IN ('missing_ibd','zero_minute_attendance','missing_punch_with_usable_source','missing_adr')`,
            [sync.failed.length === 0 ? "fixed" : "failed", options.from, options.to],
          );
          result.autoFix = {
            attempted: true,
            status: sync.failed.length === 0 ? "fixed" : "failed",
            reason: `migrated=${sync.migratedDays}; failed=${sync.failed.length}; unmapped=${sync.unmappedUsers.length}`,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await db.execute(
            `UPDATE attendance_reconciliation_issue
                SET auto_fix_status = 'failed',
                    auto_fix_reason = ?
              WHERE issue_date BETWEEN ? AND ?
                AND resolved_at IS NULL`,
            [message.slice(0, 255), options.from, options.to],
          );
          result.autoFix = { attempted: true, status: "failed", reason: message };
        }
      }
    }

    return result;
  },

  async auditDefaultWindow(options: { autoFix?: boolean } = {}) {
    const todayIST = nowIST().split("T")[0]!;
    const [year, month, day] = todayIST.split("-").map(Number) as [number, number, number];
    const toDate = new Date(year, month - 1, day - 1);
    const fromDate = new Date(toDate);
    fromDate.setDate(toDate.getDate() - Math.max(1, env.NCOSEC_RECONCILIATION_LOOKBACK_DAYS) + 1);
    const to = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, "0")}-${String(toDate.getDate()).padStart(2, "0")}`;
    const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}-${String(fromDate.getDate()).padStart(2, "0")}`;
    return this.audit({ from, to, autoFix: options.autoFix });
  },
};
