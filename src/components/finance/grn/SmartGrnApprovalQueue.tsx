import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileCheck2,
  FileSearch,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Split,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

type GrnRow = {
  id: string;
  grn_number: string;
  grn_type: "vendor" | "imprest";
  branch_id: string;
  branch_name?: string | null;
  vendor_name?: string | null;
  head?: string | null;
  sub_head?: string | null;
  amount?: number | null;
  amount_with_tax?: number | null;
  bill_date?: string | null;
  due_date?: string | null;
  status: string;
  allocation_mode?: "single" | "split" | null;
  validation_score?: number | null;
  document_match_status?: string | null;
};

type Workspace = {
  grn: Record<string, any>;
  allocations: Array<Record<string, any>>;
  documents: Array<Record<string, any>>;
  extractions: Array<Record<string, any>>;
  validations: Array<Record<string, any>>;
  duplicates: Array<Record<string, any>>;
};

type Capabilities = {
  canCreate: boolean;
  canReviewBranchStage: boolean;
  canReviewFinanceStage: boolean;
};

const STATUS_TABS = [
  ["_all", "All"],
  ["draft", "Draft"],
  ["submitted", "Branch Head Queue"],
  ["branch_head_approved", "Finance Head Queue"],
  ["pending_accounts_payment", "Accounts Payment"],
  ["partially_paid", "Partially Paid"],
  ["paid", "Paid"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"],
] as const;

function labelStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function date(value: unknown) {
  if (!value) return "—";
  return new Date(String(value)).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function tone(value: string) {
  if (["passed", "completed", "matched", "overridden", "cleared"].includes(value)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (["warning", "manual_review", "near_match", "pending", "processing"].includes(value)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function unwrap<T>(value: any): T {
  return (value?.data ?? value) as T;
}

function Metric({ label, value, toneName = "slate" }: {
  label: string;
  value: string;
  toneName?: "slate" | "blue" | "emerald" | "amber" | "rose";
}) {
  const styles = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
  };
  return (
    <div className={`rounded-2xl border p-3 ${styles[toneName]}`}>
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-950">{value}</p>
    </div>
  );
}

export function SmartGrnApprovalQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("submitted");
  const [grnType, setGrnType] = useState("_all");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<GrnRow | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [overrideCode, setOverrideCode] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const capabilitiesQuery = useQuery({
    queryKey: ["finance-capabilities-for-grn"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: Capabilities }>(
        "/api/finance/pnl/budgets/capabilities"
      );
      return response.data;
    },
  });
  const capabilities = capabilitiesQuery.data;

  const listQuery = useQuery({
    queryKey: ["grn-list", status, grnType, search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (status !== "_all") params.set("status", status);
      if (grnType !== "_all") params.set("grnType", grnType);
      if (search.trim()) params.set("search", search.trim());
      const response = await hrmsApi.get<any>(`/api/finance/grns?${params}`);
      return (response?.data ?? response?.rows ?? []) as GrnRow[];
    },
  });

  const workspaceQuery = useQuery({
    queryKey: ["grn-review-workspace", target?.id],
    enabled: Boolean(target),
    queryFn: async () => {
      const response = await hrmsApi.get<any>(`/api/finance/grns/${target!.id}/workspace`);
      return unwrap<Workspace>(response);
    },
  });
  const workspace = workspaceQuery.data;
  const parent = workspace?.grn ?? target;
  const blockers = (workspace?.validations ?? []).filter(
    (item) => Number(item.is_blocking) === 1 && item.validation_status === "failed"
  );

  const canReview = useMemo(() => {
    if (!target || !capabilities) return false;
    if (target.status === "submitted") return capabilities.canReviewBranchStage;
    if (target.status === "branch_head_approved") return capabilities.canReviewFinanceStage;
    return false;
  }, [capabilities, target]);

  const submitMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/finance/grns/${id}/submit`, {}),
    onSuccess: () => {
      toast({ title: "GRN submitted to Branch Head" });
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (error: Error) =>
      toast({ title: "Submission failed", description: error.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: (input: { id: string; decision: "approved" | "rejected"; note: string }) =>
      hrmsApi.post(`/api/finance/grns/${input.id}/review`, {
        decision: input.decision,
        reviewNote: input.note || undefined,
      }),
    onSuccess: (_, input) => {
      toast({ title: `GRN ${input.decision}` });
      setTarget(null);
      setReviewNote("");
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (error: Error) =>
      toast({ title: "Review failed", description: error.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/finance/grns/${id}/cancel`, {}),
    onSuccess: () => {
      toast({ title: "GRN cancelled" });
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (error: Error) =>
      toast({ title: "Cancellation failed", description: error.message, variant: "destructive" }),
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      if (!target || !overrideCode) throw new Error("Select a failed validation");
      if (overrideReason.trim().length < 10) throw new Error("Enter a detailed reason of at least 10 characters");
      return hrmsApi.post(
        `/api/finance/grns/${target.id}/validations/${encodeURIComponent(overrideCode)}/override`,
        { reason: overrideReason.trim() }
      );
    },
    onSuccess: () => {
      toast({ title: "Finance validation override approved and audited" });
      setOverrideCode(null);
      setOverrideReason("");
      void workspaceQuery.refetch();
    },
    onError: (error: Error) =>
      toast({ title: "Override failed", description: error.message, variant: "destructive" }),
  });

  async function openDocument(documentId?: string) {
    if (!target) return;
    try {
      const endpoint = documentId
        ? `/api/finance/grns/${target.id}/documents/${documentId}/file`
        : `/api/finance/grns/${target.id}/attachment`;
      const blob = await hrmsApi.getBlob(endpoint);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({
        title: "Document could not be opened",
        description: error instanceof Error ? error.message : "Unknown file error",
        variant: "destructive",
      });
    }
  }

  function submitDecision() {
    if (!target) return;
    if (decision === "rejected" && !reviewNote.trim()) {
      toast({ title: "Rejection reason is mandatory", variant: "destructive" });
      return;
    }
    if (decision === "approved" && blockers.length) {
      toast({
        title: "Approval is blocked",
        description: "Resolve or obtain Finance override for every blocking validation.",
        variant: "destructive",
      });
      return;
    }
    reviewMutation.mutate({ id: target.id, decision, note: reviewNote.trim() });
  }

  const rows = listQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-950">GRN Approval & Control Queue</h2>
          <p className="mt-1 text-xs text-slate-500">Inspect documents, allocation splits, duplicate matches and server validation before approval.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="w-56 pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search GRN, vendor, Head…" /></div>
          <Select value={grnType} onValueChange={setGrnType}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="_all">All types</SelectItem><SelectItem value="vendor">Vendor</SelectItem><SelectItem value="imprest">Imprest</SelectItem></SelectContent></Select>
          <Button variant="outline" size="icon" onClick={() => void listQuery.refetch()}><RefreshCw className={`h-4 w-4 ${listQuery.isFetching ? "animate-spin" : ""}`} /></Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map(([value, label]) => <button type="button" key={value} onClick={() => setStatus(value)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${status === value ? "border-[#073f78] bg-[#073f78] text-white" : "border-slate-200 bg-white text-slate-600"}`}>{label}</button>)}
      </div>

      {listQuery.isLoading ? <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20"><Loader2 className="h-7 w-7 animate-spin" /></div> : !rows.length ? <div className="rounded-3xl border border-slate-200 bg-white py-16 text-center"><FileText className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">No GRNs match the filters</p></div> : (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1160px]"><thead className="bg-[#073f78] text-white"><tr>{["GRN", "Type", "Branch", "Vendor / Holder", "Head", "Allocation", "Amount", "Validation", "Status", "Actions"].map((heading) => <th key={heading} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-4 py-3 text-xs font-bold text-[#073f78]">{row.grn_number}</td><td className="px-4 py-3"><Badge variant="outline" className="capitalize">{row.grn_type}</Badge></td><td className="px-4 py-3 text-xs"><span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-slate-400" />{row.branch_name ?? row.branch_id}</span></td><td className="max-w-[170px] px-4 py-3 text-xs"><span className="block truncate">{row.vendor_name ?? (row.grn_type === "imprest" ? "Imprest / reimbursement" : "—")}</span></td><td className="max-w-[180px] px-4 py-3 text-xs"><span className="block truncate">{row.head ?? "—"}</span><span className="block truncate text-[10px] text-slate-400">{row.sub_head ?? ""}</span></td><td className="px-4 py-3"><Badge className={row.allocation_mode === "split" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"}><Split className="mr-1 h-3 w-3" />{row.allocation_mode === "split" ? "Multi split" : "Single"}</Badge></td><td className="px-4 py-3 text-right text-xs font-bold">{money(row.amount_with_tax ?? row.amount)}</td><td className="px-4 py-3"><Badge variant="outline">{Number(row.validation_score ?? 0).toFixed(0)}%</Badge></td><td className="px-4 py-3"><Badge variant="outline">{labelStatus(row.status)}</Badge></td><td className="px-4 py-3"><div className="flex gap-1.5"><Button size="sm" variant="outline" onClick={() => { setTarget(row); setDecision("approved"); setReviewNote(""); setOverrideCode(null); setOverrideReason(""); }}><Eye className="mr-1 h-3.5 w-3.5" />Inspect</Button>{row.status === "draft" && capabilities?.canCreate && <Button size="sm" onClick={() => submitMutation.mutate(row.id)}><Send className="mr-1 h-3.5 w-3.5" />Submit</Button>}{["draft", "submitted"].includes(row.status) && capabilities?.canCreate && <Button size="icon" variant="ghost" className="text-rose-500" onClick={() => cancelMutation.mutate(row.id)}><XCircle className="h-4 w-4" /></Button>}</div></td></tr>)}</tbody></table>
        </div>
      )}

      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent className="max-h-[92vh] max-w-[1180px] overflow-y-auto p-0">
          <DialogHeader className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-5"><DialogTitle className="flex items-center gap-2 text-lg"><ClipboardList className="h-5 w-5 text-[#073f78]" />Review GRN — {target?.grn_number}</DialogTitle><p className="text-xs text-slate-500">Evidence, allocations and every server control are visible below.</p></DialogHeader>
          <div className="space-y-5 p-6">
            {workspaceQuery.isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin" /></div> : <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Metric label="Without tax" value={money(parent?.amount_without_tax)} /><Metric label="Tax" value={money(parent?.tax_amount)} toneName="blue" /><Metric label="With tax" value={money(parent?.amount_with_tax ?? parent?.amount)} toneName="emerald" /><Metric label="P&L cost" value={money(parent?.pnl_cost_amount ?? parent?.amount)} toneName="amber" /><Metric label="Validation" value={`${Number(parent?.validation_score ?? 0).toFixed(0)}%`} toneName={blockers.length ? "rose" : "emerald"} /><Metric label="Duplicates" value={String(workspace?.duplicates?.length ?? 0)} toneName={(workspace?.duplicates?.length ?? 0) ? "rose" : "slate"} /></div>

              <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                <Card className="rounded-3xl"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><FileCheck2 className="h-4 w-4 text-blue-700" />Invoice and GRN facts</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[["Vendor / Holder", parent?.vendor_name ?? "—"], ["Invoice", parent?.invoice_number ?? "—"], ["Invoice Date", date(parent?.bill_date)], ["Service Start", date(parent?.service_period_start)], ["Service End", date(parent?.service_period_end)], ["PO / Contract", parent?.purchase_reference ?? "—"], ["GSTIN", parent?.vendor_gstin ?? "—"], ["Place of Supply", parent?.place_of_supply ?? "—"], ["Due Date", date(parent?.due_date)], ["Financial Year", parent?.financial_year ?? "—"], ["Allocation", parent?.allocation_mode ?? "legacy single"], ["Status", labelStatus(parent?.status ?? "")]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words text-xs font-semibold">{String(value)}</p></div>)}</CardContent></Card>
                <Card className="rounded-3xl"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><FileSearch className="h-4 w-4 text-violet-700" />Documents</CardTitle></CardHeader><CardContent className="space-y-2">{(workspace?.documents ?? []).map((document) => <button key={document.id} type="button" onClick={() => void openDocument(String(document.id))} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50"><FileText className="h-5 w-5 text-blue-600" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{document.original_name}</p><p className="text-[10px] text-slate-500">{String(document.extraction_status ?? "pending").replaceAll("_", " ")}</p></div><Badge className={`border ${tone(String(document.extraction_status ?? "pending"))}`}>{Number(document.is_primary) === 1 ? "Primary" : "Support"}</Badge></button>)}{!workspace?.documents?.length && <Button className="w-full" variant="outline" onClick={() => void openDocument()}><FileText className="mr-2 h-4 w-4" />Open legacy attachment</Button>}</CardContent></Card>
              </div>

              <Card className="overflow-hidden rounded-3xl"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Split className="h-4 w-4 text-emerald-700" />Cost-centre allocation</CardTitle></CardHeader><CardContent className="p-0">{workspace?.allocations?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1000px]"><thead className="bg-slate-50"><tr>{["#", "Budget / Item", "Cost Centre", "Process", "Qty × Rate", "Without Tax", "Tax", "With Tax", "P&L", "%", "State"].map((heading) => <th key={heading} className="px-4 py-3 text-left text-[9px] font-semibold uppercase tracking-wide text-slate-500">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{workspace.allocations.map((allocation, index) => <tr key={allocation.id}><td className="px-4 py-3 text-xs font-bold">{index + 1}</td><td className="max-w-[220px] px-4 py-3 text-xs"><p className="truncate font-semibold">{allocation.budget_number}</p><p className="truncate text-[10px] text-slate-500">{allocation.budget_head} / {allocation.budget_sub_head} · {allocation.budget_item_name}</p></td><td className="px-4 py-3 text-xs">{allocation.cost_centre_name ?? "Branch common"}</td><td className="px-4 py-3 text-xs">{allocation.process_name ?? "Shared"}</td><td className="px-4 py-3 text-xs">{Number(allocation.quantity).toLocaleString("en-IN")} × {money(allocation.unit_rate)}</td><td className="px-4 py-3 text-xs">{money(allocation.amount_without_tax)}</td><td className="px-4 py-3 text-xs">{money(allocation.tax_amount)}</td><td className="px-4 py-3 text-xs font-bold">{money(allocation.amount_with_tax)}</td><td className="px-4 py-3 text-xs">{money(allocation.pnl_cost_amount)}</td><td className="px-4 py-3 text-xs">{Number(allocation.allocation_percentage).toFixed(4)}%</td><td className="px-4 py-3"><Badge variant="outline">{labelStatus(String(allocation.lifecycle_status))}</Badge></td></tr>)}</tbody></table></div> : <div className="p-5 text-xs text-slate-500">Legacy single-attribution GRN.</div>}</CardContent></Card>

              <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                <Card className="rounded-3xl"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-amber-700" />Validation controls</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{(workspace?.validations ?? []).map((validation) => <div key={validation.id} className={`rounded-xl border p-3 ${tone(String(validation.validation_status))}`}><div className="flex items-start gap-2">{validation.validation_status === "passed" || validation.validation_status === "overridden" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}<div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-wide">{labelStatus(String(validation.validation_code))}</p><p className="mt-1 text-[10px] leading-4">{validation.message}</p>{validation.override_reason && <p className="mt-2 rounded-lg bg-white/70 p-2 text-[10px]">Override: {validation.override_reason}</p>}{Number(validation.is_blocking) === 1 && validation.validation_status === "failed" && capabilities?.canReviewFinanceStage && <Button size="sm" variant="outline" className="mt-2" onClick={() => { setOverrideCode(String(validation.validation_code)); setOverrideReason(""); }}><BadgeCheck className="mr-1 h-3.5 w-3.5" />Finance override</Button>}</div></div>{overrideCode === validation.validation_code && <div className="mt-3 space-y-2"><Textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Mandatory detailed exception reason" /><div className="flex gap-2"><Button size="sm" onClick={() => overrideMutation.mutate()} disabled={overrideMutation.isPending}>{overrideMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="mr-1 h-3.5 w-3.5" />}Approve exception</Button><Button size="sm" variant="ghost" onClick={() => { setOverrideCode(null); setOverrideReason(""); }}>Cancel</Button></div></div>}</div>)}</CardContent></Card>
                <Card className="rounded-3xl"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><BadgeCheck className="h-4 w-4 text-rose-700" />Duplicate matches</CardTitle></CardHeader><CardContent className="space-y-2">{(workspace?.duplicates ?? []).map((duplicate) => <div key={duplicate.id} className="rounded-xl border border-rose-200 bg-rose-50 p-3"><div className="flex justify-between"><p className="text-xs font-semibold">{labelStatus(String(duplicate.match_type))}</p><Badge variant="outline">{Number(duplicate.confidence_score).toFixed(0)}%</Badge></div><p className="mt-1 text-[10px] text-slate-600">Matched GRN: {duplicate.matched_grn_number ?? "Document hash"}</p></div>)}{!workspace?.duplicates?.length && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">No duplicate match found.</div>}</CardContent></Card>
              </div>

              {canReview ? <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5"><div className="grid gap-4 lg:grid-cols-[220px_1fr]"><div className="space-y-2"><Label>Decision *</Label><Select value={decision} onValueChange={(value: "approved" | "rejected") => setDecision(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approved">Approve GRN</SelectItem><SelectItem value="rejected">Reject GRN</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Review note {decision === "rejected" ? "*" : ""}</Label><Textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></div></div>{decision === "approved" && blockers.length > 0 && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Approval is blocked by {blockers.length} unresolved server validation(s).</div>}</div> : <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800">Read-only access at the current workflow stage.</div>}
            </>}
          </div>
          <DialogFooter className="sticky bottom-0 border-t border-slate-200 bg-white px-6 py-4"><Button variant="outline" onClick={() => setTarget(null)}>Close</Button>{canReview && <Button className={decision === "approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"} onClick={submitDecision} disabled={reviewMutation.isPending || workspaceQuery.isLoading}>{reviewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : decision === "approved" ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <XCircle className="mr-2 h-4 w-4" />}{decision === "approved" ? "Approve GRN" : "Reject GRN"}</Button>}</DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
