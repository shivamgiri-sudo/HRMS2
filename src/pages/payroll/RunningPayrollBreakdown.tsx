/**
 * Running Salary Center — /payroll/running-breakdown
 *
 * Three-tab view for running-month salary:
 *   Employee  — single-employee search with full breakdown (original functionality)
 *   By Scope  — aggregate summary grouped by Branch / Process / Cost Centre
 *   My Salary — self-service view for employees (role-gated, hidden for managers)
 *
 * The "By Scope" tab uses the /api/payroll/running-summary-aggregate endpoint
 * which is a pure SQL aggregate (no per-employee compute loops) — fast even at
 * 1,000+ employee headcount.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, GitBranch, Layers, Users, IndianRupee,
  TrendingUp, ChevronRight, RefreshCw, Search, Calendar,
  CheckCircle2, Clock,
} from "lucide-react";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { RunningMonthCard, getIstRunMonth } from "@/components/payroll/RunningMonthCard";
import { cn } from "@/lib/utils";

const MANAGER_ROLES = [
  "payroll_head", "payroll_branch", "payroll", "payroll_admin",
  "admin", "super_admin", "wfm", "branch_head", "management",
  "hr", "hr_admin", "process_manager",
];

interface Employee {
  id: string; employee_code: string; name?: string;
  full_name?: string; first_name?: string; last_name?: string;
}

interface AggregateRow {
  group_id: string | null;
  group_name: string;
  group_type: string;
  headcount: number;
  total_gross: number;
  total_net: number;
  avg_gross: number;
  finalized_count: number;
  estimate_count: number;
}

interface AggregateResponse {
  success: boolean;
  data: AggregateRow[];
  run_month: string;
  group_by: string;
  total_headcount: number;
  total_gross: number;
  total_net: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function ScopeAggregateTab({ month }: { month: string }) {
  const [groupBy, setGroupBy] = useState<"branch" | "process" | "cost_centre">("branch");
  const [drillGroup, setDrillGroup] = useState<AggregateRow | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<AggregateResponse>({
    queryKey: ["running-aggregate", month, groupBy],
    queryFn: () =>
      hrmsApi.get(`/api/payroll/running-summary-aggregate?month=${month}&group_by=${groupBy}`) as Promise<AggregateResponse>,
    staleTime: 60_000,
  });

  const rows = data?.data ?? [];
  const totalGross = data?.total_gross ?? 0;
  const totalNet = data?.total_net ?? 0;
  const totalHC = data?.total_headcount ?? 0;

  const GROUP_ICONS = {
    branch: <Building2 className="w-4 h-4" />,
    process: <GitBranch className="w-4 h-4" />,
    cost_centre: <Layers className="w-4 h-4" />,
  };

  if (drillGroup) {
    return (
      <EmployeeDrilldown
        month={month}
        filterKey={groupBy === "branch" ? "branch_id" : groupBy === "process" ? "process_id" : "cost_centre_id"}
        filterId={drillGroup.group_id ?? ""}
        filterName={drillGroup.group_name}
        onBack={() => setDrillGroup(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Group-by selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["branch", "process", "cost_centre"] as const).map((g) => (
            <Button
              key={g}
              variant={groupBy === g ? "default" : "outline"}
              size="sm"
              onClick={() => setGroupBy(g)}
              className={cn("gap-1.5 text-xs capitalize", groupBy === g && "bg-indigo-600 hover:bg-indigo-700")}
            >
              {GROUP_ICONS[g]}
              {g.replace("_", " ")}
            </Button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 text-xs">
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Summary KPI tiles */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Total Headcount</p>
            <p className="text-2xl font-black text-blue-900 mt-1">{totalHC.toLocaleString()}</p>
            <p className="text-xs text-blue-500 mt-0.5">active with salary</p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-green-50 p-4">
            <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Total Gross</p>
            <p className="text-2xl font-black text-emerald-900 mt-1">{fmt(totalGross)}</p>
            <p className="text-xs text-emerald-500 mt-0.5">month projection</p>
          </div>
          <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-purple-50 p-4">
            <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide">Total Net Payable</p>
            <p className="text-2xl font-black text-violet-900 mt-1">{fmt(totalNet)}</p>
            <p className="text-xs text-violet-500 mt-0.5">after deductions</p>
          </div>
        </div>
      )}

      {/* Aggregate table */}
      <Card className="rounded-2xl border border-white/60 bg-white/95 shadow-sm">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            {GROUP_ICONS[groupBy]}
            Running salary by {groupBy.replace("_", " ")}
            {data?.run_month && (
              <Badge variant="outline" className="ml-auto text-xs font-normal">
                {data.run_month}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No data for this scope.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {rows.map((row, idx) => {
                const pct = totalGross > 0 ? Math.round((row.total_gross / totalGross) * 100) : 0;
                const allFinalized = row.finalized_count === row.headcount;
                const hasEstimates = row.estimate_count > 0;
                return (
                  <div
                    key={row.group_id ?? idx}
                    className="py-3 flex items-center gap-3 cursor-pointer group hover:bg-slate-50 rounded-xl px-2 -mx-2 transition-colors"
                    onClick={() => setDrillGroup(row)}
                  >
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      {GROUP_ICONS[groupBy]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800 truncate">{row.group_name}</span>
                        {allFinalized ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : hasEstimates ? (
                          <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-slate-500">
                          <Users className="w-3 h-3 inline mr-0.5" />{row.headcount}
                        </span>
                        <span className="text-xs text-slate-500">
                          Avg {fmt(row.avg_gross)}/head
                        </span>
                        {hasEstimates && (
                          <span className="text-xs text-amber-600">{row.estimate_count} estimate{row.estimate_count > 1 ? "s" : ""}</span>
                        )}
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-400" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-slate-800">{fmt(row.total_gross)}</p>
                      <p className="text-xs text-slate-400">{fmt(row.total_net)} net</p>
                      <p className="text-xs text-indigo-500 font-medium">{pct}%</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0 transition-colors" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmployeeDrilldown({
  month, filterKey, filterId, filterName, onBack,
}: {
  month: string; filterKey: string; filterId: string; filterName: string; onBack: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["running-batch-drill", month, filterKey, filterId, search, page],
    queryFn: () => {
      const qs = new URLSearchParams({ month, limit: String(LIMIT), page: String(page) });
      if (filterId) qs.set(filterKey, filterId);
      if (search.trim()) qs.set("search", search.trim());
      return hrmsApi.get(`/api/payroll/running-summary-batch?${qs}`) as Promise<any>;
    },
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  if (selectedEmpId) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setSelectedEmpId(null)} className="gap-1.5">
          ← Back to {filterName}
        </Button>
        <RunningMonthCard employeeId={selectedEmpId} month={month} self={false} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-sm">
          ← Back
        </Button>
        <h3 className="text-sm font-semibold text-slate-700">{filterName} — Employee list</h3>
        <Badge variant="outline" className="text-xs">{total} employees</Badge>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <Input
          className="pl-9 text-sm"
          placeholder="Search by name or code…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
      </div>
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white overflow-hidden">
          {rows.map((emp: any) => (
            <div
              key={emp.employee_id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors"
              onClick={() => setSelectedEmpId(emp.employee_id)}
            >
              <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                {emp.name?.charAt(0)?.toUpperCase() ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{emp.name}</p>
                <p className="text-xs text-slate-400">{emp.employee_code} · {emp.designation_name ?? emp.process_name ?? ""}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-slate-700">
                  {fmt(emp.earned_salary_till_date ?? emp.gross_salary ?? 0)}
                </p>
                <p className="text-xs text-slate-400">
                  {emp.is_finalized ? (
                    <span className="text-emerald-600">Finalized</span>
                  ) : (
                    <span className="text-amber-600">Estimate</span>
                  )}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
            </div>
          ))}
        </div>
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
          <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}
    </div>
  );
}

function EmployeeSearchTab({ month, isSelfOnly, employeeId }: {
  month: string; isSelfOnly: boolean; employeeId: string | null;
}) {
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

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

  const targetEmployeeId = isSelfOnly ? employeeId : selectedEmployee?.id ?? null;
  const showCard = isSelfOnly || !!selectedEmployee;

  return (
    <div className="space-y-4">
      {!isSelfOnly && (
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <Input
            className="pl-9 text-sm"
            placeholder="Search employee name or code…"
            value={search}
            onChange={(e) => searchEmployees(e.target.value)}
          />
          {suggestions.length > 0 && (
            <div className="absolute z-10 bg-popover border border-border rounded shadow mt-1 w-full max-h-48 overflow-y-auto">
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
      {showCard ? (
        <RunningMonthCard employeeId={targetEmployeeId} month={month} self={isSelfOnly} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
          Search and select an employee to see their running-month salary.
        </div>
      )}
    </div>
  );
}

export default function RunningPayrollBreakdown() {
  const { roleKeys, employeeId } = useWorkforceAccess();
  const isManager = MANAGER_ROLES.some(r => roleKeys.includes(r));
  const isSelfOnly = !isManager && roleKeys.includes("employee");

  const [runMonth, setRunMonth] = useState(getIstRunMonth());

  const isEmployee = roleKeys.includes("employee");
  const defaultTab = isSelfOnly ? "employee" : "scope";

  if (!isManager && !isEmployee) {
    return (
      <DashboardLayout>
        <div className="p-8 text-red-600">Access denied.</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-5 text-white">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Running Salary Center
              </h1>
              <p className="text-white/80 text-sm mt-0.5">
                Salary earned month-to-date using confirmed attendance. Once the run is locked, shows finalized figures.
              </p>
            </div>
            <div className="flex items-center gap-2 bg-white/15 rounded-xl px-3 py-2">
              <Calendar className="w-4 h-4 text-white/70" />
              <Input
                type="month"
                className="bg-transparent border-0 text-white text-sm w-32 p-0 focus-visible:ring-0 [color-scheme:dark]"
                value={runMonth}
                onChange={(e) => setRunMonth(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue={defaultTab}>
          <TabsList className="rounded-xl">
            {isManager && (
              <>
                <TabsTrigger value="scope" className="gap-1.5 text-xs sm:text-sm">
                  <Building2 className="w-3.5 h-3.5" />
                  By Scope
                </TabsTrigger>
                <TabsTrigger value="employee" className="gap-1.5 text-xs sm:text-sm">
                  <Users className="w-3.5 h-3.5" />
                  Employee
                </TabsTrigger>
              </>
            )}
            {isEmployee && (
              <TabsTrigger value="mine" className="gap-1.5 text-xs sm:text-sm">
                <IndianRupee className="w-3.5 h-3.5" />
                My Salary
              </TabsTrigger>
            )}
          </TabsList>

          {isManager && (
            <>
              <TabsContent value="scope" className="mt-4">
                <ScopeAggregateTab month={runMonth} />
              </TabsContent>
              <TabsContent value="employee" className="mt-4">
                <EmployeeSearchTab month={runMonth} isSelfOnly={false} employeeId={null} />
              </TabsContent>
            </>
          )}
          {isEmployee && (
            <TabsContent value="mine" className="mt-4">
              <EmployeeSearchTab month={runMonth} isSelfOnly={true} employeeId={employeeId} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
