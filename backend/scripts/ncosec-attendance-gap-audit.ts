import "dotenv/config";
import sql from "mssql";

type Args = {
  from: string;
  to: string;
  apply: boolean;
  ncosecHost?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--from") out.from = argv[++i];
    else if (arg === "--to") out.to = argv[++i];
    else if (arg === "--ncosec-host") out.ncosecHost = argv[++i];
  }
  if (!out.from || !out.to) {
    throw new Error("Usage: npm run ncosec:audit -- --from YYYY-MM-DD --to YYYY-MM-DD [--apply] [--ncosec-host HOST]");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.from) || !/^\d{4}-\d{2}-\d{2}$/.test(out.to)) {
    throw new Error("--from and --to must be YYYY-MM-DD");
  }
  return out as Args;
}

function dateKey(value: unknown): string {
  return String(value).slice(0, 10);
}

function sourceUserCandidates(row: any): string[] {
  return [row.cosec_user_id, row.biometric_code, row.employee_code]
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
    .map((value) => String(value).trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.ncosecHost) process.env.NCOSEC_DB_HOST = args.ncosecHost;

  const { env } = await import("../src/config/env.js");
  if (args.ncosecHost) {
    process.env.NCOSEC_DB_HOST = args.ncosecHost;
    (env as any).NCOSEC_DB_HOST = args.ncosecHost;
  }

  const { db, closePool } = await import("../src/db/mysql.js");
  const { getNcosecPool, closeNcosecPool } = await import("../src/db/ncosecDb.js");
  const { cosecSyncService } = await import("../src/modules/wfm/cosec-sync.service.js");

  try {
    const pool = await getNcosecPool();
    const request = pool.request();
    request.input("fromDate", sql.Date, args.from);
    request.input("toDate", sql.Date, args.to);
    const source = await request.query(`
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

    const sourceGroups = source.recordset.map((row: any) => ({
      ...row,
      cosec_user_id: String(row.cosec_user_id),
      punch_date: dateKey(row.punch_date),
      total_punches: Number(row.total_punches ?? 0),
      working_minutes: Number(row.working_minutes ?? 0),
    }));

    const [employeeRows] = await db.query<any[]>(
      `SELECT e.id AS employee_id, e.employee_code, e.biometric_code, ebe.cosec_user_id
         FROM employees e
         LEFT JOIN employee_biometric_enrollment ebe
           ON ebe.employee_id = e.id AND ebe.is_active = 1
        WHERE e.active_status = 1`,
    );
    const employeeBySourceUser = new Map<string, any>();
    for (const row of employeeRows) {
      for (const candidate of sourceUserCandidates(row)) {
        if (!employeeBySourceUser.has(candidate)) employeeBySourceUser.set(candidate, row);
      }
    }

    const [ibdRows] = await db.query<any[]>(
      `SELECT employee_code, DATE_FORMAT(activity_date, '%Y-%m-%d') AS record_date,
              biometric_minutes, total_punches
         FROM integration_biometric_daily
        WHERE activity_date BETWEEN ? AND ?`,
      [args.from, args.to],
    );
    const ibdByEmployeeDate = new Map<string, any>();
    for (const row of ibdRows) ibdByEmployeeDate.set(`${row.employee_code}__${row.record_date}`, row);

    const [adrRows] = await db.query<any[]>(
      `SELECT employee_id, DATE_FORMAT(record_date, '%Y-%m-%d') AS record_date,
              attendance_status, biometric_minutes, is_locked, mismatch_flag
         FROM attendance_daily_record
        WHERE record_date BETWEEN ? AND ?`,
      [args.from, args.to],
    );
    const adrByEmployeeDate = new Map<string, any>();
    for (const row of adrRows) adrByEmployeeDate.set(`${row.employee_id}__${row.record_date}`, row);

    const usableSource = sourceGroups.filter((row) => row.total_punches > 1 && row.working_minutes > 2);
    const unmapped = usableSource.filter((row) => !employeeBySourceUser.has(row.cosec_user_id));
    const missingIbd: any[] = [];
    const zeroMinuteRows: any[] = [];
    const missingPunchWithUsableSource: any[] = [];

    for (const row of usableSource) {
      const employee = employeeBySourceUser.get(row.cosec_user_id);
      if (!employee) continue;
      const ibd = ibdByEmployeeDate.get(`${employee.employee_code}__${row.punch_date}`);
      const adr = adrByEmployeeDate.get(`${employee.employee_id}__${row.punch_date}`);
      if (!ibd) missingIbd.push({ employee_code: employee.employee_code, cosec_user_id: row.cosec_user_id, punch_date: row.punch_date, source_minutes: row.working_minutes });
      if ((Number(ibd?.biometric_minutes ?? 0) === 0 || Number(adr?.biometric_minutes ?? 0) === 0) && row.working_minutes > 2) {
        zeroMinuteRows.push({ employee_code: employee.employee_code, cosec_user_id: row.cosec_user_id, punch_date: row.punch_date, source_minutes: row.working_minutes, ibd_minutes: ibd?.biometric_minutes ?? null, adr_minutes: adr?.biometric_minutes ?? null, adr_status: adr?.attendance_status ?? null });
      }
      if (adr?.attendance_status === "missing_punch" && row.working_minutes > 2) {
        missingPunchWithUsableSource.push({ employee_code: employee.employee_code, cosec_user_id: row.cosec_user_id, punch_date: row.punch_date, source_minutes: row.working_minutes, adr_minutes: adr.biometric_minutes });
      }
    }

    const [gapRows] = await db.query<any[]>(
      `SELECT DATE_FORMAT(cal.record_date, '%Y-%m-%d') AS record_date, COUNT(*) AS missing_adr
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
        )
        GROUP BY cal.record_date
        ORDER BY cal.record_date`,
      [args.from, args.to, args.from, args.from, args.to],
    );

    console.table([
      { metric: "source_grouped_days", count: sourceGroups.length },
      { metric: "usable_source_grouped_days", count: usableSource.length },
      { metric: "unmapped_usable_source_days", count: unmapped.length },
      { metric: "missing_ibd_days", count: missingIbd.length },
      { metric: "zero_minute_ibd_or_adr_days", count: zeroMinuteRows.length },
      { metric: "missing_punch_with_usable_source_days", count: missingPunchWithUsableSource.length },
    ]);
    console.log("ADR missing dates by day:");
    console.table(gapRows);
    console.log("Samples:");
    console.dir({
      unmapped: unmapped.slice(0, 10),
      missingIbd: missingIbd.slice(0, 10),
      zeroMinuteRows: zeroMinuteRows.slice(0, 10),
      missingPunchWithUsableSource: missingPunchWithUsableSource.slice(0, 10),
    }, { depth: null });

    if (args.apply) {
      console.log(`Applying COSEC reprocess for ${args.from} to ${args.to} through cosecSyncService.sync`);
      const result = await cosecSyncService.sync({ from: args.from, to: args.to });
      console.dir(result, { depth: null });
    } else {
      console.log("Dry-run only. Re-run with --apply to reprocess this date range.");
    }
  } finally {
    const [{ closePool }, { closeNcosecPool }] = await Promise.all([
      import("../src/db/mysql.js"),
      import("../src/db/ncosecDb.js"),
    ]);
    await Promise.allSettled([closePool(), closeNcosecPool()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
