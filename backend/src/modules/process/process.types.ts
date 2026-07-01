export interface ProcessMaster {
  id: string;
  process_code: string;
  process_name: string;
  department_id: string | null;
  process_type: string | null;
  branch_name: string | null;
  location_name: string | null;
  process_owner_employee_id: string | null;
  process_manager_employee_id: string | null;
  active_status: boolean;
  description: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProcessInput {
  processCode: string;
  processName: string;
  departmentId?: string | null;
  processType?: string | null;
  branchName?: string | null;
  locationName?: string | null;
  processOwnerEmployeeId?: string | null;
  processManagerEmployeeId?: string | null;
  description?: string | null;
}

export interface UpdateProcessInput {
  processName?: string;
  departmentId?: string | null;
  processType?: string | null;
  branchName?: string | null;
  locationName?: string | null;
  processOwnerEmployeeId?: string | null;
  processManagerEmployeeId?: string | null;
  activeStatus?: boolean;
  description?: string | null;
}

export interface ProcessFilters {
  search?: string;
  departmentId?: string;
  activeStatus?: "all" | "active" | "inactive";
}

export interface ProcessRepository {
  list(filters: ProcessFilters): Promise<ProcessMaster[]>;
  getById(id: string): Promise<ProcessMaster | null>;
  create(input: CreateProcessInput, userId: string): Promise<ProcessMaster>;
  update(
    id: string,
    input: UpdateProcessInput,
    userId: string
  ): Promise<ProcessMaster>;
  updateStatus(
    id: string,
    activeStatus: boolean,
    userId: string
  ): Promise<ProcessMaster>;
}
