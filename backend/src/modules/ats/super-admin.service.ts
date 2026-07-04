import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';

/**
 * Super Admin Service
 * Manages module access control for employees
 */

export interface ModuleAccess {
  id: string;
  module_name: string;
  employee_code: string;
  employee_name: string;
  has_access: boolean;
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  remarks: string | null;
}

export interface EmployeeWithAccess {
  employee_code: string;
  employee_name: string;
  designation: string;
  branch: string;
  modules: string[];
  total_access: number;
}

export interface Module {
  module_name: string;
  display_name: string;
  description: string;
  total_users: number;
}

interface ModuleCountRow extends RowDataPacket {
  module_name: string;
  total_users: number;
}

interface EmployeeAccessRow extends RowDataPacket {
  employee_code: string;
  employee_name: string;
  designation: string;
  branch: string;
  modules: string | null;
  total_access: number;
}

interface EmployeeModuleRow extends RowDataPacket {
  module_name: string;
}

interface SearchEmployeeRow extends RowDataPacket {
  employee_code: string;
  employee_name: string;
  designation: string;
  branch: string;
  mobile: string | null;
  email: string | null;
}

/**
 * Get all available modules
 */
export async function getAvailableModules(): Promise<Module[]> {
  const modules = [
    {
      module_name: 'ATS_DASHBOARD',
      display_name: 'ATS Dashboard',
      description: 'Main ATS dashboard and analytics',
    },
    {
      module_name: 'ATS_RECRUITER_PORTAL',
      display_name: 'Recruiter Portal',
      description: 'Interview submission and candidate management',
    },
    {
      module_name: 'ATS_PAYROLL_HR',
      display_name: 'Payroll HR Validation',
      description: 'Salary validation and approval',
    },
    {
      module_name: 'ATS_BRANCH_HEAD_APPROVAL',
      display_name: 'Branch Head Approval',
      description: 'Final salary approval and employee code generation',
    },
    {
      module_name: 'ATS_WALKIN_QUEUE',
      display_name: 'Walk-in Queue',
      description: 'Queue management and token system',
    },
    {
      module_name: 'ATS_BGV',
      display_name: 'BGV Verification',
      description: 'Background verification center',
    },
    {
      module_name: 'ATS_COMMAND_CENTRE',
      display_name: 'Command Centre',
      description: 'ATS metrics and analytics dashboard',
    },
    {
      module_name: 'COMMAND_CENTRE',
      display_name: 'Main Command Centre',
      description: 'Overall HRMS analytics',
    },
    {
      module_name: 'LMS_ADMIN',
      display_name: 'LMS Admin',
      description: 'Learning Management System administration',
    },
    {
      module_name: 'LMS_COORDINATOR',
      display_name: 'LMS Coordinator',
      description: 'Course coordination and management',
    },
    {
      module_name: 'WFM_ROSTER',
      display_name: 'WFM Roster',
      description: 'Workforce roster management',
    },
    {
      module_name: 'ACCESS_CONTROL',
      display_name: 'Access Control',
      description: 'User access and permission management',
    },
  ];

  // Get user counts for each module
  const [counts] = await db.execute<RowDataPacket[]>(
    `SELECT module_name, COUNT(*) as total_users
     FROM module_access_control
     WHERE has_access = TRUE AND revoked_at IS NULL
     GROUP BY module_name`
  );

  const countMap = new Map((counts as ModuleCountRow[]).map((c) => [c.module_name, c.total_users]));

  return modules.map((m) => ({
    ...m,
    total_users: countMap.get(m.module_name) || 0,
  }));
}

/**
 * Get module access list
 */
export async function getModuleAccessList(moduleName?: string): Promise<ModuleAccess[]> {
  let query = `
    SELECT
      mac.id,
      mac.module_name,
      mac.employee_code,
      CONCAT(e.first_name, ' ', e.last_name) as employee_name,
      mac.has_access,
      mac.granted_by,
      mac.granted_at,
      mac.revoked_at,
      mac.remarks
    FROM module_access_control mac
    LEFT JOIN employees e ON e.employee_code = mac.employee_code
  `;

  const params: Array<string | null> = [];

  if (moduleName) {
    query += ' WHERE mac.module_name = ?';
    params.push(moduleName);
  }

  query += ' ORDER BY mac.granted_at DESC';

  const [access] = await db.execute<RowDataPacket[]>(query, params);

  return access as ModuleAccess[];
}

/**
 * Get employees with their module access
 */
export async function getEmployeesWithAccess(): Promise<EmployeeWithAccess[]> {
  const [employees] = await db.execute<RowDataPacket[]>(
    `SELECT
      e.employee_code,
      CONCAT(e.first_name, ' ', e.last_name) as employee_name,
      e.designation,
      e.branch_name as branch,
      GROUP_CONCAT(DISTINCT mac.module_name ORDER BY mac.module_name SEPARATOR ',') as modules,
      COUNT(DISTINCT mac.module_name) as total_access
    FROM employees e
    LEFT JOIN module_access_control mac ON mac.employee_code = e.employee_code
      AND mac.has_access = TRUE AND mac.revoked_at IS NULL
    WHERE e.status = 'Active'
    GROUP BY e.employee_code, e.first_name, e.last_name, e.designation, e.branch_name
    HAVING total_access > 0
    ORDER BY total_access DESC, employee_name ASC`
  );

  return (employees as EmployeeAccessRow[]).map((e) => ({
    employee_code: e.employee_code,
    employee_name: e.employee_name,
    designation: e.designation,
    branch: e.branch,
    modules: e.modules ? e.modules.split(',') : [],
    total_access: e.total_access,
  }));
}

/**
 * Grant module access
 */
export async function grantModuleAccess(
  moduleName: string,
  employeeCode: string,
  grantedBy: string,
  remarks?: string
): Promise<void> {
  await db.execute(
    `INSERT INTO module_access_control
      (module_name, employee_code, has_access, granted_by, granted_at, remarks)
    VALUES (?, ?, TRUE, ?, NOW(), ?)
    ON DUPLICATE KEY UPDATE
      has_access = TRUE,
      granted_by = VALUES(granted_by),
      granted_at = NOW(),
      revoked_at = NULL,
      remarks = VALUES(remarks)`,
    [moduleName, employeeCode, grantedBy, remarks || null]
  );
}

/**
 * Revoke module access
 */
export async function revokeModuleAccess(
  moduleName: string,
  employeeCode: string
): Promise<void> {
  await db.execute(
    `UPDATE module_access_control
    SET has_access = FALSE, revoked_at = NOW()
    WHERE module_name = ? AND employee_code = ?`,
    [moduleName, employeeCode]
  );
}

/**
 * Bulk grant access to multiple employees
 */
export async function bulkGrantAccess(
  moduleName: string,
  employeeCodes: string[],
  grantedBy: string,
  remarks?: string
): Promise<{ granted: number }> {
  let granted = 0;

  for (const employeeCode of employeeCodes) {
    try {
      await grantModuleAccess(moduleName, employeeCode, grantedBy, remarks);
      granted++;
    } catch (error) {
      console.error(`Failed to grant access to ${employeeCode}:`, error);
    }
  }

  return { granted };
}

/**
 * Bulk revoke access from multiple employees
 */
export async function bulkRevokeAccess(
  moduleName: string,
  employeeCodes: string[]
): Promise<{ revoked: number }> {
  let revoked = 0;

  for (const employeeCode of employeeCodes) {
    try {
      await revokeModuleAccess(moduleName, employeeCode);
      revoked++;
    } catch (error) {
      console.error(`Failed to revoke access from ${employeeCode}:`, error);
    }
  }

  return { revoked };
}

/**
 * Check if employee has access to a module
 */
export async function hasModuleAccess(
  employeeCode: string,
  moduleName: string
): Promise<boolean> {
  const [result] = await db.execute<RowDataPacket[]>(
    `SELECT has_access
     FROM module_access_control
     WHERE employee_code = ? AND module_name = ?
       AND has_access = TRUE AND revoked_at IS NULL
     LIMIT 1`,
    [employeeCode, moduleName]
  );

  return result.length > 0;
}

/**
 * Get employee's accessible modules
 */
export async function getEmployeeModules(employeeCode: string): Promise<string[]> {
  const [modules] = await db.execute<RowDataPacket[]>(
    `SELECT module_name
     FROM module_access_control
     WHERE employee_code = ? AND has_access = TRUE AND revoked_at IS NULL
     ORDER BY module_name`,
    [employeeCode]
  );

  return (modules as EmployeeModuleRow[]).map((m) => m.module_name);
}

/**
 * Search employees by name or code
 */
export async function searchEmployees(query: string): Promise<SearchEmployeeRow[]> {
  const [employees] = await db.execute<RowDataPacket[]>(
    `SELECT
      employee_code,
      CONCAT(first_name, ' ', last_name) as employee_name,
      designation,
      branch_name as branch,
      mobile_number as mobile,
      email
    FROM employees
    WHERE status = 'Active'
      AND (
        employee_code LIKE ?
        OR first_name LIKE ?
        OR last_name LIKE ?
        OR CONCAT(first_name, ' ', last_name) LIKE ?
      )
    ORDER BY employee_name
    LIMIT 50`,
    [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`]
  );

  return employees as SearchEmployeeRow[];
}
