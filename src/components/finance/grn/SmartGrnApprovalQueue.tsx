import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CheckCircle2,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
      {/* Header + filters */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-950">GRN Approval &amp; Control Queue</h2>
          <p className="mt-1 text-xs text-slate-500">Inspect documents, allocation splits, duplicate matches and server validation before approval.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="w-56 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search GRN, vendor, Head…" />
          </div>
          <Select value={grnType} onValueChange={setGrnType}>
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

      {/* Status pills */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => setStatus(value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${status === value ? "border-[#073f78] bg-[#073f78] text-white" : "border-slate-200 bg-white text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Queue table — compact 8-column layout */}
      {listQuery.isLoading ? (
        <div className="flex justify-center rounded-3xl border border-slate-200 bg-white py-20">
          <Loader2 className="h-7 w-7 animate-spin" />
        </div>
      ) : !rows.length ? (
        <div className="rounded-3xl border border-slate-200 bg-white py-16 text-center">
          <FileText className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No GRNs match the filters</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b">
                <th className="h-8 px-3 text-left font-medium text-slate-500 w-[110px]">GRN</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500 hidden sm:table-cell">Type</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500">Branch</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500 hidden md:table-cell">Vendor</th>
                <th className="h-8 px-3 text-right font-medium text-slate-500">Amount</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500 hidden lg:table-cell">Due</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500">Status</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500">Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="h-9 border-b hover:bg-slate-50 cursor-pointer"
                  onClick={() => { setTarget(row); setDecision("approved"); setReviewNote(""); setOverrideCode(null); setOverrideReason(""); }}
                >
                  <td className="px-3 py-1 font-mono text-xs font-bold text-[#073f78]">{row.grn_number}</td>
                  <td className="px-3 py-1 hidden sm:table-cell">
                    <Badge variant="outline" className="text-xs capitalize">{row.grn_type}</Badge>
                  </td>
                  <td className="px-3 py-1 truncate max-w-[100px]">
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="h-3 w-3 text-slate-400 shrink-0" />
                      {row.branch_name ?? row.branch_id}
                    </span>
                  </td>
                  <td className="px-3 py-1 hidden md:table-cell truncate max-w-[100px]">{row.vendor_name ?? (row.grn_type === "imprest" ? "Imprest" : "—")}</td>
                  <td className="px-3 py-1 text-right font-medium">{money(row.amount_with_tax ?? row.amount)}</td>
                  <td className="px-3 py-1 hidden lg:table-cell">{row.due_date ? date(row.due_date) : "—"}</td>
                  <td className="px-3 py-1">
                    <Badge variant="secondary" className="text-xs">{labelStatus(row.status)}</Badge>
                  </td>
                  <td className="px-3 py-1">
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={(e) => { e.stopPropagation(); setTarget(row); setDecision("approved"); setReviewNote(""); setOverrideCode(null); setOverrideReason(""); }}
                      >
                        Review
                      </Button>
                      {row.status === "draft" && capabilities?.canCreate && (
                        <Button
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={(e) => { e.stopPropagation(); submitMutation.mutate(row.id); }}
                        >
                          <Send className="h-3 w-3" />
                        </Button>
                      )}
                      {["draft", "submitted"].includes(row.status) && capabilities?.canCreate && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-rose-500"
                          onClick={(e) => { e.stopPropagation(); cancelMutation.mutate(row.id); }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">No GRNs in queue</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabbed Sheet — replaces the 1180px Dialog */}
      <Sheet open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        <SheetContent side="right" className="flex w-[560px] flex-col gap-0 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-sm font-semibold">
              {target?.grn_number} — Review
            </SheetTitle>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {target?.branch_name && <Badge variant="outline" className="text-xs">{target.branch_name}</Badge>}
              {target?.vendor_name && <Badge variant="outline" className="text-xs">{target.vendor_name}</Badge>}
              <Badge variant="secondary" className="text-xs">{target ? labelStatus(target.status) : ""}</Badge>
            </div>
          </SheetHeader>

          <Tabs defaultValue="details" className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="mx-4 mt-3 w-fit shrink-0">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="allocations">Allocations</TabsTrigger>
              <TabsTrigger value="validation">Validation</TabsTrigger>
              <TabsTrigger value="decision">Decision</TabsTrigger>
            </TabsList>

            {/* Details tab */}
            <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3 m-0">
              {workspaceQuery.isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : (
                <>
                  {/* Metrics row */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <Metric label="Without tax" value={money(parent?.amount_without_tax)} />
                    <Metric label="With tax" value={money(parent?.amount_with_tax ?? parent?.amount)} toneName="emerald" />
                    <Metric label="Validation" value={`${Number(parent?.validation_score ?? 0).toFixed(0)}%`} toneName={blockers.length ? "rose" : "emerald"} />
                  </div>

                  {/* GRN facts */}
                  {target && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      {([
                        ["GRN Number", target.grn_number],
                        ["Type", target.grn_type],
                        ["Branch", target.branch_name],
                        ["Vendor", target.vendor_name],
                        ["Head", target.head],
                        ["Sub-head", target.sub_head],
                        ["Amount", money(target.amount)],
                        ["With tax", money(target.amount_with_tax)],
                        ["Bill date", date(target.bill_date)],
                        ["Due date", date(target.due_date)],
                        ["Allocation", target.allocation_mode ?? "single"],
                        ["Validation score", target.validation_score != null ? `${target.validation_score}%` : "—"],
                        ["Invoice", parent?.invoice_number ?? "—"],
                        ["Financial year", parent?.financial_year ?? "—"],
                        ["PO / Contract", parent?.purchase_reference ?? "—"],
                        ["GSTIN", parent?.vendor_gstin ?? "—"],
                      ] as [string, string | null | undefined][]).map(([label, val]) => (
                        <Fragment key={label}>
                          <dt className="text-slate-500">{label}</dt>
                          <dd className="font-medium text-slate-900 truncate">{val ?? "—"}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  )}

                  {/* Documents */}
                  <div className="mt-4">
                    <Card className="rounded-2xl">
                      <CardHeader className="py-2 px-3">
                        <CardTitle className="flex items-center gap-2 text-xs">
                          <FileSearch className="h-3.5 w-3.5 text-violet-700" />Documents
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1.5 px-3 pb-3">
                        {(workspace?.documents ?? []).map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => void openDocument(String(doc.id))}
                            className="flex w-full items-center gap-2 rounded-xl border border-slate-200 p-2 text-left hover:bg-slate-50"
                          >
                            <FileText className="h-4 w-4 text-blue-600 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold">{doc.original_name}</p>
                              <p className="text-[10px] text-slate-500">{String(doc.extraction_status ?? "pending").replaceAll("_", " ")}</p>
                            </div>
                            <Badge className={`border text-[10px] ${tone(String(doc.extraction_status ?? "pending"))}`}>
                              {Number(doc.is_primary) === 1 ? "Primary" : "Support"}
                            </Badge>
                          </button>
                        ))}
                        {!workspace?.documents?.length && (
                          <Button className="w-full" variant="outline" size="sm" onClick={() => void openDocument()}>
                            <FileText className="mr-2 h-3.5 w-3.5" />Open legacy attachment
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}
            </TabsContent>

            {/* Allocations tab */}
            <TabsContent value="allocations" className="flex-1 overflow-y-auto px-4 py-3 m-0">
              {workspaceQuery.isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : workspace?.allocations?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-slate-50">
                        {["#", "Budget / Item", "Cost Centre", "Without Tax", "With Tax", "%"].map((h) => (
                          <th key={h} className="px-2 py-2 text-left font-medium text-slate-500 text-[10px] uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {workspace.allocations.map((alloc, index) => (
                        <tr key={alloc.id}>
                          <td className="px-2 py-2 font-bold">{index + 1}</td>
                          <td className="px-2 py-2 max-w-[140px]">
                            <p className="truncate font-semibold">{alloc.budget_number}</p>
                            <p className="truncate text-[10px] text-slate-500">{alloc.budget_head} / {alloc.budget_sub_head}</p>
                          </td>
                          <td className="px-2 py-2">{alloc.cost_centre_name ?? "Branch common"}</td>
                          <td className="px-2 py-2">{money(alloc.amount_without_tax)}</td>
                          <td className="px-2 py-2 font-bold">{money(alloc.amount_with_tax)}</td>
                          <td className="px-2 py-2">{Number(alloc.allocation_percentage).toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-slate-400">Legacy single-attribution GRN — no split allocations.</p>
              )}
            </TabsContent>

            {/* Validation tab */}
            <TabsContent value="validation" className="flex-1 overflow-y-auto px-4 py-3 m-0">
              {workspaceQuery.isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : (
                <div className="space-y-3">
                  {/* Validation controls */}
                  <Card className="rounded-2xl">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="flex items-center gap-2 text-xs">
                        <ShieldCheck className="h-3.5 w-3.5 text-amber-700" />Validation controls
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 px-3 pb-3">
                      {(workspace?.validations ?? []).map((v) => (
                        <div key={v.id} className={`rounded-xl border p-2.5 text-xs ${tone(String(v.validation_status))}`}>
                          <div className="flex items-start gap-2">
                            {v.validation_status === "passed" || v.validation_status === "overridden"
                              ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-bold uppercase tracking-wide">{labelStatus(String(v.validation_code))}</p>
                              <p className="mt-0.5 text-[10px] leading-4">{v.message}</p>
                              {v.override_reason && (
                                <p className="mt-1.5 rounded-lg bg-white/70 p-1.5 text-[10px]">Override: {v.override_reason}</p>
                              )}
                              {Number(v.is_blocking) === 1 && v.validation_status === "failed" && capabilities?.canReviewFinanceStage && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="mt-2 h-6 px-2 text-[10px]"
                                  onClick={() => { setOverrideCode(String(v.validation_code)); setOverrideReason(""); }}
                                >
                                  <BadgeCheck className="mr-1 h-3 w-3" />Finance override
                                </Button>
                              )}
                            </div>
                          </div>
                          {overrideCode === v.validation_code && (
                            <div className="mt-2.5 space-y-2">
                              <Textarea
                                value={overrideReason}
                                onChange={(e) => setOverrideReason(e.target.value)}
                                placeholder="Mandatory detailed exception reason"
                                className="text-xs min-h-[60px]"
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => overrideMutation.mutate()}
                                  disabled={overrideMutation.isPending}
                                >
                                  {overrideMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <BadgeCheck className="mr-1 h-3 w-3" />}
                                  Approve exception
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setOverrideCode(null); setOverrideReason(""); }}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {!(workspace?.validations ?? []).length && (
                        <p className="text-xs text-slate-400">No validation records found.</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Duplicates */}
                  <Card className="rounded-2xl">
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="flex items-center gap-2 text-xs">
                        <BadgeCheck className="h-3.5 w-3.5 text-rose-700" />Duplicate matches
                        {(workspace?.duplicates?.length ?? 0) > 0 && (
                          <Badge variant="destructive" className="ml-auto text-[10px]">{workspace!.duplicates.length}</Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5 px-3 pb-3">
                      {(workspace?.duplicates ?? []).map((dup) => (
                        <div key={dup.id} className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs">
                          <div className="flex justify-between">
                            <p className="font-semibold">{labelStatus(String(dup.match_type))}</p>
                            <Badge variant="outline" className="text-[10px]">{Number(dup.confidence_score).toFixed(0)}%</Badge>
                          </div>
                          <p className="mt-0.5 text-[10px] text-slate-600">Matched GRN: {dup.matched_grn_number ?? "Document hash"}</p>
                        </div>
                      ))}
                      {!workspace?.duplicates?.length && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
                          No duplicate match found.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>

            {/* Decision tab */}
            <TabsContent value="decision" className="flex-1 overflow-y-auto px-4 py-3 m-0">
              {canReview ? (
                <div className="space-y-3">
                  {decision === "approved" && blockers.length > 0 && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                      Approval is blocked by {blockers.length} unresolved server validation(s). Resolve or obtain Finance override first.
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Decision *</Label>
                    <Select value={decision} onValueChange={(v: "approved" | "rejected") => setDecision(v)}>
                      <SelectTrigger className="mt-1 h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="approved">Approve GRN</SelectItem>
                        <SelectItem value="rejected">Reject GRN</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Review note {decision === "rejected" ? "*" : ""}</Label>
                    <Textarea
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      className="mt-1 min-h-[80px] text-sm"
                      placeholder="Add review notes..."
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800">
                  Read-only access at the current workflow stage.
                </div>
              )}
            </TabsContent>
          </Tabs>

          <SheetFooter className="border-t px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => setTarget(null)}>Close</Button>
            {canReview && (
              <Button
                size="sm"
                className={decision === "approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}
                disabled={reviewMutation.isPending || workspaceQuery.isLoading}
                onClick={submitDecision}
              >
                {reviewMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {decision === "approved"
                  ? <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Approve GRN</>
                  : <><XCircle className="mr-1.5 h-3.5 w-3.5" />Reject GRN</>}
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
