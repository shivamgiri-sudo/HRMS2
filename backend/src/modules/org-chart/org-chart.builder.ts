import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { UserOrgContext } from "./org-chart.scope.js";

export interface OrgTreeNode {
  id: string;
  employee_code: string;
  employee_code_masked: string;
  display_name: string;
  first_name: string;
  last_name: string | null;
  designation: string | null;
  designation_id: string | null;
  branch: string | null;
  branch_id: string | null;
  process: string | null;
  process_id: string | null;
  department: string | null;
  department_id: string | null;
  status: string;
  employment_status: string | null;
  manager_id: string | null;
  direct_report_count: number;
  total_report_count: number;
  photo_url: string | null;
  role_key: string | null;
  badges: string[];
  warnings: string[];
  children: OrgTreeNode[];
}

export interface OrgTreeResponse {
  scope: {
    scope_type: string;
    scope_id: string | null;
    scope_name: string;
  };
  nodes: OrgTreeNode[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relationship_type: string;
  }>;
  data_quality: {
    confidence_score: number;
    missing_manager_count: number;
    inactive_manager_count: number;
    circular_mapping_count: number;
    unmapped_count: number;
  };
}

/**
 * Build org tree from employee records with cycle detection.
 */
export async function buildOrgTree(
  employeeRows: RowDataPacket[],
  ctx: UserOrgContext
): Promise<OrgTreeNode[]> {
  const employeeMap = new Map<string, OrgTreeNode>();
  const childrenMap = new Map<string, string[]>();

  // First pass: create node objects
  for (const row of employeeRows) {
    const node: OrgTreeNode = {
      id: row.id,
      employee_code: row.employee_code,
      employee_code_masked: maskEmployeeCode(row.employee_code),
      display_name: row.full_name || `${row.first_name} ${row.last_name || ""}`.trim(),
      first_name: row.first_name,
      last_name: row.last_name,
      designation: row.designation_name,
      designation_id: row.designation_id,
      branch: row.branch_name,
      branch_id: row.branch_id,
      process: row.process_name,
      process_id: row.process_id,
      department: row.dept_name,
      department_id: row.department_id,
      status: row.active_status === 1 ? "Active" : "Inactive",
      employment_status: row.employment_status,
      manager_id: row.reporting_manager_id,
      direct_report_count: 0,
      total_report_count: 0,
      photo_url: row.photo_url || row.avatar_url,
      role_key: null, // Will be resolved later if needed
      badges: [],
      warnings: [],
      children: [],
    };

    // Add warnings
    if (!row.reporting_manager_id && !isCLevelDesignation(row.designation_name)) {
      node.warnings.push("No reporting manager assigned");
    }
    if (row.reporting_manager_id && !employeeRows.find((e) => e.id === row.reporting_manager_id)) {
      node.warnings.push("Reporting manager not in scope");
    }
    if (!row.designation_id) {
      node.warnings.push("No designation assigned");
    }
    if (!row.branch_id || !row.process_id || !row.department_id) {
      node.warnings.push("Incomplete org mapping");
    }

    employeeMap.set(node.id, node);

    // Build parent-child relationships
    if (row.reporting_manager_id) {
      if (!childrenMap.has(row.reporting_manager_id)) {
        childrenMap.set(row.reporting_manager_id, []);
      }
      childrenMap.get(row.reporting_manager_id)!.push(node.id);
    }
  }

  // Second pass: attach children and count direct reports
  for (const [managerId, childIds] of childrenMap.entries()) {
    const manager = employeeMap.get(managerId);
    if (manager) {
      manager.direct_report_count = childIds.length;
      manager.children = childIds.map((id) => employeeMap.get(id)!).filter(Boolean);
    }
  }

  // Third pass: calculate total report count (recursive)
  for (const node of employeeMap.values()) {
    node.total_report_count = calculateTotalReports(node);
  }

  // Find root nodes (employees without manager or manager outside scope)
  const rootNodes: OrgTreeNode[] = [];
  for (const node of employeeMap.values()) {
    if (!node.manager_id || !employeeMap.has(node.manager_id)) {
      rootNodes.push(node);
    }
  }

  // Detect and break circular references
  const visited = new Set<string>();
  for (const root of rootNodes) {
    detectAndBreakCycles(root, visited, new Set());
  }

  return rootNodes;
}

/**
 * Calculate total report count recursively.
 */
function calculateTotalReports(node: OrgTreeNode): number {
  let total = node.children.length;
  for (const child of node.children) {
    total += calculateTotalReports(child);
  }
  return total;
}

/**
 * Detect circular references and break them to prevent infinite loops.
 */
function detectAndBreakCycles(
  node: OrgTreeNode,
  globalVisited: Set<string>,
  pathVisited: Set<string>
): void {
  if (pathVisited.has(node.id)) {
    // Circular reference detected — break it
    node.children = [];
    node.warnings.push("Circular reporting chain detected and broken");
    return;
  }

  if (globalVisited.has(node.id)) {
    return;
  }

  globalVisited.add(node.id);
  pathVisited.add(node.id);

  for (const child of node.children) {
    detectAndBreakCycles(child, globalVisited, new Set(pathVisited));
  }

  pathVisited.delete(node.id);
}

/**
 * Mask employee code (show first 3 and last 3 characters).
 */
function maskEmployeeCode(code: string): string {
  if (!code || code.length <= 6) return code;
  const first = code.slice(0, 3);
  const last = code.slice(-3);
  const stars = "*".repeat(Math.min(code.length - 6, 4));
  return `${first}${stars}${last}`;
}

/**
 * Check if designation is C-level (CEO, CTO, CFO, etc.).
 */
function isCLevelDesignation(designation: string | null): boolean {
  if (!designation) return false;
  const lower = designation.toLowerCase();
  return (
    lower.includes("ceo") ||
    lower.includes("cto") ||
    lower.includes("cfo") ||
    lower.includes("coo") ||
    lower.includes("director") ||
    lower.includes("president") ||
    lower.includes("founder")
  );
}

/**
 * Build edge list from tree nodes (for graph visualization if needed).
 */
export function buildEdgeList(nodes: OrgTreeNode[]): Array<{
  id: string;
  source: string;
  target: string;
  relationship_type: string;
}> {
  const edges: Array<{ id: string; source: string; target: string; relationship_type: string }> = [];
  const visited = new Set<string>();

  function traverse(node: OrgTreeNode) {
    if (visited.has(node.id)) return;
    visited.add(node.id);

    for (const child of node.children) {
      edges.push({
        id: `${node.id}-${child.id}`,
        source: node.id,
        target: child.id,
        relationship_type: "solid_line",
      });
      traverse(child);
    }
  }

  for (const root of nodes) {
    traverse(root);
  }

  return edges;
}

/**
 * Flatten tree into a list of nodes (for search/export).
 */
export function flattenTree(nodes: OrgTreeNode[]): OrgTreeNode[] {
  const flat: OrgTreeNode[] = [];
  const visited = new Set<string>();

  function traverse(node: OrgTreeNode) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    flat.push(node);
    for (const child of node.children) {
      traverse(child);
    }
  }

  for (const root of nodes) {
    traverse(root);
  }

  return flat;
}

/**
 * Search org tree by name or employee code.
 */
export function searchOrgTree(nodes: OrgTreeNode[], query: string): OrgTreeNode[] {
  const lowerQuery = query.toLowerCase().trim();
  if (!lowerQuery) return [];

  const flat = flattenTree(nodes);
  return flat.filter(
    (node) =>
      node.display_name.toLowerCase().includes(lowerQuery) ||
      node.employee_code.toLowerCase().includes(lowerQuery) ||
      node.designation?.toLowerCase().includes(lowerQuery) ||
      node.branch?.toLowerCase().includes(lowerQuery) ||
      node.process?.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get reporting chain for an employee (upward to root).
 */
export async function getReportingChain(employeeId: string): Promise<Array<{
  id: string;
  name: string;
  designation: string | null;
  employee_code: string;
}>> {
  const chain: Array<{ id: string; name: string; designation: string | null; employee_code: string }> = [];
  const visited = new Set<string>();
  let currentId: string | null = employeeId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
              d.designation_name, e.reporting_manager_id
         FROM employees e
         LEFT JOIN designation_master d ON d.id = e.designation_id
        WHERE e.id = ? AND e.active_status = 1
        LIMIT 1`,
      [currentId]
    );

    if (rows.length === 0) break;

    const emp = rows[0] as any;
    chain.push({
      id: emp.id,
      name: emp.full_name,
      designation: emp.designation_name,
      employee_code: emp.employee_code,
    });

    currentId = emp.reporting_manager_id;
    if (chain.length > 20) break; // Safety limit
  }

  return chain;
}
