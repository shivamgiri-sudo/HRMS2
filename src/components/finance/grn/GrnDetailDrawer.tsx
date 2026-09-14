import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileText, Loader2, XCircle, AlertTriangle, RotateCcw, Send } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  dateTimeLabel,
  grnDisplayNumber,
  grnStatusTone,
  labelStatus,
  money,
} from "@/components/finance/grn/grn-format";
import {
  GrnAlert,
  GrnButton,
  GrnCellSub,
  GrnKv,
  GrnKvList,
} from "@/components/finance/grn/grn-ui";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";

// ── Types ──────────────────────────────────────────────────────────────────────

type ApprovalEvent = {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string;
  decision: string | null;
  actor_role: string;
  remarks: string | null;
  created_at: string;
};

type GrnDocument = {
  id: string;
  original_name: string;
  extraction_status: string | null;
  is_primary: number;
  document_type: string | null;
};

type GrnWorkspace = {
  grn: {
    id: string;
    /** NULL until Finance Head approves it — render via grnDisplayNumber(grn). */
    grn_number: string | null;
    grn_type: string;
    status: string;
    branch_name: string | null;
    vendor_name: string | null;
    head: string | null;
    sub_head: string | null;
    amount: number | null;
    amount_with_tax: number | null;
    bill_date: string | null;
    due_date: string | null;
    invoice_number: string | null;
    accounting_period: string | null;
    rejection_reason: string | null;
    attachment_path: string | null;
    attachment_file_path: string | null;
    attachment_original_name: string | null;
    created_by_name: string | null;
    created_at: string | null;
    description: string | null;
    /** The raiser's own note at creation time — distinct from description, a system-generated
     *  structural summary. */
    remarks: string | null;
    purchase_reference: string | null;
  };
  documents: GrnDocument[];
};

// ── Action icon for timeline events ────────────────────────────────────────────

function EventIcon({ action }: { action: string }) {
  if (action === "approve") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (action === "reject") return <XCircle className="h-4 w-4 text-red-500" />;
  if (action === "return") return <RotateCcw className="h-4 w-4 text-amber-500" />;
  if (action === "resubmit" || action === "submit") return <Send className="h-4 w-4 text-blue-500" />;
  if (action === "cancel") return <XCircle className="h-4 w-4 text-grn-ink-soft" />;
  return <Clock className="h-4 w-4 text-grn-ink-soft" />;
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    submit: "Submitted",
    approve: "Approved",
    reject: "Rejected",
    return: "Returned for correction",
    resubmit: "Resubmitted",
    cancel: "Cancelled",
    override: "Validation overridden",
    reverse: "Consumption reversed",
    billing_cycle_set: "Billing cycle updated",
  };
  return map[action] ?? action.replace(/_/g, " ");
}

function roleLabel(role: string) {
  const map: Record<string, string> = {
    branch_admin: "Branch Admin",
    branch_head: "Branch Head",
    finance_head: "Finance Head",
    super_admin: "Super Admin",
    payroll_head: "Payroll Head",
  };
  return map[role] ?? role.replace(/_/g, " ");
}

// ── Main component ──────────────────────────────────────────────────────────────

export function GrnDetailDrawer({
  grnId,
  onClose,
  onReopened,
  onEditRequested,
}: {
  grnId: string | null;
  onClose: () => void;
  /** Called after successful reopen so the list can refresh */
  onReopened?: () => void;
  /** Called when the user wants to edit the GRN (opens create form) */
  onEditRequested?: (grnId: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [docOpening, setDocOpening] = useState<string | null>(null);

  // Fetch full GRN detail via workspace endpoint (includes documents)
  const workspaceQuery = useQuery({
    queryKey: ["grn-detail-workspace", grnId],
    queryFn: async (): Promise<GrnWorkspace> => {
      const res = await hrmsApi.get<any>(`/api/finance/grns/${grnId}/workspace`);
      const d = res?.data ?? res;
      return {
        grn: d?.grn ?? d,
        documents: d?.documents ?? [],
      };
    },
    enabled: Boolean(grnId),
  });

  const historyQuery = useQuery({
    queryKey: ["grn-approval-history", grnId],
    queryFn: async (): Promise<ApprovalEvent[]> => {
      const res = await hrmsApi.get<any>(`/api/finance/grns/${grnId}/approval-history`);
      return (res?.data ?? res ?? []) as ApprovalEvent[];
    },
    enabled: Boolean(grnId),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/finance/grns/${id}/reopen`, {}),
    onSuccess: () => {
      toast({ title: "GRN reopened — it is now a draft you can edit" });
      void queryClient.invalidateQueries({ queryKey: ["grn-history"] });
      void queryClient.invalidateQueries({ queryKey: ["grn-detail-workspace", grnId] });
      onReopened?.();
    },
    onError: (err: Error) =>
      toast({ title: "Reopen failed", description: err.message, variant: "destructive" }),
  });

  const resubmitMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/finance/grns/${id}/resubmit`, {}),
    onSuccess: () => {
      toast({ title: "GRN resubmitted for approval" });
      void queryClient.invalidateQueries({ queryKey: ["grn-history"] });
      void queryClient.invalidateQueries({ queryKey: ["grn-detail-workspace", grnId] });
      onReopened?.();
    },
    onError: (err: Error) =>
      toast({ title: "Resubmit failed", description: err.message, variant: "destructive" }),
  });

  async function openDocument(documentId?: string) {
    if (!grnId) return;
    setDocOpening(documentId ?? "legacy");
    try {
      const endpoint = documentId
        ? `/api/finance/grns/${grnId}/documents/${documentId}/file`
        : `/api/finance/grns/${grnId}/attachment`;
      const blob = await hrmsApi.getBlob(endpoint);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast({
        title: "Document could not be opened",
        description: err instanceof Error ? err.message : "File error",
        variant: "destructive",
      });
    } finally {
      setDocOpening(null);
    }
  }

  const grn = workspaceQuery.data?.grn;
  const documents = workspaceQuery.data?.documents ?? [];
  const history = historyQuery.data ?? [];

  const isRejected = grn?.status === "rejected";
  const isReturned =
    grn?.status === "returned_to_branch_head" || grn?.status === "returned_to_raiser";

  return (
    <Sheet open={Boolean(grnId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full max-w-[520px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]"
      >
        <SheetHeader className="border-b border-grn-line-soft px-5 py-4">
          <SheetTitle className="flex items-center gap-3 text-base font-bold text-grn-ink">
            <span className="font-grn-mono text-grn-brand">{grn ? grnDisplayNumber(grn) : "…"}</span>
            {grn && (
              <StatusStamp tone={grnStatusTone(grn.status)}>
                {labelStatus(grn.status)}
              </StatusStamp>
            )}
          </SheetTitle>
          {grn?.branch_name && (
            <p className="mt-0.5 text-xs text-grn-ink-soft">{grn.branch_name}</p>
          )}
        </SheetHeader>

        {workspaceQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-grn-ink-soft" />
          </div>
        ) : !grn ? (
          <div className="flex flex-1 items-center justify-center text-sm text-grn-ink-soft">
            Could not load GRN details.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* ── Action banner for actionable states ── */}
            {(isRejected || isReturned) && (
              <div className="border-b border-grn-line-soft px-5 py-3">
                {isRejected && (
                  <GrnAlert tone="crit">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-grn-crit">GRN Rejected</p>
                        {grn.rejection_reason && (
                          <p className="mt-0.5 text-xs text-grn-crit">{grn.rejection_reason}</p>
                        )}
                      </div>
                      <GrnButton
                        className="shrink-0 text-xs"
                        disabled={reopenMutation.isPending}
                        onClick={() => reopenMutation.mutate(grn.id)}
                      >
                        {reopenMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        Reopen for Correction
                      </GrnButton>
                    </div>
                  </GrnAlert>
                )}
                {isReturned && (
                  <GrnAlert tone="warn">
                    <p className="font-semibold">
                      {grn.status === "returned_to_raiser"
                        ? "Returned to you for correction"
                        : "Returned to Branch Head for correction"}
                    </p>
                    <p className="mt-0.5 text-xs text-grn-ink-soft">
                      Review the timeline below for the reason. You can edit fields and resubmit,
                      or resubmit as-is if no changes are needed.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {/* Reopen to draft first so the create-form can edit all fields */}
                      {onEditRequested && (
                        <GrnButton
                          className="text-xs"
                          disabled={reopenMutation.isPending || resubmitMutation.isPending}
                          onClick={() =>
                            reopenMutation.mutate(grn.id, {
                              onSuccess: () => {
                                onClose();
                                onEditRequested(grn.id);
                              },
                            })
                          }
                        >
                          {reopenMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          Edit &amp; Resubmit
                        </GrnButton>
                      )}
                      <GrnButton
                        className="text-xs"
                        disabled={resubmitMutation.isPending || reopenMutation.isPending}
                        onClick={() => resubmitMutation.mutate(grn.id)}
                      >
                        {resubmitMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                        Resubmit As-Is
                      </GrnButton>
                    </div>
                  </GrnAlert>
                )}
              </div>
            )}

            {/* ── GRN details ── */}
            <div className="px-5 py-4">
              <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-grn-ink-soft">
                Details
              </p>
              <GrnKvList>
                {(
                  [
                    ["Vendor", grn.vendor_name],
                    ["Head", grn.head],
                    ["Sub-head", grn.sub_head],
                    ["Amount (excl. tax)", money(grn.amount, 2)],
                    ["Amount (incl. tax)", money(grn.amount_with_tax, 2)],
                    ["Bill date", grn.bill_date ? new Date(grn.bill_date).toLocaleDateString("en-IN") : null],
                    ["Invoice #", grn.invoice_number],
                    ["Acctg period", grn.accounting_period],
                    ["PO / Contract", grn.purchase_reference],
                    // The raiser's own note at creation time. Was missing here entirely —
                    // "Description" below is a system-generated structural summary ("1 invoice
                    // component(s) across N cost centre(s)"), never what the raiser typed.
                    ["Remarks", grn.remarks],
                    ["Description", grn.description],
                    ["Raised by", grn.created_by_name],
                    ["Raised at", dateTimeLabel(grn.created_at)],
                  ] as [string, string | null | undefined][]
                )
                  .filter(([, v]) => v != null && String(v).trim() !== "")
                  .map(([label, val]) => (
                    <GrnKv key={label} label={label}>
                      <span className="block break-words">{val}</span>
                    </GrnKv>
                  ))}
              </GrnKvList>
            </div>

            {/* ── Documents ── */}
            <div className="border-t border-grn-line-soft px-5 py-4">
              <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-grn-ink-soft">
                Documents
              </p>
              {documents.length > 0 ? (
                <div className="space-y-1.5">
                  {documents.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      disabled={docOpening === doc.id}
                      onClick={() => void openDocument(doc.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-grn-line bg-grn-card p-2 text-left transition-colors hover:border-grn-brand disabled:opacity-60"
                    >
                      {docOpening === doc.id ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-grn-brand" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-grn-brand" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-semibold text-grn-ink">
                          {doc.original_name}
                        </p>
                        <p className="text-[10.5px] text-grn-ink-soft">
                          {Number(doc.is_primary) === 1 ? "Primary document" : "Supporting document"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : grn.attachment_path || grn.attachment_file_path ? (
                <GrnButton
                  className="w-full"
                  disabled={docOpening === "legacy"}
                  onClick={() => void openDocument()}
                >
                  {docOpening === "legacy" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                  Open attachment
                </GrnButton>
              ) : grn.attachment_original_name ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-grn-line bg-grn-card p-2">
                  <FileText className="h-4 w-4 shrink-0 text-grn-ink-soft" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-grn-ink">
                      {grn.attachment_original_name}
                    </p>
                    <p className="text-[10.5px] text-grn-ink-soft">
                      On file in legacy system — not migrated to HRMS storage
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-grn-ink-soft">No documents attached.</p>
              )}
            </div>

            {/* ── Approval journey timeline ── */}
            <div className="border-t border-grn-line-soft px-5 py-4">
              <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.06em] text-grn-ink-soft">
                Approval Journey
              </p>
              {historyQuery.isLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-grn-ink-soft" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-grn-ink-soft">No workflow events recorded yet.</p>
              ) : (
                <ol className="relative space-y-0 border-l border-grn-line-soft pl-5">
                  {history.map((event, i) => (
                    <li key={event.id} className="relative pb-5 last:pb-0">
                      {/* connector dot */}
                      <span className="absolute -left-[21px] flex h-5 w-5 items-center justify-center rounded-full bg-grn-card ring-1 ring-grn-line">
                        <EventIcon action={event.action} />
                      </span>

                      <div className="ml-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[12.5px] font-semibold text-grn-ink">
                            {actionLabel(event.action)}
                          </span>
                          <span className="text-[10.5px] text-grn-ink-soft">
                            by {roleLabel(event.actor_role)}
                          </span>
                        </div>

                        {event.remarks && (
                          <p className="mt-0.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 ring-1 ring-amber-200">
                            {event.remarks}
                          </p>
                        )}

                        {event.from_status && event.to_status && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <StatusStamp tone={grnStatusTone(event.from_status)} className="text-[9px]">
                              {labelStatus(event.from_status)}
                            </StatusStamp>
                            <span className="text-[10px] text-grn-ink-soft">→</span>
                            <StatusStamp tone={grnStatusTone(event.to_status)} className="text-[9px]">
                              {labelStatus(event.to_status)}
                            </StatusStamp>
                          </div>
                        )}

                        <GrnCellSub className="mt-0.5">{dateTimeLabel(event.created_at)}</GrnCellSub>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
