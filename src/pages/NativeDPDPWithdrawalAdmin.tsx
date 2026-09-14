import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, CheckCircle, CheckCircle2, Clock, Eye,
  FileText, Loader2, Lock, PaperclipIcon, PlayCircle,
  RefreshCcw, Unlock, XCircle, History,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WithdrawalRequest {
  id: string;
  requester_id: string;
  requester_name: string | null;
  requester_type: string;
  status: string;
  withdrawal_reason: string;
  withdrawal_scope_json: string | null;
  request_channel: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_remarks: string | null;
  data_restriction_applied: number;
  data_restriction_at: string | null;
  escalation_required: number;
  sla_due_at: string | null;
  reference_number: string | null;
  processing_hold_active: number;
  requester_ip: string | null;
  requester_ua: string | null;
  created_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  actor_role?: string | null;
  performed_by: string | null;
  performed_by_name: string | null;
  remarks: string | null;
  performed_at: string;
}

interface WithdrawalTask {
  id: string;
  task_module: string;
  task_description: string;
  assigned_to: string | null;
  status: "pending" | "in_progress" | "completed" | "failed";
  completed_at: string | null;
  notes: string | null;
}

interface WithdrawalEvidence {
  id: string;
  evidence_type: string;
  file_path: string | null;
  description: string | null;
  uploaded_by: string | null;
  created_at: string;
}

interface WithdrawalStats {
  total_open: number;
  sla_breached: number;
  awaiting_dpo: number;
  approved_this_month: number;
}

const STATUS_COLORS: Record<string, string> = {
  submitted:    "bg-yellow-100 text-yellow-800",
  in_review:    "bg-blue-100 text-blue-800",
  approved:     "bg-green-100 text-green-800",
  rejected:     "bg-red-100 text-red-800",
  hold_released:"bg-gray-100 text-gray-800",
};

const TASK_STATUS_COLORS: Record<string, string> = {
  pending:    "bg-amber-50 text-amber-700",
  in_progress:"bg-blue-50 text-blue-700",
  completed:  "bg-emerald-50 text-emerald-700",
  failed:     "bg-red-50 text-red-700",
};

const ALLOWED_ROLES = ["admin", "hr", "compliance", "dpo", "super_admin"];
const PAGE_SIZE = 25;

// ── Helpers ───────────────────────────────────────────────────────────────────

function slaCountdown(slaAt: string | null): { label: string; cls: string } {
  if (!slaAt) return { label: "—", cls: "text-slate-400" };
  const remaining = new Date(slaAt).getTime() - Date.now();
  const h = Math.floor(remaining / (1000 * 60 * 60));
  if (remaining < 0) return { label: `${Math.abs(h)}h overdue`, cls: "text-red-700 font-bold line-through" };
  if (h < 6) return { label: `${h}h left`, cls: "text-red-700 font-bold" };
  if (h < 24) return { label: `${h}h left`, cls: "text-amber-700 font-semibold" };
  const d = Math.floor(h / 24);
  return { label: d > 0 ? `${d}d ${h % 24}h left` : `${h}h left`, cls: "text-emerald-700" };
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

function parseScopeJson(raw: string | null): string {
  if (!raw) return "All";
  try {
    const arr = JSON.parse(raw) as string[];
    return arr.map((k) => k.replace(/_/g, " ")).join(", ") || "All";
  } catch { return raw; }
}

function auditIcon(action: string) {
  if (action.includes("approve")) return <CheckCircle2 className="w-3 h-3 text-emerald-500" />;
  if (action.includes("reject")) return <XCircle className="w-3 h-3 text-red-500" />;
  if (action.includes("review")) return <PlayCircle className="w-3 h-3 text-blue-500" />;
  return <Eye className="w-3 h-3 text-gray-400" />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NativeDPDPWithdrawalAdmin() {
  const [userRole, setUserRole] = useState<string>("");
  const [roleChecked, setRoleChecked] = useState(false);

  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const [stats, setStats] = useState<WithdrawalStats | null>(null);

  const [actionDialog, setActionDialog] = useState<{ type: "approve" | "reject" | null; id: string }>({ type: null, id: "" });
  const [dialogRemarks, setDialogRemarks] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  // Detail side sheet (request + tasks + evidence + audit)
  const [detailSheet, setDetailSheet] = useState<{ open: boolean; request: WithdrawalRequest | null }>({ open: false, request: null });
  const [tasks, setTasks] = useState<WithdrawalTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [evidence, setEvidence] = useState<WithdrawalEvidence[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [releaseHoldLoading, setReleaseHoldLoading] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("hrms_access_token");
      if (raw) {
        const payload = JSON.parse(atob(raw.split(".")[1]));
        setUserRole(payload?.role ?? "");
      }
    } catch { setUserRole(""); }
    setRoleChecked(true);
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    setListError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (dateFrom) params.append("date_from", dateFrom);
      if (dateTo) params.append("date_to", dateTo);
      const res = await hrmsApi.get<{ data: WithdrawalRequest[] }>(`/api/privacy/dpdp-withdrawal?${params}`);
      setRequests(res.data ?? []);
      setPage(1);
    } catch { setListError("Failed to load requests. Check your access permissions."); }
    finally { setLoading(false); }
  };

  const fetchStats = async () => {
    try {
      const res = await hrmsApi.get<{ data: WithdrawalStats }>("/api/privacy/dpdp-withdrawal/stats");
      setStats(res.data ?? null);
    } catch { /* stats are non-critical */ }
  };

  useEffect(() => {
    if (roleChecked && ALLOWED_ROLES.includes(userRole)) {
      void fetchRequests();
      void fetchStats();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleChecked, userRole, statusFilter, dateFrom, dateTo]);

  const openDetail = async (r: WithdrawalRequest) => {
    setDetailSheet({ open: true, request: r });
    setTasks([]);
    setEvidence([]);
    setAuditEntries([]);

    setTasksLoading(true);
    setEvidenceLoading(true);
    setAuditLoading(true);

    await Promise.all([
      hrmsApi.get<{ data: WithdrawalTask[] }>(`/api/privacy/dpdp-withdrawal/${r.id}/tasks`)
        .then((res) => setTasks(res.data ?? []))
        .catch(() => setTasks([]))
        .finally(() => setTasksLoading(false)),
      hrmsApi.get<{ data: WithdrawalEvidence[] }>(`/api/privacy/dpdp-withdrawal/${r.id}/evidence`)
        .then((res) => setEvidence(res.data ?? []))
        .catch(() => setEvidence([]))
        .finally(() => setEvidenceLoading(false)),
      hrmsApi.get<{ data: AuditEntry[] }>(`/api/privacy/dpdp-withdrawal/${r.id}/audit`)
        .then((res) => setAuditEntries(res.data ?? []))
        .catch(() => setAuditEntries([]))
        .finally(() => setAuditLoading(false)),
    ]);
  };

  const handleStartReview = async (id: string) => {
    try {
      await hrmsApi.post(`/api/privacy/dpdp-withdrawal/${id}/start-review`, {});
      await fetchRequests();
    } catch { alert("Failed to start review."); }
  };

  const handleReleaseHold = async (id: string) => {
    setReleaseHoldLoading(true);
    try {
      await hrmsApi.post(`/api/privacy/dpdp-withdrawal/${id}/release-hold`, {});
      await fetchRequests();
      setDetailSheet((s) => ({
        ...s,
        request: s.request ? { ...s.request, processing_hold_active: 0 } : null,
      }));
    } catch { alert("Failed to release hold."); }
    finally { setReleaseHoldLoading(false); }
  };

  const openActionDialog = (type: "approve" | "reject", id: string) => {
    setDialogRemarks("");
    setActionError("");
    setActionDialog({ type, id });
  };

  const closeActionDialog = () => {
    setActionDialog({ type: null, id: "" });
    setDialogRemarks("");
    setActionError("");
  };

  const submitAction = async () => {
    if (!actionDialog.type || !actionDialog.id) return;
    if (actionDialog.type === "reject" && !dialogRemarks.trim()) {
      setActionError("A reason is required for rejection.");
      return;
    }
    setActionLoading(true);
    setActionError("");
    try {
      const endpoint = `/api/privacy/dpdp-withdrawal/${actionDialog.id}/${actionDialog.type}`;
      const payload = actionDialog.type === "approve"
        ? { remarks: dialogRemarks }
        : { reason: dialogRemarks };
      await hrmsApi.post(endpoint, payload);
      closeActionDialog();
      await fetchRequests();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : `Failed to ${actionDialog.type} request.`;
      setActionError(msg);
    } finally { setActionLoading(false); }
  };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(requests.length / PAGE_SIZE));
  const pagedRequests = useMemo(
    () => requests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [requests, page],
  );

  // ── Role guard ────────────────────────────────────────────────────────────

  if (!roleChecked) {
    return (
      <DashboardLayout>
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </DashboardLayout>
    );
  }

  if (!ALLOWED_ROLES.includes(userRole)) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto py-10 px-4">
          <Alert variant="destructive">
            <AlertDescription>
              You do not have permission to access this page. Required role: hr, admin, compliance, dpo, or super_admin.
            </AlertDescription>
          </Alert>
        </div>
      </DashboardLayout>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto py-6 px-4 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">DPDP Withdrawal Admin</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Review and process data withdrawal requests from employees and candidates.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { void fetchRequests(); void fetchStats(); }}
            className="inline-flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Stats tiles */}
        {stats && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-slate-500">Total Open</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{stats.total_open}</p>
            </div>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-red-500">SLA Breached</p>
              <p className="mt-2 text-3xl font-black text-red-700">{stats.sla_breached}</p>
            </div>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-violet-500">Awaiting DPO</p>
              <p className="mt-2 text-3xl font-black text-violet-700">{stats.awaiting_dpo}</p>
            </div>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-emerald-600">Approved (Month)</p>
              <p className="mt-2 text-3xl font-black text-emerald-700">{stats.approved_this_month}</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[140px]">
                <Label className="text-xs mb-1 block">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="in_review">In Review</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="hold_released">Hold Released</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[140px]">
                <Label className="text-xs mb-1 block">From date</Label>
                <Input type="date" className="h-9" value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="flex-1 min-w-[140px]">
                <Label className="text-xs mb-1 block">To date</Label>
                <Input type="date" className="h-9" value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Requests table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Withdrawal Requests
              {requests.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({requests.length} total · page {page}/{totalPages})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : listError ? (
              <Alert variant="destructive">
                <AlertDescription>{listError}</AlertDescription>
              </Alert>
            ) : requests.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-10">
                No requests found for the selected filters.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ref</TableHead>
                        <TableHead>Submitted</TableHead>
                        <TableHead>Requester</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>SLA Deadline</TableHead>
                        <TableHead>Hold</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedRequests.map((r) => {
                        const sla = slaCountdown(r.sla_due_at);
                        return (
                          <TableRow key={r.id} className="cursor-pointer hover:bg-slate-50/60"
                            onClick={() => void openDetail(r)}>
                            <TableCell className="font-mono text-xs text-slate-500">
                              {r.reference_number ?? r.id.slice(0, 8).toUpperCase()}
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {formatDate(r.created_at)}
                            </TableCell>
                            <TableCell className="text-sm">
                              <div className="font-medium">{r.requester_name ?? r.requester_id}</div>
                              <div className="text-xs text-gray-400">{r.requester_type}</div>
                            </TableCell>
                            <TableCell className="text-sm max-w-[140px] truncate">
                              {parseScopeJson(r.withdrawal_scope_json)}
                            </TableCell>
                            <TableCell>
                              <Badge className={STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-700"}>
                                {r.status.replace(/_/g, " ")}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs ${sla.cls}`}>{sla.label}</span>
                            </TableCell>
                            <TableCell>
                              {r.processing_hold_active ? (
                                <Badge className="bg-orange-100 text-orange-700 text-xs flex items-center gap-1 w-fit">
                                  <Lock className="h-2.5 w-2.5" /> Hold
                                </Badge>
                              ) : (
                                <span className="text-xs text-slate-300">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex gap-1 justify-end flex-wrap">
                                {r.status === "submitted" && (
                                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                                    onClick={() => handleStartReview(r.id)}>
                                    <PlayCircle className="h-3 w-3" /> Start
                                  </Button>
                                )}
                                {(r.status === "submitted" || r.status === "in_review") && (
                                  <>
                                    <Button variant="outline" size="sm"
                                      className="h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50"
                                      onClick={() => openActionDialog("approve", r.id)}>
                                      <CheckCircle className="h-3 w-3" /> Approve
                                    </Button>
                                    <Button variant="outline" size="sm"
                                      className="h-7 text-xs gap-1 border-red-300 text-red-700 hover:bg-red-50"
                                      onClick={() => openActionDialog("reject", r.id)}>
                                      <XCircle className="h-3 w-3" /> Reject
                                    </Button>
                                  </>
                                )}
                                {r.processing_hold_active === 1 && (
                                  <Button variant="outline" size="sm"
                                    className="h-7 text-xs gap-1 border-orange-300 text-orange-700 hover:bg-orange-50"
                                    disabled={releaseHoldLoading}
                                    onClick={() => void handleReleaseHold(r.id)}>
                                    <Unlock className="h-3 w-3" /> Release Hold
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t pt-4 mt-2">
                    <p className="text-xs text-slate-500">
                      Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, requests.length)} of {requests.length}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}>Prev</Button>
                      {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                        const p = i + 1;
                        return (
                          <Button key={p} variant={page === p ? "default" : "outline"}
                            size="sm" className="h-8 w-8 p-0"
                            onClick={() => setPage(p)}>{p}</Button>
                        );
                      })}
                      <Button variant="outline" size="sm" disabled={page === totalPages}
                        onClick={() => setPage((p) => p + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Approve / Reject dialog */}
      <Dialog open={actionDialog.type !== null}
        onOpenChange={(open) => { if (!open) closeActionDialog(); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {actionDialog.type === "approve" ? "Approve Withdrawal Request" : "Reject Withdrawal Request"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionError && <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert>}
            <div className="space-y-1.5">
              <Label className="text-sm">
                {actionDialog.type === "reject"
                  ? <><>Rejection reason</> <span className="text-red-500">*</span></>
                  : "Remarks (optional)"}
              </Label>
              <Textarea rows={3} value={dialogRemarks} onChange={(e) => setDialogRemarks(e.target.value)}
                placeholder={actionDialog.type === "reject"
                  ? "State the reason for rejection..."
                  : "Add any remarks for the record..."}
                className="resize-none" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeActionDialog} disabled={actionLoading}>Cancel</Button>
            <Button onClick={() => void submitAction()} disabled={actionLoading}
              className={actionDialog.type === "approve"
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-red-600 hover:bg-red-700 text-white"}>
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> :
                actionDialog.type === "approve" ? "Confirm Approval" : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail side sheet */}
      <Sheet open={detailSheet.open}
        onOpenChange={(open) => setDetailSheet((s) => ({ ...s, open }))}>
        <SheetContent side="right" className="w-full sm:max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Withdrawal Request Detail
            </SheetTitle>
          </SheetHeader>

          {detailSheet.request && (
            <div className="mt-4 space-y-5">
              {/* Summary card */}
              <div className="rounded-2xl border bg-slate-50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-slate-500">
                    {detailSheet.request.reference_number ?? detailSheet.request.id.slice(0, 8).toUpperCase()}
                  </span>
                  <Badge className={STATUS_COLORS[detailSheet.request.status] ?? "bg-gray-100 text-gray-700"}>
                    {detailSheet.request.status.replace(/_/g, " ")}
                  </Badge>
                </div>

                {detailSheet.request.sla_due_at && (() => {
                  const sla = slaCountdown(detailSheet.request.sla_due_at);
                  return (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <span>SLA Deadline: {formatDate(detailSheet.request.sla_due_at)}</span>
                      <span className={`font-bold ${sla.cls}`}>({sla.label})</span>
                    </div>
                  );
                })()}

                {detailSheet.request.processing_hold_active === 1 && (
                  <div className="flex items-center justify-between rounded-xl bg-orange-50 border border-orange-200 p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-orange-800">
                      <AlertTriangle className="h-4 w-4" />
                      Processing hold is active
                    </div>
                    <Button size="sm" variant="outline"
                      className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                      disabled={releaseHoldLoading}
                      onClick={() => void handleReleaseHold(detailSheet.request!.id)}>
                      <Unlock className="h-3 w-3 mr-1" />
                      {releaseHoldLoading ? "Releasing…" : "Release Hold"}
                    </Button>
                  </div>
                )}

                <div>
                  <p className="text-xs font-bold uppercase text-slate-500 mb-1">Withdrawal Reason</p>
                  <p className="text-sm text-slate-800 leading-relaxed">
                    {detailSheet.request.withdrawal_reason || <em className="text-slate-400">Not provided</em>}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase text-slate-500 mb-1">Scope</p>
                  <p className="text-sm text-slate-700">{parseScopeJson(detailSheet.request.withdrawal_scope_json)}</p>
                </div>

                {detailSheet.request.requester_ip && (
                  <div className="text-xs text-slate-400 flex gap-4">
                    <span>IP: {detailSheet.request.requester_ip}</span>
                    {detailSheet.request.requester_ua && (
                      <span className="truncate max-w-[300px]">UA: {detailSheet.request.requester_ua}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Tasks */}
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-slate-600 mb-2">Implementation Tasks</p>
                {tasksLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                ) : tasks.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-3">No tasks yet.</p>
                ) : (
                  <div className="space-y-2">
                    {tasks.map((t) => (
                      <div key={t.id} className="flex items-start gap-3 rounded-xl border bg-white p-3">
                        <span className={`rounded-lg px-2 py-1 text-xs font-semibold capitalize flex-shrink-0 ${TASK_STATUS_COLORS[t.status] ?? "bg-slate-50 text-slate-600"}`}>
                          {t.status.replace(/_/g, " ")}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-700 uppercase">{t.task_module.replace(/_/g, " ")}</p>
                          <p className="text-sm text-slate-600">{t.task_description}</p>
                          {t.notes && <p className="text-xs text-slate-400 mt-0.5 italic">{t.notes}</p>}
                        </div>
                        {t.completed_at && (
                          <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500 mt-0.5" />
                        )}
                      </div>
                    ))}
                    <div className="text-xs text-slate-400 text-right">
                      {tasks.filter((t) => t.status === "completed").length}/{tasks.length} completed
                    </div>
                  </div>
                )}
              </div>

              {/* Evidence */}
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-slate-600 mb-2">Evidence</p>
                {evidenceLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                ) : evidence.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-3">No evidence uploaded.</p>
                ) : (
                  <div className="space-y-2">
                    {evidence.map((e) => (
                      <div key={e.id} className="flex items-center gap-3 rounded-xl border bg-white p-3">
                        <PaperclipIcon className="h-4 w-4 flex-shrink-0 text-slate-400" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-700 capitalize">{e.evidence_type.replace(/_/g, " ")}</p>
                          {e.description && <p className="text-xs text-slate-400">{e.description}</p>}
                          <p className="text-xs text-slate-300 mt-0.5">{formatDate(e.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Audit timeline */}
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-slate-600 mb-2">Audit Timeline</p>
                {auditLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                ) : auditEntries.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-3">No audit entries found.</p>
                ) : (
                  <ol className="relative border-l border-gray-200 ml-3 space-y-4">
                    {auditEntries.map((entry) => (
                      <li key={entry.id} className="ml-6">
                        <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-white border border-gray-200 rounded-full">
                          {auditIcon(entry.action)}
                        </span>
                        <div className="p-3 bg-gray-50 rounded border border-gray-100">
                          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <Badge className="bg-blue-50 text-blue-700 text-xs">
                                {entry.action.replace(/_/g, " ")}
                              </Badge>
                              {entry.from_status && entry.to_status && (
                                <span className="text-xs text-slate-400">
                                  {entry.from_status} → {entry.to_status}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-gray-400 whitespace-nowrap">
                              {formatDate(entry.performed_at)}
                            </span>
                          </div>
                          {entry.performed_by_name && (
                            <p className="text-xs text-gray-600 mb-1">
                              By: <span className="font-medium">{entry.performed_by_name}</span>
                              {entry.actor_role && <span className="text-gray-400"> ({entry.actor_role})</span>}
                            </p>
                          )}
                          {entry.remarks && (
                            <p className="text-xs text-gray-500 italic">{entry.remarks}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Audit sheet (legacy — kept for direct Audit button calls from old code path) */}
      <Sheet open={false} onOpenChange={() => {}}>
        <SheetContent side="right"><SheetHeader><SheetTitle><History className="inline h-4 w-4 mr-1" />Audit</SheetTitle></SheetHeader></SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
