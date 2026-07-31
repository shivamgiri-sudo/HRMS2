import { useState } from "react";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Input } from "@/components/ui/input";
import { RunningMonthCard, getIstRunMonth } from "@/components/payroll/RunningMonthCard";

const ALLOWED_ROLES = ["payroll_head", "payroll_branch", "admin", "super_admin", "wfm", "employee"];

interface Employee { id: string; employee_code: string; name?: string; full_name?: string; first_name?: string; last_name?: string; }

export default function RunningPayrollBreakdown() {
  const { roleKeys, employeeId } = useWorkforceAccess();
  const isSelfOnly = roleKeys.length === 1 && roleKeys.includes("employee");

  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  // Payroll months are IST months — see getIstRunMonth(). This page previously
  // defaulted from the browser clock, which put non-IST users a month behind
  // around the boundary and disagreed with the Attendance Hub and Payslip pages.
  const [runMonth, setRunMonth] = useState(getIstRunMonth());

  const searchEmployees = (q: string) => {
    setSearch(q);
    if (q.length < 2) { setSuggestions([]); return; }
    hrmsApi.get<any>(`/api/employees?search=${encodeURIComponent(q)}`)
      .then((res) => {
        const data = res as any;
        setSuggestions(Array.isArray(data) ? data : data.employees ?? data.data ?? []);
      })
      .catch(() => {});
  };

  const getEmpName = (emp: Employee) =>
    emp.full_name ?? emp.name ?? (`${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() || emp.employee_code);

  const selectEmployee = (emp: Employee) => {
    setSelectedEmployee(emp);
    setSearch(`${getEmpName(emp)} (${emp.employee_code})`);
    setSuggestions([]);
  };

  if (!ALLOWED_ROLES.some(r => roleKeys.includes(r))) {
    return (
      <DashboardLayout>
        <div className="p-8 text-red-600">Access denied.</div>
      </DashboardLayout>
    );
  }

  // Employees read their own figure through the self-service endpoint; the
  // per-employee route is role-gated and would 403 for them.
  const targetEmployeeId = isSelfOnly ? employeeId : selectedEmployee?.id ?? null;
  const showCard = isSelfOnly || !!selectedEmployee;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Running Payroll Breakdown</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Salary earned from the 1st of the selected month up to today, using confirmed attendance.
            Deductions are prorated with the same PF/ESIC/PT rules as final payroll. Once the month's
            payroll run is locked, this shows the finalized figures instead of the live estimate.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          {!isSelfOnly && (
            <div className="relative">
              <Input
                className="w-64 text-sm"
                placeholder="Search employee name or code…"
                value={search}
                onChange={(e) => searchEmployees(e.target.value)}
              />
              {suggestions.length > 0 && (
                <div className="absolute z-10 bg-popover border border-border rounded shadow mt-1 w-64 max-h-48 overflow-y-auto">
                  {suggestions.map((emp) => (
                    <div
                      key={emp.id}
                      className="px-3 py-2 text-sm cursor-pointer hover:bg-muted"
                      onClick={() => selectEmployee(emp)}
                    >
                      {getEmpName(emp)} <span className="text-muted-foreground text-xs">({emp.employee_code})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <Input
            type="month"
            className="w-40 text-sm"
            value={runMonth}
            onChange={(e) => setRunMonth(e.target.value)}
          />
        </div>

        {showCard ? (
          <RunningMonthCard
            employeeId={targetEmployeeId}
            month={runMonth}
            self={isSelfOnly}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            Search and select an employee to see their running-month salary.
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
