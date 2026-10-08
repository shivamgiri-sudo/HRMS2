// Pure resolution of "which feed decides this employee's attendance" from apr_eligibility_config
// rows. No database import, so the Attendance Rules Master can preview the engine's answer for
// a whole process or a single employee without opening a connection per employee-day.
//
// attendance-engine.service.ts resolveAttendanceLogic() runs the same rule in SQL (it must stay
// one indexed query per employee-day); the two are kept in step by the contract test in
// __tests__/attendanceLogicResolver.contract.test.ts, which pins the SQL's ORDER BY.

export type AttendanceLogic = 'apr' | 'cosec' | 'apr_validated_by_cosec';

export interface AprEligibilityRow {
  id: string;
  rule_name: string | null;
  designation_id: string | null;
  department_id: string | null;
  process_id: string | null;
  attendance_logic: AttendanceLogic;
  active_status: number;
  updated_at?: string | null;
  created_by?: string | null;
}

export interface LogicScope {
  designationId: string | null;
  departmentId: string | null;
  processId: string | null;
}

export interface LogicResolution {
  logic: AttendanceLogic;
  /** The apr_eligibility_config row that decided it, or null when nothing matched / regex fallback. */
  row: AprEligibilityRow | null;
  via: 'row' | 'no_matching_row' | 'regex_fallback';
}

/** Legacy fallback — used only while apr_eligibility_config has no active rows at all. */
export function isOperationsExecutiveByRegex(departmentName: string, designationName: string): boolean {
  const department = departmentName.trim().toLowerCase();
  const designation = designationName.trim().toLowerCase();
  return (department === 'operations' || department === 'operation')
    && /^executive(?:\s*-\s*.+)?$/.test(designation);
}

/** process 4 + department 2 + designation 1 — the weights the engine's SQL ORDER BY uses. */
export function rowSpecificity(row: AprEligibilityRow): number {
  return (row.process_id ? 4 : 0) + (row.department_id ? 2 : 0) + (row.designation_id ? 1 : 0);
}

function matches(row: AprEligibilityRow, scope: LogicScope): boolean {
  return Number(row.active_status) === 1
    && (row.designation_id === null || row.designation_id === scope.designationId)
    && (row.department_id === null || row.department_id === scope.departmentId)
    && (row.process_id === null || row.process_id === scope.processId);
}

/**
 * Most specific matching active row wins. At equal specificity a non-COSEC row beats a COSEC one
 * (COSEC rows were historically excluded from matching, so this keeps every pre-existing
 * decision unchanged), then id breaks any remaining tie so the answer is deterministic.
 */
export function pickAprRow(rows: AprEligibilityRow[], scope: LogicScope): AprEligibilityRow | null {
  const candidates = rows.filter((r) => matches(r, scope));
  candidates.sort((a, b) =>
    rowSpecificity(b) - rowSpecificity(a)
    || Number(a.attendance_logic === 'cosec') - Number(b.attendance_logic === 'cosec')
    || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

export function resolveAttendanceLogicFromRows(
  rows: AprEligibilityRow[],
  scope: LogicScope,
  names: { departmentName: string; designationName: string },
): LogicResolution {
  const anyActive = rows.some((r) => Number(r.active_status) === 1);
  if (!anyActive) {
    return {
      logic: isOperationsExecutiveByRegex(names.departmentName, names.designationName) ? 'apr' : 'cosec',
      row: null,
      via: 'regex_fallback',
    };
  }
  const row = pickAprRow(rows, scope);
  if (!row) return { logic: 'cosec', row: null, via: 'no_matching_row' };
  return { logic: row.attendance_logic, row, via: 'row' };
}
