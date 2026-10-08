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

/**
 * employees.employment_status is stored in MIXED CASE. Measured on mas_hrms 2026-08-11:
 * 'Resigned' 28,200 vs 'resigned' 2,118, and 'Active' 273 vs 'active' 1,039.
 *
 * MySQL's collation is case-insensitive, so SQL filters on this column behave. A
 * JavaScript === does not, and this function is the JS side. Comparing
 * `employment_status === "resigned"` therefore misses 28,200 rows outright.
 *
 * Today that is harmless only by accident: every capitalised 'Resigned' row also carries
 * active_status = 0, which the preceding condition catches, so the measured blast radius
 * is 0 rows. It stops being harmless the moment one resigned employee is written with a
 * non-zero active_status — they would then be classified "active" and have attendance,
 * and therefore pay, generated from their badge still opening the door. 122 ex-employees
 * were still registering punches on 2026-08-11.
 *
 * Normalise rather than enumerate casings, so a third spelling cannot reopen this.
 */
// Deliberately only the two statuses the original compared. 'inactive' (26,680 rows)
// is NOT included: adding it would be a semantic change to who counts as inactive, not a
// casing fix, and it belongs in its own reviewed change even though its measured blast
// radius today is also 0.
const INACTIVE_EMPLOYMENT_STATUSES = new Set(["resigned", "terminated"]);

function isInactiveEmploymentStatus(status?: string): boolean {
  return INACTIVE_EMPLOYMENT_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

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
        isInactiveEmploymentStatus(row.employment_status);
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
