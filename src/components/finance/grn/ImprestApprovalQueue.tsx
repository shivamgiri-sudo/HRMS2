import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerUpLeft, Check, RefreshCw, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import { dateLabel, grnStatusTone, labelStatus, money } from "@/components/finance/grn/grn-format";
import {
  GRN_TR, GrnButton, GrnCard, GrnCardHeader, GrnCellSub, GrnChip, GrnEmptyState,
  GrnIconButton, GrnTable, GrnTd, GrnTextarea, GrnTh,
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
  grn_number: string;
  bill_date?: string | null;
  branch_name?: string | null;
  head?: string | null;
  sub_head?: string | null;
  cost_centre_name?: string | null;
  description?: string | null;
  amount?: number | null;
  amount_with_tax?: number | null;
  status: string;
  pending_with?: string | null;
  pending_with_role?: string | null;
  pending_since?: string | null;
  ageing_days?: number | null;
  age_bucket?: string | null;
  created_by_name?: string | null;
  attachment_original_name?: string | null;
};

type PendingAction = { row: ImprestRow; kind: "return" | "reject" } | null;

/** Older than a week is the one that needs chasing, so it is the only one coloured. */
function ageTone(bucket?: string | null) {
  return bucket === "7+" ? "crit" : bucket === "3-7" ? "warn" : "neutral";
}

export function ImprestApprovalQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<PendingAction>(null);
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["imprest-approval-queue"],
    queryFn: async () => {
      const r = await hrmsApi.get<any>("/api/finance/grns?grnType=imprest&limit=100");
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
      if (input.kind === "approve") {
        return hrmsApi.post<any>(`/api/finance/grns/${input.id}/review`, { decision: "approve" });
      }
      if (input.kind === "return") {
        return hrmsApi.post<any>(`/api/finance/grns/${input.id}/return`, {
          target: "branch_head",
          reason: input.reason,
        });
      }
      return hrmsApi.post<any>(`/api/finance/grns/${input.id}/review`, {
        decision: "reject",
        note: input.reason,
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
                <GrnTh>Action</GrnTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={GRN_TR}>
                  <GrnTd>
                    <span className="font-mono">{row.grn_number}</span>
                    <GrnCellSub>{dateLabel(row.bill_date)}</GrnCellSub>
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
                    <span className="line-clamp-2">{row.description ?? "—"}</span>
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
                      {row.ageing_days === null || row.ageing_days === undefined
                        ? "—"
                        : `${row.ageing_days}d`}
                    </StatusStamp>
                    <GrnCellSub>since {dateLabel(row.pending_since)}</GrnCellSub>
                  </GrnTd>
                  <GrnTd>{row.created_by_name ?? "—"}</GrnTd>
                  <GrnTd>
                    <div className="flex items-center gap-1">
                      <GrnIconButton
                        aria-label={`Approve ${row.grn_number}`}
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: row.id, kind: "approve" })}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </GrnIconButton>
                      {/* Return, not reject, is the default corrective action for imprest —
                          the voucher usually needs fixing, not killing. */}
                      <GrnIconButton
                        aria-label={`Return ${row.grn_number} to the Branch Head`}
                        onClick={() => { setAction({ row, kind: "return" }); setReason(""); }}
                      >
                        <CornerUpLeft className="h-3.5 w-3.5" />
                      </GrnIconButton>
                      <GrnIconButton
                        aria-label={`Reject ${row.grn_number}`}
                        onClick={() => { setAction({ row, kind: "reject" }); setReason(""); }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </GrnIconButton>
                    </div>
                  </GrnTd>
                </tr>
              ))}
            </tbody>
          </GrnTable>
        </div>
      )}

      {action && (
        <div className="border-t border-grn-line p-3">
          <p className="text-xs font-semibold text-grn-ink">
            {action.kind === "return" ? "Send back to the Branch Head" : "Reject"} ·{" "}
            <span className="font-mono">{action.row.grn_number}</span>
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
