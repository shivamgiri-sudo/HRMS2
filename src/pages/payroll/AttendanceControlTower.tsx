import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bell, CheckCircle2, Database, MoreHorizontal, RefreshCw, RotateCcw, Search, ShieldAlert, UserCheck, X, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { AttendanceGapDetailDrawer } from "./AttendanceGapDetailDrawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
    availableIssueTypes?: string[];
    sourceCounts: {
      adr: SourceCount;
      ncosec: SourceCount;
      apr: SourceCount;
      regularization: SourceCount;
    };
    truncatedSources?: string[];
    sourceRowCap?: number;
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
  accent = "blue",
}: {
  title: string;
  value: string;
  helper: string;
  icon: ReactNode;
  accent?: "blue" | "red" | "amber" | "green" | "indigo" | "violet";
}) {
  const accentMap: Record<string, { card: string; iconBg: string; value: string }> = {
    blue:   { card: "border-blue-100 bg-gradient-to-br from-white to-blue-50/60",   iconBg: "bg-blue-100 text-blue-600",   value: "text-blue-700" },
    red:    { card: "border-red-100 bg-gradient-to-br from-white to-red-50/60",     iconBg: "bg-red-100 text-red-600",     value: "text-red-700" },
    amber:  { card: "border-amber-100 bg-gradient-to-br from-white to-amber-50/60", iconBg: "bg-amber-100 text-amber-600", value: "text-amber-700" },
    green:  { card: "border-emerald-100 bg-gradient-to-br from-white to-emerald-50/60", iconBg: "bg-emerald-100 text-emerald-600", value: "text-emerald-700" },
    indigo: { card: "border-indigo-100 bg-gradient-to-br from-white to-indigo-50/60", iconBg: "bg-indigo-100 text-indigo-600", value: "text-indigo-700" },
    violet: { card: "border-violet-100 bg-gradient-to-br from-white to-violet-50/60", iconBg: "bg-violet-100 text-violet-600", value: "text-violet-700" },
  };
  const s = accentMap[accent];
  return (
    <div className={`rounded-2xl border p-4 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${s.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
          <p className={`mt-2 text-2xl font-extrabold leading-none tabular-nums tracking-tight ${s.value}`}>{value}</p>
          <p className="mt-2 text-xs leading-snug text-slate-500">{helper}</p>
        </div>
        <div className={`rounded-xl p-2.5 ${s.iconBg}`}>{icon}</div>
      </div>
    </div>
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
  // Gap key whose drill-down drawer is open, per the platform drill-down rule.
  const [detailKey, setDetailKey] = useState<string | null>(null);
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

  // availableIssueTypes ignores the issue-type filter, so selecting one type no
  // longer empties the dropdown of every other type. Falls back to the old
  // behaviour if the backend has not been redeployed yet.
  const issueOptions = data?.summary.availableIssueTypes ?? Object.keys(data?.summary.issueTypes ?? {});
  const truncatedSources = data?.summary.truncatedSources ?? [];
  const { data: filterData, error: filterError } = useQuery({
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

  const totalIssues = Object.values(data?.summary.issueTypes ?? {}).reduce((a, b) => a + b, 0);

  // ── COSEC Re-sync Panel state ──
  const [resyncOpen, setResyncOpen] = useState(false);
  const [resyncDate, setResyncDate] = useState("");
  const [resyncDateTo, setResyncDateTo] = useState("");
  const [resyncEmpCode, setResyncEmpCode] = useState("");
  const [resyncResult, setResyncResult] = useState<null | {
    from: string; to: string; employeeCode: string | null;
    syncResult: any; syncError: string | null;
    beforeCount: number; afterCount: number;
    added: number; changed: number; removed: number; unchanged: number;
    diff: Array<{ employeeCode: string; date: string; status: string; before: any; after: any }>;
  }>(null);
  const resyncDrawerRef = useRef<HTMLDivElement>(null);

  const resyncMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      const dateVal = resyncDate.trim();
      const dateToVal = resyncDateTo.trim();
      if (dateVal && dateToVal && dateToVal !== dateVal) {
        body.from = dateVal;
        body.to = dateToVal;
      } else if (dateVal) {
        body.date = dateVal;
      }
      if (resyncEmpCode.trim()) body.employeeCode = resyncEmpCode.trim();
      const res = await hrmsApi.post<{ success: boolean; data: any }>(
        "/api/payroll/attendance-control-tower/resync-cosec",
        body,
      );
      return res.data;
    },
    onSuccess: (data) => {
      setResyncResult(data);
      refetch();
    },
  });

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1440px] space-y-4 p-4 sm:p-5">

        {/* ── Hero Header ── */}
        <div
          className="relative overflow-hidden rounded-2xl p-5 sm:p-6"
          style={{
            background: "linear-gradient(135deg, #073f78 0%, #0f5ca8 50%, #1B6AB5 100%)",
            boxShadow: "0 8px 32px rgba(7,63,120,0.35)",
          }}
        >
          {/* mesh pattern */}
          <div className="pointer-events-none absolute inset-0 opacity-10"
            style={{ backgroundImage: "radial-gradient(circle at 20% 50%, rgba(255,255,255,0.3) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.2) 0%, transparent 40%)" }} />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-200" />
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-200">Payroll Operations</span>
              </div>
              <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                Attendance Control Tower
              </h1>
              <p className="mt-1 max-w-xl text-sm text-blue-100/80">
                COSEC biometric · APR dialler · HRMS ADR · Regularization · Salary day checks
              </p>
              {data?.run && (
                <p className="mt-2 text-xs text-blue-200">
                  Run <span className="font-semibold capitalize">{data.run.status}</span> &mdash; {numberValue(data.run.total_employees)} employees &mdash; Net ₹{numberValue(data.run.total_net)}
                </p>
              )}
              {(() => {
                const [yr, mo] = runMonth.split("-").map(Number);
                const lastDay = new Date(yr, mo, 0);
                const diffDays = Math.ceil((lastDay.getTime() - Date.now()) / 86400000);
                if (diffDays < 0) return <p className="mt-1 text-xs text-blue-200/50">Run month closed</p>;
                if (diffDays === 0) return <p className="mt-1 text-xs font-semibold text-amber-200">Payroll cutoff today</p>;
                return (
                  <p className={`mt-1 text-xs font-medium ${diffDays <= 3 ? "text-amber-200" : "text-blue-200/70"}`}>
                    {diffDays <= 3 ? "⚠ " : ""}{diffDays} days to payroll cutoff ({lastDay.toLocaleDateString("en-IN", { day: "numeric", month: "short" })})
                  </p>
                );
              })()}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:items-start">
              {data && (
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold capitalize backdrop-blur-sm ${STATUS_STYLE[data.status]}`}>
                  {data.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                  {data.status}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-white/25 bg-white/10 text-white hover:bg-white/20"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
              <Button
                size="sm"
                className="h-9 border-white/25 bg-white/10 text-white hover:bg-white/20"
                variant="outline"
                onClick={() => { setResyncOpen(true); setResyncResult(null); }}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Re-sync COSEC
              </Button>
              <Button
                size="sm"
                className="h-9 bg-white text-blue-800 hover:bg-blue-50"
                onClick={() => notifyManagers.mutate(undefined)}
                disabled={notifyManagers.isPending || (selected.length ? selectedConflictCount === 0 : managerConflictCount === 0)}
              >
                <Bell className="mr-1.5 h-4 w-4" />
                {selected.length ? "Notify selected" : "Notify managers"}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Frozen snapshot warning ── */}
        {data?.run?.attendance_snapshot_locked ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <span><strong>Attendance snapshot is frozen.</strong> Changes resolved here won't affect the stored salary calculation — recalculation is disabled.</span>
          </div>
        ) : null}

        {/* ── Toast messages ── */}
        {notifyManagers.data && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            ✓ Sent {notifyManagers.data.notified} manager notifications for {notifyManagers.data.conflictCount} conflict rows.
            {notifyManagers.data.skippedNoManager > 0 ? ` ${notifyManagers.data.skippedNoManager} rows had no manager mapped.` : ""}
          </div>
        )}
        {updateReview.data && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            ✓ Updated {updateReview.data.updated} conflict rows.
          </div>
        )}
        {repairMissingAdr.data && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            ✓ Repaired {repairMissingAdr.data.repaired} ADR rows. {repairMissingAdr.data.skipped} rows skipped.
          </div>
        )}
        {(notifyManagers.error || repairMissingAdr.error) && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {notifyManagers.error ? "Failed to notify reporting managers." : "Failed to repair ADR missing rows."}
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Failed to load payroll attendance control data.
          </div>
        )}
        {filterError && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Branch and process filters could not be loaded, so those dropdowns are empty. The
            figures below still cover every branch and process you can see.
          </div>
        )}
        {truncatedSources.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Showing the first {data?.summary.sourceRowCap?.toLocaleString("en-IN")} rows from{" "}
            {truncatedSources.map(sourceLabel).join(", ")}. There are more gaps than are counted
            here — narrow the branch, process or date range to see the full picture.
          </div>
        )}

        {/* ── Filter Bar ── */}
        <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Month</label>
              <Input type="month" className="h-10 rounded-xl" value={runMonth}
                onChange={(e) => { setRunMonth(e.target.value); setPage(1); }} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Branch</label>
              <Select value={branchId} onValueChange={(v) => { setBranchId(v); setProcessId("all"); setPage(1); }}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="All branches" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name ?? b.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Process</label>
              <Select value={processId} onValueChange={(v) => { setProcessId(v); setPage(1); }}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="All processes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All processes</SelectItem>
                  {processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.process_name ?? p.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Issue Type</label>
              <Select value={issueType} onValueChange={(v) => { setIssueType(v); setPage(1); }}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="All issue types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All issue types</SelectItem>
                  {issueOptions.map((t) => <SelectItem key={t} value={t}>{prettyIssue(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Review State</label>
              <Select value={reviewStatus} onValueChange={(v) => { setReviewStatus(v); setPage(1); }}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="All states" /></SelectTrigger>
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
          </div>
          <div className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="h-10 rounded-xl pl-10"
                placeholder="Search by name or employee code…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
              />
            </div>
            <Button className="h-10 rounded-xl px-5" onClick={() => { setSearch(searchInput); setPage(1); }}>
              <Search className="mr-1.5 h-4 w-4" /> Search
            </Button>
            <Button variant="ghost" className="h-10 rounded-xl px-4 text-slate-500"
              onClick={() => { setIssueType("all"); setReviewStatus("all"); setSearch(""); setSearchInput(""); setBranchId("all"); setProcessId("all"); setPage(1); }}>
              Clear
            </Button>
          </div>
        </div>

        {/* ── Stat Tiles ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard title="Open Gaps" value={numberValue(data?.summary.totalGaps)}
            helper={`${numberValue(managerConflictCount)} manager conflicts`}
            icon={<AlertTriangle className="h-5 w-5" />}
            accent={(data?.summary.totalGaps ?? 0) > 0 ? "red" : "green"} />
          <StatCard title="Payroll Readiness" value={readiness?.canCalculate ? "Ready" : data?.run ? "Needs Review" : "No Run"}
            helper={`${readinessBlockers} blockers · ${readinessWarnings} warnings`}
            icon={<Activity className="h-5 w-5" />}
            accent={readiness?.canCalculate ? "green" : readinessBlockers > 0 ? "red" : "amber"} />
          <StatCard title="COSEC Rows" value={numberValue(data?.summary.sourceCounts.ncosec.rows_count)}
            helper={`${numberValue(data?.summary.sourceCounts.ncosec.employees_count)} employees`}
            icon={<Database className="h-5 w-5" />} accent="indigo" />
          <StatCard title="APR Rows" value={numberValue(data?.summary.sourceCounts.apr.rows_count)}
            helper={`${numberValue(data?.summary.sourceCounts.apr.employees_count)} employees`}
            icon={<Database className="h-5 w-5" />} accent="blue" />
          <StatCard title="ADR Missing" value={numberValue(missingAdrCount)}
            helper="Evidence exists, day record missing"
            icon={<AlertTriangle className="h-5 w-5" />}
            accent={missingAdrCount > 0 ? "amber" : "green"} />
        </div>

        {/* ── Review Queue Strip ── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Open", count: reviewQueue.open ?? 0, style: "border-amber-200 bg-amber-50/70", badge: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
            { label: "Manager Notified", count: reviewQueue.notified ?? 0, style: "border-blue-200 bg-blue-50/70", badge: "bg-blue-100 text-blue-800", dot: "bg-blue-500" },
            { label: "Needs Regularization", count: reviewQueue.regularization_required ?? 0, style: "border-violet-200 bg-violet-50/70", badge: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
          ].map((item) => (
            <div key={item.label} className={`flex items-center gap-4 rounded-2xl border px-4 py-3 backdrop-blur-sm ${item.style}`}>
              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${item.badge}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${item.dot}`} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{item.label}</p>
                <p className="mt-0.5 text-2xl font-extrabold tabular-nums leading-none text-slate-900">{numberValue(item.count)}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Queue Focus Pill Bar ── */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 backdrop-blur-sm">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Focus</span>
          {([
            { focus: "all", label: "All Open", count: null },
            { focus: "penalty", label: "Penalty Conflicts", count: managerConflictCount },
            { focus: "adr_missing", label: "ADR Missing", count: missingAdrCount },
            { focus: "regularization", label: "Regularization", count: regularizationGapCount },
          ] as const).map(({ focus, label, count }) => {
            const isActive = activeFocus === focus;
            return (
              <button
                key={focus}
                type="button"
                onClick={() => setIssueFocus(focus)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                  isActive
                    ? "bg-[#1B6AB5] text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-[#1B6AB5]/40 hover:text-[#1B6AB5]"
                }`}
              >
                {label}
                {count !== null && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${isActive ? "bg-white/25 text-white" : "bg-slate-100 text-slate-600"}`}>
                    {numberValue(count)}
                  </span>
                )}
              </button>
            );
          })}
          {activeFocus === "custom" && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">Custom filter active</span>
          )}
        </div>

        {/* ── Main Content: Issue Mix above table on standard monitors, side-by-side only on very wide ── */}
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[220px_1fr]">

          {/* Issue Mix */}
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 backdrop-blur-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-800">Issue Mix</h3>
            {Object.entries(data?.summary.issueTypes ?? {}).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                <p className="mt-2 text-sm font-medium text-emerald-700">No gaps detected</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {Object.entries(data?.summary.issueTypes ?? {}).sort(([, a], [, b]) => b - a).map(([type, count]) => {
                  const pct = totalIssues > 0 ? Math.round((count / totalIssues) * 100) : 0;
                  const isBlocker = ["dialler_penalty_biometric_supports_better", "biometric_penalty_dialler_supports_better"].includes(type);
                  return (
                    <div key={type}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-medium text-slate-600 capitalize">{prettyIssue(type)}</span>
                        <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${isBlocker ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {count}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all ${isBlocker ? "bg-red-400" : "bg-amber-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Employee Gap Register */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Employee Gap Register</h3>
                <p className="text-[11px] text-slate-400">{numberValue(data?.total)} rows · Page {page}/{totalPages}</p>
              </div>
            </div>

            {/* Bulk action bar */}
            {selected.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-blue-50 px-4 py-2.5">
                <span className="text-xs font-semibold text-blue-800">
                  {selected.length} selected
                  {selectedConflictCount > 0 ? ` · ${selectedConflictCount} conflict` : ""}
                  {selectedRepairCount > 0 ? ` · ${selectedRepairCount} ADR-repair` : ""}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => repairMissingAdr.mutate(selected.filter((id) => rows.some((row) => row.id === id && (row.issueType === "dialler_missing_adr" || row.issueType === "ncosec_missing_adr"))))}
                    disabled={repairMissingAdr.isPending || selectedRepairCount === 0}>Repair ADR</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateReview.mutate({ status: "regularization_required" })} disabled={updateReview.isPending}>
                    <UserCheck className="mr-1 h-3.5 w-3.5" />Needs Regularization
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateReview.mutate({ status: "reviewed" })} disabled={updateReview.isPending}>
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Mark Reviewed
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateReview.mutate({ status: "no_issue" })} disabled={updateReview.isPending}>
                    <XCircle className="mr-1 h-3.5 w-3.5" />No Issue
                  </Button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto [&_td]:!py-2 [&_td]:!px-3 [&_th]:!py-2 [&_th]:!px-3 [&_tr]:h-12 [&_td]:align-middle [&_td]:overflow-hidden">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead className="h-9 w-10 px-3">
                      <input type="checkbox" className="h-4 w-4 rounded border-slate-300"
                        checked={allSelectableSelected}
                        onChange={() => {
                          if (allSelectableSelected) setSelected((c) => c.filter((id) => !selectableRows.some((r) => r.id === id)));
                          else setSelected((c) => Array.from(new Set([...c, ...selectableRows.map((r) => r.id)])));
                        }}
                        aria-label="Select all" />
                    </TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Date</TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Employee</TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Source</TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Review</TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Resolved Via</TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Manager</TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Payroll ADR</TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">APR</TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">COSEC</TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Issue</TableHead>
                    <TableHead className="h-9 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Impact</TableHead>
                    <TableHead className="h-9 w-16 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Age</TableHead>
                    <TableHead className="h-9 w-12 px-3" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={14} className="py-12 text-center text-slate-400">
                        <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin opacity-40" />
                        Loading control checks…
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={14} className="py-12 text-center">
                        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                        <p className="text-sm font-medium text-slate-500">No gaps found for the selected filters.</p>
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && rows.map((row) => (
                    <TableRow
                      key={row.id}
                      onClick={() => setDetailKey(row.id)}
                      title="Open full detail"
                      className={`h-12 cursor-pointer transition-colors hover:bg-blue-50/30 ${REVIEW_ROW_STYLE[row.reviewStatus ?? "open"] ?? ""}`}
                    >
                      <TableCell className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                        {(row.issueType === "dialler_missing_adr" || row.issueType === "ncosec_missing_adr" ||
                          ["dialler_penalty_biometric_supports_better", "biometric_penalty_dialler_supports_better"].includes(row.issueType)) ? (
                          <input type="checkbox" className="h-4 w-4 rounded border-slate-300"
                            checked={selected.includes(row.id)} onChange={() => toggleSelected(row.id)}
                            aria-label={`Select ${row.employeeCode ?? row.employeeName ?? "row"}`} />
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-1.5 text-xs font-medium text-slate-600">{row.issueDate}</TableCell>
                      <TableCell className="px-3 py-1.5 min-w-[140px] max-w-[180px]">
                        <p className="text-sm font-semibold text-slate-900 leading-tight truncate">{row.employeeName ?? row.employeeCode ?? "—"}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400 leading-tight truncate">{row.employeeCode} · {row.branchName ?? "—"}</p>
                      </TableCell>
                      <TableCell className="px-3 py-1.5">
                        <Badge variant="outline" className={`text-[11px] ${SOURCE_STYLE[row.source] ?? SOURCE_STYLE.adr}`}>{sourceLabel(row.source)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[11px] ${REVIEW_STYLE[row.reviewStatus ?? "open"] ?? REVIEW_STYLE.open}`}>
                          {prettyIssue(row.reviewStatus ?? "open")}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[110px]">
                        <span className="truncate block text-xs font-medium text-slate-700">{row.resolvedThrough ?? "—"}</span>
                      </TableCell>
                      <TableCell className="max-w-[100px]">
                        <span className="truncate block text-xs font-medium text-slate-700">{row.reportingManagerName ?? "—"}</span>
                      </TableCell>
                      <TableCell className="max-w-[120px]">
                        <span className="truncate block text-xs font-medium text-slate-800">{row.payrollSourceLabel ?? "ADR"}</span>
                        <span className="truncate block text-[10px] text-slate-500">{formatEvidence(row.adrStatus, row.adrMinutes)}</span>
                      </TableCell>
                      <TableCell className="max-w-[100px]">
                        <span className="truncate block text-xs text-slate-600">{formatEvidence(row.aprStatus, row.aprMinutes)}</span>
                      </TableCell>
                      <TableCell className="max-w-[100px]">
                        <span className="truncate block text-xs text-slate-600">{formatEvidence(row.biometricStatus, row.biometricMinutes)}</span>
                      </TableCell>
                      <TableCell className="max-w-[130px]">
                        <Badge variant="outline" className={`text-[11px] ${SEVERITY_STYLE[row.severity]}`}>{row.severity}</Badge>
                        <p className="truncate text-[10px] text-slate-500 capitalize mt-0.5">{prettyIssue(row.issueType)}</p>
                      </TableCell>
                      <TableCell className="max-w-[150px]">
                        <span className="line-clamp-2 text-[11px] text-slate-500">{row.payrollImpact}</span>
                      </TableCell>
                      <TableCell className="px-3 py-1.5 text-right">
                        {(() => {
                          const d = daysOpen(row.reviewCreatedAt);
                          if (d === null) return <span className="text-slate-300 text-xs">—</span>;
                          return (
                            <span className={`inline-flex h-6 items-center rounded-full px-2 text-[11px] font-bold ${
                              d < 3 ? "bg-emerald-100 text-emerald-700" : d <= 7 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                            }`}>{d}d</span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-700">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            {["dialler_penalty_biometric_supports_better", "biometric_penalty_dialler_supports_better"].includes(row.issueType) && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => void notifySingleManager(row.id)}
                                  disabled={notifyManagers.isPending || !row.reportingManagerUserId}
                                >
                                  <Bell className="mr-2 h-4 w-4" /> Notify Manager
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void updateSingleReview(row.id, "regularization_required")} disabled={updateReview.isPending}>
                                  <UserCheck className="mr-2 h-4 w-4" /> Needs Regularization
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void updateSingleReview(row.id, "reviewed")} disabled={updateReview.isPending}>
                                  <CheckCircle2 className="mr-2 h-4 w-4" /> Mark Reviewed
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void updateSingleReview(row.id, "no_issue")} disabled={updateReview.isPending}>
                                  <XCircle className="mr-2 h-4 w-4" /> No Issue
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            {(row.issueType === "dialler_missing_adr" || row.issueType === "ncosec_missing_adr") && (
                              <DropdownMenuItem onClick={() => repairMissingAdr.mutate([row.id])} disabled={repairMissingAdr.isPending}>
                                <RefreshCw className="mr-2 h-4 w-4" /> Repair ADR
                              </DropdownMenuItem>
                            )}
                            {row.issueType === "salary_payable_days_mismatch" && row.employeeId && !data?.run?.attendance_snapshot_locked && (
                              <DropdownMenuItem
                                onClick={() => {
                                  if (!data?.run?.id) return;
                                  void hrmsApi.post(`/api/payroll/runs/${data.run!.id}/recalculate-drift`, { employee_ids: [row.employeeId] }).then(() => { void refetch(); });
                                }}
                              >
                                <RefreshCw className="mr-2 h-4 w-4" /> Recalculate Drift
                              </DropdownMenuItem>
                            )}
                            {row.employeeId && (
                              <DropdownMenuItem asChild>
                                <Link to={`/attendance-regularization?employeeId=${encodeURIComponent(row.employeeId)}&date=${encodeURIComponent(row.issueDate)}`}>
                                  <Activity className="mr-2 h-4 w-4" /> Open Regularization
                                </Link>
                              </DropdownMenuItem>
                            )}
                            {!["dialler_penalty_biometric_supports_better", "biometric_penalty_dialler_supports_better", "dialler_missing_adr", "ncosec_missing_adr"].includes(row.issueType) && !row.employeeId && (
                              <DropdownMenuItem disabled className="text-slate-400">No actions available</DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
              <span className="text-xs text-slate-400">Page {page} of {totalPages} · {numberValue(data?.total)} total</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 rounded-xl" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</Button>
                <Button variant="outline" size="sm" className="h-8 rounded-xl" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Salary Drift Panel ── */}
        {data?.run && (
          <div className="mt-2">
            <SalaryDriftPanel runId={data.run.id} runMonth={data.runMonth} snapshotLocked={Boolean(data.run.attendance_snapshot_locked)} />
          </div>
        )}

        {/* ── Row drill-down ── */}
        <AttendanceGapDetailDrawer gapKey={detailKey} onClose={() => setDetailKey(null)} />
      </div>

      {/* ── COSEC Re-sync Drawer ── */}
      {resyncOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setResyncOpen(false)} />
          <div ref={resyncDrawerRef} className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Re-sync COSEC Biometric</h2>
                <p className="text-xs text-slate-500 mt-0.5">Pull fresh punch data from COSEC server into mas_hrms for a specific date</p>
              </div>
              <button type="button" onClick={() => setResyncOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">From Date *</label>
                  <input
                    type="date"
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                    value={resyncDate}
                    onChange={(e) => setResyncDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">To Date (optional)</label>
                  <input
                    type="date"
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                    value={resyncDateTo}
                    min={resyncDate}
                    onChange={(e) => setResyncDateTo(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Employee Code (optional — blank = all employees)</label>
                <input
                  type="text"
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 placeholder:text-slate-300 focus:border-blue-500 focus:outline-none"
                  placeholder="e.g. MAS1042"
                  value={resyncEmpCode}
                  onChange={(e) => setResyncEmpCode(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-slate-400">Leave blank to re-sync all employees for the selected date range. The COSEC pull is always org-wide; this field only filters the before/after comparison shown below.</p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                <strong>Safe operation:</strong> Only re-writes <code>integration_biometric_daily</code> rows for the selected date range. Locked ADR rows, regularizations, and other employees/dates are not touched.
              </div>

              {resyncMutation.error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  {(resyncMutation.error as any)?.response?.data?.message ?? "Re-sync failed. Check if COSEC server is reachable."}
                </div>
              )}

              <Button
                className="w-full h-10 rounded-xl"
                onClick={() => resyncMutation.mutate()}
                disabled={!resyncDate || resyncMutation.isPending}
              >
                {resyncMutation.isPending ? (
                  <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Syncing from COSEC…</>
                ) : (
                  <><RotateCcw className="mr-2 h-4 w-4" /> Start Re-sync</>
                )}
              </Button>
            </div>

            {/* Result */}
            {resyncResult && (
              <div className="border-t px-5 py-4 space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Sync Result</p>
                  {resyncResult.syncError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                      COSEC sync error: {resyncResult.syncError}
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "Added", value: resyncResult.added, color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
                        { label: "Changed", value: resyncResult.changed, color: "text-amber-700 bg-amber-50 border-amber-200" },
                        { label: "Removed", value: resyncResult.removed, color: "text-red-700 bg-red-50 border-red-200" },
                        { label: "Unchanged", value: resyncResult.unchanged, color: "text-slate-600 bg-slate-50 border-slate-200" },
                      ].map((s) => (
                        <div key={s.label} className={`rounded-xl border px-3 py-2 text-center ${s.color}`}>
                          <p className="text-lg font-extrabold">{s.value}</p>
                          <p className="text-[10px] font-semibold uppercase">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {resyncResult.syncResult && (
                    <p className="mt-2 text-[11px] text-slate-500">
                      COSEC pull: {resyncResult.syncResult.pulledEvents ?? "—"} events · {resyncResult.syncResult.migratedDays ?? "—"} days migrated
                      {resyncResult.syncResult.unmappedUsers?.length > 0 ? ` · ${resyncResult.syncResult.unmappedUsers.length} unmapped` : ""}
                    </p>
                  )}
                </div>

                {/* Before / After table */}
                {resyncResult.diff.filter(d => d.status !== "unchanged").length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Changed rows ({resyncResult.diff.filter(d => d.status !== "unchanged").length})
                    </p>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-slate-500">Emp Code</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-500">Date</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-500">Change</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-500">Before (min)</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-500">After (min)</th>
                            <th className="px-3 py-2 text-right font-semibold text-slate-500">Punches</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {resyncResult.diff
                            .filter(d => d.status !== "unchanged")
                            .slice(0, 200)
                            .map((row, i) => (
                              <tr key={i} className={
                                row.status === "added" ? "bg-emerald-50" :
                                row.status === "changed" ? "bg-amber-50" :
                                row.status === "removed" ? "bg-red-50" : ""
                              }>
                                <td className="px-3 py-1.5 font-medium text-slate-800">{row.employeeCode}</td>
                                <td className="px-3 py-1.5 text-slate-600">{row.date}</td>
                                <td className="px-3 py-1.5">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    row.status === "added" ? "bg-emerald-100 text-emerald-700" :
                                    row.status === "changed" ? "bg-amber-100 text-amber-700" :
                                    "bg-red-100 text-red-700"
                                  }`}>{row.status}</span>
                                </td>
                                <td className="px-3 py-1.5 text-right text-slate-500">{row.before?.biometric_minutes ?? "—"}</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{row.after?.biometric_minutes ?? "—"}</td>
                                <td className="px-3 py-1.5 text-right text-slate-500">{row.after?.total_punches ?? row.before?.total_punches ?? "—"}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {resyncResult.diff.filter(d => d.status !== "unchanged").length > 200 && (
                        <p className="px-3 py-2 text-[11px] text-slate-400">Showing first 200 changed rows.</p>
                      )}
                    </div>
                  </div>
                )}

                {resyncResult.diff.filter(d => d.status !== "unchanged").length === 0 && !resyncResult.syncError && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    COSEC data is already up to date for this date range — no changes needed.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
