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
  | { kind: "unknown" };

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
  if (maps.excludedSet.has(key)) return { kind: "excluded" };
  const employee = maps.byCosecId.get(key);
  if (!employee) return { kind: "unknown" };
  if (maps.inactiveSet.has(key)) return { kind: "inactive", employee };
  return { kind: "active", employee };
}
