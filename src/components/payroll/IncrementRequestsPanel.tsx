import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatIST, formatISTDate } from "@/lib/utils";
import { PlusCircle, RefreshCw, History } from "lucide-react";
import { EmployeePicker, type EmployeeSearchResult } from "@/components/payroll/EmployeePicker";
import { INCREMENT_ACTIONS_FOR_STATUS } from "@/components/payroll/incrementActions";
import { useApprovalFocus } from "@/hooks/useApprovalFocus";

type IncrStatus =
  | "submitted"
  | "hr_validated"
  | "finance_validated"
  | "approved"
  | "rejected"
  | "implemented"
  | "cancelled"
  | "withdrawn";

const STATUS_COLORS: Record<IncrStatus, string> = {
  submitted:         "bg-yellow-100 text-yellow-800",
  hr_validated:      "bg-blue-100 text-blue-800",
  finance_validated: "bg-indigo-100 text-indigo-800",
  approved:          "bg-green-100 text-green-800",
  rejected:          "bg-red-100 text-red-800",
  implemented:       "bg-emerald-100 text-emerald-800",
  cancelled:         "bg-gray-100 text-gray-600",
  withdrawn:         "bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<IncrStatus, string> = {
  submitted:         "Submitted",
  hr_validated:      "HR Validated",
  finance_validated: "Finance Validated",
  approved:          "Approved",
  rejected:          "Rejected",
  implemented:       "Implemented",
  cancelled:         "Cancelled",
  withdrawn:         "Withdrawn",
};

const REASON_CODES = [
  "Annual Review",
  "Performance",
  "Promotion",
  "Market Correction",
  "Retention",
  "Other",
];

function fmt(n: number | null | undefined) {
  if (!n) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function AuditTimeline({ requestId }: { requestId: string }) {
  const { data: trail = [] } = useQuery({
    queryKey: ["salary-increment-audit", requestId],
    queryFn: () => hrmsApi.get<{ data: any[] }>(`/api/salary-increment/${requestId}/audit`).then((r) => r.data ?? []),
  });
  return (
    <div className="space-y-2 pt-2">
      {trail.length === 0 && <p className="text-sm text-muted-foreground">No audit events yet.</p>}
      {trail.map((e: any, i: number) => (
        <div key={i} className="flex gap-3 text-sm border-l-2 border-muted pl-3 py-1">
          <div className="min-w-[120px] text-muted-foreground">
            {e.created_at ? formatIST(e.created_at) : "—"}
          </div>
          <div>
            <span className="font-medium">{e.event_type.replace(/_/g, " ")}</span>
            {e.actor_name && <span className="text-muted-foreground"> by {e.actor_name}</span>}
            {e.old_status && e.new_status && (
              <span className="text-muted-foreground"> · {e.old_status} → {e.new_status}</span>
            )}
            {e.remarks && <p className="text-muted-foreground mt-0.5">{e.remarks}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Increment requests tab of the Salary Change Center. Workflow: raise -> (HR validate, optional) -> the Payroll
 * Head approves, and approving applies it. There is no Finance step; "Finance Validated" survives only as a
 * label for old requests.
 */
export function IncrementRequestsPanel() {
  const qc = useQueryClient();
  // Server-side paging: the table holds 14k+ imported requests, so the page asks for 25 at a time, defaults to
  // what is waiting for approval, and searches by the typed employee code or name.
  const PAGE_SIZE = 25;
  const [statusFilter, setStatusFilter] = useState("pending");
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState<any>(null);
  const [pendingAction, setPendingAction] = useState<{ action: string; label: string } | null>(null);
  const [remarks, setRemarks] = useState("");

  // Create form state. The employee is typed and searched, like the Salary Change tab.
  const [employee, setEmployee] = useState<EmployeeSearchResult | null>(null);
  const [form, setForm] = useState({
    proposed_ctc: "",
    effective_from: "",
    reason_code: "",
    reason: "",
    business_justification: "",
  });

  const { data: listData, isLoading, isFetching } = useQuery({
    queryKey: ["salary-increments", statusFilter, page, search],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (search) qs.set("search", search);
      return hrmsApi
        .get<{ data: any[]; total?: number }>(`/api/salary-increment?${qs.toString()}`)
        .then((r) => ({ rows: r.data ?? [], total: Number(r.total ?? (r.data ?? []).length) }));
    },
    placeholderData: keepPreviousData,
  });
  const requests = listData?.rows ?? [];
  const total = listData?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useApprovalFocus(!isLoading);

  const createMutation = useMutation({
    mutationFn: (body: typeof form) =>
      hrmsApi.post("/api/salary-increment", {
        ...body,
        employee_id: employee?.id,
        proposed_ctc: Number(body.proposed_ctc),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-increments"] });
      toast.success("Increment request submitted");
      setCreateOpen(false);
      setEmployee(null);
      setForm({ proposed_ctc: "", effective_from: "", reason_code: "", reason: "", business_justification: "" });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to submit"),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, remarks }: { id: string; action: string; remarks: string }) =>
      hrmsApi.post(`/api/salary-increment/${id}/action`, { action, remarks }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-increments"] });
      qc.invalidateQueries({ queryKey: ["salary-increment-audit", selectedReq?.id] });
      toast.success("Action recorded");
      setActionOpen(false);
      setRemarks("");
      // Refresh detail if open
      if (detailOpen && selectedReq) {
        hrmsApi.get<{ data: any }>(`/api/salary-increment/${selectedReq.id}`).then((r) => {
          setSelectedReq(r.data);
        });
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Action failed"),
  });

  function openAction(action: string, label: string) {
    setPendingAction({ action, label });
    setRemarks("");
    setActionOpen(true);
  }

  const ACTIONS_FOR_STATUS = INCREMENT_ACTIONS_FOR_STATUS;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm">
            Raise a request → HR may validate → the Payroll Head approves, and approving applies it
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["salary-increments"] })}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusCircle className="h-4 w-4 mr-1" /> New Request
          </Button>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {["pending", "all", "approved", "implemented", "rejected", "legacy"].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            {s === "all" ? "All" : s === "pending" ? "Pending approval" : s === "legacy" ? "Legacy import" : STATUS_LABELS[s as IncrStatus]}
          </button>
        ))}
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search employee code or name…"
          className="h-8 w-64 text-xs ml-auto"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Current CTC</TableHead>
                <TableHead>Proposed CTC</TableHead>
                <TableHead>Increment %</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell>
                </TableRow>
              )}
              {!isLoading && requests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No increment requests found</TableCell>
                </TableRow>
              )}
              {requests.map((r: any) => (
                <TableRow key={r.id} data-approval-id={r.id} className="hover:bg-muted/40">
                  <TableCell>
                    <div className="font-medium">{r.employee_name}</div>
                    <div className="text-xs text-muted-foreground">{r.employee_code}</div>
                  </TableCell>
                  <TableCell>{fmt(r.current_ctc)}</TableCell>
                  <TableCell className="font-medium">{fmt(r.proposed_ctc)}</TableCell>
                  <TableCell>
                    <span className="text-green-700 font-medium">
                      +{Number(r.increment_percentage ?? 0).toFixed(2)}%
                    </span>
                  </TableCell>
                  <TableCell>{r.effective_from ? format(new Date(r.effective_from), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status as IncrStatus] ?? ""}`}>
                      {STATUS_LABELS[r.status as IncrStatus] ?? r.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.created_at ? formatISTDate(r.created_at) : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setSelectedReq(r); setDetailOpen(true); }}
                    >
                      <History className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total.toLocaleString("en-IN")} request{total === 1 ? "" : "s"}
          {isFetching && !isLoading ? " · updating…" : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
          <span>Page {page} of {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</Button>
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Salary Increment Request</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Employee *</Label>
              <EmployeePicker placeholder="Search by name or employee code…" value={employee} onSelect={setEmployee} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Proposed CTC (Annual ₹) *</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.proposed_ctc}
                  onChange={(e) => setForm({ ...form, proposed_ctc: e.target.value })}
                  placeholder="e.g. 480000"
                />
              </div>
              <div className="space-y-1">
                <Label>Effective From *</Label>
                <Input
                  type="date"
                  value={form.effective_from}
                  onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Reason Code</Label>
              <Select value={form.reason_code} onValueChange={(v) => setForm({ ...form, reason_code: v })}>
                <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                <SelectContent>
                  {REASON_CODES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Reason / Notes</Label>
              <Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Business Justification</Label>
              <Textarea rows={2} value={form.business_justification} onChange={(e) => setForm({ ...form, business_justification: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!employee || !form.proposed_ctc || !form.effective_from || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
            >
              {createMutation.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail + actions dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Increment Request — {selectedReq?.employee_name}</DialogTitle>
          </DialogHeader>
          {selectedReq && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <Card><CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">Current CTC</CardTitle></CardHeader>
                  <CardContent className="p-3 pt-0 text-lg font-semibold">{fmt(selectedReq.current_ctc)}</CardContent></Card>
                <Card><CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">Proposed CTC</CardTitle></CardHeader>
                  <CardContent className="p-3 pt-0 text-lg font-semibold text-green-700">{fmt(selectedReq.proposed_ctc)}</CardContent></Card>
                <Card><CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">Increment %</CardTitle></CardHeader>
                  <CardContent className="p-3 pt-0 text-lg font-semibold text-green-700">+{Number(selectedReq.increment_percentage ?? 0).toFixed(2)}%</CardContent></Card>
                <Card><CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">Effective From</CardTitle></CardHeader>
                  <CardContent className="p-3 pt-0 text-lg font-semibold">{selectedReq.effective_from ? format(new Date(selectedReq.effective_from), "dd MMM yyyy") : "—"}</CardContent></Card>
              </div>

              <div className="text-sm space-y-1 border rounded-lg p-3 bg-muted/30">
                <div><span className="font-medium">Status: </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[selectedReq.status as IncrStatus] ?? ""}`}>
                    {STATUS_LABELS[selectedReq.status as IncrStatus] ?? selectedReq.status}
                  </span>
                </div>
                {selectedReq.reason_code && <div><span className="font-medium">Reason: </span>{selectedReq.reason_code}</div>}
                {selectedReq.reason && <div><span className="font-medium">Notes: </span>{selectedReq.reason}</div>}
                {selectedReq.business_justification && <div><span className="font-medium">Justification: </span>{selectedReq.business_justification}</div>}
                {selectedReq.remarks && <div><span className="font-medium">Last Remarks: </span>{selectedReq.remarks}</div>}
              </div>

              {/* Workflow action buttons */}
              {ACTIONS_FOR_STATUS[selectedReq.status] && (
                <div className="flex gap-2 flex-wrap">
                  {ACTIONS_FOR_STATUS[selectedReq.status].map((a) => (
                    <Button
                      key={a.action}
                      size="sm"
                      variant={a.variant ?? "default"}
                      onClick={() => openAction(a.action, a.label)}
                    >
                      {a.label}
                    </Button>
                  ))}
                </div>
              )}

              {/* Audit trail */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Audit Trail</h3>
                <AuditTimeline requestId={selectedReq.id} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Action confirmation dialog */}
      <Dialog open={actionOpen} onOpenChange={setActionOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{pendingAction?.label}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Remarks (optional)</Label>
            <Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add a note…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionOpen(false)}>Cancel</Button>
            <Button
              disabled={actionMutation.isPending}
              onClick={() => {
                if (!selectedReq || !pendingAction) return;
                actionMutation.mutate({ id: selectedReq.id, action: pendingAction.action, remarks });
              }}
            >
              {actionMutation.isPending ? "Processing…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
