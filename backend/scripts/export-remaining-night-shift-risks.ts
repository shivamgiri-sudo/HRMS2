import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";

type Args = {
  from: string;
  to: string;
  outDir: string;
};

type QueueRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  designation_name: string | null;
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
  action_bucket: "APR_SAFE_REPAIR" | "BIOMETRIC_MISSING_PUNCH_REVIEW" | "MANUAL_REVIEW";
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { outDir: "logs" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") out.from = argv[++i];
    else if (arg === "--to") out.to = argv[++i];
    else if (arg === "--out-dir") out.outDir = argv[++i];
  }
  if (!out.from || !out.to) {
    throw new Error("Usage: npm run night-shift:export-remaining -- --from YYYY-MM-DD --to YYYY-MM-DD [--out-dir logs]");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.from) || !/^\d{4}-\d{2}-\d{2}$/.test(out.to)) {
    throw new Error("--from and --to must be YYYY-MM-DD");
  }
  return out as Args;
}

function classifyAprMinutes(minutes: number): "present" | "half_day" | "absent" {
  if (minutes >= 480) return "present";
  if (minutes >= 240) return "half_day";
  return "absent";
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { db, closePool } = await import("../src/db/mysql.js");
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
          e.id AS employee_id,
          e.employee_code,
          TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name,
          LOWER(COALESCE(dept.dept_name, '')) AS department_name,
          LOWER(COALESCE(desig.designation_name, '')) AS designation_name,
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
         AND apr1.apr_minutes >= 60
         AND COALESCE(apr2.apr_minutes, 0) >= 60
         AND apr1.apr_minutes + COALESCE(apr2.apr_minutes, 0) >= 240
       ORDER BY apr1.report_date, e.employee_code`,
      [args.from, args.to, args.from, args.to, args.from, args.to],
    );

    const queue: QueueRow[] = (rows as any[])
      .map((row) => {
        const aprCombinedMinutes = Number(row.apr_combined_minutes ?? 0);
        const inferredExpectedStatus = classifyAprMinutes(aprCombinedMinutes);
        const departmentName = row.department_name ? String(row.department_name) : null;
        const designationName = row.designation_name ? String(row.designation_name) : null;
        const adrStatus = row.adr_status ? String(row.adr_status) : null;
        const adrSource = row.adr_source ? String(row.adr_source) : null;
        const inferredAuthority =
          adrSource === "dialler"
            ? "apr"
            : /operations?/.test(String(departmentName ?? "")) &&
                /^executive(?:\s*-\s*.+)?$/.test(String(designationName ?? ""))
              ? "apr"
              : "biometric";

        let actionBucket: QueueRow["action_bucket"] | null = null;
        if (adrSource === "dialler" && adrStatus !== "missing_punch") {
          actionBucket = null;
        } else if (inferredAuthority === "apr") {
          if (adrStatus !== null && !["leave_approved", "holiday", "week_off", "week_off_worked"].includes(adrStatus)) {
            if (inferredExpectedStatus === "present" && (adrStatus === "half_day" || adrStatus === "absent" || adrStatus === "missing_punch")) {
              actionBucket = "APR_SAFE_REPAIR";
            } else if (inferredExpectedStatus === "half_day" && (adrStatus === "absent" || adrStatus === "missing_punch")) {
              actionBucket = "APR_SAFE_REPAIR";
            } else if (adrStatus !== inferredExpectedStatus) {
              actionBucket = "MANUAL_REVIEW";
            }
          }
        } else if (inferredAuthority === "biometric") {
          if (adrStatus === "missing_punch" && adrSource === "biometric") {
            actionBucket = "BIOMETRIC_MISSING_PUNCH_REVIEW";
          } else if (adrStatus !== null && adrStatus !== inferredExpectedStatus) {
            actionBucket = "MANUAL_REVIEW";
          }
        }

        return {
          employee_id: String(row.employee_id),
          employee_code: String(row.employee_code),
          employee_name: String(row.employee_name ?? "").trim(),
          department_name: departmentName,
          designation_name: designationName,
          start_date: String(row.start_date),
          next_date: String(row.next_date),
          apr_combined_minutes: aprCombinedMinutes,
          adr_status: adrStatus,
          adr_source: adrSource,
          adr_raw_minutes: row.adr_raw_minutes === null ? null : Number(row.adr_raw_minutes),
          is_locked: row.is_locked === null ? null : Number(row.is_locked),
          regularization_id: row.regularization_id ? String(row.regularization_id) : null,
          override_by: row.override_by ? String(row.override_by) : null,
          branch_id: row.branch_id ? String(row.branch_id) : null,
          process_id: row.process_id ? String(row.process_id) : null,
          inferred_expected_status: inferredExpectedStatus,
          action_bucket: actionBucket ?? "MANUAL_REVIEW",
        } satisfies QueueRow;
      })
      .filter((row) => {
        if (row.action_bucket === "APR_SAFE_REPAIR") return true;
        if (row.action_bucket === "BIOMETRIC_MISSING_PUNCH_REVIEW") return true;
        return row.adr_status !== null && row.adr_status !== row.inferred_expected_status;
      });

    const outDir = path.resolve(process.cwd(), args.outDir);
    await mkdir(outDir, { recursive: true });
    const stamp = `${args.from}_to_${args.to}`;
    const jsonPath = path.join(outDir, `night_shift_remaining_queue_${stamp}.json`);
    const csvPath = path.join(outDir, `night_shift_remaining_queue_${stamp}.csv`);

    const summary = {
      from: args.from,
      to: args.to,
      total: queue.length,
      counts: queue.reduce<Record<string, number>>((acc, row) => {
        acc[row.action_bucket] = (acc[row.action_bucket] ?? 0) + 1;
        return acc;
      }, {}),
      rows: queue,
    };

    await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");

    const headers = [
      "action_bucket",
      "employee_code",
      "employee_name",
      "start_date",
      "next_date",
      "apr_combined_minutes",
      "adr_status",
      "adr_source",
      "adr_raw_minutes",
      "department_name",
      "designation_name",
      "is_locked",
      "regularization_id",
      "override_by",
      "employee_id",
      "branch_id",
      "process_id",
      "inferred_expected_status",
    ];
    const csvLines = [
      headers.join(","),
      ...queue.map((row) => headers.map((header) => csvEscape((row as any)[header])).join(",")),
    ];
    await writeFile(csvPath, csvLines.join("\n"), "utf8");

    console.table([
      { metric: "remaining_rows", count: queue.length },
      { metric: "apr_safe_repair", count: summary.counts.APR_SAFE_REPAIR ?? 0 },
      { metric: "biometric_missing_punch_review", count: summary.counts.BIOMETRIC_MISSING_PUNCH_REVIEW ?? 0 },
      { metric: "manual_review", count: summary.counts.MANUAL_REVIEW ?? 0 },
    ]);
    console.log(`JSON saved: ${jsonPath}`);
    console.log(`CSV saved: ${csvPath}`);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
