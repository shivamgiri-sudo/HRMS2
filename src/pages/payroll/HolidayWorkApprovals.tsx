import { useEffect, useState, useCallback } from "react";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const ALLOWED_ROLES = ["wfm", "payroll_head", "payroll_branch", "admin", "super_admin"];

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-800",
  branch_payroll_validated: "bg-yellow-100 text-yellow-800",
  payroll_head_approved: "bg-green-100 text-green-800",
  superadmin_approved: "bg-emerald-100 text-emerald-800",
  payroll_included: "bg-teal-100 text-teal-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-500",
};

const STAGE_LABELS: Record<string, string> = {
  wfm: "WFM",
  branch_payroll: "Branch Payroll",
  payroll_head: "Payroll Head",
  superadmin: "Super Admin",
  wfm_approved: "WFM Approved",
  branch_payroll_validated: "Branch Payroll Validated",
  payroll_head_approved: "Payroll Head Approved",
  superadmin_approved: "Super Admin Approved",
  submitted: "Submitted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  payroll_included: "Payroll Included",
};

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "submitted", label: "Submitted" },
  { value: "branch_payroll_validated", label: "Branch Payroll Validated" },
  { value: "payroll_head_approved", label: "Payroll Head Approved" },
  { value: "superadmin_approved", label: "Super Admin Approved" },
  { value: "payroll_included", label: "Payroll Included" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

interface ApprovalRequest {
  id: number;
  holiday_date: string;
  holiday_name: string;
  branch_id: string;
  process_id: string;
  designations: string;
  status: string;
  current_approval_stage: string;
  requested_by_name: string;
  request_reason: string;
}

export default function HolidayWorkApprovals() {
  const { roleKeys } = useWorkforceAccess();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  const fetchRequests = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (monthFilter) params.set("month", monthFilter);
    hrmsApi.get<any>(`/api/payroll/holiday-work/requests?${params}`)
      .then((data: any) => setRequests(Array.isArray(data) ? data : data.data ?? data.requests ?? []))
      .catch(() => setError("Failed to load holiday work requests."))
      .finally(() => setLoading(false));
  }, [statusFilter, monthFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const openReview = (req: ApprovalRequest) => {
    setSelected(req);
    setRemarks("");
    setActionError(null);
    setActionSuccess(null);
  };

  const closeDialog = () => {
    setSelected(null);
    setRemarks("");
    setActionError(null);
    setActionSuccess(null);
  };

  const submitAction = async (action: "approve" | "reject") => {
    if (!selected) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await hrmsApi.patch(`/api/payroll/holiday-work/requests/${selected.id}/approve`, { action, remarks });
      setActionSuccess(action === "approve" ? "Request approved." : "Request rejected.");
      fetchRequests();
      setTimeout(() => {
        closeDialog();
        setSubmitting(false);
      }, 1200);
    } catch (e: any) {
      setActionError(e.message ?? "Action failed");
      setSubmitting(false);
    }
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
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Holiday Work Approvals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Review and approve or reject requests to pay staff who worked on a designated holiday.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className="border rounded px-3 py-1.5 text-sm bg-background"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            type="month"
            className="border rounded px-3 py-1.5 text-sm bg-background"
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={fetchRequests}>Refresh</Button>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 whitespace-nowrap">Holiday</th>
                <th className="text-left px-4 py-2">Branch</th>
                <th className="text-left px-4 py-2">Process</th>
                <th className="text-left px-4 py-2">Requested By</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Stage</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && requests.map((req) => (
                <tr key={req.id} className="border-t hover:bg-muted/40">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div className="font-medium">{(req as any).holiday_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{req.holiday_date?.slice(0, 10)}</div>
                  </td>
                  <td className="px-4 py-2 text-xs">{req.branch_id ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">{req.process_id ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">{req.requested_by_name ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[req.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {STAGE_LABELS[req.status] ?? req.status?.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {STAGE_LABELS[req.current_approval_stage] ?? req.current_approval_stage?.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-2">
                    <Button size="sm" variant="outline" onClick={() => openReview(req)}>Review</Button>
                  </td>
                </tr>
              ))}
              {!loading && requests.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No requests found.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <Dialog open={!!selected} onOpenChange={(open) => { if (!open) closeDialog(); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Review Holiday Work Request</DialogTitle>
            </DialogHeader>
            {selected && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2 bg-muted/40 rounded p-3">
                  <div><span className="font-medium">Holiday:</span> {(selected as any).holiday_name ?? "—"}</div>
                  <div><span className="font-medium">Date:</span> {selected.holiday_date?.slice(0, 10)}</div>
                  <div><span className="font-medium">Branch:</span> {selected.branch_id ?? "All"}</div>
                  <div><span className="font-medium">Process:</span> {selected.process_id ?? "All"}</div>
                  <div><span className="font-medium">Requested by:</span> {selected.requested_by_name ?? "—"}</div>
                  <div>
                    <span className="font-medium">Status:</span>{" "}
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[selected.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {STAGE_LABELS[selected.status] ?? selected.status?.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="col-span-2"><span className="font-medium">Stage:</span> {STAGE_LABELS[selected.current_approval_stage] ?? selected.current_approval_stage?.replace(/_/g, " ")}</div>
                  {selected.request_reason && (
                    <div className="col-span-2"><span className="font-medium">Reason:</span> {selected.request_reason}</div>
                  )}
                </div>
                <div>
                  <label className="block font-medium mb-1">Your Remarks</label>
                  <textarea
                    className="w-full border rounded px-3 py-2 text-sm resize-none bg-background"
                    rows={3}
                    placeholder="Enter remarks (optional)…"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                </div>
                {actionError && <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{actionError}</div>}
                {actionSuccess && <div className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">{actionSuccess}</div>}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={closeDialog} disabled={submitting}>Cancel</Button>
              <Button variant="destructive" disabled={submitting} onClick={() => submitAction("reject")}>
                {submitting ? "…" : "Reject"}
              </Button>
              <Button disabled={submitting} onClick={() => submitAction("approve")}>
                {submitting ? "…" : "Approve"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
