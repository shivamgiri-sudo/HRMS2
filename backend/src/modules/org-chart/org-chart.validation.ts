import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type IssueSeverity = "low" | "medium" | "high" | "critical";

export type IssueType =
  | "missing_manager"
  | "circular_mapping"
  | "inactive_manager"
  | "cross_branch_manager"
  | "process_mismatch"
  | "unmapped_employee"
  | "duplicate_reporting"
  | "orphan_manager"
  | "no_designation";

export interface DataQualityIssue {
  id?: string;
  employee_id: string | null;
  employee_name?: string;
  employee_code?: string;
  issue_type: IssueType;
  severity: IssueSeverity;
  issue_detail: Record<string, unknown>;
  suggested_fix: string;
  detected_at: string;
}

export interface DataQualitySummary {
  total_employees: number;
  issues_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  confidence_score: number;
  issues: DataQualityIssue[];
}

/**
 * Run all data-quality validations and return summary + issues.
 */
export async function validateOrgChartDataQuality(
  scopeFilter?: { branchId?: string; processId?: string }
): Promise<DataQualitySummary> {
  const issues: DataQualityIssue[] = [];

  // Run all validators
  issues.push(...(await detectMissingManagers(scopeFilter)));
  issues.push(...(await detectInactiveManagers(scopeFilter)));
  issues.push(...(await detectCircularMappings(scopeFilter)));
  issues.push(...(await detectCrossBranchManagers(scopeFilter)));
  issues.push(...(await detectProcessMismatches(scopeFilter)));
  issues.push(...(await detectUnmappedEmployees(scopeFilter)));
  issues.push(...(await detectNoDesignation(scopeFilter)));

  // Count by severity
  const critical_count = issues.filter((i) => i.severity === "critical").length;
  const high_count = issues.filter((i) => i.severity === "high").length;
  const medium_count = issues.filter((i) => i.severity === "medium").length;
  const low_count = issues.filter((i) => i.severity === "low").length;

  // Total employees in scope
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM employees WHERE active_status = 1 ${scopeFilter?.branchId ? "AND branch_id = ?" : ""} ${scopeFilter?.processId ? "AND process_id = ?" : ""}`,
    [scopeFilter?.branchId, scopeFilter?.processId].filter(Boolean)
  );
  const total_employees = (countRows as any[])[0]?.cnt ?? 0;

  // Confidence score: 100 - (issues_count / total_employees * 100)
  const confidence_score = Math.max(0, Math.min(100, 100 - (issues.length / Math.max(total_employees, 1)) * 100));

  return {
    total_employees,
    issues_count: issues.length,
    critical_count,
    high_count,
    medium_count,
    low_count,
    confidence_score: Math.round(confidence_score),
    issues,
  };
}

/**
 * Detect employees without reporting_manager_id.
 */
async function detectMissingManagers(scopeFilter?: { branchId?: string; processId?: string }): Promise<DataQualityIssue[]> {
  const wheres: string[] = [
    "e.active_status = 1",
    "(e.reporting_manager_id IS NULL OR e.reporting_manager_id = '')",
  ];
  const params: unknown[] = [];

  if (scopeFilter?.branchId) {
    wheres.push("e.branch_id = ?");
    params.push(scopeFilter.branchId);
  }
  if (scopeFilter?.processId) {
    wheres.push("e.process_id = ?");
    params.push(scopeFilter.processId);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            d.designation_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE ${wheres.join(" AND ")}
        AND NOT EXISTS (
          SELECT 1 FROM employees mgr WHERE mgr.id = e.id AND mgr.reporting_manager_id IS NULL AND mgr.designation_id IN (
            SELECT id FROM designation_master WHERE LOWER(designation_name) LIKE '%ceo%' OR LOWER(designation_name) LIKE '%director%'
          )
        )
      ORDER BY e.created_at DESC
      LIMIT 50`,
    params
  );

  return (rows as any[]).map((row) => ({
    employee_id: row.id,
    employee_name: row.full_name,
    employee_code: row.employee_code,
    issue_type: "missing_manager",
    severity: "high",
    issue_detail: { designation: row.designation_name },
    suggested_fix: `Assign a valid reporting manager to ${row.full_name} (${row.employee_code})`,
    detected_at: new Date().toISOString(),
  }));
}

/**
 * Detect employees with inactive reporting managers.
 */
async function detectInactiveManagers(scopeFilter?: { branchId?: string; processId?: string }): Promise<DataQualityIssue[]> {
  const wheres: string[] = [
    "e.active_status = 1",
    "e.reporting_manager_id IS NOT NULL",
    "mgr.active_status = 0",
  ];
  const params: unknown[] = [];

  if (scopeFilter?.branchId) {
    wheres.push("e.branch_id = ?");
    params.push(scopeFilter.branchId);
  }
  if (scopeFilter?.processId) {
    wheres.push("e.process_id = ?");
    params.push(scopeFilter.processId);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            mgr.id AS manager_id, CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')) AS manager_name
       FROM employees e
       JOIN employees mgr ON mgr.id = e.reporting_manager_id
      WHERE ${wheres.join(" AND ")}
      ORDER BY e.created_at DESC
      LIMIT 50`,
    params
  );

  return (rows as any[]).map((row) => ({
    employee_id: row.id,
    employee_name: row.full_name,
    employee_code: row.employee_code,
    issue_type: "inactive_manager",
    severity: "critical",
    issue_detail: { manager_id: row.manager_id, manager_name: row.manager_name },
    suggested_fix: `Assign a new active manager for ${row.full_name}. Current manager ${row.manager_name} is inactive.`,
    detected_at: new Date().toISOString(),
  }));
}

/**
 * Detect circular reporting chains (A→B→C→A).
 */
async function detectCircularMappings(scopeFilter?: { branchId?: string; processId?: string }): Promise<DataQualityIssue[]> {
  const wheres: string[] = ["e.active_status = 1"];
  const params: unknown[] = [];

  if (scopeFilter?.branchId) {
    wheres.push("e.branch_id = ?");
    params.push(scopeFilter.branchId);
  }
  if (scopeFilter?.processId) {
    wheres.push("e.process_id = ?");
    params.push(scopeFilter.processId);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            e.reporting_manager_id
       FROM employees e
      WHERE ${wheres.join(" AND ")}
        AND e.reporting_manager_id IS NOT NULL`,
    params
  );

  const issues: DataQualityIssue[] = [];
  const employees = rows as any[];

  for (const emp of employees) {
    const visited = new Set<string>();
    let current = emp.id;
    const chain: string[] = [current];

    while (current) {
      if (visited.has(current)) {
        // Circular chain detected
        const chainNames = await getEmployeeNames(chain);
        issues.push({
          employee_id: emp.id,
          employee_name: emp.full_name,
          employee_code: emp.employee_code,
          issue_type: "circular_mapping",
          severity: "critical",
          issue_detail: { chain: chainNames },
          suggested_fix: `Break the circular reporting chain: ${chainNames.join(" → ")}`,
          detected_at: new Date().toISOString(),
        });
        break;
      }
      visited.add(current);
      const next = employees.find((e) => e.id === current)?.reporting_manager_id;
      if (!next || visited.has(next)) break;
      chain.push(next);
      current = next;
      if (chain.length > 20) break; // Safety limit
    }
  }

  return issues;
}

/**
 * Detect managers from a different branch than their reports.
 */
async function detectCrossBranchManagers(scopeFilter?: { branchId?: string; processId?: string }): Promise<DataQualityIssue[]> {
  const wheres: string[] = [
    "e.active_status = 1",
    "e.reporting_manager_id IS NOT NULL",
    "e.branch_id IS NOT NULL",
    "mgr.branch_id IS NOT NULL",
    "e.branch_id != mgr.branch_id",
  ];
  const params: unknown[] = [];

  if (scopeFilter?.branchId) {
    wheres.push("e.branch_id = ?");
    params.push(scopeFilter.branchId);
  }
  if (scopeFilter?.processId) {
    wheres.push("e.process_id = ?");
    params.push(scopeFilter.processId);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            eb.branch_name AS employee_branch,
            mgr.id AS manager_id, CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')) AS manager_name,
            mb.branch_name AS manager_branch
       FROM employees e
       JOIN employees mgr ON mgr.id = e.reporting_manager_id
       LEFT JOIN branch_master eb ON eb.id = e.branch_id
       LEFT JOIN branch_master mb ON mb.id = mgr.branch_id
      WHERE ${wheres.join(" AND ")}
      ORDER BY e.created_at DESC
      LIMIT 50`,
    params
  );

  return (rows as any[]).map((row) => ({
    employee_id: row.id,
    employee_name: row.full_name,
    employee_code: row.employee_code,
    issue_type: "cross_branch_manager",
    severity: "medium",
    issue_detail: {
      employee_branch: row.employee_branch,
      manager_name: row.manager_name,
      manager_branch: row.manager_branch,
    },
    suggested_fix: `${row.full_name} (${row.employee_branch}) reports to ${row.manager_name} (${row.manager_branch}). Consider aligning branch assignments.`,
    detected_at: new Date().toISOString(),
  }));
}

/**
 * Detect process mismatches (employee and manager in different processes).
 */
async function detectProcessMismatches(scopeFilter?: { branchId?: string; processId?: string }): Promise<DataQualityIssue[]> {
  const wheres: string[] = [
    "e.active_status = 1",
    "e.reporting_manager_id IS NOT NULL",
    "e.process_id IS NOT NULL",
    "mgr.process_id IS NOT NULL",
    "e.process_id != mgr.process_id",
  ];
  const params: unknown[] = [];

  if (scopeFilter?.branchId) {
    wheres.push("e.branch_id = ?");
    params.push(scopeFilter.branchId);
  }
  if (scopeFilter?.processId) {
    wheres.push("e.process_id = ?");
    params.push(scopeFilter.processId);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            ep.process_name AS employee_process,
            mgr.id AS manager_id, CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')) AS manager_name,
            mp.process_name AS manager_process
       FROM employees e
       JOIN employees mgr ON mgr.id = e.reporting_manager_id
       LEFT JOIN process_master ep ON ep.id = e.process_id
       LEFT JOIN process_master mp ON mp.id = mgr.process_id
      WHERE ${wheres.join(" AND ")}
      ORDER BY e.created_at DESC
      LIMIT 50`,
    params
  );

  return (rows as any[]).map((row) => ({
    employee_id: row.id,
    employee_name: row.full_name,
    employee_code: row.employee_code,
    issue_type: "process_mismatch",
    severity: "low",
    issue_detail: {
      employee_process: row.employee_process,
      manager_name: row.manager_name,
      manager_process: row.manager_process,
    },
    suggested_fix: `${row.full_name} (${row.employee_process}) reports to ${row.manager_name} (${row.manager_process}). Consider aligning process assignments.`,
    detected_at: new Date().toISOString(),
  }));
}

/**
 * Detect employees without branch/process/department.
 */
async function detectUnmappedEmployees(scopeFilter?: { branchId?: string; processId?: string }): Promise<DataQualityIssue[]> {
  const wheres: string[] = [
    "e.active_status = 1",
    "(e.branch_id IS NULL OR e.process_id IS NULL OR e.department_id IS NULL)",
  ];
  const params: unknown[] = [];

  if (scopeFilter?.branchId) {
    wheres.push("e.branch_id = ?");
    params.push(scopeFilter.branchId);
  }
  if (scopeFilter?.processId) {
    wheres.push("e.process_id = ?");
    params.push(scopeFilter.processId);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            e.branch_id, e.process_id, e.department_id
       FROM employees e
      WHERE ${wheres.join(" AND ")}
      ORDER BY e.created_at DESC
      LIMIT 50`,
    params
  );

  return (rows as any[]).map((row) => {
    const missing: string[] = [];
    if (!row.branch_id) missing.push("branch");
    if (!row.process_id) missing.push("process");
    if (!row.department_id) missing.push("department");

    return {
      employee_id: row.id,
      employee_name: row.full_name,
      employee_code: row.employee_code,
      issue_type: "unmapped_employee",
      severity: "high",
      issue_detail: { missing_fields: missing },
      suggested_fix: `Assign ${missing.join(", ")} to ${row.full_name} (${row.employee_code})`,
      detected_at: new Date().toISOString(),
    };
  });
}

/**
 * Detect employees without designation.
 */
async function detectNoDesignation(scopeFilter?: { branchId?: string; processId?: string }): Promise<DataQualityIssue[]> {
  const wheres: string[] = ["e.active_status = 1", "e.designation_id IS NULL"];
  const params: unknown[] = [];

  if (scopeFilter?.branchId) {
    wheres.push("e.branch_id = ?");
    params.push(scopeFilter.branchId);
  }
  if (scopeFilter?.processId) {
    wheres.push("e.process_id = ?");
    params.push(scopeFilter.processId);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name
       FROM employees e
      WHERE ${wheres.join(" AND ")}
      ORDER BY e.created_at DESC
      LIMIT 50`,
    params
  );

  return (rows as any[]).map((row) => ({
    employee_id: row.id,
    employee_name: row.full_name,
    employee_code: row.employee_code,
    issue_type: "no_designation",
    severity: "medium",
    issue_detail: {},
    suggested_fix: `Assign a designation to ${row.full_name} (${row.employee_code})`,
    detected_at: new Date().toISOString(),
  }));
}

/**
 * Helper: get employee names for a list of IDs.
 */
async function getEmployeeNames(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, CONCAT(first_name, ' ', COALESCE(last_name, '')) AS full_name
       FROM employees
      WHERE id IN (${placeholders})`,
    ids
  );
  const nameMap = new Map((rows as any[]).map((r) => [r.id, r.full_name]));
  return ids.map((id) => nameMap.get(id) ?? id);
}

/**
 * Persist issues to org_chart_data_issue table (optional — for historical tracking).
 */
export async function persistDataQualityIssues(issues: DataQualityIssue[]): Promise<void> {
  if (issues.length === 0) return;

  // Clear old issues (active_status = 0)
  await db.execute("UPDATE org_chart_data_issue SET active_status = 0 WHERE active_status = 1");

  // Insert new issues
  for (const issue of issues) {
    await db.execute(
      `INSERT INTO org_chart_data_issue (employee_id, issue_type, severity, issue_detail, suggested_fix, detected_at, active_status)
       VALUES (?, ?, ?, ?, ?, NOW(), 1)`,
      [issue.employee_id, issue.issue_type, issue.severity, JSON.stringify(issue.issue_detail), issue.suggested_fix]
    );
  }
}
