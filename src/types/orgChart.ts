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
  children: OrgTreeNode[];
}

export interface OrgTreeResponse {
  success: boolean;
  nodes: OrgTreeNode[];
  totalCount: number;
}
