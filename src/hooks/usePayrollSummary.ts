import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export interface PayrollSummaryRecord {
  id: string;
  employeeCode: string;
  employeeName: string;
  branch: string;
  process: string;
  department: string;
  costCentre: string;
  basicSalary: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  status: string;
}

export interface PayrollSummary {
  month: number;
  year: number;
  monthName: string;
  totalBasic: number;
  totalAllowances: number;
  totalDeductions: number;
  totalNetSalary: number;
  employeeCount: number;
  records: PayrollSummaryRecord[];
}

const PAGE_SIZE = 1000;

function normalizeStatus(row: any): string {
  const raw = String(row.line_status ?? row.run_status ?? row.status ?? "processed").toLowerCase();
  if (["disbursed", "finalized", "finalised", "paid"].includes(raw)) return "paid";
  if (["processing", "reviewed", "approved", "locked", "calculated", "processed"].includes(raw)) return "processed";
  return raw || "processed";
}

export function usePayrollSummary(month: number, year: number, branchId?: string, processId?: string, costCentreId?: string) {
  const runMonth = `${year}-${String(month).padStart(2, '0')}`;
  return useQuery({
    queryKey: ["payroll-summary", month, year, branchId, processId, costCentreId],
    queryFn: async (): Promise<PayrollSummary> => {
      const allRows: any[] = [];
      let page = 1;
      const baseParams = [
        `runMonth=${runMonth}`,
        `limit=${PAGE_SIZE}`,
        branchId ? `branchId=${branchId}` : "",
        processId ? `processId=${processId}` : "",
        costCentreId ? `costCentreId=${costCentreId}` : "",
      ].filter(Boolean).join("&");
      while (true) {
        const response = await hrmsApi.get<{ success: boolean; data: any[]; total: number; page: number; limit: number }>(
          `/api/payroll/records?${baseParams}&page=${page}`
        );
        const batch = response.data ?? [];
        allRows.push(...batch);
        const total = Number((response as any).total ?? batch.length);
        if (allRows.length >= total || batch.length < PAGE_SIZE) break;
        page++;
      }

      const records: PayrollSummaryRecord[] = allRows.map((l: any) => {
        const basic = Number(l.basic ?? l.basic_salary ?? 0);
        const hra = Number(l.hra ?? 0);
        const special = Number(l.special_allowance ?? 0);
        const gross = Number(l.gross_salary ?? 0);
        const allowances = hra + special > 0 ? hra + special : Math.max(0, gross - basic);
        return {
          id: String(l.id ?? l.employee_id ?? l.employee_code),
          employeeCode: l.employee_code ?? '',
          employeeName: l.employee_name ?? 'Unknown',
          branch: l.branch_name ?? '-',
          process: l.process_name ?? '-',
          department: l.department_name ?? l.dept_name ?? l.process_name ?? '-',
          costCentre: l.cost_centre_name ?? '-',
          basicSalary: basic,
          allowances,
          deductions: Number(l.total_deductions ?? 0),
          netSalary: Number(l.net_salary ?? 0),
          status: normalizeStatus(l),
        };
      });

      return {
        month, year,
        monthName: `${MONTH_NAMES[month - 1]} ${year}`,
        totalBasic: records.reduce((s, r) => s + r.basicSalary, 0),
        totalAllowances: records.reduce((s, r) => s + r.allowances, 0),
        totalDeductions: records.reduce((s, r) => s + r.deductions, 0),
        totalNetSalary: records.reduce((s, r) => s + r.netSalary, 0),
        employeeCount: records.length,
        records,
      };
    },
  });
}
