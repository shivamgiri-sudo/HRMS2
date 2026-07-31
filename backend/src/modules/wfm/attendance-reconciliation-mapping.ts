type EmployeeRow = {
  employee_id?: string | number;
  employee_code?: string;
  biometric_code?: string;
  cosec_user_id?: string | number;
  active_status?: number | string;
  employment_status?: string;
};

export type SourceMaps = {
  byCosecId: Map<string, EmployeeRow>;
  byEmployeeCode: Map<string, EmployeeRow>;
  excludedSet: Set<string>;
  inactiveSet: Set<string>;
};

export type ClassifiedUser =
  | { kind: "excluded" }
  | { kind: "inactive"; employee: EmployeeRow }
  | { kind: "active"; employee: EmployeeRow }
  | { kind: "unmapped" };

export function buildSourceUserMaps(employeeRows: EmployeeRow[], excludedCosecIds: string[]): SourceMaps {
  const byCosecId = new Map<string, EmployeeRow>();
  const byEmployeeCode = new Map<string, EmployeeRow>();
  const inactiveSet = new Set<string>();

  for (const row of employeeRows) {
    if (row.cosec_user_id) {
      const key = String(row.cosec_user_id);
      byCosecId.set(key, row);
      const isInactive =
        row.active_status === 0 ||
        row.active_status === "0" ||
        row.employment_status === "resigned" ||
        row.employment_status === "terminated";
      if (isInactive) inactiveSet.add(key);
    }
    if (row.employee_code) {
      byEmployeeCode.set(row.employee_code, row);
    }
    if (row.biometric_code) {
      byCosecId.set(row.biometric_code, row);
    }
  }

  return {
    byCosecId,
    byEmployeeCode,
    excludedSet: new Set(excludedCosecIds.map(String)),
    inactiveSet,
  };
}

export function classifySourceUser(cosecUserId: string, maps: SourceMaps): ClassifiedUser {
  const key = String(cosecUserId);
  if (maps.excludedSet.has(key) || isThirdPartyCosecUser(key)) return { kind: "excluded" };
  const employee = maps.byCosecId.get(key);
  if (!employee) return { kind: "unmapped" };
  if (maps.inactiveSet.has(key)) return { kind: "inactive", employee };
  return { kind: "active", employee };
}

/**
 * COSEC ids belonging to a different company that shares the biometric devices.
 *
 * These people are not MAS Callnet employees and never have been, so they are
 * neither "unmapped" (which reports attendance as dropped and invites someone to
 * go and link an employee_code that should not exist) nor "inactive/resigned"
 * (which asserts an employment relationship that never existed). They are simply
 * not ours, which is what `excluded` means.
 *
 * Matched by prefix rather than by listing ids: the exclusion table already holds
 * 36 IDC entries added by hand, yet IDC60168, IDC62383 and IDC62716 still showed
 * up as unmapped in the 2026-06-18 sync — a per-id list cannot keep up with a
 * roster that is not ours to manage. Verified safe against production: zero rows
 * in employees.employee_code and zero in
 * employee_biometric_enrollment.cosec_user_id begin with IDC.
 */
const THIRD_PARTY_COSEC_PREFIXES = ["IDC"] as const;

export function isThirdPartyCosecUser(cosecUserId: string): boolean {
  const key = String(cosecUserId).trim().toUpperCase();
  return THIRD_PARTY_COSEC_PREFIXES.some((prefix) => key.startsWith(prefix));
}
