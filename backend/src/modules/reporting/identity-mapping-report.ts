export interface IdentityMappingReportQuery {
  branchId?: unknown;
  processId?: unknown;
  departmentId?: unknown;
}

export interface BuiltReportSql {
  sql: string;
  params: unknown[];
}

function trimFilter(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

export function buildIdentityMappingExceptionsSql(
  query: IdentityMappingReportQuery,
  _todayIso = new Date().toISOString().slice(0, 10),
): BuiltReportSql {
  const params: unknown[] = [];
  const employeeClauses = [
    "e.active_status = 1",
    "LOWER(COALESCE(e.employment_status,'active')) = 'active'",
  ];

  const branchId = trimFilter(query.branchId);
  if (branchId) {
    employeeClauses.push("e.branch_id = ?");
    params.push(branchId);
  }

  const processId = trimFilter(query.processId);
  if (processId) {
    employeeClauses.push("e.process_id = ?");
    params.push(processId);
  }

  const departmentId = trimFilter(query.departmentId);
  if (departmentId) {
    employeeClauses.push("e.department_id = ?");
    params.push(departmentId);
  }

  const baseSelect = `e.employee_code,
       COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
       b.branch_name,
       p.process_name,
       COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS manager_name,
       e.biometric_code,
       e.call_centre_code,
       e.updated_at`;

  const baseFrom = `FROM employees e
  LEFT JOIN branch_master b ON b.id = e.branch_id
  LEFT JOIN process_master p ON p.id = e.process_id
  LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
 WHERE ${employeeClauses.join(" AND ")}`;

  const sql = `
SELECT 'MISSING_BIOMETRIC_CODE' AS exception_type,
       'HIGH' AS severity,
       ${baseSelect},
       'HRMS employee has no biometric_code, so biometric attendance cannot be reconciled safely.' AS exception_detail,
       'Update employee biometric_code from COSEC/Masbiometric master before using biometric attendance in performance reports.' AS recommended_action
  ${baseFrom}
   AND COALESCE(e.biometric_code,'') = ''
UNION ALL
SELECT 'MISSING_CALL_CENTRE_CODE' AS exception_type,
       'HIGH' AS severity,
       ${baseSelect},
       'HRMS employee has no call_centre_code, so dialer/APR/sales activity cannot be joined safely.' AS exception_detail,
       'Map the employee to their dialer/MAS agent ID before using productivity or sales dashboards.' AS recommended_action
  ${baseFrom}
   AND COALESCE(e.call_centre_code,'') = ''
UNION ALL
SELECT 'MISSING_PROCESS_MAPPING' AS exception_type,
       'HIGH' AS severity,
       ${baseSelect},
       'HRMS employee has no process_id, so team/process/AM rollups will be incomplete.' AS exception_detail,
       'Assign process_id and verify the process-to-branch/client mapping.' AS recommended_action
  ${baseFrom}
   AND e.process_id IS NULL
UNION ALL
SELECT 'MISSING_BRANCH_MAPPING' AS exception_type,
       'HIGH' AS severity,
       ${baseSelect},
       'HRMS employee has no branch_id, so branch reports and payroll readiness rollups will be incomplete.' AS exception_detail,
       'Assign branch_id and verify payroll/operations ownership.' AS recommended_action
  ${baseFrom}
   AND e.branch_id IS NULL
UNION ALL
SELECT 'MISSING_MANAGER_MAPPING' AS exception_type,
       'MEDIUM' AS severity,
       ${baseSelect},
       'HRMS employee has no reporting manager/manager mapping, so TL/AM dashboards cannot roll this employee correctly.' AS exception_detail,
       'Assign reporting_manager_id or manager_id according to the HRMS hierarchy.' AS recommended_action
  ${baseFrom}
   AND e.reporting_manager_id IS NULL
   AND e.manager_id IS NULL`;

  return { sql, params: [...params, ...params, ...params, ...params, ...params] };
}