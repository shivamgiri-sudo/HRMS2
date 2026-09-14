/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, ChevronDown, ChevronUp, Check, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const VENDOR_TYPES = ["supplier", "service", "contractor", "other"] as const;
const PAYMENT_TERMS = ["Net 7", "Net 15", "Net 30", "Net 45", "Net 60", "Immediate", "Advance", "Custom"] as const;

interface ApprovalRequest {
  id: string; request_type: "create" | "update"; vendor_id: string | null;
  payload: Record<string, any>; status: "pending" | "approved" | "rejected";
  raised_by: string; raised_by_name?: string; branch_name?: string;
  raised_at: string; reviewed_by?: string | null; reviewed_at?: string | null;
  review_notes?: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  pending:  "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

export function VendorApprovalsTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editedPayloads, setEditedPayloads] = useState<Record<string, Record<string, any>>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["vendor-approvals", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const r = await hrmsApi.get<any>(`/api/finance/vendor-approval/requests?${params}`);
      return ((r as any)?.data?.data ?? (r as any)?.data ?? []) as ApprovalRequest[];
    },
  });
  const requests = data ?? [];

  const approveMutation = useMutation({
    mutationFn: ({ id, editedPayload, notes }: { id: string; editedPayload: Record<string,any> | null; notes?: string }) =>
      hrmsApi.patch(`/api/finance/vendor-approval/${id}/approve`, { editedPayload, reviewNotes: notes }),
    onSuccess: (_, { id }) => {
      toast.success("Vendor request approved — vendor created/updated");
      qc.invalidateQueries({ queryKey: ["vendor-approvals"] });
      qc.invalidateQueries({ queryKey: ["erp-vendors"] });
      setExpandedId(null);
      setEditedPayloads(p => { const n = { ...p }; delete n[id]; return n; });
    },
    onError: (e: any) => toast.error(e?.message ?? "Approval failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      hrmsApi.patch(`/api/finance/vendor-approval/${id}/reject`, { reviewNotes: notes }),
    onSuccess: (_, { id }) => {
      toast.success("Request rejected");
      qc.invalidateQueries({ queryKey: ["vendor-approvals"] });
      setExpandedId(null);
      setReviewNotes(n => { const nx = { ...n }; delete nx[id]; return nx; });
    },
    onError: (e: any) => toast.error(e?.message ?? "Rejection failed"),
  });

  function getPayload(req: ApprovalRequest) {
    return editedPayloads[req.id] ?? req.payload ?? {};
  }
  function setPayloadField(id: string, field: string, value: any) {
    setEditedPayloads(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }));
  }
  function mergedPayload(req: ApprovalRequest) {
    return { ...req.payload, ...(editedPayloads[req.id] ?? {}) };
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="">All</SelectItem>
          </SelectContent>
        </Select>
        <button onClick={() => void refetch()} className="text-slate-400 hover:text-slate-600">
          <RefreshCw className="h-4 w-4" />
        </button>
        {requests.length > 0 && (
          <span className="text-xs text-slate-500">{requests.length} request{requests.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : requests.length === 0 ? (
        <div className="text-center py-16 text-sm text-slate-400">No {statusFilter} vendor requests.</div>
      ) : (
        <div className="rounded border bg-white overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_120px_120px_100px_90px_80px] gap-0 border-b bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {["Vendor Name","Type","Branch","Raised By","Raised At","Status"].map(col => (
              <div key={col} className="px-3 py-2">{col}</div>
            ))}
          </div>

          {requests.map(req => {
            const payload = mergedPayload(req);
            const ep = editedPayloads[req.id] ?? {};
            const isExpanded = expandedId === req.id;
            const isPending = req.status === "pending";

            return (
              <div key={req.id} className="border-b">
                {/* Summary row */}
                <div
                  className={`grid grid-cols-[1fr_120px_120px_100px_90px_80px] gap-0 text-sm hover:bg-slate-50 transition-colors cursor-pointer ${isExpanded ? "bg-slate-50" : ""}`}
                  onClick={() => setExpandedId(isExpanded ? null : req.id)}
                >
                  <div className="px-3 py-2.5">
                    <p className="font-medium text-slate-800">{req.payload?.vendor_name ?? "—"}</p>
                    <p className="text-xs text-slate-400">{req.request_type === "create" ? "New vendor" : "Update"}</p>
                  </div>
                  <div className="px-3 py-2.5 self-center text-xs text-slate-600">{req.payload?.vendor_type ?? "—"}</div>
                  <div className="px-3 py-2.5 self-center text-xs text-slate-600">{req.branch_name ?? "—"}</div>
                  <div className="px-3 py-2.5 self-center text-xs text-slate-600">{req.raised_by_name ?? "—"}</div>
                  <div className="px-3 py-2.5 self-center text-xs text-slate-500">
                    {req.raised_at ? format(new Date(req.raised_at), "dd MMM yy") : "—"}
                  </div>
                  <div className="px-3 py-2.5 self-center flex items-center justify-between">
                    <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[req.status] ?? ""}`}>{req.status}</Badge>
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-slate-400 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-1" />}
                  </div>
                </div>

                {/* Expanded review panel */}
                {isExpanded && (
                  <div className="px-4 py-3 bg-slate-50/60 border-t border-dashed space-y-3">
                    <p className="text-xs font-semibold text-slate-600">
                      {isPending ? "Review & correct fields before approving:" : "Submitted payload:"}
                    </p>

                    {/* Key vendor fields as editable (for Finance Head) / read-only (for others / non-pending) */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Vendor Name", field: "vendor_name", type: "text" },
                        { label: "Contact Name", field: "contact_name", type: "text" },
                        { label: "Contact Email", field: "contact_email", type: "text" },
                        { label: "Contact Phone", field: "contact_phone", type: "text" },
                        { label: "GST Number", field: "gst_number", type: "text" },
                        { label: "PAN Number", field: "pan_number", type: "text" },
                      ].map(({ label, field, type }) => (
                        <div key={field}>
                          <p className="text-[10px] font-medium text-slate-500 mb-0.5">{label}</p>
                          {isPending ? (
                            <Input
                              className="h-7 text-xs"
                              type={type}
                              value={ep[field] !== undefined ? ep[field] : (req.payload?.[field] ?? "")}
                              onChange={e => setPayloadField(req.id, field, e.target.value)}
                            />
                          ) : (
                            <p className="text-xs text-slate-700">{payload[field] ?? "—"}</p>
                          )}
                        </div>
                      ))}

                      {/* Vendor Type dropdown */}
                      <div>
                        <p className="text-[10px] font-medium text-slate-500 mb-0.5">Vendor Type</p>
                        {isPending ? (
                          <Select value={ep.vendor_type ?? req.payload?.vendor_type ?? "supplier"} onValueChange={v => setPayloadField(req.id, "vendor_type", v)}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{VENDOR_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <p className="text-xs text-slate-700">{payload.vendor_type ?? "—"}</p>
                        )}
                      </div>

                      {/* Payment Terms dropdown */}
                      <div>
                        <p className="text-[10px] font-medium text-slate-500 mb-0.5">Payment Terms</p>
                        {isPending ? (
                          <Select value={ep.payment_terms ?? req.payload?.payment_terms ?? ""} onValueChange={v => setPayloadField(req.id, "payment_terms", v)}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                            <SelectContent>{PAYMENT_TERMS.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <p className="text-xs text-slate-700">{payload.payment_terms ?? "—"}</p>
                        )}
                      </div>
                    </div>

                    {/* Review notes */}
                    {isPending && (
                      <div>
                        <p className="text-[10px] font-medium text-slate-500 mb-0.5">Review Notes (required to reject)</p>
                        <Textarea
                          className="text-xs h-16 resize-none"
                          placeholder="Add notes…"
                          value={reviewNotes[req.id] ?? ""}
                          onChange={e => setReviewNotes(n => ({ ...n, [req.id]: e.target.value }))}
                        />
                      </div>
                    )}

                    {!isPending && req.review_notes && (
                      <div>
                        <p className="text-[10px] font-medium text-slate-500 mb-0.5">Review Notes</p>
                        <p className="text-xs text-slate-600">{req.review_notes}</p>
                      </div>
                    )}

                    {isPending && (
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate({
                            id: req.id,
                            editedPayload: Object.keys(editedPayloads[req.id] ?? {}).length ? editedPayloads[req.id] : null,
                            notes: reviewNotes[req.id],
                          })}
                        >
                          {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-red-200 text-red-600 hover:bg-red-50"
                          disabled={rejectMutation.isPending || !reviewNotes[req.id]?.trim()}
                          onClick={() => rejectMutation.mutate({ id: req.id, notes: reviewNotes[req.id] ?? "" })}
                        >
                          {rejectMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                          Reject
                        </Button>
                        <span className="text-[10px] text-slate-400">Notes required to reject</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
