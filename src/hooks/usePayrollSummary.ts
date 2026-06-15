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
  department: string;
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

export function usePayrollSummary(month: number, year: number) {
  const runMonth = `${year}-${String(month).padStart(2, '0')}`;
  return useQuery({
    queryKey: ["payroll-summary", month, year],
    queryFn: async (): Promise<PayrollSummary> => {
      // Step 1: fetch runs for this month to get run IDs
      const runsResult = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/payroll/runs?runMonth=${runMonth}`
      );
      const runs = runsResult.data ?? [];
      if (!runs.length) {
        return {
          month, year,
          monthName: `${MONTH_NAMES[month - 1]} ${year}`,
          totalBasic: 0, totalAllowances: 0, totalDeductions: 0,
          totalNetSalary: 0, employeeCount: 0, records: [],
        };
      }

      // Step 2: fetch salary lines for the first approved run
      const run = runs[0];
      const linesResult = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/payroll/runs/${run.id}/lines`
      );
      const lines = linesResult.data ?? [];

      const records: PayrollSummaryRecord[] = lines.map((l: any) => ({
        id: l.id ?? l.employee_id,
        employeeCode: l.employee_code ?? '',
        employeeName: l.employee_name ?? 'Unknown',
        department: l.department_name ?? l.dept_name ?? '-',
        basicSalary: Number(l.basic ?? l.basic_salary ?? 0),
        allowances: Number(l.gross_salary ?? 0) - Number(l.basic ?? 0),
        deductions: Number(l.total_deductions ?? 0),
        netSalary: Number(l.net_salary ?? 0),
        status: l.status ?? 'processed',
      }));

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
