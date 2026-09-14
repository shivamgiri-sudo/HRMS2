export interface OrgTreeNode {
  id: string;
  employee_code: string;
  name: string;
  designation: string | null;
  process_name: string | null;
  branch_name: string | null;
  department_name: string | null;
  avatar_url: string | null;
  reporting_manager_id: string | null;
  role_key: string | null;
  active_status: number;
  /** 1 when the row was pulled in only to complete the viewer's reporting line. */
  is_reporting_line?: number;
  direct_reports?: number;
  total_reports?: number;
  children: OrgTreeNode[];
}

export interface OrgTreeDataIssue {
  type: "self_manager" | "cycle" | "missing_manager";
  employeeId: string;
  employeeCode: string;
  name: string;
  detail: string;
}

export interface OrgTreeResponse {
  success: boolean;
  nodes: OrgTreeNode[];
  /** Everyone in scope, including people held back in the unassigned tray. */
  totalCount: number;
  /** People actually placed in the rendered hierarchy. */
  renderedCount: number;
  selfEmployeeId: string | null;
  /** Active employees with no manager and no reports — kept out of the tree so it stays readable. */
  unassigned: OrgTreeNode[];
  dataIssues: OrgTreeDataIssue[];
}
