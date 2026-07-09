import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format } from "date-fns";

export interface PayrollRecordFilters {
  month?:        number;
  year?:         number;
  search?:       string;
  branchId?:     string;
  departmentId?: string;
  processId?:    string;
  status?:       string;
  page?:         number;
  limit?:        number;
}

export interface PayrollRecord {
  id: string;
  runId: string;
  employeeId: string;
  employeeCode: string;
  employee: {
    name: string;
    email: string;
    avatar?: string;
  };
  month: string;
  monthNum: number;
  year: number;
  basic: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  status: "pending" | "processing" | "paid";
  paidAt?: string;
  designation?: string;
  department?: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const toRunMonth = (month?: number, year?: number) => {
  if (month === undefined || year === undefined) return undefined;
  return `${year}-${String(month).padStart(2, "0")}`;
};

const normalizePayrollStatus = (runStatus?: string, lineStatus?: string): PayrollRecord["status"] => {
  const run = String(runStatus || "").toLowerCase();
  const line = String(lineStatus || "").toLowerCase();
  if (["disbursed", "finalized", "finalised", "paid"].includes(run)) return "paid";
  if (["processing", "reviewed", "approved", "locked"].includes(run) || line === "calculated") return "processing";
  return "pending";
};

const mapPayrollRecord = (row: any): PayrollRecord => {
  const [yearStr, monthStr] = String(row.run_month ?? "").split("-");
  const monthNum = Number(monthStr || 0);
  const employeeName = String(row.employee_name ?? "").trim() || row.employee_code || "Unknown Employee";
  const allowances =
    Number(row.hra ?? 0) +
    Number(row.special_allowance ?? 0) +
    Number(row.incentive_total ?? 0);

  return {
    id: String(row.id),
    runId: String(row.run_id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    employeeCode: String(row.employee_code ?? ""),
    employee: {
      name: employeeName,
      email: String(row.employee_email ?? ""),
      avatar: row.employee_avatar ?? undefined,
    },
    month: MONTH_NAMES[monthNum - 1] ?? String(row.run_month ?? ""),
    monthNum,
    year: Number(yearStr || 0),
    basic: Number(row.basic ?? 0),
    allowances,
    deductions: Number(row.total_deductions ?? 0),
    netSalary: Number(row.net_salary ?? 0),
    status: normalizePayrollStatus(row.run_status, row.line_status),
    paidAt: row.disbursed_at ? String(row.disbursed_at).slice(0, 10) : undefined,
    designation: row.designation_name ?? row.designation ?? undefined,
    department:  row.dept_name ?? row.department ?? undefined,
  };
};

async function fetchPayrollRecordPage(
  f: PayrollRecordFilters
): Promise<{ records: PayrollRecord[]; total: number; page: number; limit: number }> {
  const p = new URLSearchParams();
  if (f.month !== undefined && f.year !== undefined)
    p.set("runMonth", toRunMonth(f.month, f.year)!);
  if (f.search)       p.set("search",       f.search);
  if (f.branchId)     p.set("branchId",     f.branchId);
  if (f.departmentId) p.set("departmentId", f.departmentId);
  if (f.processId)    p.set("processId",    f.processId);
  if (f.status)       p.set("status",       f.status);
  p.set("page",  String(f.page  ?? 1));
  p.set("limit", String(f.limit ?? 50));

  const res = await hrmsApi.get<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(
    `/api/payroll/records?${p}`
  );
  return {
    records: (res.data ?? []).map(mapPayrollRecord),
    total:   Number(res.total  ?? 0),
    page:    Number(res.page   ?? 1),
    limit:   Number(res.limit  ?? 50),
  };
}

export function usePayrollRecords(filters: PayrollRecordFilters = {}) {
  return useQuery({
    queryKey: ["payroll-records", filters],
    queryFn: async () => {
      try {
        return fetchPayrollRecordPage(filters);
      } catch {
        console.warn("Payroll records fetch failed");
        return { records: [] as PayrollRecord[], total: 0, page: 1, limit: 50 };
      }
    },
    placeholderData: (prev) => prev,
  });
}

export interface PayrollStats {
  totalPayroll: number | null;
  employeeCount: number | null;
  avgSalary: number | null;
  pending: number | null;
  salaryAssignedEmployees?: number | null;
  payrollEmployees?: number | null;
  missingPayrollEmployees?: number | null;
  totalBasic?: number | null;
  totalAllowances?: number | null;
  totalDeductions?: number | null;
  effectiveRunMonth?: string | null;
  isFallback?: boolean;
}

export function usePayrollStats() {
  return useQuery<PayrollStats>({
    queryKey: ["payroll-stats"],
    queryFn: async (): Promise<PayrollStats> => {
      try {
        // Get current month's payroll run
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();

        const runMonth = toRunMonth(currentMonth, currentYear);
        const res = await hrmsApi.get<{ success: boolean; data: any }>(
          `/api/payroll/overview?runMonth=${runMonth}`
        );
        // Backend returns { data: { run, stats: { total_net, employee_count, ... }, runMonth } }
        const overview = res.data || {};
        const stats = overview.stats || {};
        const run   = overview.run   || {};

        const totalPayroll    = Number(stats.total_net      ?? run.total_net      ?? 0);
        const payrollEmployees = Number(stats.employee_count ?? run.total_employees ?? 0);
        const avgSalary = payrollEmployees > 0 ? totalPayroll / payrollEmployees : 0;

        return {
          totalPayroll,
          employeeCount: payrollEmployees,
          avgSalary,
          pending: 0,
          salaryAssignedEmployees: payrollEmployees,
          payrollEmployees,
          missingPayrollEmployees: 0,
          totalBasic: Number(stats.total_basic ?? 0),
          totalAllowances: Number(stats.total_allowances ?? 0),
          totalDeductions: Number(stats.total_deductions ?? stats.total_pf ?? 0),
          effectiveRunMonth: overview.runMonth ?? null,
          isFallback: overview.isFallback ?? false,
        };
      } catch (error) {
        console.error("Failed to fetch payroll stats:", error);
        return {
          totalPayroll: 0,
          employeeCount: 0,
          avgSalary: 0,
          pending: 0,
        };
      }
    },
  });
}

export function useGeneratePayroll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ month, year }: { month: number; year: number }) => {
      const runMonth = toRunMonth(month, year);
      if (!runMonth) throw new Error("Invalid payroll month");

      let runId: string | null = null;
      try {
        const created = await hrmsApi.post<{ data: any }>("/api/payroll/runs", { runMonth });
        runId = created.data?.id ?? null;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.toLowerCase().includes("already exists")) throw error;
        const existing = await hrmsApi.get<{ data: any[] }>(
          `/api/payroll/runs?runMonth=${runMonth}&limit=1`
        );
        runId = existing.data?.[0]?.id ?? null;
      }

      if (!runId) throw new Error("Could not find or create payroll run");
      // Payroll calculation can take 30-120s for large tenants — use extended timeout
      const calculated = await hrmsApi.post<{ success: boolean; data: any; message?: string }>(
        `/api/payroll/runs/${runId}/calculate`,
        undefined,
        120_000
      );
      return {
        count: Number(calculated.data?.employees_processed ?? 0),
        runId,
        ...calculated.data,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-records"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-stats"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-analytics"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-trends"] });
    },
  });
}

export function useFreezeAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (runId: string) => {
      const result = await hrmsApi.post<{ success: boolean; message?: string; data?: any }>(
        `/api/payroll/runs/${runId}/freeze-attendance`,
        undefined
      );
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-records"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-stats"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-analytics"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-trends"] });
    },
  });
}

export function useUpdatePayrollStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "draft" | "processed" | "paid" }) => {
      const backendStatus =
        status === "paid" ? "disbursed" :
        status === "processed" ? "reviewed" :
        "processing";
      await hrmsApi.patch(`/api/payroll/runs/${id}/status`, { status: backendStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-records"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-stats"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-analytics"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-trends"] });
    },
  });
}

export function useBulkUpdatePayrollStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: "draft" | "processed" | "paid" }) => {
      const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
      await Promise.all(uniqueIds.map((id) =>
        hrmsApi.patch(`/api/payroll/runs/${id}/status`, {
          status: status === "paid" ? "disbursed" : status === "processed" ? "reviewed" : "processing",
        })
      ));
      return { count: uniqueIds.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-records"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-stats"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-analytics"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-trends"] });
    },
  });
}

export interface SalaryStructure {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  employeeEmail: string;
  employeeAvatar?: string;
  basicSalary: number;
  hra: number;
  transportAllowance: number;
  medicalAllowance: number;
  otherAllowances: number;
  taxDeduction: number;
  otherDeductions: number;
  effectiveFrom: string;
  totalAllowances: number;
  totalDeductions: number;
  netSalary: number;
}

export function useSalaryStructures() {
  return useQuery({
    queryKey: ["salary-structures"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/payroll/employee-salaries");
      return (res.data || []).map((s: any): SalaryStructure => {
        const basicSalary = Number(s.basic_salary ?? 0);
        const hra = Number(s.hra ?? 0);
        const specialAllowance = Number(s.special_allowance ?? 0);
        // transport/medical are not separate fields in our CTC model — special_allowance is the residual
        const transportAllowance = 0;
        const medicalAllowance = 0;
        const otherAllowances = specialAllowance;
        const taxDeduction = 0;
        const otherDeductions = 0;
        const totalAllowances = hra + specialAllowance;
        const totalDeductions = 0;
        const netSalary = basicSalary + totalAllowances - totalDeductions;

        return {
          id: s.id,
          employeeId: s.employee_id ?? "",
          employeeCode: s.employee_code ?? "",
          employeeName: s.employee_name ?? s.employee_code ?? "Unknown",
          employeeEmail: s.employee_email ?? "",
          employeeAvatar: s.employee_avatar ?? undefined,
          basicSalary,
          hra,
          transportAllowance,
          medicalAllowance,
          otherAllowances,
          taxDeduction,
          otherDeductions,
          effectiveFrom: s.effective_from ?? "",
          totalAllowances,
          totalDeductions,
          netSalary,
        };
      });
    },
  });
}

export interface CreateSalaryStructureData {
  employee_id: string;
  basic_salary: number;
  hra?: number;
  transport_allowance?: number;
  medical_allowance?: number;
  other_allowances?: number;
  tax_deduction?: number;
  other_deductions?: number;
  effective_from: string;
}

export function useCreateSalaryStructure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSalaryStructureData) => {
      await hrmsApi.post("/api/payroll/structures", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] });
    },
  });
}

export function useUpdateSalaryStructure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<CreateSalaryStructureData>) => {
      await hrmsApi.put(`/api/payroll/structures/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] });
    },
  });
}

export function useDeleteSalaryStructure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await hrmsApi.delete(`/api/payroll/structures/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] });
    },
  });
}

// ─── Analytics types ──────────────────────────────────────────────────────────

export interface PayrollAnalyticsDimRow {
  dimension_name:      string;
  headcount:           number;
  total_basic:         number;
  total_allowances:    number;
  total_gross:         number;
  total_deductions:    number;
  total_net:           number;
  total_pf_employer:   number;
  total_esic_employer: number;
  avg_net?:            number;
  pct_of_total?:       number;
}

export interface PayrollAnalyticsKPI {
  headcount:           number;
  total_net:           number;
  avg_net:             number;
  total_gross:         number;
  total_pf_employer:   number;
  total_esic_employer: number;
}

export interface PayrollAnalyticsResponse {
  runMonth: string | null;
  kpi:      PayrollAnalyticsKPI;
  data:     PayrollAnalyticsDimRow[];
}

export interface PayrollTrendRow {
  run_month:        string;
  headcount:        number;
  total_gross:      number;
  total_deductions: number;
  total_net:        number;
  month_label?:     string;
}

export function usePayrollAnalytics(
  runMonth: string | undefined,
  dimension: "department" | "branch" | "process" = "department"
) {
  return useQuery<PayrollAnalyticsResponse>({
    queryKey: ["payroll-analytics", runMonth, dimension],
    queryFn: async () => {
      const p = new URLSearchParams({ dimension });
      if (runMonth) p.set("runMonth", runMonth);
      const res = await hrmsApi.get<{ success: boolean; runMonth: string | null; kpi: any; data: any[] }>(
        `/api/payroll/analytics?${p}`
      );
      const totalNet = Number(res.kpi?.total_net ?? 0);
      return {
        runMonth: res.runMonth ?? null,
        kpi: {
          headcount:           Number(res.kpi?.headcount           ?? 0),
          total_net:           Number(res.kpi?.total_net           ?? 0),
          avg_net:             Number(res.kpi?.avg_net             ?? 0),
          total_gross:         Number(res.kpi?.total_gross         ?? 0),
          total_pf_employer:   Number(res.kpi?.total_pf_employer   ?? 0),
          total_esic_employer: Number(res.kpi?.total_esic_employer ?? 0),
        },
        data: (res.data ?? []).map((row) => ({
          ...row,
          headcount:           Number(row.headcount),
          total_net:           Number(row.total_net),
          total_gross:         Number(row.total_gross),
          total_pf_employer:   Number(row.total_pf_employer),
          total_esic_employer: Number(row.total_esic_employer),
          avg_net:      row.headcount > 0 ? Number(row.total_net) / Number(row.headcount) : 0,
          pct_of_total: totalNet > 0 ? (Number(row.total_net) / totalNet) * 100 : 0,
        })),
      };
    },
    staleTime: 2 * 60 * 1000,
  });
}

export interface PayrollRunSummary {
  id: string;
  run_month: string;
  status: string;
  total_employees: number;
}

export function usePayrollRunSummaries() {
  return useQuery<PayrollRunSummary[]>({
    queryKey: ["payroll-run-summaries"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        "/api/payroll/runs?limit=50"
      );
      return (res.data ?? []).map((r: any) => ({
        id: String(r.id),
        run_month: String(r.run_month ?? ""),
        status: String(r.status ?? ""),
        total_employees: Number(r.total_employees ?? 0),
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function usePayrollTrends(months = 6) {
  return useQuery<PayrollTrendRow[]>({
    queryKey: ["payroll-trends", months],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/payroll/analytics/trends?months=${months}`
      );
      return (res.data ?? []).map((row) => {
        const [yr, mo] = String(row.run_month ?? "").split("-");
        const label = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" })
          .format(new Date(Number(yr), Number(mo) - 1, 1));
        return {
          run_month:        String(row.run_month),
          headcount:        Number(row.headcount),
          total_gross:      Number(row.total_gross),
          total_deductions: Number(row.total_deductions),
          total_net:        Number(row.total_net),
          month_label:      label,
        };
      });
    },
    staleTime: 2 * 60 * 1000,
  });
}
