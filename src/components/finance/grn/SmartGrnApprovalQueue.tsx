import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  Split,
  XCircle,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import {
  checkTone,
  dateLabel,
  grnStatusTone,
  labelStatus,
  money,
} from "@/components/finance/grn/grn-format";
import {
  GRN_SHEET_TAB_TRIGGER,
  GRN_SHEET_TABS_LIST,
  GRN_TR,
  GrnAlert,
  GrnButton,
  GrnCard,
  GrnCardHeader,
  GrnCellSub,
  GrnChip,
  GrnEmptyState,
  GrnIconButton,
  GrnKv,
  GrnKvList,
  GrnMetric,
  GrnMetricStrip,
  GrnSearchInput,
  GrnSelect,
  GrnTable,
  GrnTd,
  GrnTextarea,
  GrnTh,
} from "@/components/finance/grn/grn-ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useGrnSummary } from "@/hooks/useGrnSummary";
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
  accounting_period?: string | null;
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

function unwrap<T>(value: any): T {
  return (value?.data ?? value) as T;
}

export function SmartGrnApprovalQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("submitted");
  const [grnType, setGrnType] = useState("_all");
  const [search, setSearch] = useState("");
  const [backDated, setBackDated] = useState(false);
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

  // Per-status counts for the filter chips. Aggregated server-side, so a chip's number is the
  // true total rather than however many of that status happened to fit in the 100-row list.
  const summary = useGrnSummary().data;

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
  // The workspace row carries far more columns than the list row's GrnRow type declares, and the
  // Details tab reads several of them (invoice_number, vendor_gstin, …). Typed as the loose record
  // it actually is, rather than a union that has no such properties on one arm.
  const parent: Record<string, any> | undefined = workspace?.grn ?? target ?? undefined;
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
      // Chip counts and the page header read the summary aggregate, not this list.
      void queryClient.invalidateQueries({ queryKey: ["grn-summary"] });
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
      // Chip counts and the page header read the summary aggregate, not this list.
      void queryClient.invalidateQueries({ queryKey: ["grn-summary"] });
    },
    onError: (error: Error) =>
      toast({ title: "Review failed", description: error.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/finance/grns/${id}/cancel`, {}),
    onSuccess: () => {
      toast({ title: "GRN cancelled" });
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
      // Chip counts and the page header read the summary aggregate, not this list.
      void queryClient.invalidateQueries({ queryKey: ["grn-summary"] });
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

  /**
   * Takes the decision explicitly rather than reading it from state. The footer now has separate
   * Reject and Approve buttons, and `setDecision(x); submitDecision()` would have submitted the
   * *previous* decision — setState is asynchronous and submitDecision closes over the old value.
   */
  function submitDecision(decision: "approved" | "rejected") {
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
  // Client-side back-dated filter: show only GRNs where accounting_period differs from
  // the invoice date month (period-end cut-off entries booked into a prior accounting month).
  const displayRows = backDated
    ? rows.filter((row) => {
        const ap = row.accounting_period?.slice(0, 7);
        const bp = row.bill_date?.slice(0, 7);
        return ap && bp && ap !== bp;
      })
    : rows;

  return (
    <>
      <GrnCard>
        <GrnCardHeader
          title="GRN Approval & Control Queue"
          description="Inspect documents, allocation splits, duplicate matches and server validation before approval."
        />

        <div className="flex flex-wrap items-center gap-2 px-[16px] py-[12px]">
          <GrnSearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // Names what the API actually searches — grn_number, vendor_name, head, description.
            // Branch is not a searchable column, so promising it would be a lie.
            placeholder="Search GRN, vendor, head or description"
          />
          <GrnSelect small value={grnType} onChange={(e) => setGrnType(e.target.value)} aria-label="GRN type">
            <option value="_all">All types</option>
            <option value="vendor">Vendor</option>
            <option value="imprest">Imprest</option>
          </GrnSelect>
          <GrnChip active={backDated} onClick={() => setBackDated((v) => !v)}>
            Back-dated
          </GrnChip>
          <GrnIconButton onClick={() => void listQuery.refetch()} title="Refresh" aria-label="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`} />
          </GrnIconButton>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-grn-line-soft px-4 pb-3">
          {STATUS_TABS.map(([value, label]) => (
            <GrnChip
              key={value}
              active={status === value}
              onClick={() => setStatus(value)}
              // Counts come from the summary aggregate, so they reflect every matching GRN
              // rather than whatever fitted in the 100-row list response.
              count={value === "_all" ? undefined : summary?.byStatus[value]?.count}
            >
              {label}
            </GrnChip>
          ))}
        </div>

        {listQuery.isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-7 w-7 animate-spin text-grn-ink-soft" />
          </div>
        ) : !displayRows.length ? (
          <GrnEmptyState icon={<FileText className="h-9 w-9" />} title="No GRNs match the filters" />
        ) : (
          <GrnTable minWidth={980}>
            <thead>
              <tr>
                <GrnTh sticky={false} className="w-[120px]">GRN</GrnTh>
                <GrnTh sticky={false}>Type</GrnTh>
                <GrnTh sticky={false}>Branch</GrnTh>
                <GrnTh sticky={false}>Vendor</GrnTh>
                <GrnTh sticky={false} align="right">Amount</GrnTh>
                <GrnTh sticky={false}>Due</GrnTh>
                {backDated && <GrnTh sticky={false}>Acctg Period</GrnTh>}
                <GrnTh sticky={false}>Status</GrnTh>
                <GrnTh sticky={false} />
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr
                  key={row.id}
                  className={`${GRN_TR} cursor-pointer`}
                  onClick={() => { setTarget(row); setDecision("approved"); setReviewNote(""); setOverrideCode(null); setOverrideReason(""); }}
                >
                  <GrnTd className="font-grn-mono font-bold text-grn-brand">{row.grn_number}</GrnTd>
                  <GrnTd>
                    <StatusStamp tone="neutral">{row.grn_type}</StatusStamp>
                  </GrnTd>
                  <GrnTd className="max-w-[140px] truncate">
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="h-3 w-3 shrink-0 text-grn-ink-soft" />
                      {row.branch_name ?? row.branch_id}
                    </span>
                  </GrnTd>
                  <GrnTd className="max-w-[160px] truncate">
                    {row.vendor_name ?? (row.grn_type === "imprest" ? "Imprest" : "—")}
                  </GrnTd>
                  <GrnTd align="right" className="font-semibold">{money(row.amount_with_tax ?? row.amount)}</GrnTd>
                  <GrnTd>{row.due_date ? dateLabel(row.due_date) : "—"}</GrnTd>
                  {backDated && (
                    <GrnTd>
                      <span className="font-grn-mono text-amber-700">{row.accounting_period ?? "—"}</span>
                    </GrnTd>
                  )}
                  <GrnTd>
                    <StatusStamp tone={grnStatusTone(row.status)}>{labelStatus(row.status)}</StatusStamp>
                  </GrnTd>
                  <GrnTd>
                    <div className="flex justify-end gap-1.5">
                      <GrnButton
                        variant="primary"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setTarget(row); setDecision("approved"); setReviewNote(""); setOverrideCode(null); setOverrideReason(""); }}
                      >
                        Review
                      </GrnButton>
                      {/* Not in the redesign mock, but a real capability: a draft only leaves the
                          branch when someone submits it. */}
                      {row.status === "draft" && capabilities?.canCreate && (
                        <GrnIconButton
                          title="Submit to Branch Head"
                          aria-label="Submit to Branch Head"
                          onClick={(e) => { e.stopPropagation(); submitMutation.mutate(row.id); }}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </GrnIconButton>
                      )}
                      {["draft", "submitted"].includes(row.status) && capabilities?.canCreate && (
                        <GrnIconButton
                          title="Cancel this GRN"
                          aria-label="Cancel this GRN"
                          className="hover:border-grn-crit hover:text-grn-crit"
                          onClick={(e) => { e.stopPropagation(); cancelMutation.mutate(row.id); }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </GrnIconButton>
                      )}
                    </div>
                  </GrnTd>
                </tr>
              ))}
            </tbody>
          </GrnTable>
        )}
      </GrnCard>

      {/* Tabbed Sheet — replaces the 1180px Dialog */}
      <Sheet open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        {/* Full width below 560px — a fixed 560 overflowed the viewport on a phone. */}
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:w-[560px] sm:max-w-[560px]">
          <SheetHeader className="border-b border-grn-line bg-grn-line-soft px-[16px] py-[12px]">
            <SheetTitle className="font-grn-mono text-[13px] font-bold text-grn-brand">
              {target?.grn_number} — Review
            </SheetTitle>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className="text-[11px] text-grn-ink-soft">
                {[target?.vendor_name, target?.branch_name].filter(Boolean).join(" · ") || "—"}
              </span>
              {target && <StatusStamp tone={grnStatusTone(target.status)}>{labelStatus(target.status)}</StatusStamp>}
            </div>
          </SheetHeader>

          <Tabs defaultValue="details" className="flex flex-1 flex-col overflow-hidden">
            <TabsList className={`${GRN_SHEET_TABS_LIST} shrink-0`}>
              <TabsTrigger value="details" className={GRN_SHEET_TAB_TRIGGER}>Details</TabsTrigger>
              <TabsTrigger value="allocations" className={GRN_SHEET_TAB_TRIGGER}>Allocations</TabsTrigger>
              <TabsTrigger value="validation" className={GRN_SHEET_TAB_TRIGGER}>
                Validation
                {blockers.length > 0 && (
                  <span className="rounded-full bg-grn-warn-bg px-1.5 font-grn-mono text-[9.5px] font-bold text-grn-warn">
                    {blockers.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="decision" className={GRN_SHEET_TAB_TRIGGER}>Decision</TabsTrigger>
            </TabsList>

            {/* Details tab */}
            <TabsContent value="details" className="m-0 flex-1 overflow-y-auto">
              {workspaceQuery.isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-grn-ink-soft" /></div>
              ) : (
                <>
                  <GrnMetricStrip className="border-b border-grn-line-soft">
                    <GrnMetric label="Without tax" value={money(parent?.amount_without_tax)} />
                    <GrnMetric label="With tax" value={money(parent?.amount_with_tax ?? parent?.amount)} />
                    <GrnMetric
                      label="Validation"
                      value={`${Number(parent?.validation_score ?? 0).toFixed(0)}%`}
                      tone={blockers.length ? "crit" : "ok"}
                    />
                  </GrnMetricStrip>

                  {target && (
                    <GrnKvList>
                      {([
                        ["GRN Number", target.grn_number],
                        ["Type", target.grn_type],
                        ["Branch", target.branch_name],
                        ["Vendor", target.vendor_name],
                        ["Head", target.head],
                        ["Sub-head", target.sub_head],
                        ["Amount", money(target.amount)],
                        ["With tax", money(target.amount_with_tax)],
                        ["Bill date", dateLabel(target.bill_date)],
                        ["Due date", dateLabel(target.due_date)],
                        ["Allocation", target.allocation_mode ?? "single"],
                        ["Validation score", target.validation_score != null ? `${target.validation_score}%` : "—"],
                        ["Invoice", parent?.invoice_number ?? "—"],
                        ["Financial year", parent?.financial_year ?? "—"],
                        ["PO / Contract", parent?.purchase_reference ?? "—"],
                        ["GSTIN", parent?.vendor_gstin ?? "—"],
                      ] as [string, string | null | undefined][]).map(([label, val]) => (
                        <GrnKv key={label} label={label}>
                          <span className="block truncate">{val ?? "—"}</span>
                        </GrnKv>
                      ))}
                    </GrnKvList>
                  )}

                  <div className="border-t border-grn-line-soft px-4 py-4">
                    <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-grn-ink-soft">
                      Documents
                    </p>
                    <div className="space-y-1.5">
                      {(workspace?.documents ?? []).map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => void openDocument(String(doc.id))}
                          className="flex w-full items-center gap-2 rounded-lg border border-grn-line bg-grn-card p-2 text-left transition-colors hover:border-grn-brand"
                        >
                          <FileText className="h-4 w-4 shrink-0 text-grn-brand" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-semibold text-grn-ink">{doc.original_name}</p>
                            <p className="text-[10.5px] text-grn-ink-soft">
                              {String(doc.extraction_status ?? "pending").replace(/_/g, " ")}
                            </p>
                          </div>
                          <StatusStamp tone={checkTone(String(doc.extraction_status ?? "pending"))}>
                            {Number(doc.is_primary) === 1 ? "Primary" : "Support"}
                          </StatusStamp>
                        </button>
                      ))}
                      {!workspace?.documents?.length && (
                        <GrnButton className="w-full" onClick={() => void openDocument()}>
                          <FileText className="h-3.5 w-3.5" />Open legacy attachment
                        </GrnButton>
                      )}
                    </div>
                  </div>
                </>
              )}
            </TabsContent>

            {/* Allocations tab */}
            <TabsContent value="allocations" className="m-0 flex-1 overflow-y-auto">
              {workspaceQuery.isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-grn-ink-soft" /></div>
              ) : workspace?.allocations?.length ? (
                <GrnTable minWidth={620}>
                  <thead>
                    <tr>
                      <GrnTh sticky={false}>#</GrnTh>
                      <GrnTh sticky={false}>Budget / item</GrnTh>
                      <GrnTh sticky={false}>Cost centre</GrnTh>
                      <GrnTh sticky={false} align="right">Without tax</GrnTh>
                      <GrnTh sticky={false} align="right">With tax</GrnTh>
                      <GrnTh sticky={false} align="right">%</GrnTh>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.allocations.map((alloc, index) => (
                      <tr key={alloc.id} className={GRN_TR}>
                        <GrnTd className="font-grn-mono text-grn-ink-soft">{index + 1}</GrnTd>
                        <GrnTd className="max-w-[160px]">
                          <p className="truncate font-semibold">{alloc.budget_number}</p>
                          <GrnCellSub className="truncate">{alloc.budget_head} / {alloc.budget_sub_head}</GrnCellSub>
                        </GrnTd>
                        <GrnTd>{alloc.cost_centre_name ?? "Branch common"}</GrnTd>
                        <GrnTd align="right">{money(alloc.amount_without_tax)}</GrnTd>
                        <GrnTd align="right" className="font-semibold">{money(alloc.amount_with_tax)}</GrnTd>
                        <GrnTd align="right">{Number(alloc.allocation_percentage).toFixed(2)}%</GrnTd>
                      </tr>
                    ))}
                  </tbody>
                </GrnTable>
              ) : (
                <p className="px-4 py-6 text-[12px] text-grn-ink-soft">
                  Legacy single-attribution GRN — no split allocations.
                </p>
              )}
            </TabsContent>

            {/* Validation tab */}
            <TabsContent value="validation" className="m-0 flex-1 overflow-y-auto">
              {workspaceQuery.isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-grn-ink-soft" /></div>
              ) : (
                <div className="space-y-2.5 p-4">
                  {(workspace?.validations ?? []).map((v) => {
                    const resolved = v.validation_status === "passed" || v.validation_status === "overridden";
                    return (
                      <GrnAlert key={v.id} tone={checkTone(String(v.validation_status))}>
                        <div className="flex items-start gap-2">
                          {resolved
                            ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <StatusStamp tone={checkTone(String(v.validation_status))}>
                              {String(v.validation_code)}
                            </StatusStamp>
                            <p className="mt-1.5 text-[12px] leading-5">{v.message}</p>
                            {v.override_reason && (
                              <p className="mt-1.5 rounded-lg bg-grn-card/70 p-1.5 text-[11px]">
                                Override: {v.override_reason}
                              </p>
                            )}
                            {Number(v.is_blocking) === 1 && v.validation_status === "failed" && capabilities?.canReviewFinanceStage && (
                              <GrnButton
                                size="sm"
                                className="mt-2"
                                onClick={() => { setOverrideCode(String(v.validation_code)); setOverrideReason(""); }}
                              >
                                <BadgeCheck className="h-3 w-3" />Finance override
                              </GrnButton>
                            )}
                          </div>
                        </div>
                        {overrideCode === v.validation_code && (
                          <div className="mt-2.5 space-y-2">
                            <GrnTextarea
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              placeholder="Mandatory detailed exception reason (at least 10 characters)"
                              className="min-h-[60px] bg-grn-card"
                            />
                            <div className="flex gap-2">
                              <GrnButton
                                variant="primary"
                                size="sm"
                                onClick={() => overrideMutation.mutate()}
                                disabled={overrideMutation.isPending}
                              >
                                {overrideMutation.isPending
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <BadgeCheck className="h-3 w-3" />}
                                Approve exception
                              </GrnButton>
                              <GrnButton
                                variant="ghost"
                                size="sm"
                                onClick={() => { setOverrideCode(null); setOverrideReason(""); }}
                              >
                                Cancel
                              </GrnButton>
                            </div>
                          </div>
                        )}
                      </GrnAlert>
                    );
                  })}
                  {!(workspace?.validations ?? []).length && (
                    <p className="text-[12px] text-grn-ink-soft">No validation records found.</p>
                  )}

                  {/* Not in the redesign mock, and not droppable: a duplicate invoice is the one
                      thing a reviewer most needs told before approving a payment. */}
                  <div className="pt-1">
                    <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-grn-ink-soft">
                      Duplicate matches
                    </p>
                    <div className="space-y-1.5">
                      {(workspace?.duplicates ?? []).map((dup) => (
                        <GrnAlert key={dup.id} tone="crit">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold">{labelStatus(String(dup.match_type))}</p>
                            <span className="font-grn-mono text-[11px]">
                              {Number(dup.confidence_score).toFixed(0)}%
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-grn-ink-soft">
                            Matched GRN: {dup.matched_grn_number ?? "Document hash"}
                          </p>
                        </GrnAlert>
                      ))}
                      {!workspace?.duplicates?.length && (
                        <GrnAlert tone="ok">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-grn-ok">Duplicate check — no match found</span>
                            <StatusStamp tone="ok">Clear</StatusStamp>
                          </div>
                        </GrnAlert>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Decision tab */}
            <TabsContent value="decision" className="m-0 flex-1 overflow-y-auto">
              {canReview ? (
                <div className="space-y-3 p-4">
                  {decision === "approved" && blockers.length > 0 && (
                    <GrnAlert tone="warn">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          {blockers.length} unresolved blocking validation(s) — resolve them on the
                          Validation tab, or obtain a Finance override, before this can be approved.
                        </span>
                      </div>
                    </GrnAlert>
                  )}
                  <div>
                    <Label className="text-[11.5px] font-semibold text-grn-ink">
                      Decision <span className="text-grn-crit">*</span>
                    </Label>
                    {/* Mirrors the footer buttons rather than competing with them: clicking
                        Reject or Approve below submits that decision explicitly, whatever this
                        says. It drives the required-note marker and the banner above. */}
                    <GrnSelect
                      className="mt-1 w-full"
                      value={decision}
                      onChange={(e) => setDecision(e.target.value as "approved" | "rejected")}
                    >
                      <option value="approved">Approve GRN</option>
                      <option value="rejected">Reject GRN</option>
                    </GrnSelect>
                  </div>
                  <div>
                    <Label className="text-[11.5px] font-semibold text-grn-ink">
                      Review note{" "}
                      <span className="font-normal text-grn-ink-soft">(required on reject)</span>
                    </Label>
                    <GrnTextarea
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      className="mt-1 min-h-[80px]"
                      placeholder="Why this decision"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-4">
                  <GrnAlert tone="info">Read-only access at the current workflow stage.</GrnAlert>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <SheetFooter className="gap-2 border-t border-grn-line-soft px-[16px] py-[12px] sm:justify-end">
            <GrnButton onClick={() => setTarget(null)}>Close</GrnButton>
            {canReview && (
              <>
                <GrnButton
                  variant="destructive"
                  disabled={reviewMutation.isPending || workspaceQuery.isLoading}
                  onClick={() => submitDecision("rejected")}
                >
                  <XCircle className="h-3.5 w-3.5" />Reject
                </GrnButton>
                <GrnButton
                  variant="ok"
                  disabled={reviewMutation.isPending || workspaceQuery.isLoading || blockers.length > 0}
                  title={blockers.length ? `Blocked by ${blockers.length} unresolved validation(s)` : undefined}
                  onClick={() => submitDecision("approved")}
                >
                  {reviewMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Approve
                </GrnButton>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
