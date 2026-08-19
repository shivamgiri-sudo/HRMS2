import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  FileMinus2,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
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
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
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
  created_at?: string | null;
};

const PAGE_SIZE = 50;

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

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
  canReviewAccountsStage: boolean;
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

export function SmartGrnApprovalQueue({ onReopenForEdit }: { onReopenForEdit?: (grnId: string) => void } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("submitted");
  const [grnType, setGrnType] = useState("_all");
  const [search, setSearch] = useState("");
  const [backDated, setBackDated] = useState(false);
  const [myGrnsOnly, setMyGrnsOnly] = useState(false);
  const [filterBranch, setFilterBranch] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("");
  const [page, setPage] = useState(1);
  const didSetInitialTab = useRef(false);
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

  useEffect(() => {
    if (!capabilities || didSetInitialTab.current) return;
    didSetInitialTab.current = true;
    if (capabilities.canReviewAccountsStage && !capabilities.canReviewBranchStage && !capabilities.canReviewFinanceStage) {
      setStatus("finance_head_approved");
    } else if (capabilities.canReviewFinanceStage && !capabilities.canReviewBranchStage) {
      setStatus("branch_head_approved");
    } else if (capabilities.canCreate && !capabilities.canReviewBranchStage && !capabilities.canReviewFinanceStage) {
      // Pure raiser (branch_admin who cannot review) — show all their own GRNs by default
      setStatus("_all");
      setMyGrnsOnly(true);
    }
    // branch stage reviewers stay on "submitted" — the default is already correct
  }, [capabilities]);

  const branchesQuery = useQuery({
    queryKey: ["grn-branches-list"],
    queryFn: async () => {
      const res = await hrmsApi.get<any>("/api/org/branches?limit=200");
      return (res?.data ?? res?.rows ?? []) as Array<{ id: string; branch_name?: string; name?: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });
  const branchOptions = branchesQuery.data ?? [];

  // Per-status counts for the filter chips. Aggregated server-side, so a chip's number is the
  // true total rather than however many of that status happened to fit in the 100-row list.
  const summary = useGrnSummary().data;

  const listQuery = useQuery({
    queryKey: ["grn-list", status, grnType, search, filterBranch, filterPeriod, page, myGrnsOnly],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
      if (status !== "_all") params.set("status", status);
      if (grnType !== "_all") params.set("grnType", grnType);
      if (search.trim()) params.set("search", search.trim());
      if (filterBranch) params.set("branchId", filterBranch);
      if (filterPeriod) params.set("accountingPeriod", filterPeriod);
      if (myGrnsOnly) params.set("createdBy", "me");
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

  // Debit Notes — state and queries
  const DN_ELIGIBLE_STATUSES = new Set([
    "pending_accounts_payment", "payment_scheduled", "partially_paid", "paid", "approved",
  ]);
  const canRaiseDn = Boolean(
    target?.grn_type === "vendor"
    && target?.status
    && DN_ELIGIBLE_STATUSES.has(target.status)
    && capabilities?.canReviewFinanceStage
  );

  const [dnForm, setDnForm] = useState({ date: "", reason: "other", amount: "", gstAmount: "", remarks: "" });
  const [showDnCreate, setShowDnCreate] = useState(false);
  const DN_REASONS = [
    { value: "quality_deficiency", label: "Quality deficiency" },
    { value: "short_supply",       label: "Short supply" },
    { value: "price_difference",   label: "Price difference" },
    { value: "returns",            label: "Returns" },
    { value: "other",              label: "Other" },
  ];

  const debitNotesQuery = useQuery({
    queryKey: ["grn-debit-notes", target?.id],
    queryFn: () => hrmsApi.get<any>(`/api/finance/grns/${target!.id}/debit-notes`),
    enabled: Boolean(target?.id) && canRaiseDn,
    staleTime: 30_000,
  });
  const debitNotes: any[] = (debitNotesQuery.data as any)?.data ?? [];

  const createDnMutation = useMutation({
    mutationFn: () => hrmsApi.post(`/api/finance/grns/${target!.id}/debit-note`, {
      dnDate: dnForm.date,
      reason: dnForm.reason,
      amount: Number(dnForm.amount),
      gstAmount: Number(dnForm.gstAmount || 0),
      remarks: dnForm.remarks.trim() || undefined,
    }),
    onSuccess: () => {
      toast({ title: "Debit note raised" });
      setShowDnCreate(false);
      setDnForm({ date: "", reason: "other", amount: "", gstAmount: "", remarks: "" });
      void debitNotesQuery.refetch();
    },
    onError: (e: Error) => toast({ title: "Failed to raise debit note", description: e.message, variant: "destructive" }),
  });

  const approveDnMutation = useMutation({
    mutationFn: (dnId: string) => hrmsApi.post(`/api/finance/debit-notes/${dnId}/approve`, {}),
    onSuccess: () => { toast({ title: "Debit note approved" }); void debitNotesQuery.refetch(); },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const [cancelDnId, setCancelDnId] = useState<string | null>(null);
  const [cancelDnReason, setCancelDnReason] = useState("");
  const cancelDnMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      hrmsApi.post(`/api/finance/debit-notes/${id}/cancel`, { reason }),
    onSuccess: () => {
      toast({ title: "Debit note cancelled" });
      setCancelDnId(null);
      setCancelDnReason("");
      void debitNotesQuery.refetch();
    },
    onError: (e: Error) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/finance/grns/${id}/reopen`, {}),
    onSuccess: (_, id) => {
      toast({ title: "GRN reopened — redirecting to edit form" });
      setTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
      void queryClient.invalidateQueries({ queryKey: ["grn-summary"] });
      onReopenForEdit?.(id);
    },
    onError: (error: Error) =>
      toast({ title: "Reopen failed", description: error.message, variant: "destructive" }),
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
          <GrnSelect small value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} aria-label="Filter by branch">
            <option value="">All branches</option>
            {branchOptions.map((b) => (
              <option key={b.id} value={b.id}>{b.branch_name ?? b.name ?? b.id}</option>
            ))}
          </GrnSelect>
          {/* Safari never implemented input[type=month] — it degrades to a bare text box with no
              picker, so this filter was unusable there. Same swap GrnSearchWorkspace already made,
              styled to this queue's own tokens. emptyLabel keeps "" reachable: the filter is off by
              default and must be clearable back to all periods. */}
          <MonthYearPicker
            value={filterPeriod}
            onChange={setFilterPeriod}
            emptyLabel="All periods"
            selectClassName="h-7 rounded border border-grn-line-soft bg-white px-2 text-xs text-grn-ink focus:outline-none focus:ring-1 focus:ring-grn-brand"
          />
          <GrnChip active={backDated} onClick={() => setBackDated((v) => !v)}>
            Back-dated
          </GrnChip>
          {capabilities?.canCreate && (
            <GrnChip active={myGrnsOnly} onClick={() => setMyGrnsOnly((v) => !v)}>
              My GRNs
            </GrnChip>
          )}
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
                {/* When the GRN was actually raised. Only Due and Bill dates were shown, and
                    neither answers "when did this arrive for approval" — a GRN raised today can
                    carry a bill date weeks old, so the two are routinely far apart. */}
                <GrnTh sticky={false}>Raised</GrnTh>
                <GrnTh sticky={false}>Due</GrnTh>
                {backDated && <GrnTh sticky={false}>Acctg Period</GrnTh>}
                <GrnTh sticky={false} align="right">Waiting</GrnTh>
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
                  <GrnTd className="font-grn-mono font-bold text-grn-brand">
                    <span className="block">{row.grn_number}</span>
                    {row.accounting_period && row.bill_date &&
                      row.accounting_period.slice(0, 7) !== row.bill_date.slice(0, 7) && (
                        <span className="mt-0.5 block font-grn-mono text-[10px] font-normal text-amber-600">
                          ≠ {row.accounting_period.slice(0, 7)}
                        </span>
                      )}
                  </GrnTd>
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
                  <GrnTd>
                    {row.created_at ? dateLabel(row.created_at) : "—"}
                    {row.bill_date && <GrnCellSub>bill {dateLabel(row.bill_date)}</GrnCellSub>}
                  </GrnTd>
                  <GrnTd>{row.due_date ? dateLabel(row.due_date) : "—"}</GrnTd>
                  {backDated && (
                    <GrnTd>
                      <span className="font-grn-mono text-amber-700">{row.accounting_period ?? "—"}</span>
                    </GrnTd>
                  )}
                  <GrnTd align="right">
                    {row.created_at ? (() => {
                      const d = daysSince(row.created_at);
                      return (
                        <span className={`font-grn-mono text-[11px] font-semibold ${d > 3 ? "text-rose-600" : d > 1 ? "text-amber-600" : "text-grn-ink-soft"}`}>
                          {d}d
                        </span>
                      );
                    })() : <span className="text-grn-ink-soft">—</span>}
                  </GrnTd>
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
                      {/* Inline quick-approve / quick-reject — mirrors the imprest queue pattern */}
                      {((row.status === "submitted" && capabilities?.canReviewBranchStage) ||
                        (row.status === "branch_head_approved" && capabilities?.canReviewFinanceStage)) && (
                        <>
                          <GrnIconButton
                            title="Approve"
                            aria-label={`Approve ${row.grn_number}`}
                            disabled={reviewMutation.isPending}
                            onClick={(e) => { e.stopPropagation(); reviewMutation.mutate({ id: row.id, decision: "approved", note: "" }); }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </GrnIconButton>
                          <GrnIconButton
                            title="Reject (opens review)"
                            aria-label={`Reject ${row.grn_number}`}
                            className="hover:border-grn-crit hover:text-grn-crit"
                            onClick={(e) => { e.stopPropagation(); setTarget(row); setDecision("rejected"); setReviewNote(""); setOverrideCode(null); setOverrideReason(""); }}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </GrnIconButton>
                        </>
                      )}
                      {/* Not in the redesign mock, but a real capability: a draft only leaves the
                          branch when someone submits it. */}
                      {row.status === "draft" && capabilities?.canCreate && (
                        <>
                          <GrnIconButton
                            title="Edit this GRN"
                            aria-label="Edit this GRN"
                            onClick={(e) => { e.stopPropagation(); onReopenForEdit?.(row.id); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </GrnIconButton>
                          <GrnIconButton
                            title="Submit to Branch Head"
                            aria-label="Submit to Branch Head"
                            onClick={(e) => { e.stopPropagation(); submitMutation.mutate(row.id); }}
                          >
                            <Send className="h-3.5 w-3.5" />
                          </GrnIconButton>
                        </>
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
        {displayRows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 text-xs text-grn-ink-soft">
            <span>Showing {displayRows.length} result{displayRows.length !== 1 ? "s" : ""}</span>
            {rows.length === PAGE_SIZE && (
              <GrnButton variant="default" size="sm" onClick={() => setPage((p) => p + 1)}>
                Load more
              </GrnButton>
            )}
          </div>
        )}
      </GrnCard>

      {/* Tabbed Sheet — replaces the 1180px Dialog */}
      <Sheet open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        {/* Full width below 560px — a fixed 560 overflowed the viewport on a phone. */}
        <SheetContent side="right" className="grn-scope flex w-full flex-col gap-0 p-0 sm:w-[560px] sm:max-w-[560px]">
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
              {canRaiseDn && (
                <TabsTrigger value="debit-notes" className={GRN_SHEET_TAB_TRIGGER}>
                  <FileMinus2 className="mr-1 h-3 w-3" />
                  Debit Notes
                  {debitNotes.filter((d) => String(d.status) === "draft").length > 0 && (
                    <span className="ml-1 rounded-full bg-amber-100 px-1.5 font-grn-mono text-[9.5px] font-bold text-amber-700">
                      {debitNotes.filter((d) => String(d.status) === "draft").length}
                    </span>
                  )}
                </TabsTrigger>
              )}
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
                        ["Acctg period", parent?.accounting_period ?? "—"],
                        ["Rejection reason", parent?.rejection_reason ?? null],
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
                <div className="space-y-3 p-4">
                  <GrnAlert tone="info">
                    {target?.status === "rejected"
                      ? "This GRN was rejected. Reopen it to correct and resubmit."
                      : "Read-only access at the current workflow stage."}
                  </GrnAlert>
                  {target?.status === "rejected" && capabilities?.canCreate && (
                    <GrnButton
                      variant="primary"
                      disabled={reopenMutation.isPending}
                      onClick={() => target && reopenMutation.mutate(target.id)}
                    >
                      {reopenMutation.isPending
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RotateCcw className="h-3.5 w-3.5" />}
                      Reopen for Correction
                    </GrnButton>
                  )}
                </div>
              )}
            </TabsContent>
            {/* Debit Notes tab */}
            {canRaiseDn && (
              <TabsContent value="debit-notes" className="m-0 flex-1 overflow-y-auto">
                <div className="space-y-3 p-4">
                  {debitNotesQuery.isLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-grn-ink-soft" /></div>
                  ) : debitNotes.length === 0 && !showDnCreate ? (
                    <GrnAlert tone="info">No debit notes raised against this GRN yet.</GrnAlert>
                  ) : (
                    <div className="space-y-2">
                      {debitNotes.map((dn: any) => (
                        <div key={dn.id} className="rounded-xl border bg-white p-3 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-grn-ink">{dn.dn_number}</p>
                              <p className="text-[11px] text-grn-ink-soft mt-0.5">
                                {dn.reason?.replace(/_/g, " ")} · ₹{Number(dn.amount).toLocaleString("en-IN")}
                                {Number(dn.gst_amount ?? 0) > 0 && ` + ₹${Number(dn.gst_amount).toLocaleString("en-IN")} GST`}
                                {" · "}{String(dn.dn_date).slice(0, 10)}
                              </p>
                              {dn.remarks && <p className="text-[11px] text-grn-ink-soft mt-0.5 italic">{dn.remarks}</p>}
                            </div>
                            <div className="shrink-0 flex items-center gap-1.5">
                              {String(dn.status) === "draft" && (
                                <>
                                  <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">Draft</span>
                                  <GrnButton variant="primary" className="h-6 px-2 text-[10px]"
                                    disabled={approveDnMutation.isPending}
                                    onClick={() => approveDnMutation.mutate(dn.id)}>
                                    Approve
                                  </GrnButton>
                                  <GrnButton variant="destructive" className="h-6 px-2 text-[10px]"
                                    disabled={cancelDnMutation.isPending}
                                    onClick={() => { setCancelDnId(dn.id); setCancelDnReason(""); }}>
                                    Cancel
                                  </GrnButton>
                                </>
                              )}
                              {String(dn.status) === "approved" && (
                                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Approved</span>
                              )}
                              {String(dn.status) === "cancelled" && (
                                <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500">Cancelled</span>
                              )}
                              {String(dn.status) === "settled" && (
                                <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700">Settled</span>
                              )}
                            </div>
                          </div>
                          {cancelDnId === dn.id && (
                            <div className="mt-2 space-y-1.5">
                              <input
                                className="h-8 w-full rounded-md border border-grn-line-soft bg-white px-2.5 text-xs"
                                placeholder="Cancellation reason (required)"
                                autoFocus
                                value={cancelDnReason}
                                onChange={(e) => setCancelDnReason(e.target.value)}
                              />
                              <div className="flex gap-1.5">
                                <GrnButton variant="destructive" className="h-6 px-2 text-[10px]"
                                  disabled={!cancelDnReason.trim() || cancelDnMutation.isPending}
                                  onClick={() => cancelDnMutation.mutate({ id: dn.id, reason: cancelDnReason.trim() })}>
                                  {cancelDnMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                                </GrnButton>
                                <GrnButton className="h-6 px-2 text-[10px]" onClick={() => setCancelDnId(null)}>Back</GrnButton>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Create new debit note form */}
                  {!showDnCreate ? (
                    <GrnButton variant="primary" onClick={() => setShowDnCreate(true)}>
                      <Plus className="h-3.5 w-3.5" /> Raise Debit Note
                    </GrnButton>
                  ) : (
                    <div className="rounded-xl border bg-slate-50 p-3 space-y-2 text-sm">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-grn-ink-soft">New Debit Note</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] font-semibold text-grn-ink mb-1 block">Date *</label>
                          <input type="date" className="h-8 w-full rounded-md border border-grn-line-soft bg-white px-2.5 text-xs"
                            value={dnForm.date} onChange={(e) => setDnForm((f) => ({ ...f, date: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-grn-ink mb-1 block">Reason *</label>
                          <select className="h-8 w-full rounded-md border border-grn-line-soft bg-white px-2.5 text-xs"
                            value={dnForm.reason} onChange={(e) => setDnForm((f) => ({ ...f, reason: e.target.value }))}>
                            {DN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-grn-ink mb-1 block">Amount (₹) *</label>
                          <input type="number" min="0.01" className="h-8 w-full rounded-md border border-grn-line-soft bg-white px-2.5 text-xs"
                            placeholder="0.00" value={dnForm.amount}
                            onChange={(e) => setDnForm((f) => ({ ...f, amount: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-grn-ink mb-1 block">GST (₹)</label>
                          <input type="number" min="0" className="h-8 w-full rounded-md border border-grn-line-soft bg-white px-2.5 text-xs"
                            placeholder="0.00" value={dnForm.gstAmount}
                            onChange={(e) => setDnForm((f) => ({ ...f, gstAmount: e.target.value }))} />
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-grn-ink mb-1 block">Remarks</label>
                        <input className="h-8 w-full rounded-md border border-grn-line-soft bg-white px-2.5 text-xs"
                          placeholder="Optional details" value={dnForm.remarks}
                          onChange={(e) => setDnForm((f) => ({ ...f, remarks: e.target.value }))} />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <GrnButton variant="primary"
                          disabled={!dnForm.date || !dnForm.amount || Number(dnForm.amount) <= 0 || createDnMutation.isPending}
                          onClick={() => {
                            const grnTotal = Number(target?.amount_with_tax ?? target?.amount ?? 0);
                            const dnAmount = Number(dnForm.amount);
                            if (grnTotal > 0 && dnAmount > grnTotal) {
                              toast({ title: `Debit note (${money(dnAmount)}) exceeds GRN total (${money(grnTotal)})`, variant: "destructive" });
                              return;
                            }
                            createDnMutation.mutate();
                          }}>
                          {createDnMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                          Raise Note
                        </GrnButton>
                        <GrnButton onClick={() => setShowDnCreate(false)}>Cancel</GrnButton>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>

          <SheetFooter className="flex-wrap gap-2 border-t border-grn-line-soft px-[16px] py-[12px] sm:flex-nowrap sm:justify-end">
            <GrnButton onClick={() => setTarget(null)}>Close</GrnButton>
            {canReview && (
              <div className="flex shrink-0 gap-2">
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
              </div>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
