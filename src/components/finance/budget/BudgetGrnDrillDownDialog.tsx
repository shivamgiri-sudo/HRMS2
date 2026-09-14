import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronRight, FileText, Loader2, Paperclip, AlertTriangle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { money, dateLabel, dateTimeLabel, grnDisplayNumber, labelStatus, grnStatusTone, checkTone } from "@/components/finance/grn/grn-format";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";

export type GrnDrillDownContext = {
  costCentreId: string | null;
  costCentreName: string;
  head: string;
  subHead: string | null;
  /** The Reserved / Consumed figures shown on the row that was clicked. Passed through purely so
   *  this dialog can foot its own list back to them — a GRN that lands in neither (see
   *  budgetBucket below) is otherwise indistinguishable from one that does. */
  reserved?: number;
  consumed?: number;
};

type GrnRow = {
  id: string;
  /** NULL until Finance Head approves it — render via grnDisplayNumber(grn). */
  grn_number: string | null;
  invoice_number: string | null;
  vendor_name: string | null;
  bill_date: string | null;
  amount_without_tax: number | null;
  tax_amount: number | null;
  amount_with_tax: number | null;
  /** Net of recoverable GST — what actually hits P&L cost and feeds the Variance tab's Consumed
   *  figure. NULL on rows raised before this column existed. */
  pnl_cost_amount: number | null;
  /** This drill-down's own cost-centre/head/sub-head SHARE of the GRN, when it was split across
   *  more than one — NULL for an unsplit GRN, where the header amount already is the whole spend.
   *  See GET /api/finance/grns's context_alloc join. */
  context_amount_with_tax: number | null;
  context_pnl_cost_amount: number | null;
  /** How this row's share splits across the budget line's two figures. A GRN still at 'submitted'
   *  holds its allocation at lifecycle_status='draft', so it lands in `pending` — real money in
   *  flight that neither the Reserved nor the Consumed column on the clicked row contains. NULL
   *  when this GRN has no allocation rows at all (the older direct-budget-line path, where
   *  finance_budget_line.reserved_amount/consumed_amount is the counter instead). */
  context_reserved_pnl_cost_amount: number | null;
  context_consumed_pnl_cost_amount: number | null;
  context_pending_pnl_cost_amount: number | null;
  status: string;
  description: string | null;
  remarks: string | null;
  rejection_reason: string | null;
  cost_centre_name: string | null;
  process_name: string | null;
  budget_item_name: string | null;
  created_by_name: string | null;
  created_at: string | null;
  branch_head_reviewed_by_name: string | null;
  branch_head_reviewed_at: string | null;
  finance_head_reviewed_by_name: string | null;
  finance_head_reviewed_at: string | null;
  attachment_path: string | null;
  attachment_file_path: string | null;
  attachment_original_name: string | null;
};

/** One row each from GET /api/finance/grns/:id/workspace's documents / allocations / validations
 *  / duplicates arrays — loosely typed to just the fields this dialog actually reads, since the
 *  full shapes belong to grn-smart.service.ts, not this dialog. */
type GrnDocument = {
  id: string;
  original_name: string;
  extraction_status: string | null;
  is_primary: number | boolean;
};
type GrnAllocation = {
  id: string;
  cost_centre_id: string | null;
  budget_head: string | null;
  budget_sub_head: string | null;
  amount_with_tax: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  pnl_cost_amount: number | null;
  lifecycle_status: string | null;
};
type GrnValidation = {
  id: string;
  validation_code: string;
  severity: string | null;
  validation_status: string | null;
  is_blocking: number | boolean;
  message: string | null;
};
type GrnDuplicate = {
  id: string;
  matched_grn_number: string | null;
  match_type: string | null;
  confidence_score: number | null;
  review_status: string | null;
};
type GrnWorkspace = {
  documents: GrnDocument[];
  allocations: GrnAllocation[];
  validations: GrnValidation[];
  duplicates: GrnDuplicate[];
};

function hasAttachment(grn: GrnRow) {
  return Boolean(grn.attachment_path || grn.attachment_file_path || grn.attachment_original_name);
}

/** grn_cost_allocation.lifecycle_status ("reserved" | "consumed" | "released") is not a
 *  pass/warn/fail check outcome, so checkTone() (built for validation/extraction results) is the
 *  wrong fit — this is its own small vocabulary instead. */
function lifecycleTone(status: string): "ok" | "warn" | "neutral" {
  if (status === "consumed") return "ok";
  if (status === "reserved") return "warn";
  return "neutral";
}

/**
 * Which of the clicked budget row's two figures this GRN actually lands in.
 *
 * The list itself is matched on the GRN's header cost centre/head/sub-head, so it deliberately
 * shows GRNs at every approval stage. The budget row's numbers are not: Reserved counts
 * grn_cost_allocation rows at lifecycle_status='reserved' (Branch Head approved) and Consumed
 * counts 'consumed' (Finance Head approved). A GRN still at 'submitted' holds its allocation at
 * 'draft' and lands in NEITHER — which is why a ₹235 Reserved / ₹0 Consumed line can list three
 * GRNs totalling ₹757 and still be arithmetically right. Saying so per row is the whole point of
 * this classification; without it the dialog looks like it contradicts the row that opened it.
 *
 * Allocation lifecycle wins when the GRN has allocation rows, because that is exactly what
 * budget-cost-centre-utilization.service.ts sums. When it has none, that service falls back to
 * finance_budget_line.reserved_amount/consumed_amount — no per-GRN column exposes that, so the
 * GRN's own approval stage is the honest stand-in.
 */
type BudgetBucket = "consumed" | "reserved" | "pending" | "none";

const BUDGET_BUCKET_LABEL: Record<BudgetBucket, string> = {
  consumed: "In Consumed",
  reserved: "In Reserved",
  pending: "Not counted yet",
  none: "Not counted",
};

const BUDGET_BUCKET_CLASS: Record<BudgetBucket, string> = {
  consumed: "text-emerald-700",
  reserved: "text-amber-700",
  pending: "text-blue-700",
  none: "text-slate-400",
};

/** Terminal stages whose allocations were released/reversed — they will never reach either figure. */
const NON_COUNTING_STATUSES = new Set(["rejected", "cancelled", "consumption_reversed"]);

function budgetBucket(grn: GrnRow): BudgetBucket {
  const consumed = Number(grn.context_consumed_pnl_cost_amount ?? 0);
  const reserved = Number(grn.context_reserved_pnl_cost_amount ?? 0);
  const pending = Number(grn.context_pending_pnl_cost_amount ?? 0);
  if (consumed > 0) return "consumed";
  if (reserved > 0) return "reserved";
  if (pending > 0) return "pending";
  if (NON_COUNTING_STATUSES.has(grn.status)) return "none";
  // No allocation rows for this context at all — read the header's approval stage instead.
  if (grn.status === "submitted" || grn.status === "draft") return "pending";
  if (grn.status === "branch_head_approved") return "reserved";
  return "consumed";
}

/** The share of this GRN that sits in its bucket — the allocation split when there is one, else
 *  the GRN's own P&L cost (net of recoverable GST, matching what the budget row counts). */
function budgetBucketAmount(grn: GrnRow, bucket: BudgetBucket): number {
  const perBucket =
    bucket === "consumed"
      ? grn.context_consumed_pnl_cost_amount
      : bucket === "reserved"
        ? grn.context_reserved_pnl_cost_amount
        : bucket === "pending"
          ? grn.context_pending_pnl_cost_amount
          : null;
  if (perBucket != null && Number(perBucket) > 0) return Number(perBucket);
  if (bucket === "none") return 0;
  return Number(grn.context_pnl_cost_amount ?? grn.pnl_cost_amount ?? grn.amount_with_tax ?? 0);
}

/**
 * Read-only GRN list for one (branch, period, cost centre, head, sub-head) combination — the
 * drill-down target from the Variance tab (click a head/sub-head row, pick a cost centre) and
 * the Cost Centre tab (click a head/sub-head row directly, cost centre already known).
 *
 * Deliberately a small local table rather than reusing GrnSearchWorkspace.tsx, which is a whole
 * page component with its own filter/pagination state — the wrong footprint for a modal that
 * exists only to answer "which GRNs make up this number." Clicking a row expands it in place to
 * show document(s), this budget line's exact allocation split, and the approval chain — fetched
 * lazily via GET /api/finance/grns/:id/workspace, the same endpoint SmartGrnApprovalQueue.tsx
 * uses for its own review sheet, so nothing here duplicates that page's data model.
 */
export function BudgetGrnDrillDownDialog({
  context,
  onOpenChange,
  branchId,
  period,
}: {
  context: GrnDrillDownContext | null;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  period: string;
}) {
  const [expandedGrnId, setExpandedGrnId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["budget-grn-drilldown", branchId, period, context],
    queryFn: async () => {
      if (!context) return { data: [], total: 0 };
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (period) params.set("accountingPeriod", period);
      if (context.costCentreId) params.set("costCentreId", context.costCentreId);
      if (context.head) params.set("head", context.head);
      if (context.subHead) params.set("subHead", context.subHead);
      params.set("excludeDraft", "true");
      params.set("limit", "100");
      const response = await hrmsApi.get<{ data: GrnRow[]; total: number }>(
        `/api/finance/grns?${params.toString()}`
      );
      return { data: response.data ?? [], total: response.total ?? 0 };
    },
    enabled: Boolean(context),
  });

  const workspaceQuery = useQuery({
    queryKey: ["budget-grn-drilldown-workspace", expandedGrnId],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: GrnWorkspace }>(
        `/api/finance/grns/${expandedGrnId}/workspace`
      );
      return response.data;
    },
    enabled: Boolean(expandedGrnId),
    staleTime: 60_000,
  });

  /** Same blob-fetch-and-open pattern as SmartGrnApprovalQueue.tsx's openDocument() — these
   *  routes are auth-gated, so a plain <a href> won't carry the JWT. */
  async function openGrnDocument(grnId: string, documentId?: string) {
    try {
      const endpoint = documentId
        ? `/api/finance/grns/${grnId}/documents/${documentId}/file`
        : `/api/finance/grns/${grnId}/attachment`;
      const blob = await hrmsApi.getBlob(endpoint);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Document could not be opened");
    }
  }

  const rows = query.data?.data ?? [];

  /** Foots the list back to the budget row that opened it: every GRN listed belongs to exactly one
   *  bucket, and reserved/consumed here must equal the two figures on that row. `pending` is the
   *  money in flight that the row shows nowhere — the reason this list can total more than it. */
  const totals = rows.reduce(
    (accumulator, grn) => {
      const bucket = budgetBucket(grn);
      accumulator[bucket] += budgetBucketAmount(grn, bucket);
      return accumulator;
    },
    { consumed: 0, reserved: 0, pending: 0, none: 0 } as Record<BudgetBucket, number>
  );

  return (
    <Dialog open={Boolean(context)} onOpenChange={(open) => { onOpenChange(open); if (!open) setExpandedGrnId(null); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            GRNs — {context?.head}
            {context?.subHead ? ` / ${context.subHead}` : ""}
            {context?.costCentreName ? ` · ${context.costCentreName}` : ""}
          </DialogTitle>
        </DialogHeader>
        {query.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : query.isError ? (
          <p className="py-6 text-center text-sm text-rose-600">
            {(query.error as Error)?.message || "Could not load GRNs for this selection."}
          </p>
        ) : !rows.length ? (
          <p className="py-6 text-center text-sm text-slate-500">No GRNs raised against this head/sub-head yet.</p>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b text-left text-slate-500">
                  <th className="h-8 px-3 font-medium">GRN Number</th>
                  <th className="h-8 px-3 font-medium">Invoice No.</th>
                  <th className="h-8 px-3 font-medium">Vendor</th>
                  <th className="h-8 px-3 font-medium">Bill Date</th>
                  <th className="h-8 px-3 text-right font-medium">Amount</th>
                  <th className="h-8 px-3 font-medium">Status</th>
                  <th className="h-8 px-3 text-right font-medium">Counts as</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((grn) => {
                  const isOpen = expandedGrnId === grn.id;
                  const bucket = budgetBucket(grn);
                  return (
                    <Fragment key={grn.id}>
                      <tr
                        className="cursor-pointer hover:bg-slate-50/70"
                        onClick={() => setExpandedGrnId(isOpen ? null : grn.id)}
                        tabIndex={0}
                        role="button"
                        aria-expanded={isOpen}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setExpandedGrnId(isOpen ? null : grn.id);
                          }
                        }}
                      >
                        <td className="px-3 py-2 font-medium text-slate-800">
                          <span className="inline-flex items-center gap-1.5">
                            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                            {grnDisplayNumber(grn)}
                            {hasAttachment(grn) && <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{grn.invoice_number ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{grn.vendor_name ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{dateLabel(grn.bill_date)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {/* This drill-down's own share when the GRN was split across cost
                              centres/heads — the header's amount_with_tax is the WHOLE bill and
                              overstates every split it appears under otherwise. */}
                          {money(grn.context_amount_with_tax ?? grn.amount_with_tax)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusStamp tone={grnStatusTone(grn.status)}>{labelStatus(grn.status)}</StatusStamp>
                        </td>
                        <td className={`px-3 py-2 text-right font-medium ${BUDGET_BUCKET_CLASS[bucket]}`}>
                          {BUDGET_BUCKET_LABEL[bucket]}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={7} className="p-0">
                            <GrnDetailPanel
                              grn={grn}
                              context={context}
                              workspace={workspaceQuery.data}
                              isLoading={workspaceQuery.isLoading}
                              isError={workspaceQuery.isError}
                              onOpenDocument={(documentId) => void openGrnDocument(grn.id, documentId)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && <ReconciliationFooter totals={totals} context={context} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ties the list above back to the row that opened it. Reserved and Consumed here are the same two
 * numbers as on that row; "Not counted yet" is spend already raised against this head at this cost
 * centre that has not passed Branch Head, so no figure on the budget row contains it. Showing it
 * separately is the difference between "these numbers are wrong" and "this money is not committed
 * yet" — the two look identical without it.
 */
function ReconciliationFooter({
  totals,
  context,
}: {
  totals: Record<BudgetBucket, number>;
  context: GrnDrillDownContext | null;
}) {
  const rowReserved = context?.reserved;
  const rowConsumed = context?.consumed;
  // A paise-level gap is rounding across allocation splits, not a real disagreement.
  const drifts =
    (rowReserved != null && Math.abs(rowReserved - totals.reserved) > 1) ||
    (rowConsumed != null && Math.abs(rowConsumed - totals.consumed) > 1);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
        <span className="font-semibold text-slate-700">This list adds up to</span>
        <span className="text-emerald-700">
          Consumed <span className="tabular-nums font-semibold">{money(totals.consumed)}</span>
        </span>
        <span className="text-amber-700">
          Reserved <span className="tabular-nums font-semibold">{money(totals.reserved)}</span>
        </span>
        <span className="text-blue-700">
          Not counted yet <span className="tabular-nums font-semibold">{money(totals.pending)}</span>
        </span>
        {totals.none > 0 && (
          <span className="text-slate-400">
            Rejected / reversed <span className="tabular-nums font-semibold">{money(totals.none)}</span>
          </span>
        )}
      </div>
      <p className="mt-2 leading-relaxed text-slate-500">
        A GRN only reaches <span className="font-medium text-amber-700">Reserved</span> once Branch
        Head approves it, and <span className="font-medium text-emerald-700">Consumed</span> once
        Finance Head does. Anything still awaiting Branch Head is listed here but is in neither
        figure on the budget row, so this list can total more than the row shows.
      </p>
      {(rowReserved != null || rowConsumed != null) && (
        <p className={`mt-1.5 ${drifts ? "font-medium text-rose-600" : "text-slate-500"}`}>
          {drifts
            ? `Does not match the budget row (Reserved ${money(rowReserved ?? 0)}, Consumed ${money(rowConsumed ?? 0)}) — report this.`
            : `Matches the budget row: Reserved ${money(rowReserved ?? 0)}, Consumed ${money(rowConsumed ?? 0)}.`}
        </p>
      )}
    </div>
  );
}

function GrnDetailPanel({
  grn,
  context,
  workspace,
  isLoading,
  isError,
  onOpenDocument,
}: {
  grn: GrnRow;
  context: GrnDrillDownContext | null;
  workspace: GrnWorkspace | undefined;
  isLoading: boolean;
  isError: boolean;
  onOpenDocument: (documentId?: string) => void;
}) {
  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  }
  if (isError || !workspace) {
    return <p className="py-6 text-center text-xs text-rose-600">Could not load this GRN's detail.</p>;
  }

  // The GRN's own header total is not always what landed on THIS budget line — a GRN can be
  // split across multiple cost centres/heads. Show the allocation row(s) matching the dialog's
  // own context, not the header amount, whenever the GRN actually has splits recorded.
  const matchingAllocations = workspace.allocations.filter((alloc) =>
    (context?.costCentreId ?? null) === (alloc.cost_centre_id ?? null)
    && context?.head === alloc.budget_head
    && (context?.subHead ?? null) === (alloc.budget_sub_head ?? null)
  );

  const blockingValidations = workspace.validations.filter((v) => Number(v.is_blocking) === 1 && v.validation_status !== "overridden");
  const hasDuplicates = workspace.duplicates.length > 0;

  return (
    <div className="grid gap-4 border-t border-slate-200 p-4 md:grid-cols-2">
      {(blockingValidations.length > 0 || hasDuplicates) && (
        <div className="md:col-span-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-0.5">
            {blockingValidations.map((v) => <p key={v.id}>{v.message ?? v.validation_code}</p>)}
            {hasDuplicates && <p>Possible duplicate of {workspace.duplicates.map((d) => d.matched_grn_number ?? "another GRN").join(", ")}.</p>}
          </div>
        </div>
      )}

      {/* Documents */}
      <div>
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Documents</p>
        <div className="space-y-1.5">
          {workspace.documents.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onOpenDocument(doc.id)}
              className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-left transition-colors hover:border-blue-300"
            >
              <FileText className="h-4 w-4 shrink-0 text-blue-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-slate-800">{doc.original_name}</p>
                <p className="text-[10.5px] text-slate-500">{(doc.extraction_status ?? "pending").replace(/_/g, " ")}</p>
              </div>
              <StatusStamp tone={checkTone(doc.extraction_status ?? "pending")}>
                {Number(doc.is_primary) === 1 ? "Primary" : "Support"}
              </StatusStamp>
            </button>
          ))}
          {!workspace.documents.length && (
            (grn.attachment_path || grn.attachment_file_path) ? (
              <button
                type="button"
                onClick={() => onOpenDocument()}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-left text-[12px] font-semibold text-slate-800 transition-colors hover:border-blue-300"
              >
                <FileText className="h-3.5 w-3.5 text-blue-600" />Open legacy attachment
              </button>
            ) : grn.attachment_original_name ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white p-2">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-slate-700">{grn.attachment_original_name}</p>
                  <p className="text-[10.5px] text-slate-500">On file in the legacy system — not migrated to HRMS storage</p>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">No document uploaded against this GRN.</p>
            )
          )}
        </div>
      </div>

      {/* This budget line's exact split */}
      <div>
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">
          {matchingAllocations.length ? "This head/sub-head's allocation" : "Amount & tax"}
        </p>
        {matchingAllocations.length ? (
          <div className="space-y-1.5">
            {matchingAllocations.map((alloc) => (
              <div key={alloc.id} className="rounded-lg border border-slate-200 bg-white p-2 text-[11px]">
                {/* P&L cost leads — it is what actually feeds the Variance tab's Consumed figure
                    (GST recovered as ITC is never a real cost). Leading with the tax-inclusive
                    amount here made this number look bigger than the Consumed it explains. */}
                <div className="flex justify-between"><span className="text-slate-500">P&amp;L cost (Consumed basis)</span><span className="font-medium tabular-nums">{money(alloc.pnl_cost_amount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Amount (with tax)</span><span className="font-medium tabular-nums">{money(alloc.amount_with_tax)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">CGST / SGST / IGST</span><span className="font-medium tabular-nums">{money(alloc.cgst_amount)} / {money(alloc.sgst_amount)} / {money(alloc.igst_amount)}</span></div>
                <div className="mt-1"><StatusStamp tone={lifecycleTone(alloc.lifecycle_status ?? "")}>{labelStatus(alloc.lifecycle_status ?? "unknown")}</StatusStamp></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-2 text-[11px] space-y-1">
            <div className="flex justify-between"><span className="text-slate-500">Without tax</span><span className="font-medium tabular-nums">{money(grn.amount_without_tax)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Tax</span><span className="font-medium tabular-nums">{money(grn.tax_amount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">With tax</span><span className="font-medium tabular-nums">{money(grn.amount_with_tax)}</span></div>
          </div>
        )}
      </div>

      {/* More header detail */}
      <div>
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Detail</p>
        <div className="space-y-1 text-[11px] text-slate-600">
          {grn.process_name && <p><span className="text-slate-400">Process:</span> {grn.process_name}</p>}
          {grn.cost_centre_name && <p><span className="text-slate-400">Cost centre:</span> {grn.cost_centre_name}</p>}
          {grn.budget_item_name && <p><span className="text-slate-400">Budget item:</span> {grn.budget_item_name}</p>}
          {(grn.description || grn.remarks) && <p><span className="text-slate-400">Notes:</span> {grn.description || grn.remarks}</p>}
          {grn.status === "rejected" && grn.rejection_reason && (
            <p className="text-rose-600"><span className="text-slate-400">Rejected:</span> {grn.rejection_reason}</p>
          )}
        </div>
      </div>

      {/* Approval chain */}
      <div>
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Approval chain</p>
        <div className="space-y-1 text-[11px] text-slate-600">
          <p><span className="text-slate-400">Raised by:</span> {grn.created_by_name ?? "—"}{grn.created_at ? ` · ${dateTimeLabel(grn.created_at) ?? dateLabel(grn.created_at)}` : ""}</p>
          <p><span className="text-slate-400">Branch Head:</span> {grn.branch_head_reviewed_by_name ? `${grn.branch_head_reviewed_by_name} · ${dateTimeLabel(grn.branch_head_reviewed_at) ?? "—"}` : "Pending"}</p>
          <p><span className="text-slate-400">Finance Head:</span> {grn.finance_head_reviewed_by_name ? `${grn.finance_head_reviewed_by_name} · ${dateTimeLabel(grn.finance_head_reviewed_at) ?? "—"}` : "Pending"}</p>
        </div>
      </div>
    </div>
  );
}
