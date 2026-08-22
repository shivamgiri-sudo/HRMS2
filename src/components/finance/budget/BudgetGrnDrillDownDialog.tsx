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
import { money, dateLabel, dateTimeLabel, labelStatus, grnStatusTone, checkTone } from "@/components/finance/grn/grn-format";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";

export type GrnDrillDownContext = {
  costCentreId: string | null;
  costCentreName: string;
  head: string;
  subHead: string | null;
};

type GrnRow = {
  id: string;
  grn_number: string;
  invoice_number: string | null;
  vendor_name: string | null;
  bill_date: string | null;
  amount_without_tax: number | null;
  tax_amount: number | null;
  amount_with_tax: number | null;
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
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((grn) => {
                  const isOpen = expandedGrnId === grn.id;
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
                            {grn.grn_number}
                            {hasAttachment(grn) && <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{grn.invoice_number ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{grn.vendor_name ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{dateLabel(grn.bill_date)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(grn.amount_with_tax)}</td>
                        <td className="px-3 py-2">
                          <StatusStamp tone={grnStatusTone(grn.status)}>{labelStatus(grn.status)}</StatusStamp>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={6} className="p-0">
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
      </DialogContent>
    </Dialog>
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
                <div className="flex justify-between"><span className="text-slate-500">Amount (with tax)</span><span className="font-medium tabular-nums">{money(alloc.amount_with_tax)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">CGST / SGST / IGST</span><span className="font-medium tabular-nums">{money(alloc.cgst_amount)} / {money(alloc.sgst_amount)} / {money(alloc.igst_amount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">P&amp;L cost</span><span className="font-medium tabular-nums">{money(alloc.pnl_cost_amount)}</span></div>
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
