import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { format } from "date-fns";

export interface PayrollRecord {
  id: string;
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
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function usePayrollRecords(month?: number, year?: number) {
  return useQuery({
    queryKey: ["payroll-records", month, year],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (month !== undefined) params.set("month", String(month));
      if (year  !== undefined) params.set("year",  String(year));
      try {
        const res = await hrmsApi.get<{ success: boolean; data: any[] }>(`/api/payroll/runs?${params}`);
        return (res.data || []).map((run: any): PayrollRecord => ({
          id: run.id,
          employeeId: "",
          employeeCode: "",
          employee: { name: "", email: "" },
          month: run.run_month ?? "",
          monthNum: Number((run.run_month ?? "0-0").split("-")[1]),
          year:     Number((run.run_month ?? "0-0").split("-")[0]),
          basic: 0,
          allowances: 0,
          deductions: Number(run.total_deductions ?? 0),
          netSalary:  Number(run.total_net ?? 0),
          status: run.status === "disbursed" ? "paid" : run.status === "processing" || run.status === "locked" ? "processing" : "pending",
        }));
      } catch {
        console.warn("Payroll run management requires backend payroll module");
        return [] as PayrollRecord[];
      }
    },
  });
}

export interface PayrollStats {
  totalPayroll: number | null;
  employeeCount: number | null;
  avgSalary: number | null;
  pending: number | null;
}

export function usePayrollStats() {
  return useQuery<PayrollStats>({
    queryKey: ["payroll-stats"],
    queryFn: async (): Promise<PayrollStats> => {
      console.warn("Payroll run management requires backend payroll module");
      return {
        totalPayroll: null,
        employeeCount: null,
        avgSalary: null,
        pending: null,
      };
    },
  });
}

export function useGeneratePayroll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ month, year }: { month: number; year: number }) => {
      console.warn("Payroll run management requires backend payroll module");
      throw new Error("Payroll generation is managed through the backend payroll module. Please use the payroll run API directly.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-records"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-stats"] });
    },
  });
}

export function useUpdatePayrollStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "draft" | "processed" | "paid" }) => {
      console.warn("Payroll run management requires backend payroll module");
      throw new Error("Payroll status updates are managed through the backend payroll module.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-records"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-stats"] });
    },
  });
}

export function useBulkUpdatePayrollStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: "draft" | "processed" | "paid" }) => {
      console.warn("Payroll run management requires backend payroll module");
      throw new Error("Bulk payroll status updates are managed through the backend payroll module.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-records"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-stats"] });
    },
  });
}

export interface SalaryStructure {
  id: string;
  employeeId: string;
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
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/payroll/structures");
      return (res.data || []).map((s: any): SalaryStructure => {
        const hra = Number(s.hra ?? 0);
        const transportAllowance = Number(s.transport_allowance ?? 0);
        const medicalAllowance = Number(s.medical_allowance ?? 0);
        const otherAllowances = Number(s.other_allowances ?? 0);
        const taxDeduction = Number(s.tax_deduction ?? 0);
        const otherDeductions = Number(s.other_deductions ?? 0);
        const basicSalary = Number(s.basic_salary ?? 0);
        const totalAllowances = hra + transportAllowance + medicalAllowance + otherAllowances;
        const totalDeductions = taxDeduction + otherDeductions;
        const netSalary = basicSalary + totalAllowances - totalDeductions;

        return {
          id: s.id,
          employeeId: s.employee_id ?? "",
          employeeName: s.structure_name ?? `${s.employee?.first_name ?? ""} ${s.employee?.last_name ?? ""}`.trim(),
          employeeEmail: s.employee?.email ?? "",
          employeeAvatar: s.employee?.avatar_url ?? undefined,
          basicSalary,
          hra,
          transportAllowance,
          medicalAllowance,
          otherAllowances,
          taxDeduction,
          otherDeductions,
          effectiveFrom: s.effective_from ?? s.created_at ?? "",
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
