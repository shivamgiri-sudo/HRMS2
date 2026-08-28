import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  FileCheck2,
  Lock,
  Users,
  TrendingUp,
  Banknote,
  RotateCcw,
  Info,
  ArrowRight,
} from "lucide-react";

import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { Textarea } from "../../components/ui/textarea";
import { useWorkforceAccess } from "../../hooks/useUserRole";
import { hrmsApi } from "../../lib/hrmsApi";
import { useFreezeAttendance } from "../../hooks/usePayroll";
import { useQuery } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BranchReadinessRow {
  branch_id: string;
  branch_name?: string;
  employee_count: number;
  attendance_frozen: number | boolean;
  incentives_status: string;
  bank_details_pct: number;
  uan_complete_pct: number;
  readiness_score: number;
  readiness_status: "not_started" | "in_progress" | "ready" | "blocked";
}

interface BranchReadinessSummary {
  rows: BranchReadinessRow[];
  ready_count: number;
  total_count: number;
}

interface PayrollRun {
  id: number | string;
  run_month: string;
  status: string;
  validation_status: string;
  attendance_snapshot_locked?: number | boolean;
}

interface PayrollLine {
  id: number | string;
  employee_code?: string;
  employee_name?: string;
  department?: string;
  designation?: string;
  attendance_source?: string;
  attendance_data_source?: string | null;
  paid_base?: number | null;
  week_off_days?: number | null;
  holiday_days?: number | null;
  calc_payable_days?: number | null;
  final_payable_days?: number | null;
  active_calendar_days?: number | null;
  leave_reversed_days?: number | null;
  gross_salary?: number | null;
  net_salary?: number | null;
  status?: string;
  needs_recalculation?: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, prefix = ""): string {
  if (n === null || n === undefined) return "—";
  return `${prefix}${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function ValidationBadge({ status }: { status: string }) {
  if (status === "validated") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Validated
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200">
        <XCircle className="w-3 h-3 mr-1" />
        Rejected
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 border-amber-200">
      <AlertTriangle className="w-3 h-3 mr-1" />
      Pending Validation
    </Badge>
  );
}

function AttSourceBadge({ source, dataSource }: { source?: string | null; dataSource?: string | null }) {
  const isFallback = dataSource === 'SESSION_FALLBACK';
  const isNoData   = dataSource === 'NO_DATA';
  if (isFallback || isNoData) {
    return (
      <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50" title="Attendance engine data unavailable — legacy session fallback used. Verify before disbursement.">
        <AlertTriangle className="w-3 h-3 mr-1" />
        {isNoData ? 'No Data' : 'Fallback'}
      </Badge>
    );
  }
  if (!source && !dataSource) return <span className="text-slate-400">—</span>;
  const isDialler = /apr|dialler|dial/i.test(source ?? '');
  return (
    <Badge
      variant="outline"
      className={
        isDialler
          ? "border-blue-300 text-blue-700 bg-blue-50"
          : "border-slate-300 text-slate-600 bg-slate-50"
      }
    >
      {isDialler ? "APR/Dialler" : "Biometric"}
    </Badge>
  );
}

function BranchReadinessGrid({ month }: { month: string }) {
  const { data, isError } = useQuery<BranchReadinessSummary>({
    queryKey: ["branch-readiness-summary", month],
    queryFn: async () => {
      const res = await hrmsApi.get<any>(
        `/api/payroll/branch-readiness/summary?month=${month}`,
      );
      return res as BranchReadinessSummary;
    },
    enabled: !!month,
    retry: false,
  });

  if (isError || !data) return null;
  if (!data.rows || data.rows.length === 0) return null;

  const readyCount = data.ready_count ?? data.rows.filter((r) => r.readiness_status === "ready").length;
  const totalCount = data.total_count ?? data.rows.length;
  const readinessPct = totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0;

  const statusBorder = (s: BranchReadinessRow["readiness_status"]) => {
    if (s === "ready") return "border-l-4 border-l-emerald-400";
    if (s === "in_progress") return "border-l-4 border-l-amber-400";
    return "border-l-4 border-l-red-400";
  };

  const statusBadge = (s: BranchReadinessRow["readiness_status"]) => {
    if (s === "ready") return "bg-emerald-100 text-emerald-800 border-emerald-200";
    if (s === "in_progress") return "bg-amber-100 text-amber-800 border-amber-200";
    return "bg-red-100 text-red-800 border-red-200";
  };

  return (
    <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b bg-slate-50/80 flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-slate-800">Branch Readiness Status</span>
        <div className="flex items-center gap-3 flex-1 max-w-xs">
          <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${readinessPct}%`,
                background: readinessPct === 100 ? "#22c55e" : readinessPct >= 60 ? "#f59e0b" : "#ef4444",
              }}
            />
          </div>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
              readyCount === totalCount
                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                : "bg-amber-100 text-amber-800 border-amber-200"
            }`}
          >
            {readyCount} / {totalCount} ready
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="whitespace-nowrap">Branch</TableHead>
              <TableHead className="whitespace-nowrap text-right">Employees</TableHead>
              <TableHead className="whitespace-nowrap text-center">Att. Frozen</TableHead>
              <TableHead className="whitespace-nowrap text-center">Incentives</TableHead>
              <TableHead className="whitespace-nowrap text-right">Bank %</TableHead>
              <TableHead className="whitespace-nowrap text-right">UAN %</TableHead>
              <TableHead className="whitespace-nowrap text-right">Score</TableHead>
              <TableHead className="whitespace-nowrap text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow
                key={row.branch_id}
                className={`hover:bg-slate-50 transition-colors ${statusBorder(row.readiness_status)}`}
              >
                <TableCell className="font-medium text-sm whitespace-nowrap">
                  {row.branch_name ?? row.branch_id}
                </TableCell>
                <TableCell className="text-right text-sm">{row.employee_count}</TableCell>
                <TableCell className="text-center">
                  {row.attendance_frozen ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 mx-auto" />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      row.incentives_status === "approved"
                        ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                        : row.incentives_status === "uploaded"
                        ? "bg-blue-100 text-blue-700 border border-blue-200"
                        : "bg-slate-100 text-slate-500 border border-slate-200"
                    }`}
                  >
                    {row.incentives_status === "not_uploaded" ? "Not Uploaded" : row.incentives_status}
                  </span>
                </TableCell>
                <TableCell className="text-right text-sm font-mono">
                  <span className={Number(row.bank_details_pct) < 80 ? "text-amber-700 font-semibold" : "text-slate-700"}>
                    {Number(row.bank_details_pct).toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell className="text-right text-sm font-mono">
                  <span className={Number(row.uan_complete_pct) < 80 ? "text-amber-700 font-semibold" : "text-slate-700"}>
                    {Number(row.uan_complete_pct).toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="w-12 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(Number(row.readiness_score), 100)}%`,
                          background: Number(row.readiness_score) >= 80 ? "#22c55e" : Number(row.readiness_score) >= 50 ? "#f59e0b" : "#ef4444",
                        }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-slate-800">
                      {Number(row.readiness_score).toFixed(1)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${statusBadge(row.readiness_status)}`}>
                    {row.readiness_status.replace("_", " ")}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Gradient KPI Tile ────────────────────────────────────────────────────────

type KpiTone = "blue" | "green" | "amber" | "red" | "violet" | "slate";

const TONE_STYLES: Record<KpiTone, { bg: string; border: string; label: string; value: string; icon: string }> = {
  blue:   { bg: "from-blue-50 to-indigo-50",    border: "border-blue-200",   label: "text-blue-600",   value: "text-blue-900",   icon: "bg-blue-100 text-blue-600"   },
  green:  { bg: "from-emerald-50 to-green-50",  border: "border-emerald-200",label: "text-emerald-600",value: "text-emerald-900",icon: "bg-emerald-100 text-emerald-600" },
  amber:  { bg: "from-amber-50 to-orange-50",   border: "border-amber-200",  label: "text-amber-700",  value: "text-amber-900",  icon: "bg-amber-100 text-amber-700" },
  red:    { bg: "from-red-50 to-rose-50",        border: "border-red-200",    label: "text-red-600",    value: "text-red-900",    icon: "bg-red-100 text-red-600"     },
  violet: { bg: "from-violet-50 to-purple-50",  border: "border-violet-200", label: "text-violet-600", value: "text-violet-900", icon: "bg-violet-100 text-violet-600" },
  slate:  { bg: "from-slate-50 to-slate-100",   border: "border-slate-200",  label: "text-slate-500",  value: "text-slate-900",  icon: "bg-slate-100 text-slate-600" },
};

function GradientKpiTile({
  label,
  value,
  tone,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string | number;
  tone: KpiTone;
  icon: React.ElementType;
  sub?: string;
}) {
  const s = TONE_STYLES[tone];
  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${s.bg} ${s.border} p-4 shadow-sm`}>
      <div className="flex items-start justify-between mb-3">
        <p className={`text-xs font-semibold uppercase tracking-wide ${s.label}`}>{label}</p>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${s.icon}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <p className={`text-2xl font-bold ${s.value}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${s.label} opacity-80`}>{sub}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PayrollValidationScreen() {
  const { roleKeys } = useWorkforceAccess();
  const canValidate = roleKeys.some((r) =>
    ["payroll_head", "super_admin"].includes(r),
  );

  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const freezeAttendance = useFreezeAttendance();

  // ── Fetch runs list ──────────────────────────────────────────────────────────
  const fetchRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await hrmsApi.get<any>("/api/payroll/runs?limit=24");
      const list: PayrollRun[] = Array.isArray(data)
        ? data
        : data?.runs ?? data?.data ?? [];
      setRuns(list);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load payroll runs");
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // ── Fetch lines for selected run ─────────────────────────────────────────────
  const fetchLines = useCallback(async (runId: string) => {
    if (!runId) return;
    setLoading(true);
    setLines([]);
    try {
      const data = await hrmsApi.get<any>(
        `/api/payroll/runs/${runId}/lines`,
      );
      const raw = Array.isArray(data) ? data : (data?.lines ?? data?.data?.lines ?? (Array.isArray(data?.data) ? data?.data : null) ?? []);
      const list: PayrollLine[] = Array.isArray(raw) ? raw : [];
      setLines(list);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load payroll lines");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRunChange = (runId: string) => {
    setSelectedRunId(runId);
    fetchLines(runId);
  };

  // ── Selected run object ──────────────────────────────────────────────────────
  const selectedRun = runs.find(
    (r) => String(r.id) === String(selectedRunId),
  );

  // ── Freeze attendance ────────────────────────────────────────────────────────
  const handleFreezeAttendance = async () => {
    if (!selectedRunId) return;
    setActionLoading(true);
    try {
      await freezeAttendance.mutateAsync(selectedRunId);
      toast.success("Attendance frozen — payroll can now be calculated");
      await fetchRuns();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to freeze attendance");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Validate ─────────────────────────────────────────────────────────────────
  const handleValidate = async () => {
    if (!selectedRunId) return;
    setActionLoading(true);
    try {
      await hrmsApi.patch(`/api/payroll/runs/${selectedRunId}/validate`, {});
      toast.success("Payroll run validated successfully");
      await fetchRuns();
    } catch (err: any) {
      toast.error(err?.message ?? "Validation failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Reject ───────────────────────────────────────────────────────────────────
  const handleRejectSubmit = async () => {
    if (!selectedRunId || !rejectReason.trim()) {
      toast.warning("Please enter a rejection reason");
      return;
    }
    setActionLoading(true);
    try {
      await hrmsApi.patch(
        `/api/payroll/runs/${selectedRunId}/reject-validation`,
        { reason: rejectReason.trim() },
      );
      toast.success("Payroll run rejected");
      setRejectOpen(false);
      setRejectReason("");
      await fetchRuns();
    } catch (err: any) {
      toast.error(err?.message ?? "Rejection failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Selected month (derived from run) ───────────────────────────────────────
  const selectedMonth = selectedRun?.run_month ?? "";

  // ── KPI aggregates ───────────────────────────────────────────────────────────
  const totalEmployees = lines.length;
  const totalGross = lines.reduce(
    (s, l) => s + (Number(l.gross_salary) || 0),
    0,
  );
  const totalNet = lines.reduce(
    (s, l) => s + (Number(l.net_salary) || 0),
    0,
  );
  const leaveReversedCount = lines.filter(
    (l) => l.leave_reversed_days !== null && l.leave_reversed_days !== undefined && Number(l.leave_reversed_days) > 0,
  ).length;
  const needsRecalcCount = lines.filter(
    (l) => l.needs_recalculation === 1,
  ).length;
  const fallbackAttCount = lines.filter(
    (l) => l.attendance_data_source === "SESSION_FALLBACK" || l.attendance_data_source === "NO_DATA",
  ).length;

  // ── Role guard ───────────────────────────────────────────────────────────────
  if (!canValidate) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-slate-500">
          Access restricted to Head Payroll
        </div>
      </DashboardLayout>
    );
  }

  const validationStatus = selectedRun?.validation_status ?? "";
  const isAttendanceFrozen = Boolean(selectedRun?.attendance_snapshot_locked);
  const validateDisabled =
    validationStatus === "validated" || lines.length === 0 || actionLoading;
  const rejectDisabled =
    validationStatus === "rejected" || lines.length === 0 || actionLoading;
  const freezeDisabled =
    !selectedRunId || isAttendanceFrozen || actionLoading;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-5">

        {/* ── Gradient Header ────────────────────────────────────────────── */}
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-700 text-white px-6 py-5 shadow-lg">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <FileCheck2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Payroll Validation</h1>
                <p className="text-indigo-200 text-sm mt-0.5">
                  Review attendance, salary lines and branch readiness before NEFT export
                </p>
              </div>
            </div>
            {selectedRun && (
              <div className="flex items-center gap-2 flex-wrap">
                <ValidationBadge status={validationStatus} />
                <Badge
                  variant="outline"
                  className={`border-white/40 ${isAttendanceFrozen
                    ? "bg-white/20 text-white"
                    : "bg-amber-500/30 text-amber-100 border-amber-400/50"
                  }`}
                >
                  <Lock className="w-3 h-3 mr-1" />
                  {isAttendanceFrozen ? "Attendance Frozen" : "Attendance Not Frozen"}
                </Badge>
              </div>
            )}
          </div>
        </div>

        {/* ── Run selector + action bar ──────────────────────────────────── */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm px-5 py-4">
          <div className="flex gap-3 items-center flex-wrap">
            <Select
              value={selectedRunId}
              onValueChange={handleRunChange}
              disabled={runsLoading}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder={runsLoading ? "Loading runs…" : "Select payroll run"} />
              </SelectTrigger>
              <SelectContent>
                {runs.map((run) => (
                  <SelectItem key={String(run.id)} value={String(run.id)}>
                    {run.run_month} — {run.status ?? ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="ml-auto flex gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={fetchRuns}
                size="sm"
                disabled={runsLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${runsLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                variant="outline"
                onClick={handleFreezeAttendance}
                disabled={freezeDisabled}
                className="border-blue-300 text-blue-700 hover:bg-blue-50"
                title={isAttendanceFrozen ? "Attendance already frozen" : "Lock attendance before calculating payroll"}
              >
                <Lock className="w-4 h-4 mr-1" />
                {isAttendanceFrozen ? "Frozen" : "Freeze Attendance"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setRejectOpen(true)}
                disabled={rejectDisabled}
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                <XCircle className="w-4 h-4 mr-1" />
                Reject Run
              </Button>
              <Button
                onClick={handleValidate}
                disabled={validateDisabled}
                className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white shadow-md shadow-indigo-500/25"
              >
                <CheckCircle2 className="w-4 h-4 mr-1" />
                Validate Run
              </Button>
            </div>
          </div>
        </div>

        {/* ── Exclusion Warning Banner (shown when a run is selected) ────── */}
        {selectedRunId && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 shadow-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">Some employees may be excluded from this run</p>
              <p className="text-sm text-amber-700 mt-0.5">
                Employees with pending Payroll Head salary package review are silently excluded.
                Verify count before validating.
              </p>
            </div>
            <a
              href="/payroll/salary-review"
              className="flex items-center gap-1 text-sm font-semibold text-amber-800 underline whitespace-nowrap hover:text-amber-900 shrink-0"
            >
              Salary Review <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        {/* ── Branch Readiness ───────────────────────────────────────────── */}
        {selectedMonth && <BranchReadinessGrid month={selectedMonth} />}

        {/* ── KPI Tiles ─────────────────────────────────────────────────── */}
        {selectedRunId && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <GradientKpiTile
              label="Total Employees"
              value={totalEmployees}
              tone="blue"
              icon={Users}
              sub="in this run"
            />
            <GradientKpiTile
              label="Total Gross"
              value={`₹ ${(totalGross / 100000).toFixed(1)}L`}
              tone="slate"
              icon={TrendingUp}
              sub={`₹ ${totalGross.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
            />
            <GradientKpiTile
              label="Total Net Payable"
              value={`₹ ${(totalNet / 100000).toFixed(1)}L`}
              tone="green"
              icon={Banknote}
              sub={`₹ ${totalNet.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
            />
            <GradientKpiTile
              label="Needs Recalculation"
              value={needsRecalcCount}
              tone={needsRecalcCount > 0 ? "amber" : "green"}
              icon={RotateCcw}
              sub={needsRecalcCount > 0 ? "pending re-run" : "all up to date"}
            />
            <GradientKpiTile
              label="Fallback Att. Source"
              value={fallbackAttCount}
              tone={fallbackAttCount > 0 ? "red" : "green"}
              icon={Info}
              sub={fallbackAttCount > 0 ? "manual verify required" : "all biometric / APR"}
            />
          </div>
        )}

        {/* ── Salary Lines Table ─────────────────────────────────────────── */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b bg-slate-50/80 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">
              Salary Preparation Lines
              {lines.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-400">
                  ({lines.length} records)
                </span>
              )}
            </p>
            {needsRecalcCount > 0 && (
              <span className="text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                {needsRecalcCount} need recalculation
              </span>
            )}
          </div>

          {!selectedRunId ? (
            <div className="p-10 text-center text-slate-400 text-sm">
              Select a payroll run to view lines
            </div>
          ) : loading ? (
            <div className="p-10 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Loading payroll lines…
            </div>
          ) : lines.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">
              No salary lines found for this run
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="whitespace-nowrap">Emp Code</TableHead>
                    <TableHead className="whitespace-nowrap">Name</TableHead>
                    <TableHead className="whitespace-nowrap">Dept / Designation</TableHead>
                    <TableHead className="whitespace-nowrap">Att. Source</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Paid Base (₹)</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Week-offs</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Holidays</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Calc Payable</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Final Payable</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Leave Reversed</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Gross (₹)</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Net (₹)</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, idx) => {
                    const capHit =
                      line.final_payable_days !== null &&
                      line.final_payable_days !== undefined &&
                      line.active_calendar_days !== null &&
                      line.active_calendar_days !== undefined &&
                      Number(line.final_payable_days) >=
                        Number(line.active_calendar_days);

                    const isFallback =
                      line.attendance_data_source === "SESSION_FALLBACK" ||
                      line.attendance_data_source === "NO_DATA";

                    const rowBorder =
                      line.needs_recalculation === 1
                        ? "border-l-4 border-l-amber-400"
                        : isFallback
                        ? "border-l-4 border-l-orange-400"
                        : line.status === "finalised" || line.status === "finalized"
                        ? "border-l-4 border-l-emerald-300"
                        : "border-l-4 border-l-transparent";

                    return (
                      <TableRow
                        key={String(line.id ?? idx)}
                        className={`hover:bg-slate-50 transition-colors ${rowBorder}`}
                      >
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {line.employee_code ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {line.needs_recalculation === 1 && (
                              <span title="Needs recalculation" className="shrink-0">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                              </span>
                            )}
                            <span>{line.employee_name ?? "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-slate-500">
                          <div>{line.department ?? "—"}</div>
                          <div className="text-slate-400">{line.designation ?? ""}</div>
                        </TableCell>
                        <TableCell>
                          <AttSourceBadge source={line.attendance_source} dataSource={line.attendance_data_source} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {fmt(line.paid_base)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {fmt(line.week_off_days)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {fmt(line.holiday_days)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {fmt(line.calc_payable_days)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {line.final_payable_days !== null &&
                          line.final_payable_days !== undefined ? (
                            <span
                              className={
                                capHit
                                  ? "font-semibold text-amber-700"
                                  : "font-semibold text-emerald-700"
                              }
                              title={capHit ? "Calendar cap reached" : undefined}
                            >
                              {Number(line.final_payable_days).toFixed(1)}
                              {capHit && (
                                <span className="ml-1 text-xs text-amber-500">⚠</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {line.leave_reversed_days !== null &&
                          line.leave_reversed_days !== undefined
                            ? Number(line.leave_reversed_days).toFixed(1)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {fmt(line.gross_salary)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold text-slate-900">
                          {fmt(line.net_salary)}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                              line.status === "finalised" || line.status === "finalized"
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                : line.status === "draft"
                                ? "bg-slate-100 text-slate-600 border-slate-200"
                                : "bg-amber-100 text-amber-700 border-amber-200"
                            }`}
                          >
                            {line.status ?? "—"}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* ── Reject Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-5 py-4 bg-gradient-to-r from-red-600 to-rose-600 text-white rounded-t-xl">
            <DialogTitle className="flex items-center gap-2 text-white">
              <XCircle className="w-5 h-5" />
              Reject Payroll Run
            </DialogTitle>
          </DialogHeader>
          <div className="p-5 space-y-3">
            <p className="text-sm text-slate-600">
              Please provide a reason for rejecting this payroll run. This action will require
              re-processing before the run can be validated.
            </p>
            <Textarea
              placeholder="Enter rejection reason…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>
          <DialogFooter className="gap-2 px-5 pb-5">
            <Button
              variant="outline"
              onClick={() => {
                setRejectOpen(false);
                setRejectReason("");
              }}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRejectSubmit}
              disabled={!rejectReason.trim() || actionLoading}
              className="bg-red-700 hover:bg-red-800 text-white"
            >
              {actionLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <XCircle className="w-4 h-4 mr-1" />
              )}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
