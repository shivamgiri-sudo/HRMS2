import { useEffect, useState, useCallback } from "react";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Users,
  Zap,
  SkipForward,
  Activity,
} from "lucide-react";

const ALLOWED_ROLES = ["payroll_head", "payroll_branch", "admin", "super_admin"];
const TRIGGER_ROLES = ["payroll_head", "admin", "super_admin"];

interface QueueItem {
  id: string;
  employee_name: string;
  employee_code: string;
  payroll_month: string;
  source_event_type: string;
  reason: string;
  status: string;
  requested_at: string;
  processed_at?: string | null;
  error_message?: string | null;
}

interface RunOption {
  id: string;
  run_month: string;
  status: string;
  total_employees: number;
}

interface Employee { id: string; employee_code: string; name: string; }

// ─── Status style maps ────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  pending:        "bg-amber-100 text-amber-800 border border-amber-200",
  processing:     "bg-blue-100 text-blue-800 border border-blue-200",
  completed:      "bg-emerald-100 text-emerald-800 border border-emerald-200",
  failed:         "bg-red-100 text-red-800 border border-red-200",
  skipped_locked: "bg-slate-100 text-slate-700 border border-slate-200",
};

const STATUS_ROW_BORDER: Record<string, string> = {
  pending:        "border-l-4 border-l-amber-400",
  processing:     "border-l-4 border-l-blue-400",
  completed:      "border-l-4 border-l-emerald-400",
  failed:         "border-l-4 border-l-red-400",
  skipped_locked: "border-l-4 border-l-slate-300",
};

const SOURCE_BADGE: Record<string, string> = {
  regularization:       "bg-emerald-50 text-emerald-700 border border-emerald-200",
  roster_change:        "bg-blue-50 text-blue-700 border border-blue-200",
  leave_adjustment:     "bg-violet-50 text-violet-700 border border-violet-200",
  salary_revision:      "bg-indigo-50 text-indigo-700 border border-indigo-200",
  manual:               "bg-slate-50 text-slate-700 border border-slate-200",
  bulk:                 "bg-orange-50 text-orange-700 border border-orange-200",
};

// ─── KPI Tile ─────────────────────────────────────────────────────────────────

type KpiTone = "amber" | "blue" | "green" | "red" | "slate" | "violet";

const TONE: Record<KpiTone, { bg: string; border: string; label: string; value: string; icon: string }> = {
  amber:  { bg: "from-amber-50 to-orange-50",    border: "border-amber-200",   label: "text-amber-600",   value: "text-amber-900",   icon: "bg-amber-100 text-amber-600"   },
  blue:   { bg: "from-blue-50 to-indigo-50",     border: "border-blue-200",    label: "text-blue-600",    value: "text-blue-900",    icon: "bg-blue-100 text-blue-600"     },
  green:  { bg: "from-emerald-50 to-green-50",   border: "border-emerald-200", label: "text-emerald-600", value: "text-emerald-900", icon: "bg-emerald-100 text-emerald-600" },
  red:    { bg: "from-red-50 to-rose-50",        border: "border-red-200",     label: "text-red-600",     value: "text-red-900",     icon: "bg-red-100 text-red-600"       },
  slate:  { bg: "from-slate-50 to-slate-100",    border: "border-slate-200",   label: "text-slate-500",   value: "text-slate-900",   icon: "bg-slate-100 text-slate-500"   },
  violet: { bg: "from-violet-50 to-purple-50",   border: "border-violet-200",  label: "text-violet-600",  value: "text-violet-900",  icon: "bg-violet-100 text-violet-600" },
};

function KpiTile({
  label, value, tone, icon: Icon, sub,
}: {
  label: string; value: string | number; tone: KpiTone; icon: React.ElementType; sub?: string;
}) {
  const s = TONE[tone];
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

export default function RecalculationQueue() {
  const { roleKeys } = useWorkforceAccess();
  const canTrigger = TRIGGER_ROLES.some(r => roleKeys.includes(r));

  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trigger form state
  const [showTrigger, setShowTrigger] = useState(false);
  const [trigSearch, setTrigSearch] = useState("");
  const [trigSuggestions, setTrigSuggestions] = useState<Employee[]>([]);
  const [trigEmployee, setTrigEmployee] = useState<Employee | null>(null);
  const [trigMonth, setTrigMonth] = useState("");
  const [trigReason, setTrigReason] = useState("");
  const [trigSubmitting, setTrigSubmitting] = useState(false);
  const [trigError, setTrigError] = useState<string | null>(null);
  const [trigSuccess, setTrigSuccess] = useState<string | null>(null);

  // Bulk recalculation state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkRunId, setBulkRunId] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);

  const [runs, setRuns] = useState<RunOption[]>([]);

  const fetchQueue = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (monthFilter) params.set("payrollMonth", monthFilter);
    hrmsApi.get<any>(`/api/payroll/recalculation-queue?${params}`)
      .then((data: any) => {
        setItems(Array.isArray(data) ? data : data.data ?? data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => setError("Failed to load recalculation queue."))
      .finally(() => setLoading(false));
  }, [statusFilter, monthFilter]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  useEffect(() => {
    hrmsApi.get<any>("/api/payroll/runs?limit=20")
      .then((res: any) => {
        const list = Array.isArray(res) ? res : (res?.data ?? res?.runs ?? []);
        setRuns(list.filter((r: any) => !["locked", "disbursed"].includes(r.status)));
      })
      .catch(() => {});
  }, []);

  const searchEmployees = (q: string) => {
    setTrigSearch(q);
    setTrigEmployee(null);
    if (q.length < 2) { setTrigSuggestions([]); return; }
    hrmsApi.get<any>(`/api/employees?search=${encodeURIComponent(q)}`)
      .then((res: any) => setTrigSuggestions(Array.isArray(res) ? res : res.employees ?? res.data ?? []))
      .catch(() => {});
  };

  const selectTrigEmployee = (emp: Employee) => {
    setTrigEmployee(emp);
    setTrigSearch(`${emp.name} (${emp.employee_code})`);
    setTrigSuggestions([]);
  };

  const submitTrigger = async () => {
    if (!trigEmployee || !trigMonth) return;
    setTrigSubmitting(true);
    setTrigError(null);
    setTrigSuccess(null);
    try {
      await hrmsApi.post("/api/payroll/recalculation-queue", {
        employee_id: trigEmployee.id,
        payroll_month: trigMonth,
        reason: trigReason || "Manual recalculation request",
      });
      setTrigSuccess(`Queued recalculation for ${trigEmployee.name} — ${trigMonth}`);
      setTrigSearch("");
      setTrigEmployee(null);
      setTrigMonth("");
      setTrigReason("");
      fetchQueue();
    } catch (e: any) {
      setTrigError(e.message ?? "Failed to queue recalculation");
    } finally {
      setTrigSubmitting(false);
    }
  };

  const submitBulkRecalculation = async () => {
    if (!bulkRunId) return;
    setBulkSubmitting(true);
    setBulkError(null);
    setBulkSuccess(null);
    try {
      await hrmsApi.post("/api/payroll/recalculation-queue/bulk", {
        run_id: bulkRunId,
        reason: bulkReason || "Bulk recalculation request",
      });
      setBulkSuccess("Bulk recalculation queued for all employees in this run");
      setBulkRunId("");
      setBulkReason("");
      setShowBulkModal(false);
      fetchQueue();
    } catch (e: any) {
      setBulkError(e.message ?? "Failed to queue bulk recalculation");
    } finally {
      setBulkSubmitting(false);
    }
  };

  const retryItem = async (id: string) => {
    try {
      await hrmsApi.post(`/api/payroll/recalculation-queue/${id}/retry`, {});
      fetchQueue();
    } catch (e: any) {
      setError(e.message ?? "Retry failed");
    }
  };

  const cancelItem = async (id: string) => {
    try {
      await hrmsApi.post(`/api/payroll/recalculation-queue/${id}/cancel`, {});
      fetchQueue();
    } catch (e: any) {
      setError(e.message ?? "Cancel failed");
    }
  };

  if (!ALLOWED_ROLES.some(r => roleKeys.includes(r))) {
    return (
      <DashboardLayout>
        <div className="p-8 text-red-600">Access denied.</div>
      </DashboardLayout>
    );
  }

  // Derived KPI counts from current page of items
  const pendingCount    = items.filter(i => i.status === "pending").length;
  const processingCount = items.filter(i => i.status === "processing").length;
  const failedCount     = items.filter(i => i.status === "failed").length;
  const completedCount  = items.filter(i => i.status === "completed").length;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-5">

        {/* ── Gradient Header ─────────────────────────────────────────────── */}
        <div className="rounded-2xl bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-500 text-white px-6 py-5 shadow-lg">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Payroll Recalculation Queue</h1>
                <p className="text-amber-100 text-sm mt-0.5">
                  Monitor recalculation events triggered by regularization, roster changes, or manual request
                </p>
              </div>
            </div>
            {canTrigger && (
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/30 bg-white/15 text-white hover:bg-white/25"
                  onClick={() => setShowTrigger(p => !p)}
                >
                  <Zap className="w-3.5 h-3.5 mr-1" />
                  {showTrigger ? "Hide Form" : "Trigger Recalculation"}
                </Button>
                <Button
                  size="sm"
                  className="bg-white text-amber-700 hover:bg-amber-50"
                  onClick={() => setShowBulkModal(true)}
                >
                  <Users className="w-3.5 h-3.5 mr-1" />
                  Bulk Recalculate
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* ── KPI tiles ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiTile label="Pending"    value={pendingCount}    tone="amber"  icon={Clock}       sub="awaiting processing" />
          <KpiTile label="Processing" value={processingCount} tone="blue"   icon={Activity}    sub="currently running"   />
          <KpiTile label="Failed"     value={failedCount}     tone={failedCount > 0 ? "red" : "green"} icon={XCircle} sub={failedCount > 0 ? "requires retry" : "no failures"} />
          <KpiTile label="Completed"  value={completedCount}  tone="green"  icon={CheckCircle2} sub="this view" />
        </div>

        {/* ── Trigger single recalc form ───────────────────────────────── */}
        {canTrigger && showTrigger && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 backdrop-blur-sm shadow-sm p-5 space-y-4">
            <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
              <Zap className="w-4 h-4" /> Manually Trigger Recalculation
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="relative">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">
                  Employee <span className="text-red-500">*</span>
                </label>
                <Input
                  className="text-sm bg-white"
                  placeholder="Search employee…"
                  value={trigSearch}
                  onChange={e => searchEmployees(e.target.value)}
                />
                {trigSuggestions.length > 0 && (
                  <div className="absolute z-10 bg-white border border-slate-200 rounded-xl shadow-lg mt-1 w-full max-h-48 overflow-y-auto">
                    {trigSuggestions.map(emp => (
                      <div
                        key={emp.id}
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-slate-50"
                        onClick={() => selectTrigEmployee(emp)}
                      >
                        {emp.name}{" "}
                        <span className="text-slate-400 text-xs">({emp.employee_code})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">
                  Payroll Month <span className="text-red-500">*</span>
                </label>
                <Input
                  type="month"
                  className="text-sm bg-white"
                  value={trigMonth}
                  onChange={e => setTrigMonth(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Reason</label>
                <Input
                  className="text-sm bg-white"
                  placeholder="Optional reason"
                  value={trigReason}
                  onChange={e => setTrigReason(e.target.value)}
                />
              </div>
            </div>
            {trigError   && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{trigError}</p>}
            {trigSuccess && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{trigSuccess}</p>}
            <Button
              size="sm"
              disabled={trigSubmitting || !trigEmployee || !trigMonth}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={submitTrigger}
            >
              {trigSubmitting
                ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Queuing…</>
                : <><RotateCcw className="w-3.5 h-3.5 mr-1.5" />Queue Recalculation</>}
            </Button>
          </div>
        )}

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm px-5 py-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1 block">Status</label>
              <Select value={statusFilter} onValueChange={v => setStatusFilter(v)}>
                <SelectTrigger className="w-44 h-9">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="skipped_locked">Skipped (Locked)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1 block">Month</label>
              <Input
                type="month"
                className="w-40 h-9 text-sm"
                value={monthFilter}
                onChange={e => setMonthFilter(e.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" onClick={fetchQueue} disabled={loading} className="h-9">
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {total > 0 && (
              <span className="text-xs text-slate-500 ml-auto self-center">
                {total} total items
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* ── Queue Table ──────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b bg-slate-50/80">
            <p className="text-sm font-semibold text-slate-800">
              Recalculation Queue
              {items.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-400">({items.length} shown)</span>
              )}
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="whitespace-nowrap">Employee</TableHead>
                  <TableHead className="whitespace-nowrap">Code</TableHead>
                  <TableHead className="whitespace-nowrap">Month</TableHead>
                  <TableHead className="whitespace-nowrap">Source Event</TableHead>
                  <TableHead className="whitespace-nowrap max-w-xs">Reason</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap">Requested</TableHead>
                  <TableHead className="whitespace-nowrap">Processed</TableHead>
                  <TableHead className="whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-slate-400">
                      <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" />
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!loading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-slate-400 text-sm">
                      No items in queue{statusFilter !== "all" ? ` matching status "${statusFilter}"` : ""}.
                    </TableCell>
                  </TableRow>
                )}
                {!loading && items.map((item) => {
                  const sourceKey = item.source_event_type?.toLowerCase() ?? "";
                  const sourceBadgeStyle = Object.entries(SOURCE_BADGE).find(([k]) =>
                    sourceKey.includes(k)
                  )?.[1] ?? "bg-slate-50 text-slate-600 border border-slate-200";

                  return (
                    <TableRow
                      key={item.id}
                      className={`hover:bg-slate-50 transition-colors ${STATUS_ROW_BORDER[item.status] ?? "border-l-4 border-l-transparent"}`}
                    >
                      <TableCell className="font-medium text-sm whitespace-nowrap">
                        {item.employee_name}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {item.employee_code}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700 whitespace-nowrap">
                        {item.payroll_month?.slice(0, 7)}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sourceBadgeStyle}`}>
                          {item.source_event_type?.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-xs text-slate-600 truncate" title={item.reason}>
                          {item.reason}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[item.status] ?? "bg-slate-100 text-slate-700 border border-slate-200"}`}>
                          {item.status?.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        {item.requested_at ? new Date(item.requested_at).toLocaleString("en-IN") : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        {item.processed_at ? new Date(item.processed_at).toLocaleString("en-IN") : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5 items-center">
                          {item.status === "failed" && (
                            <button
                              className="text-xs px-2 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 font-medium"
                              onClick={() => void retryItem(item.id)}
                            >
                              Retry
                            </button>
                          )}
                          {item.status === "pending" && (
                            <button
                              className="text-xs px-2 py-1 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium"
                              onClick={() => void cancelItem(item.id)}
                            >
                              Cancel
                            </button>
                          )}
                          {item.status === "failed" && item.error_message && (
                            <span
                              className="text-xs text-red-500 underline cursor-help"
                              title={item.error_message}
                            >
                              Error
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* ── Bulk Recalculation Dialog ──────────────────────────────────────── */}
      <Dialog open={showBulkModal} onOpenChange={setShowBulkModal}>
        <DialogContent className="max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-5 py-4 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-t-xl">
            <DialogTitle className="flex items-center gap-2 text-white">
              <Users className="w-5 h-5" />
              Bulk Recalculate for Run
            </DialogTitle>
          </DialogHeader>
          <div className="p-5 space-y-4">
            {bulkSuccess && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                {bulkSuccess}
              </div>
            )}
            {bulkError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                {bulkError}
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">
                Payroll Run <span className="text-red-500">*</span>
              </label>
              <Select value={bulkRunId} onValueChange={setBulkRunId} disabled={bulkSubmitting}>
                <SelectTrigger>
                  <SelectValue placeholder="— Select run —" />
                </SelectTrigger>
                <SelectContent>
                  {runs.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.run_month} · {r.status} · {r.total_employees} employees
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Reason</label>
              <Input
                placeholder="Enter reason for recalculation"
                value={bulkReason}
                onChange={e => setBulkReason(e.target.value)}
                disabled={bulkSubmitting}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 px-5 pb-5">
            <Button
              variant="outline"
              onClick={() => setShowBulkModal(false)}
              disabled={bulkSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={submitBulkRecalculation}
              disabled={bulkSubmitting || !bulkRunId}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {bulkSubmitting
                ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Submitting…</>
                : <><RotateCcw className="w-3.5 h-3.5 mr-1.5" />Submit Bulk Request</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
