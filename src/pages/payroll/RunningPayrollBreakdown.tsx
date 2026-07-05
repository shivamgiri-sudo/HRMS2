import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ALLOWED_ROLES = ["payroll_head", "payroll_branch", "admin", "super_admin", "wfm", "employee"];

interface Employee { id: number; employee_code: string; name: string; }

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

export default function RunningPayrollBreakdown() {
  const { user } = useAuth();
  const role = user?.role ?? "";
  const isSelfOnly = role === "employee";

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
    const token = localStorage.getItem("token");
    fetch(`/api/employees?search=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setSuggestions(Array.isArray(data) ? data : data.employees ?? []))
      .catch(() => {});
  };

  const fetchSummary = () => {
    setLoading(true);
    setError(null);
    setSummary(null);
    const token = localStorage.getItem("token");
    const runDate = `${runMonth}-01`;
    const endpoint = isSelfOnly
      ? `/api/payroll/running-summary/me?runMonth=${runDate}`
      : `/api/payroll/running-summary/${selectedEmployee!.id}?runMonth=${runDate}`;
    fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setSummary(data.data ?? data.summary ?? data))
      .catch(() => setError("Failed to load running summary."))
      .finally(() => setLoading(false));
  };

  const selectEmployee = (emp: Employee) => {
    setSelectedEmployee(emp);
    setSearch(`${emp.name} (${emp.employee_code})`);
    setSuggestions([]);
  };

  if (!ALLOWED_ROLES.includes(role)) {
    return <div className="p-8 text-red-600">Access denied.</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Running Payroll Breakdown</h1>
      <div className="flex flex-wrap gap-3 mb-6 items-end">
        {!isSelfOnly && (
          <div className="relative">
            <Input
              className="w-64 text-sm"
              placeholder="Search employee name or code…"
              value={search}
              onChange={(e) => searchEmployees(e.target.value)}
            />
            {suggestions.length > 0 && (
              <div className="absolute z-10 bg-white border rounded shadow mt-1 w-64 max-h-48 overflow-y-auto">
                {suggestions.map((emp) => (
                  <div
                    key={emp.id}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-muted"
                    onClick={() => selectEmployee(emp)}
                  >
                    {emp.name} <span className="text-muted-foreground text-xs">({emp.employee_code})</span>
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
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      {summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <SummaryCard label="Earned Payable Days" value={summary.earned_payable_days} />
            <SummaryCard label="Eligible Week-off Days (till date)" value={summary.eligible_weekoff_till_date} />
            <SummaryCard label="Eligible Holiday Days (till date)" value={summary.eligible_holiday_till_date} />
            <SummaryCard label="Earned Gross Till Date" value={`₹${Number(summary.earned_salary_till_date).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
            <SummaryCard label="Earned Net Till Date" value={`₹${Number(summary.earned_net_till_date).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
            <SummaryCard label="Projected Payable Days" value={summary.projected_payable_days} />
            <SummaryCard label="Projected Gross" value={`₹${Number(summary.projected_salary).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
            <SummaryCard label="Projected Net" value={`₹${Number(summary.projected_net).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
          </div>
          <div className="mb-4 border rounded-lg p-4 bg-muted/40">
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Deductions (prorated on earned days)</p>
            <div className="grid grid-cols-3 gap-3">
              <SummaryCard label="PF (Employee)" value={`₹${Number(summary.pf_employee).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
              <SummaryCard label="ESIC (Employee)" value={`₹${Number(summary.esic_employee).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
              <SummaryCard label="Professional Tax" value={`₹${Number(summary.professional_tax).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Earned figures = confirmed attendance to date. Projection assumes remaining rostered days are worked.
            Deductions are prorated on actual earned days using the same PF/ESIC/PT rules as payroll.
          </p>
        </>
      )}
    </div>
  );
}
