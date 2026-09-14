/**
 * HolidayWork — merged page combining Holiday Work Requests + Approvals into two tabs.
 * Replaces the two separate pages /payroll/holiday-work-requests and /payroll/holiday-work-approvals.
 */
import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useWorkforceAccess } from "@/hooks/useUserRole";

// ── shared constants ─────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-800",
  branch_payroll_validated: "bg-yellow-100 text-yellow-800",
  payroll_head_approved: "bg-green-100 text-green-800",
  superadmin_approved: "bg-emerald-100 text-emerald-800",
  payroll_included: "bg-teal-100 text-teal-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-500",
  pending: "bg-blue-50 text-blue-700",
};

const STAGE_LABELS: Record<string, string> = {
  submitted: "Submitted", branch_payroll_validated: "Branch Payroll Validated",
  payroll_head_approved: "Payroll Head Approved", superadmin_approved: "Super Admin Approved",
  payroll_included: "Payroll Included", rejected: "Rejected", cancelled: "Cancelled",
  pending: "Pending", approved: "Approved",
};

const REQUEST_ROLES = ["wfm", "admin", "super_admin", "payroll_head", "payroll_branch"];
const APPROVAL_ROLES = ["wfm", "payroll_head", "payroll_branch", "admin", "super_admin"];

// ── Submit Request Tab ────────────────────────────────────────────────────────

function SubmitTab() {
  const { roleKeys } = useWorkforceAccess();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    holiday_id: "", branch_id: "", process_id: "",
    cost_centre_id: "", policy_id: "", request_reason: "", remarks: "",
  });
  const [desInput, setDesInput] = useState("");
  const [designationIds, setDesignationIds] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const { data: holidays = [] } = useQuery({
    queryKey: ["holiday-master-active"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/holiday-master").then((d: any) => Array.isArray(d) ? d : d.data ?? []),
  });
  const { data: policies = [] } = useQuery({
    queryKey: ["holiday-work-policies"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/holiday-work/policies").then((d: any) => Array.isArray(d) ? d : d.data ?? []),
  });
  const { data: branches = [] } = useQuery({
    queryKey: ["org-branches"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches").then((d: any) => Array.isArray(d) ? d : d.data ?? []),
  });
  const { data: processes = [] } = useQuery({
    queryKey: ["org-processes"],
    queryFn: () => hrmsApi.get<any>("/api/org/processes").then((d: any) => Array.isArray(d) ? d : d.data ?? []),
  });
  const { data: requests = [], refetch: refetchRequests } = useQuery({
    queryKey: ["holiday-work-requests"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/holiday-work/requests").then((d: any) => Array.isArray(d) ? d : d.data ?? []),
  });

  const submit = useMutation({
    mutationFn: () => hrmsApi.post("/api/payroll/holiday-work/requests", {
      holiday_id: form.holiday_id, branch_id: form.branch_id || null,
      process_id: form.process_id || null, cost_centre_id: form.cost_centre_id || null,
      payout_policy_id: form.policy_id, request_reason: form.request_reason || form.remarks,
      remarks: form.remarks, designation_ids: designationIds,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holiday-work-requests"] });
      setForm({ holiday_id: "", branch_id: "", process_id: "", cost_centre_id: "", policy_id: "", request_reason: "", remarks: "" });
      setDesignationIds([]); setSubmitError(null); setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 3000);
    },
    onError: (e: any) => setSubmitError(e.message ?? "Submission failed"),
  });

  if (!REQUEST_ROLES.some(r => roleKeys.includes(r))) {
    return <div className="p-8 text-red-600 text-sm">You don't have permission to submit holiday work requests.</div>;
  }

  const sel = (key: keyof typeof form, v: string) => setForm(p => ({ ...p, [key]: v }));

  return (
    <div className="space-y-6">
      {/* New Request Form */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">New Holiday Work Request</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Holiday <span className="text-red-500">*</span></label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm bg-background" value={form.holiday_id} onChange={e => sel("holiday_id", e.target.value)}>
              <option value="">Select holiday</option>
              {(holidays as any[]).map((h: any) => <option key={h.id} value={h.id}>{h.holiday_date?.slice(0,10)} — {h.holiday_name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Payout Policy <span className="text-red-500">*</span></label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm bg-background" value={form.policy_id} onChange={e => sel("policy_id", e.target.value)}>
              <option value="">Select policy</option>
              {(policies as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.policy_name} — {p.payout_type}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Branch</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm bg-background" value={form.branch_id} onChange={e => sel("branch_id", e.target.value)}>
              <option value="">All branches</option>
              {(branches as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.branch_name ?? b.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Process</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm bg-background" value={form.process_id} onChange={e => sel("process_id", e.target.value)}>
              <option value="">All processes</option>
              {(processes as any[]).map((proc: any) => <option key={proc.id} value={proc.id}>{proc.process_name ?? proc.name}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Eligible Designations <span className="text-xs text-muted-foreground">(optional)</span></label>
          <div className="flex gap-2">
            <input className="flex-1 border rounded-lg px-3 py-2 text-sm bg-background" placeholder="Enter designation ID and press Add"
              value={desInput} onChange={e => setDesInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const v = desInput.trim(); if (v && !designationIds.includes(v)) setDesignationIds(p => [...p, v]); setDesInput(""); } }} />
            <Button type="button" variant="outline" onClick={() => { const v = desInput.trim(); if (v && !designationIds.includes(v)) setDesignationIds(p => [...p, v]); setDesInput(""); }}>Add</Button>
          </div>
          {designationIds.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {designationIds.map(d => <Badge key={d} variant="secondary" className="cursor-pointer text-xs" onClick={() => setDesignationIds(p => p.filter(x => x !== d))}>{d} ×</Badge>)}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Reason / Remarks</label>
          <Textarea placeholder="Describe the business need for holiday work…" value={form.request_reason} onChange={e => sel("request_reason", e.target.value)} rows={3} />
        </div>

        {submitError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{submitError}</p>}
        {submitSuccess && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">Request submitted successfully.</p>}

        <Button disabled={submit.isPending || !form.holiday_id || !form.policy_id} onClick={() => submit.mutate()}>
          {submit.isPending ? "Submitting…" : "Submit Request"}
        </Button>
      </div>

      {/* My Submitted Requests */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-700">Submitted Requests</h2>
          <Button size="sm" variant="ghost" onClick={() => refetchRequests()}>Refresh</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/30">
              {["Holiday", "Branch", "Process", "Policy", "Designations", "Status", "Submitted At"].map(h => (
                <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap text-slate-600">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(requests as any[]).map((r: any) => (
                <tr key={r.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-2 whitespace-nowrap"><div className="font-medium">{r.holiday_name ?? "—"}</div><div className="text-xs text-muted-foreground">{r.holiday_date?.slice(0,10) ?? ""}</div></td>
                  <td className="px-4 py-2 text-xs">{r.branch_id ?? "All"}</td>
                  <td className="px-4 py-2 text-xs">{r.process_id ?? "All"}</td>
                  <td className="px-4 py-2 text-xs"><div>{r.policy_name ?? r.payout_policy_id ?? "—"}</div>{r.payout_type && <div className="text-muted-foreground">{r.payout_type}</div>}</td>
                  <td className="px-4 py-2 text-xs">{r.designation_count ?? (Array.isArray(r.designation_ids) ? r.designation_ids.length : "—")}</td>
                  <td className="px-4 py-2"><span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-700"}`}>{STAGE_LABELS[r.status] ?? r.status?.replace(/_/g," ")}</span></td>
                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleString("en-IN") : "—"}</td>
                </tr>
              ))}
              {(requests as any[]).length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No requests found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Approvals Tab ─────────────────────────────────────────────────────────────

// superadmin_approved/payroll_included removed 2026-08-25: the approve action
// (payroll-more.routes.ts PATCH /requests/:id/approve) only ever writes
// payroll_head_approved or rejected — no code path anywhere produces either of those two
// statuses, so filtering by them always returned nothing. payroll_head_approved is the
// real terminal state today.
const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" }, { value: "submitted", label: "Submitted" },
  { value: "branch_payroll_validated", label: "Branch Payroll Validated" },
  { value: "payroll_head_approved", label: "Payroll Head Approved" },
  { value: "rejected", label: "Rejected" }, { value: "cancelled", label: "Cancelled" },
];

interface ApprovalRequest {
  id: number; holiday_date: string; holiday_name: string;
  branch_id: string; process_id: string; designations: string;
  status: string; current_approval_stage: string;
  requested_by_name: string; request_reason: string;
}

function ApprovalsTab() {
  const { roleKeys } = useWorkforceAccess();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  const fetchRequests = useCallback(() => {
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (monthFilter) params.set("month", monthFilter);
    hrmsApi.get<any>(`/api/payroll/holiday-work/requests?${params}`)
      .then((data: any) => setRequests(Array.isArray(data) ? data : data.data ?? data.requests ?? []))
      .catch(() => setError("Failed to load holiday work requests."))
      .finally(() => setLoading(false));
  }, [statusFilter, monthFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const submitAction = async (action: "approve" | "reject") => {
    if (!selected) return;
    setSubmitting(true); setActionError(null);
    try {
      await hrmsApi.patch(`/api/payroll/holiday-work/requests/${selected.id}/approve`, { action, remarks });
      setActionSuccess(action === "approve" ? "Request approved." : "Request rejected.");
      fetchRequests();
      setTimeout(() => { setSelected(null); setRemarks(""); setActionError(null); setActionSuccess(null); setSubmitting(false); }, 1200);
    } catch (e: any) { setActionError(e.message ?? "Action failed"); setSubmitting(false); }
  };

  if (!APPROVAL_ROLES.some(r => roleKeys.includes(r))) {
    return <div className="p-8 text-red-600 text-sm">You don't have permission to approve holiday work requests.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className="border rounded-lg px-3 py-1.5 text-sm bg-background" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="month" className="border rounded-lg px-3 py-1.5 text-sm bg-background" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} />
        <Button size="sm" variant="outline" onClick={fetchRequests}>Refresh</Button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>{["Holiday", "Branch", "Process", "Requested By", "Status", ""].map(h => <th key={h} className="text-left px-4 py-3 whitespace-nowrap font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && requests.map(req => (
              <tr key={req.id} className="border-t hover:bg-muted/30">
                <td className="px-4 py-2 whitespace-nowrap"><div className="font-medium">{(req as any).holiday_name ?? "—"}</div><div className="text-xs text-muted-foreground">{req.holiday_date?.slice(0,10)}</div></td>
                <td className="px-4 py-2 text-xs">{req.branch_id ?? "—"}</td>
                <td className="px-4 py-2 text-xs">{req.process_id ?? "—"}</td>
                <td className="px-4 py-2 text-xs">{req.requested_by_name ?? "—"}</td>
                <td className="px-4 py-2"><span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[req.status] ?? "bg-gray-100 text-gray-700"}`}>{STAGE_LABELS[req.status] ?? req.status?.replace(/_/g," ")}</span></td>
                <td className="px-4 py-2"><Button size="sm" variant="outline" onClick={() => { setSelected(req); setRemarks(""); setActionError(null); setActionSuccess(null); }}>Review</Button></td>
              </tr>
            ))}
            {!loading && requests.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No requests found.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={!!selected} onOpenChange={open => { if (!open) { setSelected(null); setRemarks(""); setActionError(null); setActionSuccess(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Review Holiday Work Request</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 bg-muted/40 rounded-lg p-3">
                <div><span className="font-medium">Holiday:</span> {(selected as any).holiday_name ?? "—"}</div>
                <div><span className="font-medium">Date:</span> {selected.holiday_date?.slice(0,10)}</div>
                <div><span className="font-medium">Branch:</span> {selected.branch_id ?? "All"}</div>
                <div><span className="font-medium">Process:</span> {selected.process_id ?? "All"}</div>
                <div><span className="font-medium">Requested by:</span> {selected.requested_by_name ?? "—"}</div>
                <div><span className="font-medium">Status:</span> <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[selected.status] ?? "bg-gray-100 text-gray-700"}`}>{STAGE_LABELS[selected.status] ?? selected.status?.replace(/_/g," ")}</span></div>
                {selected.request_reason && <div className="col-span-2"><span className="font-medium">Reason:</span> {selected.request_reason}</div>}
              </div>
              <div>
                <label className="block font-medium mb-1">Your Remarks</label>
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm resize-none bg-background" rows={3} placeholder="Enter remarks (optional)…" value={remarks} onChange={e => setRemarks(e.target.value)} />
              </div>
              {actionError && <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{actionError}</div>}
              {actionSuccess && <div className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">{actionSuccess}</div>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => { setSelected(null); setRemarks(""); }} disabled={submitting}>Cancel</Button>
            <Button variant="destructive" disabled={submitting} onClick={() => submitAction("reject")}>{submitting ? "…" : "Reject"}</Button>
            <Button disabled={submitting} onClick={() => submitAction("approve")}>{submitting ? "…" : "Approve"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HolidayWork() {
  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Holiday Work</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Submit requests for staff working on designated holidays and manage the multi-stage approval workflow.</p>
        </div>
        <Tabs defaultValue="submit">
          <TabsList className="mb-4">
            <TabsTrigger value="submit">Submit Request</TabsTrigger>
            <TabsTrigger value="approvals">Approvals Queue</TabsTrigger>
          </TabsList>
          <TabsContent value="submit"><SubmitTab /></TabsContent>
          <TabsContent value="approvals"><ApprovalsTab /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
