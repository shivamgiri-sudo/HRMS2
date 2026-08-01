import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bell, CheckCircle2, Database, RefreshCw, Search, ShieldAlert, UserCheck, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SalaryDriftPanel } from "@/components/payroll/SalaryDriftPanel";

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
  payrollSourceLabel?: string | null;
  aprMinutes?: number | null;
  aprStatus?: string | null;
  biometricMinutes?: number | null;
  biometricStatus?: string | null;
  payrollImpact: string;
  actionNeeded: string;
  employeeId?: string | null;
  reportingManagerName?: string | null;
  reportingManagerUserId?: string | null;
  reviewStatus?: string | null;
  reviewNote?: string | null;
  reviewCreatedAt?: string | null;
  resolvedThrough?: string | null;
  resolvedDetail?: string | null;
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
    attendance_snapshot_locked?: number | boolean;
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

interface FilterOption {
  id: string;
  branch_name?: string;
  process_name?: string;
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

const REVIEW_STYLE: Record<string, string> = {
  open: "bg-amber-50 text-amber-800 border-amber-200",
  notified: "bg-blue-50 text-blue-800 border-blue-200",
  regularization_required: "bg-violet-50 text-violet-800 border-violet-200",
  reviewed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  no_issue: "bg-slate-100 text-slate-700 border-slate-200",
};

const REVIEW_ROW_STYLE: Record<string, string> = {
  open: "bg-amber-50/40",
  notified: "bg-blue-50/40",
  regularization_required: "bg-violet-50/40",
  reviewed: "",
  no_issue: "",
};

function currentRunMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function prettyIssue(value: string) {
  return value.replace(/_/g, " ");
}

function sourceLabel(value: string) {
  if (value === "apr") return "APR dialler";
  if (value === "ncosec") return "COSEC biometric";
  if (value === "salary_prep") return "salary prep";
  return value.replace("_", " ");
}

function numberValue(value: unknown) {
  return Number(value ?? 0).toLocaleString("en-IN");
}

function formatEvidence(status: string | null | undefined, minutes: number | null | undefined) {
  if (!status && (minutes === null || minutes === undefined)) return "-";
  if (minutes === null || minutes === undefined) return prettyIssue(status ?? "-");
  return `${prettyIssue(status ?? "-")} (${minutes}m)`;
}

function includesIssue(type: string, set: string[]) {
  return set.includes(type);
}

function daysOpen(reviewCreatedAt: string | null | undefined): number | null {
  if (!reviewCreatedAt) return null;
  return Math.floor((Date.now() - new Date(reviewCreatedAt).getTime()) / 86400000);
}

function daysOpenStyle(days: number): string {
  if (days < 3) return "text-emerald-700";
  if (days <= 7) return "text-amber-700";
  return "text-red-600 font-semibold";
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
  const [reviewStatus, setReviewStatus] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState("all");
  const [processId, setProcessId] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const limit = 50;

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("runMonth", runMonth);
    p.set("page", String(page));
    p.set("limit", String(limit));
    if (issueType !== "all") p.set("issueType", issueType);
    if (reviewStatus !== "all") p.set("reviewStatus", reviewStatus);
    if (search.trim()) p.set("search", search.trim());
    if (branchId !== "all") p.set("branchId", branchId);
    if (processId !== "all") p.set("processId", processId);
    return p;
  }, [branchId, issueType, page, processId, reviewStatus, runMonth, search]);

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
  const { data: filterData } = useQuery({
    queryKey: ["payroll-attendance-control-filter-options", branchId],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (branchId !== "all") p.set("branchId", branchId);
      const res = await hrmsApi.get<{ success: boolean; data: { branches: FilterOption[]; processes: FilterOption[] } }>(
        `/api/payroll/filter-options?${p.toString()}`,
      );
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
  const branches = filterData?.branches ?? [];
  const processes = filterData?.processes ?? [];
  const rows = data?.gaps ?? [];
  const reviewQueue = rows.reduce(
    (acc, row) => {
      const status = String(row.reviewStatus ?? "open");
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / limit));
  const readiness = data?.readiness;
  const readinessBlockers = Number(readiness?.summary?.blockers ?? 0);
  const readinessWarnings = Number(readiness?.summary?.warnings ?? 0);
  const managerConflictCount =
    Number(data?.summary.issueTypes.dialler_penalty_biometric_supports_better ?? 0) +
    Number(data?.summary.issueTypes.biometric_penalty_dialler_supports_better ?? 0);
  const missingAdrCount =
    Number(data?.summary.issueTypes.dialler_missing_adr ?? 0) +
    Number(data?.summary.issueTypes.ncosec_missing_adr ?? 0);
  const regularizationGapCount = Number(data?.summary.issueTypes.approved_regularization_not_locked_in_adr ?? 0);
  const priorityIssueTypes = [
    "dialler_penalty_biometric_supports_better",
    "biometric_penalty_dialler_supports_better",
  ];
  const adrMissingIssueTypes = ["dialler_missing_adr", "ncosec_missing_adr", "ncosec_minutes_not_in_adr"];
  const regularizationIssueTypes = ["approved_regularization_not_locked_in_adr", "salary_payable_days_mismatch"];
  const activeFocus =
    issueType === "all"
      ? "all"
      : includesIssue(issueType, priorityIssueTypes)
        ? "penalty"
        : includesIssue(issueType, adrMissingIssueTypes)
          ? "adr_missing"
          : includesIssue(issueType, regularizationIssueTypes)
            ? "regularization"
            : "custom";

  const notifyManagers = useMutation({
    mutationFn: async (conflictKeys?: string[]) => {
      const res = await hrmsApi.post<{ success: boolean; data: { notified: number; skippedNoManager: number; conflictCount: number } }>(
        "/api/payroll/attendance-control-tower/notify-managers",
        {
          runMonth,
          issueType,
          reviewStatus,
          search,
          branchId: branchId !== "all" ? branchId : undefined,
          processId: processId !== "all" ? processId : undefined,
          conflictKeys: conflictKeys?.length ? conflictKeys : selected.length ? selected : undefined,
        },
      );
      return res.data;
    },
    onSuccess: () => {
      setSelected([]);
      refetch();
    },
  });

  const updateReview = useMutation({
    mutationFn: async ({ conflictKeys, status }: { conflictKeys?: string[]; status: "reviewed" | "no_issue" | "regularization_required" }) => {
      const res = await hrmsApi.post<{ success: boolean; data: { updated: number } }>(
        "/api/payroll/attendance-control-tower/review-status",
        { runMonth, conflictKeys: conflictKeys?.length ? conflictKeys : selected, status },
      );
      return res.data;
    },
    onSuccess: () => {
      setSelected([]);
      refetch();
    },
  });

  const repairMissingAdr = useMutation({
    mutationFn: async (conflictKeys: string[]) => {
      const res = await hrmsApi.post<{ success: boolean; data: { requested: number; repaired: number; skipped: number } }>(
        "/api/payroll/attendance-control-tower/repair-missing-adr",
        { conflictKeys },
      );
      return res.data;
    },
    onSuccess: () => {
      setSelected([]);
      refetch();
    },
  });

  const updateSingleReview = async (id: string, status: "reviewed" | "no_issue" | "regularization_required") => {
    await updateReview.mutateAsync({ conflictKeys: [id], status });
  };

  const notifySingleManager = async (id: string) => {
    await notifyManagers.mutateAsync([id]);
  };

  const selectableRows = rows.filter((row) =>
    row.issueType === "dialler_missing_adr" ||
    row.issueType === "ncosec_missing_adr" ||
    ["dialler_penalty_biometric_supports_better", "biometric_penalty_dialler_supports_better"].includes(row.issueType),
  );
  const selectedConflictCount = selected.filter((id) =>
    rows.some((row) => row.id === id && ["dialler_penalty_biometric_supports_better", "biometric_penalty_dialler_supports_better"].includes(row.issueType)),
  ).length;
  const selectedRepairCount = selected.filter((id) =>
    rows.some((row) => row.id === id && (row.issueType === "dialler_missing_adr" || row.issueType === "ncosec_missing_adr")),
  ).length;
  const allSelectableSelected = selectableRows.length > 0 && selectableRows.every((row) => selected.includes(row.id));
  const toggleSelected = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const setIssueFocus = (focus: "all" | "penalty" | "adr_missing" | "regularization") => {
    if (focus === "all") {
      setIssueType("all");
      setPage(1);
      return;
    }
    if (focus === "penalty") {
      setIssueType("biometric_penalty_dialler_supports_better");
      setPage(1);
      return;
    }
    if (focus === "adr_missing") {
      setIssueType("dialler_missing_adr");
      setPage(1);
      return;
    }
    setIssueType("approved_regularization_not_locked_in_adr");
    setPage(1);
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Payroll Attendance Control Tower</h1>
            <p className="mt-1 text-sm text-slate-500">
              COSEC biometric evidence, APR dialler evidence, HRMS ADR, regularization, and salary day checks for payroll confidence.
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
            <Button
              size="sm"
              onClick={() => notifyManagers.mutate()}
              disabled={notifyManagers.isPending || (selected.length ? selectedConflictCount === 0 : managerConflictCount === 0)}
            >
              <Bell className="h-4 w-4" />
              {selected.length ? "Notify selected" : "Notify managers"}
            </Button>
          </div>
        </div>

        {notifyManagers.data && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Sent {notifyManagers.data.notified} manager notifications for {notifyManagers.data.conflictCount} conflict rows.
            {notifyManagers.data.skippedNoManager > 0 ? ` ${notifyManagers.data.skippedNoManager} rows had no manager user mapped.` : ""}
          </div>
        )}
        {updateReview.data && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Updated {updateReview.data.updated} selected conflict rows.
          </div>
        )}
        {repairMissingAdr.data && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Repaired {repairMissingAdr.data.repaired} ADR rows. {repairMissingAdr.data.skipped} rows were skipped because they were protected or no longer repairable.
          </div>
        )}
        {notifyManagers.error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Failed to notify reporting managers.
          </div>
        )}
        {repairMissingAdr.error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Failed to repair ADR missing rows.
          </div>
        )}

        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[150px_180px_180px_210px_190px_1fr_110px_90px]">
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
                <label className="text-xs font-medium text-slate-500">Branch</label>
                <Select value={branchId} onValueChange={(value) => { setBranchId(value); setProcessId("all"); setPage(1); }}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue placeholder="All branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All branches</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>{branch.branch_name ?? branch.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Process</label>
                <Select value={processId} onValueChange={(value) => { setProcessId(value); setPage(1); }}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue placeholder="All processes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All processes</SelectItem>
                    {processes.map((process) => (
                      <SelectItem key={process.id} value={process.id}>{process.process_name ?? process.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500" htmlFor="issue-type">Issue type</label>
                <Select value={issueType} onValueChange={(value) => { setIssueType(value); setPage(1); }}>
                  <SelectTrigger id="issue-type" className="mt-1 h-9">
                    <SelectValue placeholder="All issue types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All issue types</SelectItem>
                    {issueOptions.map((type) => (
                      <SelectItem key={type} value={type}>{prettyIssue(type)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500" htmlFor="review-status">Review state</label>
                <Select value={reviewStatus} onValueChange={(value) => { setReviewStatus(value); setPage(1); }}>
                  <SelectTrigger id="review-status" className="mt-1 h-9">
                    <SelectValue placeholder="Open only" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Open queue</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="notified">Manager notified</SelectItem>
                    <SelectItem value="regularization_required">Regularization required</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="no_issue">No issue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500" htmlFor="gap-search">Employee search</label>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="gap-search"
                    className="h-9 pl-8"
                    placeholder="Name or employee code"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        setSearch(searchInput);
                        setPage(1);
                      }
                    }}
                  />
                </div>
              </div>
              <div className="flex items-end">
                <Button size="sm" className="h-9 w-full" onClick={() => { setSearch(searchInput); setPage(1); }}>
                  <Search className="h-4 w-4" />
                  Search
                </Button>
              </div>
              <div className="flex items-end">
                <Button variant="ghost" size="sm" className="h-9 w-full" onClick={() => { setIssueType("all"); setReviewStatus("all"); setSearch(""); setSearchInput(""); setBranchId("all"); setProcessId("all"); setPage(1); }}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">
                {data?.run ? (
                  <span>Run {data.run.status} - {numberValue(data.run.total_employees)} employees - Net Rs {numberValue(data.run.total_net)}</span>
                ) : (
                  <span>No payroll run found for selected month.</span>
                )}
            </div>
            {data?.run?.attendance_snapshot_locked ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2 text-sm text-amber-800 mb-2 mt-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
                <span><strong>Attendance snapshot is frozen.</strong> Changes resolved here won't affect the stored salary calculation — recalculation is disabled.</span>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Failed to load payroll attendance control data.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatCard
            title="Open Gaps"
            value={numberValue(data?.summary.totalGaps)}
            helper={`${numberValue(managerConflictCount)} manager-review conflicts`}
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
            helper={`${numberValue(data?.summary.sourceCounts.ncosec.employees_count)} employees with COSEC biometric rows`}
            icon={<Database className="h-4 w-4" />}
          />
          <StatCard
            title="APR Imported"
            value={numberValue(data?.summary.sourceCounts.apr.rows_count)}
            helper={`${numberValue(data?.summary.sourceCounts.apr.employees_count)} employees with APR dialler rows`}
            icon={<Database className="h-4 w-4" />}
          />
          <StatCard
            title="ADR Missing Days"
            value={numberValue(missingAdrCount)}
            helper="APR or COSEC evidence exists but payroll day record is missing"
            icon={<AlertTriangle className="h-4 w-4" />}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Card className="rounded-md">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs font-medium text-slate-500">Open Queue</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{numberValue(reviewQueue.open)}</p>
              </div>
              <Badge variant="outline" className={REVIEW_STYLE.open}>Open</Badge>
            </CardContent>
          </Card>
          <Card className="rounded-md">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs font-medium text-slate-500">Managers Notified</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{numberValue(reviewQueue.notified)}</p>
              </div>
              <Badge variant="outline" className={REVIEW_STYLE.notified}>Notified</Badge>
            </CardContent>
          </Card>
          <Card className="rounded-md">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs font-medium text-slate-500">Needs Regularization</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{numberValue(reviewQueue.regularization_required)}</p>
              </div>
              <Badge variant="outline" className={REVIEW_STYLE.regularization_required}>Regularization</Badge>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-md">
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <span className="text-xs font-medium text-slate-500">Queue focus</span>
            <Button
              size="sm"
              variant={activeFocus === "all" ? "default" : "outline"}
              className="h-8"
              onClick={() => setIssueFocus("all")}
            >
              All open
            </Button>
            <Button
              size="sm"
              variant={activeFocus === "penalty" ? "default" : "outline"}
              className="h-8"
              onClick={() => setIssueFocus("penalty")}
            >
              Penalty conflicts {numberValue(managerConflictCount)}
            </Button>
            <Button
              size="sm"
              variant={activeFocus === "adr_missing" ? "default" : "outline"}
              className="h-8"
              onClick={() => setIssueFocus("adr_missing")}
            >
              ADR missing {numberValue(missingAdrCount)}
            </Button>
            <Button
              size="sm"
              variant={activeFocus === "regularization" ? "default" : "outline"}
              className="h-8"
              onClick={() => setIssueFocus("regularization")}
            >
              Regularization blockers {numberValue(regularizationGapCount)}
            </Button>
            {activeFocus === "custom" ? (
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                Custom issue filter active
              </Badge>
            ) : null}
          </CardContent>
        </Card>

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
              {selected.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-y bg-slate-50 px-4 py-2">
                  <span className="text-xs font-medium text-slate-600">
                    {selected.length} rows selected
                    {selectedConflictCount > 0 ? ` - ${selectedConflictCount} manager-conflict` : ""}
                    {selectedRepairCount > 0 ? ` - ${selectedRepairCount} ADR-repair` : ""}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => repairMissingAdr.mutate(selected.filter((id) => rows.some((row) => row.id === id && (row.issueType === "dialler_missing_adr" || row.issueType === "ncosec_missing_adr"))))}
                      disabled={repairMissingAdr.isPending || selectedRepairCount === 0}
                    >
                      Repair ADR
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => updateReview.mutate({ status: "regularization_required" })} disabled={updateReview.isPending}>
                      <UserCheck className="h-4 w-4" />
                      Needs regularization
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => updateReview.mutate({ status: "reviewed" })} disabled={updateReview.isPending}>
                      <CheckCircle2 className="h-4 w-4" />
                      Mark reviewed
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => updateReview.mutate({ status: "no_issue" })} disabled={updateReview.isPending}>
                      <XCircle className="h-4 w-4" />
                      No issue
                    </Button>
                  </div>
                </div>
              )}
              <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 w-10 px-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={allSelectableSelected}
                          onChange={() => {
                            if (allSelectableSelected) {
                              setSelected((current) => current.filter((id) => !selectableRows.some((row) => row.id === id)));
                            } else {
                              setSelected((current) => Array.from(new Set([...current, ...selectableRows.map((row) => row.id)])));
                            }
                          }}
                          aria-label="Select all manager-review conflicts"
                        />
                      </TableHead>
                      <TableHead className="h-9 px-3">Date</TableHead>
                      <TableHead className="h-9 px-3">Employee</TableHead>
                      <TableHead className="h-9 px-3">Source</TableHead>
                      <TableHead className="h-9 px-3">Review</TableHead>
                      <TableHead className="h-9 px-3">Resolved Through</TableHead>
                      <TableHead className="h-9 px-3">Manager</TableHead>
                      <TableHead className="h-9 px-3">Payroll Result</TableHead>
                      <TableHead className="h-9 px-3">APR Evidence</TableHead>
                      <TableHead className="h-9 px-3">COSEC Evidence</TableHead>
                      <TableHead className="h-9 px-3">Issue</TableHead>
                      <TableHead className="h-9 px-3">Impact</TableHead>
                      <TableHead className="h-9 w-16 px-3 text-right">Days Open</TableHead>
                      <TableHead className="h-9 px-3">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={14} className="px-4 py-8 text-center text-slate-500">Loading control checks...</TableCell>
                      </TableRow>
                    )}
                    {!isLoading && rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={14} className="px-4 py-8 text-center text-slate-500">No gaps found for the selected filters.</TableCell>
                      </TableRow>
                    )}
                    {!isLoading && rows.map((row) => (
                      <TableRow key={row.id} className={REVIEW_ROW_STYLE[row.reviewStatus ?? "open"] ?? ""}>
                        <TableCell className="px-3 py-2">
                          {(
                            row.issueType === "dialler_missing_adr" ||
                            row.issueType === "ncosec_missing_adr" ||
                            ["dialler_penalty_biometric_supports_better", "biometric_penalty_dialler_supports_better"].includes(row.issueType)
                          ) ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300"
                              checked={selected.includes(row.id)}
                              onChange={() => toggleSelected(row.id)}
                              aria-label={`Select ${row.employeeCode ?? row.employeeName ?? "conflict row"}`}
                            />
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{row.issueDate}</TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="font-medium text-slate-900">{row.employeeName ?? row.employeeCode ?? "-"}</div>
                          <div className="text-xs text-slate-500">{row.employeeCode ?? "-"} - {row.branchName ?? "No branch"} - {row.processName ?? "No process"}</div>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant="outline" className={SOURCE_STYLE[row.source] ?? SOURCE_STYLE.adr}>{sourceLabel(row.source)}</Badge>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="space-y-1">
                            <Badge variant="outline" className={REVIEW_STYLE[row.reviewStatus ?? "open"] ?? REVIEW_STYLE.open}>
                              {prettyIssue(row.reviewStatus ?? "open")}
                            </Badge>
                            {row.reviewNote ? <div className="text-xs text-slate-500">{row.reviewNote}</div> : null}
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-slate-700">{row.resolvedThrough ?? "-"}</div>
                            {row.resolvedDetail ? <div className="text-xs text-slate-500">{row.resolvedDetail}</div> : null}
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="text-sm font-medium text-slate-700">{row.reportingManagerName ?? "-"}</div>
                          <div className="text-xs text-slate-500">{row.reportingManagerUserId ?? "No user mapping"}</div>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-slate-800">{row.payrollSourceLabel ?? "Payroll ADR"}</div>
                            <div className="text-xs text-slate-500">{formatEvidence(row.adrStatus, row.adrMinutes)}</div>
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="text-xs text-slate-600">{formatEvidence(row.aprStatus, row.aprMinutes)}</div>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="text-xs text-slate-600">{formatEvidence(row.biometricStatus, row.biometricMinutes)}</div>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="space-y-1">
                            <Badge variant="outline" className={SEVERITY_STYLE[row.severity]}>{row.severity}</Badge>
                            <div className="text-xs text-slate-600">{prettyIssue(row.issueType)}</div>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[260px] px-3 py-2 text-xs text-slate-600">{row.payrollImpact}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-xs">
                          {(() => { const d = daysOpen(row.reviewCreatedAt); if (d === null) return <span className="text-slate-400">—</span>; return <span className={daysOpenStyle(d)}>{d}d</span>; })()}
                        </TableCell>
                        <TableCell className="max-w-[260px] px-3 py-2">
                          <div className="space-y-2">
                            <div className="text-xs text-slate-600">{row.actionNeeded}</div>
                            <div className="flex flex-wrap gap-2">
                              {["dialler_penalty_biometric_supports_better", "biometric_penalty_dialler_supports_better"].includes(row.issueType) ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => void notifySingleManager(row.id)}
                                    disabled={notifyManagers.isPending || !row.reportingManagerUserId}
                                  >
                                    Notify
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => void updateSingleReview(row.id, "regularization_required")}
                                    disabled={updateReview.isPending}
                                  >
                                    Needs regularization
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => void updateSingleReview(row.id, "reviewed")}
                                    disabled={updateReview.isPending}
                                  >
                                    Reviewed
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 px-2 text-xs"
                                    onClick={() => void updateSingleReview(row.id, "no_issue")}
                                    disabled={updateReview.isPending}
                                  >
                                    No issue
                                  </Button>
                                </>
                              ) : null}
                              {row.issueType === "dialler_missing_adr" || row.issueType === "ncosec_missing_adr" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  onClick={() => repairMissingAdr.mutate([row.id])}
                                  disabled={repairMissingAdr.isPending}
                                >
                                  Repair ADR
                                </Button>
                              ) : null}
                              {row.issueType === "salary_payable_days_mismatch" && row.employeeId && !data?.run?.attendance_snapshot_locked && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                                  onClick={() => {
                                    if (!data?.run?.id) return;
                                    void hrmsApi.post(`/api/payroll/runs/${data.run!.id}/recalculate-drift`, {
                                      employee_ids: [row.employeeId],
                                    }).then(() => { void refetch(); });
                                  }}
                                >
                                  <RefreshCw className="h-3 w-3 mr-1" />Recalculate
                                </Button>
                              )}
                              {row.employeeId ? (
                                <Button asChild size="sm" variant="outline" className="h-8 px-2 text-xs">
                                  <Link to={`/attendance-regularization?employeeId=${encodeURIComponent(row.employeeId)}&date=${encodeURIComponent(row.issueDate)}`}>
                                    Open regularization
                                  </Link>
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
        {data?.run && (
          <div className="mt-6">
            <SalaryDriftPanel
              runId={data.run.id}
              runMonth={data.runMonth}
              snapshotLocked={Boolean(data.run.attendance_snapshot_locked)}
            />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
