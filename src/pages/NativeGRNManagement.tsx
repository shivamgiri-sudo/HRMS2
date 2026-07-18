import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Eye,
  FileCheck2,
  FilePlus,
  FileSearch,
  FileText,
  IndianRupee,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Split,
  XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BudgetLinkedGrnForm } from "@/components/finance/grn/BudgetLinkedGrnForm";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  amount_without_tax?: number | null;
  tax_amount?: number | null;
  amount_with_tax?: number | null;
  pnl_cost_amount?: number | null;
  bill_date?: string | null;
  due_date?: string | null;
  financial_year?: string | null;
  status: string;
  allocation_mode?: "single" | "split" | null;
  validation_score?: number | null;
  document_match_status?: string | null;
  attachment_path?: string | null;
  attachment_file_path?: string | null;
};

type SmartWorkspace = {
  grn: Record<string, any>;
  allocations: Array<Record<string, any>>;
  documents: Array<Record<string, any>>;
  extractions: Array<Record<string, any>>;
  validations: Array<Record<string, any>>;
  duplicates: Array<Record<string, any>>;
};

type FinanceCapabilities = {
  canCreate: boolean;
  canReviewBranchStage: boolean;
  canReviewFinanceStage: boolean;
  canReviewAccountsStage: boolean;
};

const STATUS_CONFIG: Record<
  string,
  { dot: string; badge: string; label: string }
> = {
  draft: {
    dot: "bg-slate-400",
    badge: "bg-slate-50 text-slate-600 border-slate-200",
    label: "Draft",
  },
  submitted: {
    dot: "bg-amber-400",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    label: "Branch Head Queue",
  },
  branch_head_approved: {
    dot: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    label: "Finance Head Queue",
  },
  pending_accounts_payment: {
    dot: "bg-violet-500",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    label: "Pending Accounts Payment",
  },
  payment_scheduled: {
    dot: "bg-indigo-500",
    badge: "bg-indigo-50 text-indigo-700 border-indigo-200",
    label: "Payment Scheduled",
  },
  partially_paid: {
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    label: "Partially Paid",
  },
  paid: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Paid",
  },
  approved: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Approved",
  },
  rejected: {
    dot: "bg-rose-500",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    label: "Rejected",
  },
  cancelled: {
    dot: "bg-slate-300",
    badge: "bg-slate-100 text-slate-500 border-slate-200",
    label: "Cancelled",
  },
};

const STATUS_TABS = [
  { value: "_all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Branch Head Queue" },
  { value: "branch_head_approved", label: "Finance Head Queue" },
  { value: "pending_accounts_payment", label: "Accounts Payment" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? {
    dot: "bg-slate-400",
    badge: "bg-slate-50 text-slate-600 border-slate-200",
    label: status.replaceAll("_", " "),
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold capitalize ${config.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function fmt(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function money(value: number | string | null | undefined) {
  return `₹${fmt(value)}`;
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function unwrapData<T>(value: any): T {
  return (value?.data ?? value) as T;
}

function validationTone(status: string) {
  if (["passed", "completed", "matched", "overridden"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (["warning", "manual_review", "near_match", "pending", "processing"].includes(status)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function Metric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "blue" | "emerald" | "amber" | "rose";
}) {
  const styles = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
  };
  return (
    <div className={`rounded-2xl border p-3 ${styles[tone]}`}>
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-bold text-slate-950">{value}</p>
    </div>
  );
}

function ApprovalQueueTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("submitted");
  const [grnTypeFilter, setGrnTypeFilter] = useState("_all");
  const [search, setSearch] = useState("");
  const [reviewTarget, setReviewTarget] = useState<GrnRow | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approved" | "rejected">(
    "approved"
  );
  const [reviewNote, setReviewNote] = useState("");

  const capabilitiesQuery = useQuery({
    queryKey: ["finance-capabilities-for-grn"],
    queryFn: async () => {
      const response = await hrmsApi.get<{
        success: boolean;
        data: FinanceCapabilities;
      }>("/api/finance/pnl/budgets/capabilities");
      return response.data;
    },
  });
  const capabilities = capabilitiesQuery.data;

  const listQuery = useQuery({
    queryKey: ["grn-list", statusFilter, grnTypeFilter, search],
    queryFn: async () => {
      const query = new URLSearchParams();
      if (statusFilter !== "_all") query.set("status", statusFilter);
      if (grnTypeFilter !== "_all") query.set("grnType", grnTypeFilter);
      if (search.trim()) query.set("search", search.trim());
      query.set("limit", "100");
      const response = await hrmsApi.get<any>(`/api/finance/grns?${query}`);
      return (response?.data ?? response?.rows ?? []) as GrnRow[];
    },
  });
  const rows = listQuery.data ?? [];

  const workspaceQuery = useQuery({
    queryKey: ["grn-review-workspace", reviewTarget?.id],
    enabled: Boolean(reviewTarget?.id),
    queryFn: async () => {
      const response = await hrmsApi.get<any>(
        `/api/finance/grns/${reviewTarget!.id}/workspace`
      );
      return unwrapData<SmartWorkspace>(response);
    },
  });
  const workspace = workspaceQuery.data;
  const parent = workspace?.grn ?? reviewTarget;
  const blockingValidations = (workspace?.validations ?? []).filter(
    (item) => Number(item.is_blocking) === 1 && item.validation_status === "failed"
  );
  const exactDuplicates = (workspace?.duplicates ?? []).filter(
    (item) => ["invoice_identity", "document_hash"].includes(String(item.match_type))
      && String(item.review_status ?? "open") === "open"
  );

  const canReview = useMemo(() => {
    if (!reviewTarget || !capabilities) return false;
    if (reviewTarget.status === "submitted") return capabilities.canReviewBranchStage;
    if (reviewTarget.status === "branch_head_approved") {
      return capabilities.canReviewFinanceStage;
    }
    return false;
  }, [capabilities, reviewTarget]);

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      hrmsApi.post(`/api/finance/grns/${id}/submit`, {}),
    onSuccess: () => {
      toast({ title: "GRN submitted to the Branch Head" });
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (error: Error) =>
      toast({ title: "Submission failed", description: error.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      decision,
      note,
    }: {
      id: string;
      decision: "approved" | "rejected";
      note: string;
    }) =>
      hrmsApi.post(`/api/finance/grns/${id}/review`, {
        decision,
        reviewNote: note || undefined,
      }),
    onSuccess: (_, input) => {
      toast({ title: `GRN ${input.decision}` });
      setReviewTarget(null);
      setReviewNote("");
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (error: Error) =>
      toast({ title: "Review failed", description: error.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      hrmsApi.post(`/api/finance/grns/${id}/cancel`, {}),
    onSuccess: () => {
      toast({ title: "GRN cancelled" });
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
    },
    onError: (error: Error) =>
      toast({ title: "Cancellation failed", description: error.message, variant: "destructive" }),
  });

  async function openDocument(documentId?: string) {
    if (!reviewTarget) return;
    try {
      const path = documentId
        ? `/api/finance/grns/${reviewTarget.id}/documents/${documentId}/file`
        : `/api/finance/grns/${reviewTarget.id}/attachment`;
      const blob = await hrmsApi.getBlob(path);
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

  function approveOrReject() {
    if (!reviewTarget) return;
    if (reviewDecision === "rejected" && !reviewNote.trim()) {
      toast({
        title: "Rejection note is mandatory",
        variant: "destructive",
      });
      return;
    }
    if (reviewDecision === "approved" && (blockingValidations.length || exactDuplicates.length)) {
      toast({
        title: "Approval is blocked",
        description: "Resolve blocking validations and exact duplicate matches first.",
        variant: "destructive",
      });
      return;
    }
    reviewMutation.mutate({
      id: reviewTarget.id,
      decision: reviewDecision,
      note: reviewNote.trim(),
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-950">GRN Approval & Control Queue</h2>
          <p className="mt-1 text-xs text-slate-500">
            Review invoice proof, cost-centre splits, duplicate checks, budget impact and tax facts before approval.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="w-56 pl-9"
              placeholder="Search GRN, vendor, Head…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select value={grnTypeFilter} onValueChange={setGrnTypeFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All types</SelectItem>
              <SelectItem value="vendor">Vendor</SelectItem>
              <SelectItem value="imprest">Imprest</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => void listQuery.refetch()}>
            <RefreshCw className={`h-4 w-4 ${listQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.value;
          const config = tab.value === "_all" ? null : STATUS_CONFIG[tab.value];
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-[#073f78] bg-[#073f78] text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {config && !active && <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />}
              {tab.label}
            </button>
          );
        })}
      </div>

      {listQuery.isLoading ? (
        <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20">
          <Loader2 className="h-7 w-7 animate-spin text-[#073f78]" />
        </div>
      ) : !rows.length ? (
        <div className="rounded-3xl border border-slate-200 bg-white py-16 text-center shadow-sm">
          <FileText className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No GRNs match the selected filters</p>
          <p className="mt-1 text-xs text-slate-400">Create a smart GRN or change the queue filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1180px]">
            <thead className="bg-[#073f78] text-white">
              <tr>
                {["GRN", "Type", "Branch", "Vendor / Holder", "Head", "Allocation", "Amount", "Validation", "Bill / Due", "Status", "Actions"].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-white/90">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 text-xs font-bold text-[#073f78]">{row.grn_number}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="capitalize">{row.grn_type}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-700"><span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-slate-400" />{row.branch_name ?? row.branch_id}</span></td>
                  <td className="max-w-[180px] px-4 py-3 text-xs text-slate-700"><span className="block truncate">{row.vendor_name ?? (row.grn_type === "imprest" ? "Imprest / reimbursement" : "—")}</span></td>
                  <td className="max-w-[190px] px-4 py-3 text-xs text-slate-700"><span className="block truncate">{row.head ?? "—"}</span><span className="block truncate text-[10px] text-slate-400">{row.sub_head ?? ""}</span></td>
                  <td className="px-4 py-3"><Badge className={row.allocation_mode === "split" ? "bg-violet-50 text-violet-700 hover:bg-violet-50" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}><Split className="mr-1 h-3 w-3" />{row.allocation_mode === "split" ? "Multi split" : "Single"}</Badge></td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-slate-900">{money(row.amount_with_tax ?? row.amount)}</td>
                  <td className="px-4 py-3"><div className="flex flex-col gap-1"><Badge variant="outline">{Number(row.validation_score ?? 0).toFixed(0)}%</Badge>{row.document_match_status && row.document_match_status !== "not_checked" && <span className="text-[9px] capitalize text-slate-500">{row.document_match_status.replaceAll("_", " ")}</span>}</div></td>
                  <td className="px-4 py-3 text-[10px] text-slate-500"><p>{fmtDate(row.bill_date)}</p><p className="mt-1">Due {fmtDate(row.due_date)}</p></td>
                  <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {row.status === "draft" && capabilities?.canCreate && (
                        <Button size="sm" variant="outline" onClick={() => submitMutation.mutate(row.id)} disabled={submitMutation.isPending}>
                          <Send className="mr-1 h-3.5 w-3.5" /> Submit
                        </Button>
                      )}
                      {["submitted", "branch_head_approved"].includes(row.status) && (
                        <Button size="sm" onClick={() => { setReviewTarget(row); setReviewDecision("approved"); setReviewNote(""); }}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> Review
                        </Button>
                      )}
                      {(row.attachment_path || row.attachment_file_path) && (
                        <Button size="icon" variant="outline" title="Open legacy attachment" onClick={() => { setReviewTarget(row); window.setTimeout(() => void openDocument(), 0); }}>
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {["draft", "submitted"].includes(row.status) && capabilities?.canCreate && (
                        <Button size="icon" variant="ghost" title="Cancel GRN" className="text-rose-500" onClick={() => cancelMutation.mutate(row.id)} disabled={cancelMutation.isPending}>
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(reviewTarget)} onOpenChange={(open) => !open && setReviewTarget(null)}>
        <DialogContent className="max-h-[92vh] max-w-[1180px] overflow-y-auto p-0">
          <DialogHeader className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div>
                <DialogTitle className="flex items-center gap-2 text-lg"><ClipboardList className="h-5 w-5 text-[#073f78]" />Review GRN — {reviewTarget?.grn_number}</DialogTitle>
                <p className="mt-1 text-xs text-slate-500">Verify the evidence, every cost split and all blocking financial controls before deciding.</p>
              </div>
              {reviewTarget && <StatusBadge status={reviewTarget.status} />}
            </div>
          </DialogHeader>

          <div className="space-y-5 p-6">
            {workspaceQuery.isLoading ? (
              <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-[#073f78]" /></div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <Metric label="Without tax" value={money(parent?.amount_without_tax ?? 0)} />
                  <Metric label="Tax" value={money(parent?.tax_amount ?? 0)} tone="blue" />
                  <Metric label="With tax" value={money(parent?.amount_with_tax ?? parent?.amount ?? 0)} tone="emerald" />
                  <Metric label="P&L cost" value={money(parent?.pnl_cost_amount ?? parent?.amount ?? 0)} tone="amber" />
                  <Metric label="Validation" value={`${Number(parent?.validation_score ?? 0).toFixed(0)}%`} tone={blockingValidations.length ? "rose" : "emerald"} />
                  <Metric label="Duplicate matches" value={String(workspace?.duplicates?.length ?? 0)} tone={exactDuplicates.length ? "rose" : "slate"} />
                </div>

                <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                  <Card className="rounded-3xl border-slate-200">
                    <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><FileCheck2 className="h-4 w-4 text-blue-700" />Invoice and legacy GRN fields</CardTitle></CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        ["Vendor / Holder", parent?.vendor_name ?? "—"],
                        ["Invoice Number", parent?.invoice_number ?? "—"],
                        ["Invoice Date", fmtDate(parent?.bill_date)],
                        ["Service Start", fmtDate(parent?.service_period_start)],
                        ["Service End", fmtDate(parent?.service_period_end)],
                        ["PO / Contract", parent?.purchase_reference ?? "—"],
                        ["Vendor GSTIN", parent?.vendor_gstin ?? "—"],
                        ["Place of Supply", parent?.place_of_supply ?? "—"],
                        ["Payment Terms", `${Number(parent?.payment_terms_days ?? 0)} days`],
                        ["Due Date", fmtDate(parent?.due_date)],
                        ["Financial Year", parent?.financial_year ?? "—"],
                        ["Allocation Mode", parent?.allocation_mode ?? "legacy single"],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words text-xs font-semibold text-slate-800">{String(value)}</p></div>
                      ))}
                      {parent?.remarks && <div className="sm:col-span-2 lg:col-span-3 rounded-xl bg-slate-50 p-3"><p className="text-[9px] uppercase tracking-wide text-slate-400">Remarks</p><p className="mt-1 text-xs leading-5 text-slate-700">{parent.remarks}</p></div>}
                    </CardContent>
                  </Card>

                  <Card className="rounded-3xl border-slate-200">
                    <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><FileSearch className="h-4 w-4 text-violet-700" />Documents and extraction</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {(workspace?.documents ?? []).map((document) => (
                        <button key={document.id} type="button" onClick={() => void openDocument(String(document.id))} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50"><FileText className="h-5 w-5 text-blue-600" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{document.original_name}</p><p className="mt-0.5 text-[10px] text-slate-500">{String(document.extraction_status ?? "not analyzed").replaceAll("_", " ")}</p></div><Badge className={`border ${validationTone(String(document.extraction_status ?? "pending"))}`}>{Number(document.is_primary) === 1 ? "Primary" : "Support"}</Badge></button>
                      ))}
                      {!workspace?.documents?.length && (parent?.attachment_path || parent?.attachment_file_path) && <Button variant="outline" className="w-full" onClick={() => void openDocument()}><FileText className="mr-2 h-4 w-4" />Open legacy attachment</Button>}
                      {!workspace?.documents?.length && !(parent?.attachment_path || parent?.attachment_file_path) && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">No supporting proof is available.</div>}
                      {workspace?.extractions?.[0] && <div className="rounded-xl border border-violet-200 bg-violet-50 p-3"><p className="text-xs font-bold text-violet-950">Latest extraction</p><p className="mt-1 text-[10px] text-violet-700">{workspace.extractions[0].provider} · confidence {Number(workspace.extractions[0].confidence_score ?? 0).toFixed(0)}% · {workspace.extractions[0].status}</p></div>}
                    </CardContent>
                  </Card>
                </div>

                <Card className="overflow-hidden rounded-3xl border-slate-200">
                  <CardHeader className="border-b border-slate-100"><CardTitle className="flex items-center gap-2 text-sm"><Split className="h-4 w-4 text-emerald-700" />Cost-centre and approved budget allocation</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    {workspace?.allocations?.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[1050px]">
                          <thead className="bg-slate-50"><tr>{["#", "Budget / Item", "Cost Centre", "Process", "Qty × Rate", "Without Tax", "Tax", "With Tax", "P&L", "%", "State"].map((heading) => <th key={heading} className="px-4 py-3 text-left text-[9px] font-semibold uppercase tracking-wide text-slate-500">{heading}</th>)}</tr></thead>
                          <tbody className="divide-y divide-slate-100">{workspace.allocations.map((allocation, index) => <tr key={allocation.id}><td className="px-4 py-3 text-xs font-bold">{index + 1}</td><td className="max-w-[230px] px-4 py-3 text-xs"><p className="truncate font-semibold">{allocation.budget_number}</p><p className="truncate text-[10px] text-slate-500">{allocation.budget_head} / {allocation.budget_sub_head} · {allocation.budget_item_name}</p></td><td className="px-4 py-3 text-xs">{allocation.cost_centre_name ?? "Branch common"}</td><td className="px-4 py-3 text-xs">{allocation.process_name ?? "Shared"}</td><td className="px-4 py-3 text-xs">{Number(allocation.quantity).toLocaleString("en-IN")} × {money(allocation.unit_rate)}</td><td className="px-4 py-3 text-xs">{money(allocation.amount_without_tax)}</td><td className="px-4 py-3 text-xs">{money(allocation.tax_amount)}</td><td className="px-4 py-3 text-xs font-bold">{money(allocation.amount_with_tax)}</td><td className="px-4 py-3 text-xs">{money(allocation.pnl_cost_amount)}</td><td className="px-4 py-3 text-xs">{Number(allocation.allocation_percentage).toFixed(4)}%</td><td className="px-4 py-3"><Badge variant="outline" className="capitalize">{String(allocation.lifecycle_status).replaceAll("_", " ")}</Badge></td></tr>)}</tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-5 text-xs text-slate-500">Legacy single-attribution GRN. Process: {parent?.process_name ?? "Shared"}; Cost Centre: {parent?.cost_centre_name ?? "Branch common"}.</div>
                    )}
                  </CardContent>
                </Card>

                <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
                  <Card className="rounded-3xl border-slate-200">
                    <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-amber-700" />Validation results</CardTitle></CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                      {(workspace?.validations ?? []).map((validation) => <div key={validation.id} className={`rounded-xl border p-3 ${validationTone(String(validation.validation_status))}`}><div className="flex items-start gap-2">{validation.validation_status === "passed" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}<div><p className="text-[10px] font-bold uppercase tracking-wide">{String(validation.validation_code).replaceAll("_", " ")}</p><p className="mt-1 text-[10px] leading-4">{validation.message}</p>{Number(validation.is_blocking) === 1 && validation.validation_status === "failed" && <Badge className="mt-2 bg-white/70 text-rose-700">Blocking</Badge>}</div></div></div>)}
                      {!workspace?.validations?.length && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 md:col-span-2">No server validation record exists for this historical GRN. Review manually before approval.</div>}
                    </CardContent>
                  </Card>

                  <Card className="rounded-3xl border-slate-200">
                    <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><BadgeCheck className="h-4 w-4 text-rose-700" />Duplicate review</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {(workspace?.duplicates ?? []).map((duplicate) => <div key={duplicate.id} className={`rounded-xl border p-3 ${duplicate.review_status === "cleared" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold capitalize">{String(duplicate.match_type).replaceAll("_", " ")}</p><Badge variant="outline">{Number(duplicate.confidence_score).toFixed(0)}%</Badge></div><p className="mt-1 text-[10px] text-slate-600">Matched GRN: {duplicate.matched_grn_number ?? "Document hash"} · {duplicate.review_status}</p></div>)}
                      {!workspace?.duplicates?.length && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">No duplicate match was found.</div>}
                    </CardContent>
                  </Card>
                </div>

                {canReview ? (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                      <div className="space-y-2"><Label>Decision *</Label><Select value={reviewDecision} onValueChange={(value: "approved" | "rejected") => setReviewDecision(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approved">Approve GRN</SelectItem><SelectItem value="rejected">Reject GRN</SelectItem></SelectContent></Select></div>
                      <div className="space-y-2"><Label>Review note {reviewDecision === "rejected" ? "*" : ""}</Label><Textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Record observations, exceptions or rejection reason" /></div>
                    </div>
                    {reviewDecision === "approved" && (blockingValidations.length > 0 || exactDuplicates.length > 0) && <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Approval is blocked by {blockingValidations.length} validation failure(s) and {exactDuplicates.length} exact duplicate match(es).</div>}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800">You have read-only access at this workflow stage.</div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="sticky bottom-0 border-t border-slate-200 bg-white px-6 py-4">
            <Button variant="outline" onClick={() => setReviewTarget(null)}>Close</Button>
            {canReview && <Button className={reviewDecision === "approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"} onClick={approveOrReject} disabled={reviewMutation.isPending || workspaceQuery.isLoading}>{reviewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : reviewDecision === "approved" ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <XCircle className="mr-2 h-4 w-4" />}{reviewDecision === "approved" ? "Approve GRN" : "Reject GRN"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function NativeGRNManagement() {
  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#ffffff_45%,_#f4f7fb_100%)]">
        <div className="relative overflow-hidden border-b border-slate-200 bg-white shadow-sm">
          <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "repeating-linear-gradient(45deg, #073f78 0, #073f78 1px, transparent 0, transparent 50%)", backgroundSize: "8px 8px" }} />
          <div className="relative px-6 py-5">
            <nav className="mb-2 flex items-center gap-1 text-[11px] text-slate-400"><span>Finance</span><ChevronRight className="h-3 w-3" /><span className="font-medium text-[#073f78]">GRN Management</span></nav>
            <div className="flex items-center gap-4"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#073f78] shadow-md shadow-[#073f78]/20"><FilePlus className="h-5 w-5 text-white" /></div><div><h1 className="text-xl font-bold text-slate-950">Smart GRN Management</h1><p className="mt-0.5 text-xs text-slate-500">Document intelligence, exact cost-centre allocation and staged finance approvals.</p></div></div>
          </div>
        </div>

        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <Tabs defaultValue="create">
            <TabsList className="mb-6 h-auto w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <TabsTrigger value="create" className="rounded-lg px-5 py-2 text-xs font-semibold data-[state=active]:bg-[#073f78] data-[state=active]:text-white"><FilePlus className="mr-2 h-3.5 w-3.5" />Create Smart GRN</TabsTrigger>
              <TabsTrigger value="queue" className="rounded-lg px-5 py-2 text-xs font-semibold data-[state=active]:bg-[#073f78] data-[state=active]:text-white"><ClipboardList className="mr-2 h-3.5 w-3.5" />Approval & Control Queue</TabsTrigger>
            </TabsList>
            <TabsContent value="create"><BudgetLinkedGrnForm /></TabsContent>
            <TabsContent value="queue"><Card className="rounded-3xl border-slate-200 shadow-sm"><CardContent className="p-5"><ApprovalQueueTab /></CardContent></Card></TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
