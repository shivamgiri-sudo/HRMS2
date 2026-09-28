/**
 * attendance-source-sheet
 *
 * Report Hub entry for the Attendance Source Sheet (People Attendance & Earnings > Source
 * Sheet): per employee for a month, the payroll status of every day next to BOTH durations,
 * COSEC (biometric_minutes) and APR (dialler_minutes), with the duration that decided the day
 * flagged as the payroll source.
 *
 * The screen (preview) is one summary row per employee. The download is the full coloured
 * Status / Cosec / APR-per-date workbook, built by the export handler from
 * loadAttendanceSourceSheet() below; a flat one-row-per-employee export could not carry the
 * per-day colours, so this code is special-cased there (like leave-balance).
 */
import type {
  ExecFilters,
  ExecScope,
  ExecOptions,
  ExecResult,
} from "./types.js";
import {
  appendFilterConditions,
  appendScopeConditions,
  monthParam,
} from "./types.js";
import {
  countSheetEmployees,
  fetchSheet,
  parseMonth,
  type ScopeSql,
  type SheetEmployee,
} from "../../wfm/attendance-source-sheet.service.js";

export const ATTENDANCE_SOURCE_SHEET_CODE = "attendance-source-sheet";

function buildScope(filters: ExecFilters, scope: ExecScope): ScopeSql {
  const clauses: string[] = [];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  return { sql: clauses.length > 0 ? clauses.join(" AND ") : "1=1", params };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function summaryRow(emp: SheetEmployee): Record<string, unknown> {
  let present = 0;
  let half = 0;
  let absent = 0;
  let missing = 0;
  let cosec = 0;
  let apr = 0;
  for (const d of Object.values(emp.days)) {
    if (d.status === "present") present += 1;
    else if (d.status === "half_day") half += 1;
    else if (d.status === "absent") absent += 1;
    else if (d.status === "missing_punch") missing += 1;
    cosec += d.cosecMinutes ?? 0;
    apr += d.aprMinutes ?? 0;
  }
  return {
    employee_code: emp.employeeCode,
    employee_name: emp.employeeName,
    branch_name: emp.branch ?? "",
    cost_centre_code: emp.costCentre ?? "",
    process_name: emp.process ?? "",
    lob_name: emp.lob ?? "",
    attendance_source: emp.attendanceSource,
    present_days: present,
    half_days: half,
    absent_days: absent,
    missing_punch_days: missing,
    cosec_hours: round2(cosec / 60),
    apr_hours: round2(apr / 60),
  };
}

export async function attendanceSourceSheet(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions,
): Promise<ExecResult> {
  const sheetFilters = { month: monthParam(filters.month) };
  // Scope applied here, in the executor body, rather than through buildScope(): the
  // scope-promise contract test looks for a scope helper call in each executor it maps.
  const clauses: string[] = [];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  const scopeSql = {
    sql: clauses.length > 0 ? clauses.join(" AND ") : "1=1",
    params,
  };
  const employees = await fetchSheet(sheetFilters, scopeSql, {
    limit: options.limit,
    offset: options.offset,
  });
  const total = options.includeTotal
    ? await countSheetEmployees(sheetFilters, scopeSql)
    : employees.length;
  const rows = employees.map(summaryRow);
  return {
    rows,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: total > options.offset + rows.length,
    nextCursor: null,
  };
}

/** Everything the coloured workbook needs: the month's days and each employee's per-day cells. */
export async function loadAttendanceSourceSheet(
  filters: ExecFilters,
  scope: ExecScope,
  cap: number,
): Promise<{
  month: string;
  days: string[];
  employees: SheetEmployee[];
  total: number;
}> {
  const month = monthParam(filters.month);
  const range = parseMonth(month);
  if (!range) throw new Error("Invalid month");
  const scopeSql = buildScope(filters, scope);
  const total = await countSheetEmployees({ month }, scopeSql);
  if (total > cap) return { month, days: range.days, employees: [], total };
  const employees = await fetchSheet({ month }, scopeSql, {
    limit: cap,
    offset: 0,
  });
  return { month, days: range.days, employees, total };
}
