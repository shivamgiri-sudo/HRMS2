import { useState } from "react";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ALLOWED_ROLES = ["payroll_head", "payroll_branch", "admin", "super_admin", "wfm", "employee"];

interface Employee { id: string; employee_code: string; name?: string; full_name?: string; first_name?: string; last_name?: string; }

interface Summary {
  earned_payable_days: number;
  eligible_weekoff_till_date: number;
  eligible_holiday_till_date: number;
  earned_salary_till_date: number;
  earned_net_till_date: number;
  projected_payable_days: number;
  projected_salary: number;
  projected_net: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

const inr = (v: number) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export default function RunningPayrollBreakdown() {
  const { roleKeys } = useWorkforceAccess();
  const isSelfOnly = roleKeys.length === 1 && roleKeys.includes("employee");

  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [runMonth, setRunMonth] = useState(defaultMonth);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const fetchSummary = () => {
    setLoading(true);
    setError(null);
    setSummary(null);
    const endpoint = isSelfOnly
      ? `/api/payroll/running-summary/me?month=${runMonth}`
      : `/api/payroll/running-summary/${selectedEmployee!.id}?month=${runMonth}`;
    hrmsApi.get<any>(endpoint)
      .then((res) => {
        const data = res as any;
        setSummary(data.data ?? data.summary ?? data);
      })
      .catch((e: any) => setError(e.message ?? "Failed to load running summary."))
      .finally(() => setLoading(false));
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

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Running Payroll Breakdown</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Shows salary earned from the 1st of the selected month to today, plus a full-month projection assuming remaining rostered days are worked.
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
          <Button
            onClick={fetchSummary}
            disabled={loading || (!isSelfOnly && !selectedEmployee)}
          >
            {loading ? "Loading…" : "Load"}
          </Button>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

        {summary && (
          <>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Earned (confirmed attendance to date)</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <SummaryCard label="Earned Payable Days" value={summary.earned_payable_days} />
                <SummaryCard label="Eligible Week-off Days" value={summary.eligible_weekoff_till_date} />
                <SummaryCard label="Eligible Holiday Days" value={summary.eligible_holiday_till_date} />
                <SummaryCard label="Earned Gross Till Date" value={inr(summary.earned_salary_till_date)} />
                <SummaryCard label="Earned Net Till Date" value={inr(summary.earned_net_till_date)} />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Projected (assumes remaining rostered days worked)</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <SummaryCard label="Projected Payable Days" value={summary.projected_payable_days} />
                <SummaryCard label="Projected Gross" value={inr(summary.projected_salary)} />
                <SummaryCard label="Projected Net" value={inr(summary.projected_net)} />
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-muted/40">
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Deductions (prorated on earned days)</p>
              <div className="grid grid-cols-3 gap-3">
                <SummaryCard label="PF (Employee)" value={inr(summary.pf_employee)} />
                <SummaryCard label="ESIC (Employee)" value={inr(summary.esic_employee)} />
                <SummaryCard label="Professional Tax" value={inr(summary.professional_tax)} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Earned figures use confirmed attendance up to today. Projection assumes the remaining days in the month follow the roster. Deductions are prorated using the same PF/ESIC/PT rules as final payroll.
            </p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
