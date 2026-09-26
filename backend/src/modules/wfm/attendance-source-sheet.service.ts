// backend/src/modules/wfm/attendance-source-sheet.service.ts
// "Attendance Source Sheet" — one row per employee for a month, and for every day the payroll
// status next to BOTH durations: COSEC (biometric_minutes) and APR (dialler_minutes). The
// duration that actually drove the day's status — attendance_daily_record.attendance_source —
// is flagged as the payroll source so a reader can see which of the two was used and how far
// the other one disagrees. Read-only; nothing here writes attendance.

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type PayrollSource = "apr" | "cosec";

export interface SheetDay {
  /** Short status code shown in the cell: P, HD, A, L, H, WO, WOW, MP, UR. */
  code: string;
  status: string;
  cosecMinutes: number | null;
  aprMinutes: number | null;
  /** Which duration decided the status (attendance_daily_record.attendance_source). */
  payrollSource: PayrollSource | null;
}

export interface SheetEmployee {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branch: string | null;
  costCentre: string | null;
  process: string | null;
  lob: string | null;
  /** APR, COSEC, or "APR + COSEC" when the month mixes both. */
  attendanceSource: string;
  /** Keyed by YYYY-MM-DD; a day with no attendance row is simply absent. */
  days: Record<string, SheetDay>;
}

export interface SheetFilters {
  month: string; // YYYY-MM
  branchId?: string;
  processId?: string;
  costCentreId?: string;
  search?: string;
}

export interface ScopeSql {
  sql: string;
  params: unknown[];
}

export const STATUS_CODES: Readonly<Record<string, string>> = {
  present: "P",
  half_day: "HD",
  absent: "A",
  leave_approved: "L",
  holiday: "H",
  week_off: "WO",
  week_off_worked: "WOW",
  missing_punch: "MP",
  unreconciled: "UR",
};

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonth(
  value: unknown,
): { from: string; to: string; days: string[] } | null {
  const m = typeof value === "string" ? MONTH_RE.exec(value) : null;
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = Array.from(
    { length: lastDay },
    (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`,
  );
  return { from: days[0], to: days[lastDay - 1], days };
}

/** 540 -> "9:00 Hrs". null (no reading) -> "-". */
export function formatHours(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "-";
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} Hrs`;
}

export function statusCode(status: string): string {
  return STATUS_CODES[status] ?? status.slice(0, 3).toUpperCase();
}

/** The employee-level label: which source(s) produced the month's attendance rows. */
export function summariseSource(days: Iterable<SheetDay>): string {
  let apr = 0;
  let cosec = 0;
  for (const d of days) {
    if (d.payrollSource === "apr") apr += 1;
    else if (d.payrollSource === "cosec") cosec += 1;
  }
  if (apr > 0 && cosec > 0) return "APR + COSEC";
  if (apr > 0) return "APR";
  if (cosec > 0) return "COSEC";
  return "-";
}

function toMinutes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toSheetDay(row: RowDataPacket): SheetDay {
  const status = String(row.attendance_status ?? "");
  const source = String(row.attendance_source ?? "");
  return {
    code: statusCode(status),
    status,
    cosecMinutes: toMinutes(row.biometric_minutes),
    aprMinutes: toMinutes(row.dialler_minutes),
    payrollSource:
      source === "dialler" ? "apr" : source === "biometric" ? "cosec" : null,
  };
}

interface EmployeeWhere {
  sql: string;
  params: unknown[];
}

// Employees who have at least one attendance row in the month (so leavers stay visible), within
// the caller's scope and the optional filters. EXISTS keeps the date bounds sargable.
function employeeWhere(
  f: SheetFilters,
  range: { from: string; to: string },
  scope: ScopeSql,
): EmployeeWhere {
  const where: string[] = [
    `(${scope.sql})`,
    `EXISTS (SELECT 1 FROM attendance_daily_record a
              WHERE a.employee_id = e.id AND a.record_date >= ? AND a.record_date <= ?)`,
  ];
  const params: unknown[] = [...scope.params, range.from, range.to];
  if (f.branchId) {
    where.push("e.branch_id = ?");
    params.push(f.branchId);
  }
  if (f.processId) {
    where.push("e.process_id = ?");
    params.push(f.processId);
  }
  if (f.costCentreId) {
    where.push("e.cost_centre_id = ?");
    params.push(f.costCentreId);
  }
  if (f.search) {
    where.push("(e.employee_code LIKE ? OR e.full_name LIKE ?)");
    const like = `%${f.search.replace(/[%_\\]/g, "\\$&")}%`;
    params.push(like, like);
  }
  return { sql: where.join(" AND "), params };
}

const EMPLOYEE_FROM = `
  FROM employees e
  LEFT JOIN branch_master bm ON bm.id = e.branch_id
  LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
  LEFT JOIN process_master pm ON pm.id = e.process_id
  LEFT JOIN lob_master lm ON lm.id = e.lob_id`;

export async function countSheetEmployees(
  f: SheetFilters,
  scope: ScopeSql,
): Promise<number> {
  const range = parseMonth(f.month);
  if (!range) throw new Error("Invalid month");
  const w = employeeWhere(f, range, scope);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total ${EMPLOYEE_FROM} WHERE ${w.sql}`,
    w.params as any[],
  );
  return Number((rows as RowDataPacket[])[0]?.total ?? 0);
}

export async function fetchSheet(
  f: SheetFilters,
  scope: ScopeSql,
  page: { limit: number; offset: number },
): Promise<SheetEmployee[]> {
  const range = parseMonth(f.month);
  if (!range) throw new Error("Invalid month");
  const w = employeeWhere(f, range, scope);
  // LIMIT/OFFSET are validated integers from the route, inlined because mysql2's prepared
  // execute() rejects them as bound parameters on some server versions.
  const limit = Math.trunc(page.limit);
  const offset = Math.trunc(page.offset);
  const [emps] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name,
            bm.branch_name, ccm.cost_centre_code, pm.process_name, lm.lob_name
       ${EMPLOYEE_FROM}
      WHERE ${w.sql}
      ORDER BY e.employee_code
      LIMIT ${limit} OFFSET ${offset}`,
    w.params as any[],
  );
  const employees = emps as RowDataPacket[];
  if (employees.length === 0) return [];

  const ids = employees.map((e) => String(e.id));
  const [records] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, DATE_FORMAT(record_date, '%Y-%m-%d') AS d,
            attendance_status, attendance_source, dialler_minutes, biometric_minutes
       FROM attendance_daily_record
      WHERE employee_id IN (${ids.map(() => "?").join(",")})
        AND record_date >= ? AND record_date <= ?`,
    [...ids, range.from, range.to],
  );

  const byEmployee = new Map<string, Record<string, SheetDay>>();
  for (const r of records as RowDataPacket[]) {
    const key = String(r.employee_id);
    const days = byEmployee.get(key) ?? {};
    days[String(r.d)] = toSheetDay(r);
    byEmployee.set(key, days);
  }

  return employees.map((e) => {
    const days = byEmployee.get(String(e.id)) ?? {};
    return {
      employeeId: String(e.id),
      employeeCode: String(e.employee_code ?? ""),
      employeeName: String(e.full_name ?? ""),
      branch: e.branch_name ?? null,
      costCentre: e.cost_centre_code ?? null,
      process: e.process_name ?? null,
      lob: e.lob_name ?? null,
      attendanceSource: summariseSource(Object.values(days)),
      days,
    };
  });
}
