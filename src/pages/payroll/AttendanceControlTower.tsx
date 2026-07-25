import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Database, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type ControlStatus = "ready" | "warning" | "blocked";

interface SourceCount {
  rows_count?: number;
  employees_count?: number;
}

interface GapRow {
  id: string;
  issueDate: string;
  employeeCode: string | null;
  employeeName: string | null;
  branchName: string | null;
  processName: string | null;
  issueType: string;
  severity: "blocker" | "warning";
  source: "apr" | "ncosec" | "adr" | "regularization" | "salary_prep";
  sourceMinutes: number | null;
  adrMinutes: number | null;
  adrStatus: string | null;
  payrollImpact: string;
  actionNeeded: string;
}

interface ControlTowerResponse {
  runMonth: string;
  from: string;
  to: string;
  run: {
    id: string;
    status: string;
    total_employees: number;
    total_net: number;
  } | null;
  status: ControlStatus;
  summary: {
    totalGaps: number;
    blockers: number;
    warnings: number;
    issueTypes: Record<string, number>;
    sourceCounts: {
      adr: SourceCount;
      ncosec: SourceCount;
      apr: SourceCount;
      regularization: SourceCount;
    };
  };
  readiness: any;
  gaps: GapRow[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_STYLE: Record<ControlStatus, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  blocked: "border-red-200 bg-red-50 text-red-800",
};

const SEVERITY_STYLE: Record<string, string> = {
  blocker: "bg-red-100 text-red-800 border-red-200",
  warning: "bg-amber-100 text-amber-800 border-amber-200",
};

const SOURCE_STYLE: Record<string, string> = {
  apr: "bg-sky-100 text-sky-800 border-sky-200",
  ncosec: "bg-indigo-100 text-indigo-800 border-indigo-200",
  regularization: "bg-emerald-100 text-emerald-800 border-emerald-200",
  salary_prep: "bg-slate-100 text-slate-800 border-slate-200",
  adr: "bg-zinc-100 text-zinc-800 border-zinc-200",
};

function currentRunMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function prettyIssue(value: string) {
  return value.replace(/_/g, " ");
}

function numberValue(value: unknown) {
  return Number(value ?? 0).toLocaleString("en-IN");
}

function StatCard({
  title,
  value,
  helper,
  icon,
}: {
  title: string;
  value: string;
  helper: string;
  icon: ReactNode;
}) {
  return (
    <Card className="rounded-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500">{title}</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{helper}</p>
          </div>
          <div className="rounded-md border bg-white p-2 text-slate-500">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AttendanceControlTower() {
  const [runMonth, setRunMonth] = useState(currentRunMonth());
  const [issueType, setIssueType] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 50;

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("runMonth", runMonth);
    p.set("page", String(page));
    p.set("limit", String(limit));
    if (issueType !== "all") p.set("issueType", issueType);
    if (search.trim()) p.set("search", search.trim());
    return p;
  }, [issueType, page, runMonth, search]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["payroll-attendance-control-tower", params.toString()],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: ControlTowerResponse }>(
        `/api/payroll/attendance-control-tower?${params.toString()}`,
      );
      return res.data;
    },
    staleTime: 30_000,
  });

  const issueOptions = Object.keys(data?.summary.issueTypes ?? {});
  const rows = data?.gaps ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / limit));
  const readiness = data?.readiness;
  const readinessBlockers = Number(readiness?.summary?.blockers ?? 0);
  const readinessWarnings = Number(readiness?.summary?.warnings ?? 0);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Payroll Attendance Control Tower</h1>
            <p className="mt-1 text-sm text-slate-500">
              NCOSEC, APR, HRMS attendance, regularization, and salary day checks for payroll confidence.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <Badge variant="outline" className={`h-8 px-3 capitalize ${STATUS_STYLE[data.status]}`}>
                {data.status === "ready" ? <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> : <ShieldAlert className="mr-1 h-3.5 w-3.5" />}
                {data.status}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_220px_220px_1fr_auto]">
              <div>
                <label className="text-xs font-medium text-slate-500" htmlFor="run-month">Payroll month</label>
                <Input
                  id="run-month"
                  type="month"
                  className="mt-1 h-9"
                  value={runMonth}
                  onChange={(event) => {
                    setRunMonth(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500" htmlFor="issue-type">Issue type</label>
                <select
                  id="issue-type"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={issueType}
                  onChange={(event) => {
                    setIssueType(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All issue types</option>
                  {issueOptions.map((type) => (
                    <option key={type} value={type}>{prettyIssue(type)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500" htmlFor="gap-search">Employee or process</label>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="gap-search"
                    className="h-9 pl-8"
                    placeholder="Search gaps"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
              <div className="flex items-end text-xs text-slate-500">
                {data?.run ? (
                  <span>Run {data.run.status} - {numberValue(data.run.total_employees)} employees - Net Rs {numberValue(data.run.total_net)}</span>
                ) : (
                  <span>No payroll run found for selected month.</span>
                )}
              </div>
              <div className="flex items-end">
                <Button variant="ghost" size="sm" onClick={() => { setIssueType("all"); setSearch(""); setPage(1); }}>
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Failed to load payroll attendance control data.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Open Gaps"
            value={numberValue(data?.summary.totalGaps)}
            helper={`${numberValue(data?.summary.blockers)} blockers, ${numberValue(data?.summary.warnings)} warnings`}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <StatCard
            title="Payroll Readiness"
            value={readiness?.canCalculate ? "Can calculate" : data?.run ? "Needs review" : "No run"}
            helper={`${readinessBlockers} blockers, ${readinessWarnings} warnings`}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatCard
            title="NCOSEC Imported"
            value={numberValue(data?.summary.sourceCounts.ncosec.rows_count)}
            helper={`${numberValue(data?.summary.sourceCounts.ncosec.employees_count)} employees with biometric rows`}
            icon={<Database className="h-4 w-4" />}
          />
          <StatCard
            title="APR Imported"
            value={numberValue(data?.summary.sourceCounts.apr.rows_count)}
            helper={`${numberValue(data?.summary.sourceCounts.apr.employees_count)} employees with APR rows`}
            icon={<Database className="h-4 w-4" />}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <Card className="rounded-md lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Issue Mix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(data?.summary.issueTypes ?? {}).length === 0 ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  No attendance-payroll gaps detected.
                </div>
              ) : (
                Object.entries(data?.summary.issueTypes ?? {}).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <span className="truncate">{prettyIssue(type)}</span>
                    <span className="font-semibold">{count}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-md lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>Employee Gap Register</span>
                <span className="text-xs font-normal text-slate-500">{numberValue(data?.total)} rows</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y bg-slate-50 text-xs text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-left font-medium">Employee</th>
                      <th className="px-3 py-2 text-left font-medium">Source</th>
                      <th className="px-3 py-2 text-left font-medium">Issue</th>
                      <th className="px-3 py-2 text-right font-medium">Source Min</th>
                      <th className="px-3 py-2 text-right font-medium">ADR Min</th>
                      <th className="px-3 py-2 text-left font-medium">ADR Status</th>
                      <th className="px-3 py-2 text-left font-medium">Impact</th>
                      <th className="px-3 py-2 text-left font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {isLoading && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-slate-500">Loading control checks...</td>
                      </tr>
                    )}
                    {!isLoading && rows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-slate-500">No gaps found for the selected filters.</td>
                      </tr>
                    )}
                    {!isLoading && rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{row.issueDate}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{row.employeeName ?? row.employeeCode ?? "-"}</div>
                          <div className="text-xs text-slate-500">{row.employeeCode ?? "-"} - {row.branchName ?? "No branch"} - {row.processName ?? "No process"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={SOURCE_STYLE[row.source] ?? SOURCE_STYLE.adr}>{row.source.replace("_", " ")}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="space-y-1">
                            <Badge variant="outline" className={SEVERITY_STYLE[row.severity]}>{row.severity}</Badge>
                            <div className="text-xs text-slate-600">{prettyIssue(row.issueType)}</div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.sourceMinutes ?? "-"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.adrMinutes ?? "-"}</td>
                        <td className="px-3 py-2 text-xs">{row.adrStatus ?? "-"}</td>
                        <td className="max-w-[260px] px-3 py-2 text-xs text-slate-600">{row.payrollImpact}</td>
                        <td className="max-w-[260px] px-3 py-2 text-xs text-slate-600">{row.actionNeeded}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t px-4 py-3">
                <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
