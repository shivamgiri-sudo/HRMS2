import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerUpLeft, Check, History, RefreshCw, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import { dateLabel, grnDisplayNumber, grnStatusTone, labelStatus, money } from "@/components/finance/grn/grn-format";
import {
  GRN_TR, GrnButton, GrnCard, GrnCardHeader, GrnCellSub, GrnChip, GrnEmptyState,
  GrnIconButton, GrnInput, GrnTable, GrnTd, GrnTextarea, GrnTh,
} from "@/components/finance/grn/grn-ui";

/**
 * Imprest approval queue (Requirement 10).
 *
 * A table, not a card per request. A reviewer clearing twenty vouchers needs to compare them —
 * who is holding what, and for how long — and a stack of cards makes that impossible without
 * scrolling. The columns are the ones the requirement names.
 *
 * Pending With and Ageing are derived server-side from status, never stored. Ageing counts time
 * in the CURRENT stage rather than since the voucher was raised, so a slow Branch Head does not
 * make a fast Finance turnaround look bad.
 *
 * Actions stay inline. Approving is one click from the row; only Return and Reject open a
 * reason box, because both are meaningless without one.
 */

type ImprestRow = {
  id: string;
  /** NULL until Finance Head approves it (imprest's final stage too) — render via
   *  grnDisplayNumber(row), never this field directly. */
  grn_number: string | null;
  bill_date?: string | null;
  branch_name?: string | null;
  head?: string | null;
  sub_head?: string | null;
  cost_centre_name?: string | null;
  description?: string | null;
  /** The raiser's own note at creation time — e.g. "Paid to X for Y". `description` is a
   *  system-generated structural summary ("1 invoice component(s) across N cost centre(s)"),
   *  never what the raiser typed; the two were being conflated here, hiding the real reason a
   *  reviewer needs to approve or query the voucher. */
  remarks?: string | null;
  amount?: number | null;
  amount_with_tax?: number | null;
  status: string;
  pending_with?: string | null;
  pending_with_role?: string | null;
  pending_since?: string | null;
  ageing_days?: number | null;
  age_bucket?: string | null;
  created_by_name?: string | null;
  /** When the voucher was raised. Distinct from bill_date, which is the expense date on the
   *  receipt — an imprest raised today routinely carries a bill date from weeks earlier. */
  created_at?: string | null;
  attachment_original_name?: string | null;
};

type PendingAction = { row: ImprestRow; kind: "return" | "reject" } | null;

type ApprovalEvent = {
  id: string;
  action: string;
  from_status?: string | null;
  to_status: string;
  actor_name?: string | null;
  actor_role?: string | null;
  remarks?: string | null;
  created_at: string;
};

/** Older than a week is the one that needs chasing, so it is the only one coloured. */
function ageTone(bucket?: string | null) {
  if (bucket === "legacy") return "neutral";
  return bucket === "7+" ? "crit" : bucket === "3-7" ? "warn" : "neutral";
}

export function ImprestApprovalQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<PendingAction>(null);
  const [reason, setReason] = useState("");
  const [historyFor, setHistoryFor] = useState<ImprestRow | null>(null);

  /**
   * The voucher's approval history.
   *
   * This queue already tells a reviewer "the reason is kept on the voucher's history". Until
   * now that was a promise nothing could keep: five call sites wrote finance_approval_event and
   * no reader was ever wired to an endpoint, so a returned voucher recorded exactly why and
   * nobody could read it back. Fetched on demand rather than per row, because a queue of twenty
   * would otherwise fire twenty requests to show nothing most of the time.
   */
  const history = useQuery({
    queryKey: ["imprest-approval-history", historyFor?.id],
    enabled: Boolean(historyFor?.id),
    queryFn: async () => {
      const r = await hrmsApi.get<any>(`/api/finance/grns/${historyFor!.id}/approval-history`);
      const body = (r as any)?.data ?? r;
      return ((body?.data ?? body ?? []) as ApprovalEvent[]);
    },
  });

  const [billDateFrom, setBillDateFrom] = useState("");
  const [billDateTo, setBillDateTo] = useState("");

  const query = useQuery({
    queryKey: ["imprest-approval-queue", billDateFrom, billDateTo],
    queryFn: async () => {
      const params = new URLSearchParams({ grnType: "imprest", limit: "100" });
      if (billDateFrom) params.set("billDateFrom", billDateFrom);
      if (billDateTo) params.set("billDateTo", billDateTo);
      const r = await hrmsApi.get<any>(`/api/finance/grns?${params}`);
      const body = (r as any)?.data ?? r;
      return ((body?.data ?? body?.rows ?? body ?? []) as ImprestRow[]);
    },
  });

  const all = Array.isArray(query.data) ? query.data : [];
  // Only what is actually waiting on somebody. A queue showing settled vouchers is a report.
  const rows = all.filter((r) => r.pending_with_role);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["imprest-approval-queue"] });

  const decide = useMutation({
    mutationFn: async (input: { id: string; kind: "approve" | "return" | "reject"; reason?: string }) => {
      // ReviewGrnPayload is { decision: "approved" | "rejected"; reviewNote?: string } — past
      // tense, and reviewNote, not note. grn.routes.ts passes req.body to grnService.reviewGrn
      // unmapped, so the earlier "approve"/"reject"/note spelling failed the guard at
      // grn.service.ts:421 and every Approve and Reject in this queue returned "Review decision
      // must be approved or rejected". Same payload SmartGrnApprovalQueue already sends.
      if (input.kind === "approve") {
        return hrmsApi.post<any>(`/api/finance/grns/${input.id}/review`, { decision: "approved" });
      }
      // /return is a different endpoint with its own contract — { target, reason } is correct there.
      if (input.kind === "return") {
        return hrmsApi.post<any>(`/api/finance/grns/${input.id}/return`, {
          target: "branch_head",
          reason: input.reason,
        });
      }
      return hrmsApi.post<any>(`/api/finance/grns/${input.id}/review`, {
        decision: "rejected",
        reviewNote: input.reason,
      });
    },
    onSuccess: (_d, v) => {
      toast({
        title:
          v.kind === "approve" ? "Voucher approved"
          : v.kind === "return" ? "Sent back to the Branch Head"
          : "Voucher rejected",
      });
      setAction(null);
      setReason("");
      refresh();
    },
    onError: (e: Error) => toast({ title: "Could not complete", description: e.message, variant: "destructive" }),
  });

  return (
    <GrnCard>
      <GrnCardHeader
        title="Imprest approvals"
        description={
          rows.length
            ? `${rows.length} voucher${rows.length === 1 ? "" : "s"} waiting`
            : undefined
        }
        action={
          <GrnIconButton aria-label="Refresh the queue" onClick={() => query.refetch()}>
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
          </GrnIconButton>
        }
      />

      {/* Bill date range — same filter GRN Search and the vendor GRN approval queue use. No
          vendor filter here: every row in this queue is imprest, which carries no vendor. */}
      <div className="flex items-center gap-1 border-b border-grn-line-soft px-3 pb-3">
        <span className="text-xs font-medium text-grn-ink-soft">Bill date:</span>
        <GrnInput
          type="date"
          aria-label="Bill date from"
          className="h-7 w-[136px] text-xs"
          value={billDateFrom}
          onChange={(e) => setBillDateFrom(e.target.value)}
        />
        <span className="text-xs text-grn-ink-soft">to</span>
        <GrnInput
          type="date"
          aria-label="Bill date to"
          className="h-7 w-[136px] text-xs"
          value={billDateTo}
          onChange={(e) => setBillDateTo(e.target.value)}
        />
        {(billDateFrom || billDateTo) && (
          <GrnIconButton
            aria-label="Clear date filters"
            title="Clear date filters"
            onClick={() => { setBillDateFrom(""); setBillDateTo(""); }}
          >
            ×
          </GrnIconButton>
        )}
      </div>

      {rows.length === 0 ? (
        <GrnEmptyState
          title={query.isLoading ? "Loading…" : "Nothing waiting"}
          description={query.isLoading ? undefined : "Every imprest voucher has been actioned."}
        />
      ) : (
        <div className="overflow-x-auto">
          <GrnTable>
            <thead>
              <tr>
                <GrnTh>Voucher</GrnTh>
                <GrnTh>Branch</GrnTh>
                <GrnTh>Head / Sub-head</GrnTh>
                <GrnTh>Details</GrnTh>
                <GrnTh className="text-right">Amount</GrnTh>
                <GrnTh>Stage</GrnTh>
                <GrnTh>Pending with</GrnTh>
                <GrnTh>Ageing</GrnTh>
                <GrnTh>Raised by</GrnTh>
                <GrnTh>Raised on</GrnTh>
                <GrnTh>Action</GrnTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={GRN_TR}>
                  <GrnTd>
                    <span className="font-mono">{grnDisplayNumber(row)}</span>
                    <GrnCellSub>bill {dateLabel(row.bill_date)}</GrnCellSub>
                  </GrnTd>
                  <GrnTd>
                    {row.branch_name ?? "—"}
                    <GrnCellSub>{row.cost_centre_name ?? "—"}</GrnCellSub>
                  </GrnTd>
                  <GrnTd>
                    {row.head ?? "—"}
                    <GrnCellSub>{row.sub_head ?? "—"}</GrnCellSub>
                  </GrnTd>
                  <GrnTd>
                    {/* The raiser's own note — was showing description, the system-generated
                        split-count summary, never what was actually typed at creation. */}
                    <span className="line-clamp-2" title={row.remarks ?? undefined}>{row.remarks ?? "—"}</span>
                    {/* Proof is what a reviewer checks before approving, so its presence is
                        visible in the row rather than one click away. */}
                    <GrnCellSub>
                      {row.attachment_original_name ? "Proof attached" : "No proof attached"}
                    </GrnCellSub>
                  </GrnTd>
                  <GrnTd className="text-right tabular-nums">
                    {money(row.amount_with_tax ?? row.amount ?? 0)}
                  </GrnTd>
                  <GrnTd>
                    <StatusStamp tone={grnStatusTone(row.status)}>{labelStatus(row.status)}</StatusStamp>
                  </GrnTd>
                  <GrnTd>{row.pending_with ?? "—"}</GrnTd>
                  <GrnTd>
                    <StatusStamp tone={ageTone(row.age_bucket)}>
                      {row.age_bucket === "legacy" || row.ageing_days === -1
                        ? "Legacy"
                        : row.ageing_days === null || row.ageing_days === undefined
                          ? "—"
                          : `${row.ageing_days}d`}
                    </StatusStamp>
                    {row.age_bucket !== "legacy" && row.ageing_days !== -1 && (
                      <GrnCellSub>since {dateLabel(row.pending_since)}</GrnCellSub>
                    )}
                  </GrnTd>
                  <GrnTd>{row.created_by_name ?? "—"}</GrnTd>
                  {/* The voucher cell's sub-line is the BILL date, which reads as the raised date
                      and is not — an imprest raised today routinely carries a bill date from
                      weeks earlier. Both are now labelled and both are shown. */}
                  <GrnTd>{row.created_at ? dateLabel(row.created_at) : "—"}</GrnTd>
                  <GrnTd>
                    <div className="flex items-center gap-1">
                      <GrnIconButton
                        aria-label={`Approve ${grnDisplayNumber(row)}`}
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: row.id, kind: "approve" })}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </GrnIconButton>
                      {/* Return, not reject, is the default corrective action for imprest —
                          the voucher usually needs fixing, not killing. */}
                      <GrnIconButton
                        aria-label={`Return ${grnDisplayNumber(row)} to the Branch Head`}
                        onClick={() => { setAction({ row, kind: "return" }); setReason(""); }}
                      >
                        <CornerUpLeft className="h-3.5 w-3.5" />
                      </GrnIconButton>
                      <GrnIconButton
                        aria-label={`Reject ${grnDisplayNumber(row)}`}
                        onClick={() => { setAction({ row, kind: "reject" }); setReason(""); }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </GrnIconButton>
                      <GrnIconButton
                        aria-label={`History of ${grnDisplayNumber(row)}`}
                        onClick={() => setHistoryFor((current) => (current?.id === row.id ? null : row))}
                      >
                        <History className="h-3.5 w-3.5" />
                      </GrnIconButton>
                    </div>
                  </GrnTd>
                </tr>
              ))}
            </tbody>
          </GrnTable>
        </div>
      )}

      {historyFor && (
        <div className="border-t border-grn-line p-3">
          <p className="text-xs font-semibold text-grn-ink">
            History · <span className="font-mono">{grnDisplayNumber(historyFor)}</span>
          </p>
          {history.isLoading ? (
            <p className="mt-2 text-[11px] text-grn-ink-soft">Loading…</p>
          ) : !history.data?.length ? (
            <p className="mt-2 text-[11px] text-grn-ink-soft">
              Nothing recorded yet. Events are written from the point a voucher is submitted, so
              anything raised before this existed shows no history.
            </p>
          ) : (
            /* Oldest first: a history reads forwards. Every entry survives, so a voucher
               returned twice shows BOTH reasons rather than only the most recent — which is why
               this is an append-only table and not a column each transition overwrites. */
            <ol className="mt-2 space-y-2">
              {history.data.map((event) => (
                <li key={event.id} className="border-l-2 border-grn-line pl-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[11.5px] font-semibold text-grn-ink">
                      {labelStatus(event.action)}
                    </span>
                    <span className="text-[10.5px] text-grn-ink-soft">
                      {event.from_status ? `${labelStatus(event.from_status)} → ` : ""}
                      {labelStatus(event.to_status)}
                    </span>
                    <span className="ml-auto text-[10.5px] text-grn-ink-soft">
                      {dateLabel(event.created_at)}
                    </span>
                  </div>
                  <GrnCellSub>
                    {event.actor_name ?? "Unknown"}
                    {event.actor_role ? ` · ${labelStatus(event.actor_role)}` : ""}
                  </GrnCellSub>
                  {event.remarks && (
                    <p className="mt-1 text-[11px] text-grn-ink">{event.remarks}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <div className="mt-2 flex justify-end">
            <GrnChip active={false} onClick={() => setHistoryFor(null)}>Close</GrnChip>
          </div>
        </div>
      )}

      {action && (
        <div className="border-t border-grn-line p-3">
          <p className="text-xs font-semibold text-grn-ink">
            {action.kind === "return" ? "Send back to the Branch Head" : "Reject"} ·{" "}
            <span className="font-mono">{grnDisplayNumber(action.row)}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-grn-ink-soft">
            {action.kind === "return"
              ? "The Branch Head can correct and resubmit. The reason is kept on the voucher's history."
              : "Rejection is final. If the voucher can be corrected, send it back instead."}
          </p>
          <GrnTextarea
            className="mt-2"
            rows={2}
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <GrnChip active={false} onClick={() => { setAction(null); setReason(""); }}>
              Cancel
            </GrnChip>
            <GrnButton
              disabled={!reason.trim() || decide.isPending}
              onClick={() => decide.mutate({ id: action.row.id, kind: action.kind, reason: reason.trim() })}
            >
              {action.kind === "return" ? "Send back" : "Reject"}
            </GrnButton>
          </div>
        </div>
      )}
    </GrnCard>
  );
}
