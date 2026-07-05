import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const ALLOWED_ROLES = ["wfm", "payroll_head", "payroll_branch", "admin", "super_admin"];

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  wfm_approved: "bg-blue-100 text-blue-800",
  branch_payroll_approved: "bg-yellow-100 text-yellow-800",
  superadmin_approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

interface ApprovalRequest {
  id: number;
  holiday_date: string;
  description: string;
  branch: string;
  process: string;
  designations: string;
  status: string;
  current_approval_stage: string;
  requested_by_name: string;
}

export default function HolidayWorkApprovals() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const role = user?.role ?? "";

  const fetchRequests = () => {
    setLoading(true);
    const token = localStorage.getItem("token");
    fetch("/api/payroll/holiday-work/requests", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setRequests(Array.isArray(data) ? data : data.requests ?? []))
      .catch(() => setError("Failed to load holiday work requests."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRequests(); }, []);

  const openReview = (req: ApprovalRequest) => {
    setSelected(req);
    setRemarks("");
    setActionError(null);
  };

  const closeDialog = () => {
    setSelected(null);
    setRemarks("");
    setActionError(null);
  };

  const submitAction = async (action: "approve" | "reject") => {
    if (!selected) return;
    setSubmitting(true);
    setActionError(null);
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`/api/payroll/holiday-work/requests/${selected.id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, remarks }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Action failed");
      closeDialog();
      fetchRequests();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!ALLOWED_ROLES.includes(role)) {
    return <div className="p-8 text-red-600">Access denied.</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Holiday Work Approvals</h1>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Holiday Date</th>
              <th className="text-left px-4 py-2">Description</th>
              <th className="text-left px-4 py-2">Branch</th>
              <th className="text-left px-4 py-2">Process</th>
              <th className="text-left px-4 py-2">Designations</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Stage</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && requests.map((req) => (
              <tr key={req.id} className="border-t hover:bg-muted/40">
                <td className="px-4 py-2 whitespace-nowrap">{req.holiday_date}</td>
                <td className="px-4 py-2">{req.description}</td>
                <td className="px-4 py-2">{req.branch}</td>
                <td className="px-4 py-2">{req.process}</td>
                <td className="px-4 py-2 max-w-[140px] truncate" title={req.designations}>{req.designations}</td>
                <td className="px-4 py-2">
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[req.status] ?? "bg-gray-100 text-gray-700"}`}>
                    {req.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{req.current_approval_stage}</td>
                <td className="px-4 py-2">
                  <Button size="sm" variant="outline" onClick={() => openReview(req)}>Review</Button>
                </td>
              </tr>
            ))}
            {!loading && requests.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">No requests found.</td></tr>
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
              <div className="grid grid-cols-2 gap-2">
                <div><span className="font-medium">Holiday:</span> {selected.holiday_date}</div>
                <div><span className="font-medium">Description:</span> {selected.description}</div>
                <div><span className="font-medium">Branch:</span> {selected.branch}</div>
                <div><span className="font-medium">Process:</span> {selected.process}</div>
                <div><span className="font-medium">Designations:</span> {selected.designations}</div>
                <div><span className="font-medium">Requested by:</span> {selected.requested_by_name}</div>
                <div>
                  <span className="font-medium">Status:</span>{" "}
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[selected.status] ?? "bg-gray-100 text-gray-700"}`}>
                    {selected.status}
                  </span>
                </div>
                <div><span className="font-medium">Stage:</span> {selected.current_approval_stage}</div>
              </div>
              <div>
                <label className="block font-medium mb-1">Remarks</label>
                <textarea
                  className="w-full border rounded px-3 py-2 text-sm resize-none"
                  rows={3}
                  placeholder="Enter remarks (optional)…"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
              {actionError && <div className="text-xs text-red-600">{actionError}</div>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={closeDialog} disabled={submitting}>Cancel</Button>
            <Button variant="destructive" disabled={submitting} onClick={() => submitAction("reject")}>Reject</Button>
            <Button disabled={submitting} onClick={() => submitAction("approve")}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
