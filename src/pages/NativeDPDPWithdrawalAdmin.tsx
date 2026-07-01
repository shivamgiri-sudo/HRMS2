import { useEffect, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Eye, CheckCircle, XCircle, PlayCircle, History } from "lucide-react";

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
  created_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  performed_by: string | null;
  performed_by_name: string | null;
  remarks: string | null;
  performed_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-yellow-100 text-yellow-800",
  in_review: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  hold_released: "bg-gray-100 text-gray-800",
};

const ALLOWED_ROLES = ["admin", "hr", "compliance", "dpo", "super_admin"];

// ── Component ─────────────────────────────────────────────────────────────────

export default function NativeDPDPWithdrawalAdmin() {
  // Role guard
  const [userRole, setUserRole] = useState<string>("");
  const [roleChecked, setRoleChecked] = useState(false);

  // List state
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Action dialogs
  const [actionDialog, setActionDialog] = useState<{
    type: "approve" | "reject" | null;
    id: string;
  }>({ type: null, id: "" });
  const [dialogRemarks, setDialogRemarks] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  // Audit sheet
  const [auditSheet, setAuditSheet] = useState<{ open: boolean; id: string }>({
    open: false,
    id: "",
  });
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Role detection from stored session
  useEffect(() => {
    try {
      const raw = localStorage.getItem("hrms_access_token");
      if (raw) {
        const payload = JSON.parse(atob(raw.split(".")[1]));
        setUserRole(payload?.role ?? "");
      }
    } catch {
      setUserRole("");
    }
    setRoleChecked(true);
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    setListError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.append("status", statusFilter);
      if (dateFrom) params.append("date_from", dateFrom);
      if (dateTo) params.append("date_to", dateTo);

      const res = await hrmsApi.get<{ data: WithdrawalRequest[] }>(
        `/api/privacy/dpdp-withdrawal?${params.toString()}`
      );
      setRequests(res.data ?? []);
    } catch {
      setListError("Failed to load requests. Check your access permissions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (roleChecked && ALLOWED_ROLES.includes(userRole)) {
      fetchRequests();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleChecked, userRole, statusFilter]);

  const handleStartReview = async (id: string) => {
    try {
      await hrmsApi.post(`/api/privacy/dpdp-withdrawal/${id}/start-review`, {});
      await fetchRequests();
    } catch {
      alert("Failed to start review.");
    }
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
      const payload =
        actionDialog.type === "approve"
          ? { remarks: dialogRemarks }
          : { reason: dialogRemarks };
      await hrmsApi.post(endpoint, payload);
      closeActionDialog();
      await fetchRequests();
    } catch (err: any) {
      setActionError(
        err?.response?.data?.message ?? `Failed to ${actionDialog.type} request.`
      );
    } finally {
      setActionLoading(false);
    }
  };

  const openAuditSheet = async (id: string) => {
    setAuditSheet({ open: true, id });
    setAuditLoading(true);
    setAuditEntries([]);
    try {
      const res = await hrmsApi.get<{ data: AuditEntry[] }>(
        `/api/privacy/dpdp-withdrawal/${id}/audit`
      );
      setAuditEntries(res.data ?? []);
    } catch {
      setAuditEntries([]);
    } finally {
      setAuditLoading(false);
    }
  };

  const formatDate = (d: string | null) =>
    d
      ? new Date(d).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";

  const parseScopeJson = (raw: string | null): string => {
    if (!raw) return "All";
    try {
      const arr = JSON.parse(raw) as string[];
      return arr.map((k) => k.replace(/_/g, " ")).join(", ") || "All";
    } catch {
      return raw;
    }
  };

  // ── Role guard render ─────────────────────────────────────────────────────

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
              You do not have permission to access this page. Required role: hr, admin, compliance,
              or dpo.
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
        <div>
          <h1 className="text-xl font-semibold text-gray-900">DPDP Withdrawal Admin</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Review and process data withdrawal requests from employees and candidates.
          </p>
        </div>

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
                <Input
                  type="date"
                  className="h-9"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[140px]">
                <Label className="text-xs mb-1 block">To date</Label>
                <Input
                  type="date"
                  className="h-9"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={fetchRequests} className="h-9">
                Refresh
              </Button>
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
                  ({requests.length})
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Requester</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Escalation</TableHead>
                      <TableHead>Restriction</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatDate(r.created_at)}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium">{r.requester_name ?? r.requester_id}</div>
                          <div className="text-xs text-gray-400">{r.requester_type}</div>
                        </TableCell>
                        <TableCell className="text-sm max-w-[160px] truncate">
                          {parseScopeJson(r.withdrawal_scope_json)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-700"
                            }
                          >
                            {r.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.escalation_required ? (
                            <Badge className="bg-red-100 text-red-700">Yes</Badge>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.data_restriction_applied ? (
                            <Badge className="bg-green-100 text-green-700">Applied</Badge>
                          ) : (
                            <span className="text-gray-400">Pending</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end flex-wrap">
                            {r.status === "submitted" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={() => handleStartReview(r.id)}
                              >
                                <PlayCircle className="h-3 w-3" />
                                Start
                              </Button>
                            )}
                            {(r.status === "submitted" || r.status === "in_review") && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50"
                                  onClick={() => openActionDialog("approve", r.id)}
                                >
                                  <CheckCircle className="h-3 w-3" />
                                  Approve
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1 border-red-300 text-red-700 hover:bg-red-50"
                                  onClick={() => openActionDialog("reject", r.id)}
                                >
                                  <XCircle className="h-3 w-3" />
                                  Reject
                                </Button>
                              </>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => openAuditSheet(r.id)}
                            >
                              <History className="h-3 w-3" />
                              Audit
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Approve / Reject dialog */}
      <Dialog
        open={actionDialog.type !== null}
        onOpenChange={(open) => { if (!open) closeActionDialog(); }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {actionDialog.type === "approve" ? "Approve Withdrawal Request" : "Reject Withdrawal Request"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {actionError && (
              <Alert variant="destructive">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label className="text-sm">
                {actionDialog.type === "reject" ? (
                  <>Rejection reason <span className="text-red-500">*</span></>
                ) : (
                  "Remarks (optional)"
                )}
              </Label>
              <Textarea
                rows={3}
                value={dialogRemarks}
                onChange={(e) => setDialogRemarks(e.target.value)}
                placeholder={
                  actionDialog.type === "reject"
                    ? "State the reason for rejection..."
                    : "Add any remarks for the record..."
                }
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeActionDialog} disabled={actionLoading}>
              Cancel
            </Button>
            <Button
              onClick={submitAction}
              disabled={actionLoading}
              className={
                actionDialog.type === "approve"
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-red-600 hover:bg-red-700 text-white"
              }
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : actionDialog.type === "approve" ? (
                "Confirm Approval"
              ) : (
                "Confirm Rejection"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit timeline sheet */}
      <Sheet
        open={auditSheet.open}
        onOpenChange={(open) => setAuditSheet((s) => ({ ...s, open }))}
      >
        <SheetContent side="right" className="w-full sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Audit Timeline</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            {auditLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : auditEntries.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No audit entries found.</p>
            ) : (
              <ol className="relative border-l border-gray-200 ml-3 space-y-6">
                {auditEntries.map((entry) => (
                  <li key={entry.id} className="ml-6">
                    <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-white border border-gray-200 rounded-full">
                      <Eye className="w-3 h-3 text-gray-400" />
                    </span>
                    <div className="p-3 bg-gray-50 rounded border border-gray-100">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <Badge className="bg-blue-50 text-blue-700 text-xs">
                          {entry.action.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {formatDate(entry.performed_at)}
                        </span>
                      </div>
                      {entry.performed_by_name && (
                        <p className="text-xs text-gray-600 mb-1">
                          By: <span className="font-medium">{entry.performed_by_name}</span>
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
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
