import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format } from "date-fns";

const EMPLOYEE_PAGE_SIZE = 200;

export interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  phone?: string | null;
  avatar?: string;
  department: string;
  process: string;
  branch: string;
  costCentre: string;
  reportingManager: string;
  officialEmailCompliant: boolean;
  designation: string;
  joinDate: string;
  status: "active" | "inactive" | "onboarding" | "offboarded";
}

export interface EmployeeWithDetails {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  designation: string;
  hire_date: string;
  status: string;
  avatar_url: string | null;
  department: { name: string } | null;
}

interface EmployeePage {
  data: RawEmployee[];
  total: number;
  page: number;
  limit: number;
  stats?: EmployeeStatsResponse;
  process_breakdown?: EmployeeProcessBreakdown[];
}

export interface RawEmployee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  mobile?: string | null;
  avatar_url?: string | null;
  photo_url?: string | null;
  department_name?: string | null;
  designation_name?: string | null;
  designation?: string | null;
  date_of_joining?: string | null;
  employment_status?: string | null;
  reporting_manager_id?: string | null;
  reporting_manager_name?: string | null;
  process_name?: string | null;
  branch_name?: string | null;
  cost_centre_name?: string | null;
}

export interface EmployeeDirectoryFilters {
  page: number;
  limit: number;
  recordStatus: "active" | "inactive" | "all";
  status?: string;
  search?: string;
  departmentId?: string;
  processId?: string;
  branchId?: string;
}

interface EmployeeStatsResponse {
  total_employees?: number;
  active_employees?: number;
  onboarding_employees?: number;
  inactive_employees?: number;
  department_count?: number;
}

export interface EmployeeProcessBreakdown {
  process_id?: string | null;
  process_name: string;
  active_count: number;
  inactive_count: number;
  total_count: number;
}

export interface EmployeeSearchOption {
  id: string;
  employee_code: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
}

interface DepartmentRow {
  id: string;
  dept_name: string;
  dept_code: string;
  description?: string | null;
  manager_id?: string | null;
}

interface NamedMasterRow {
  id: string;
  process_name?: string;
  branch_name?: string;
  employee_count?: number;
}

export async function fetchAllEmployeeRows(recordStatus: "active" | "inactive" | "all" = "active"): Promise<RawEmployee[]> {
  const firstPage = await hrmsApi.get<EmployeePage>(
    `/api/employees?page=1&limit=${EMPLOYEE_PAGE_SIZE}&recordStatus=${recordStatus}`
  );
  const rows = firstPage.data ?? [];
  const totalPages = Math.ceil((firstPage.total ?? rows.length) / EMPLOYEE_PAGE_SIZE);

  if (totalPages <= 1) return rows;

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      hrmsApi.get<EmployeePage>(
        `/api/employees?page=${index + 2}&limit=${EMPLOYEE_PAGE_SIZE}`
          + `&recordStatus=${recordStatus}`
      )
    )
  );

  return rows.concat(...remainingPages.map((page) => page.data ?? []));
}

function formatEmployeeDate(value: unknown): string {
  if (!value) return "";
  const datePart = String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!datePart) return "";
  const parsed = new Date(`${datePart}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? "" : format(parsed, "MMM d, yyyy");
}

function normalizeEmployeeStatus(value: unknown): Employee["status"] {
  const status = String(value ?? "").trim().toLowerCase();
  if (status === "active" || status === "on notice") return "active";
  if (status === "onboarding") return "onboarding";
  if (["terminated", "offboarded", "absconded"].includes(status)) return "offboarded";
  return "inactive";
}

function mapEmployee(emp: RawEmployee): Employee {
  return {
    id: emp.id,
    employeeCode: emp.employee_code,
    name: `${emp.first_name} ${emp.last_name ?? ""}`.trim(),
    email: emp.email ?? "",
    phone: emp.mobile ?? null,
    avatar: emp.avatar_url ?? emp.photo_url ?? undefined,
    department: emp.department_name || "Unassigned",
    process: emp.process_name || "Unassigned",
    branch: emp.branch_name || "Unassigned",
    costCentre: emp.cost_centre_name || "Unassigned",
    reportingManager: emp.reporting_manager_name || "Unassigned",
    officialEmailCompliant: /@(teammas\.in|teammas\.co\.in)$/i.test(emp.email ?? ""),
    designation: emp.designation_name || emp.designation || "",
    joinDate: formatEmployeeDate(emp.date_of_joining),
    status: normalizeEmployeeStatus(emp.employment_status),
  };
}

export function useEmployeeDirectory(filters: EmployeeDirectoryFilters) {
  return useQuery({
    queryKey: ["employee-directory", filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(filters.page),
        limit: String(filters.limit),
        recordStatus: filters.recordStatus,
      });
      if (filters.status) params.set("status", filters.status);
      if (filters.search) params.set("search", filters.search);
      if (filters.departmentId) params.set("departmentId", filters.departmentId);
      if (filters.processId) params.set("processId", filters.processId);
      if (filters.branchId) params.set("branchId", filters.branchId);

      const response = await hrmsApi.get<EmployeePage>(`/api/employees?${params.toString()}`);
      return {
        employees: (response.data ?? []).map(mapEmployee),
        total: Number(response.total ?? 0),
        stats: response.stats,
        processBreakdown: response.process_breakdown ?? [],
      };
    },
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useEmployeeDirectoryAnalytics(filters: EmployeeDirectoryFilters) {
  return useQuery({
    queryKey: ["employee-directory-analytics", filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: "1",
        limit: "1",
        recordStatus: filters.recordStatus,
        includeAnalytics: "true",
      });
      if (filters.status) params.set("status", filters.status);
      if (filters.search) params.set("search", filters.search);
      if (filters.departmentId) params.set("departmentId", filters.departmentId);
      if (filters.processId) params.set("processId", filters.processId);
      if (filters.branchId) params.set("branchId", filters.branchId);

      const response = await hrmsApi.get<EmployeePage>(`/api/employees?${params.toString()}`);
      return {
        stats: response.stats,
        processBreakdown: response.process_breakdown ?? [],
      };
    },
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

export function useEmployeeSearchOptions(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["employee-search-options", q],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: EmployeeSearchOption[] }>(
        `/api/employees/options/search?q=${encodeURIComponent(q)}&limit=8`
      );
      return res.data ?? [];
    },
    enabled: q.length >= 1,
    staleTime: 30_000,
  });
}

export function useEmployees(recordStatus: "active" | "inactive" | "all" = "active") {
  return useQuery({
    queryKey: ["employees", recordStatus],
    queryFn: async () => {
      const rows = await fetchAllEmployeeRows(recordStatus);
      return rows.map(mapEmployee);
    },
    staleTime: 60_000,
  });
}

export function useEmployeeStats() {
  return useQuery({
    queryKey: ["employee-stats"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: EmployeeStatsResponse }>("/api/employees/stats");
      const stats = res.data ?? {};
      return {
        total: stats.total_employees ?? 0,
        active: stats.active_employees ?? 0,
        onboarding: stats.onboarding_employees ?? 0,
      };
    },
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: DepartmentRow[] }>("/api/org/departments");
      return (res.data ?? []).map((d) => ({
        id: d.id,
        name: d.dept_name,
        code: d.dept_code,
        description: d.description ?? "",
      }));
    },
  });
}

export function useEmployeeDirectoryMasters() {
  return useQuery({
    queryKey: ["employee-directory-masters"],
    queryFn: async () => {
      const res = await hrmsApi.get<{
        data: {
          processes?: NamedMasterRow[];
          branches?: NamedMasterRow[];
        };
      }>("/api/employees/directory-masters");
      return {
        processes: (res.data?.processes ?? []).map((row) => ({
          id: row.id,
          name: row.process_name ?? "",
          employeeCount: Number(row.employee_count ?? 0),
        })).filter((row) => row.name),
        branches: (res.data?.branches ?? []).map((row) => ({
          id: row.id,
          name: row.branch_name ?? "",
          employeeCount: Number(row.employee_count ?? 0),
        })).filter((row) => row.name),
      };
    },
    staleTime: 5 * 60_000,
  });
}

export function useBulkDeleteEmployees() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (employeeIds: string[]) => {
      // Deactivate in parallel via backend API
      const errors: string[] = [];

      await Promise.all(
        employeeIds.map(async (id) => {
          try {
            await hrmsApi.delete(`/api/employees/${id}`);
          } catch (err: unknown) {
            errors.push(`Failed to delete employee ${id}: ${err instanceof Error ? err.message : "Unknown error"}`);
          }
        })
      );

      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }

      return { deletedCount: employeeIds.length };
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-directory"] });
      queryClient.invalidateQueries({ queryKey: ["employee-stats"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
    },
  });
}

export function useBulkUpdateEmployeeStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ employeeIds, status }: { employeeIds: string[]; status: "active" | "inactive" }) => {
      await Promise.all(
        employeeIds.map((id) => hrmsApi.patch(`/api/employees/${id}`, { employment_status: status }))
      );
      return { updatedCount: employeeIds.length, status };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-directory"] });
      queryClient.invalidateQueries({ queryKey: ["employee-stats"] });
    },
  });
}
