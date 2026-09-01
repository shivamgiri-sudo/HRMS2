import { useState } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import {
  useManualAdjustments,
  useCreateManualAdjustment,
  useReviewManualAdjustment,
  type AdjustmentType,
} from "@/hooks/useManualAdjustments";
import { useWorkforceAccess } from "@/hooks/useUserRole";

/** Mirrors ADJUSTMENT_WRITE_ROLES / ADJUSTMENT_APPROVE_ROLES on the backend; the API enforces
 *  these regardless — this only decides what the UI offers. */
const CREATE_ROLES = ["super_admin", "admin", "branch_admin", "branch_head", "finance", "finance_head", "accounts_head"];
const APPROVE_ROLES = ["super_admin", "finance_head", "accounts_head"];

const TYPE_LABEL: Record<AdjustmentType, string> = {
  projected_revenue: "Projected Revenue",
  penalty: "Penalty",
  reward: "Reward",
};

function currency(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function statusBadgeClass(status: string) {
  if (status === "approved") return "bg-emerald-100 text-emerald-700";
  if (status === "rejected") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-700";
}

/**
 * Manual P&L Adjustments — entry form, pending-approval queue and the resulting Adjusted Total.
 *
 * DESIGN: a separate adjustment layer, never blended into the system-calculated actuals shown
 * elsewhere on this page. Only APPROVED entries count toward the Adjusted Total; pending and
 * rejected entries are visible here for tracking but never move any figure.
 */
export function ManualAdjustmentsPanel({
  processId,
  processName,
  period,
  systemRevenue,
  adjustedTotal,
}: {
  processId: string;
  processName: string;
  period: string;
  /** The pure system-calculated revenue figure — shown for comparison, never edited here. */
  systemRevenue: number;
  /** Server-computed adjustedTotal for this process/period, when the detail bundle carries one. */
  adjustedTotal?: {
    approvedProjectedRevenue: number;
    approvedRewards: number;
    approvedPenalties: number;
    adjustedTotal: number;
    pendingCount: number;
  } | null;
}) {
  const { hasAnyRole } = useWorkforceAccess();
  const canCreate = hasAnyRole(...CREATE_ROLES);
  const canApprove = hasAnyRole(...APPROVE_ROLES);

  const [type, setType] = useState<AdjustmentType>("projected_revenue");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const listQuery = useManualAdjustments({ processId, period });
  const createMutation = useCreateManualAdjustment();
  const reviewMutation = useReviewManualAdjustment();

  function submit() {
    setFormError(null);
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setFormError("Enter an amount greater than zero.");
      return;
    }
    if (!reason.trim()) {
      setFormError("A reason is required — this money moves a P&L figure.");
      return;
    }
    createMutation.mutate(
      { processId, periodCode: period, adjustmentType: type, amount: amountNum, reason: reason.trim() },
      {
        onSuccess: () => { setAmount(""); setReason(""); },
        onError: (err) => setFormError((err as Error)?.message || "Could not create the adjustment."),
      }
    );
  }

  const entries = listQuery.data ?? [];
  const pending = entries.filter((e) => e.status === "pending");
  const decided = entries.filter((e) => e.status !== "pending");

  return (
    <div className="space-y-4">
      {/* Adjusted Total — clearly separate from, and alongside, the system figure. */}
      <section className="rounded-lg border p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Adjusted Total (system revenue ± approved adjustments)
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
          <dt className="text-slate-500">System revenue (unchanged)</dt>
          <dd className="text-right font-medium text-slate-900">{currency(systemRevenue)}</dd>
          <dt className="text-slate-500">Approved rewards (+)</dt>
          <dd className="text-right font-medium text-emerald-700">{currency(adjustedTotal?.approvedRewards ?? 0)}</dd>
          <dt className="text-slate-500">Approved penalties (−)</dt>
          <dd className="text-right font-medium text-rose-700">{currency(adjustedTotal?.approvedPenalties ?? 0)}</dd>
          <dt className="text-slate-500">Approved projected revenue (info only)</dt>
          <dd className="text-right font-medium text-slate-500">{currency(adjustedTotal?.approvedProjectedRevenue ?? 0)}</dd>
        </dl>
        <div className="mt-2 flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
          <span className="text-xs font-semibold text-slate-600">Adjusted Total</span>
          <span className="text-sm font-bold text-slate-900">
            {currency(adjustedTotal?.adjustedTotal ?? systemRevenue)}
          </span>
        </div>
        {(adjustedTotal?.pendingCount ?? 0) > 0 && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-700">
            <AlertCircle className="h-3 w-3" />
            {adjustedTotal!.pendingCount} adjustment(s) still pending — not reflected above until approved.
          </p>
        )}
      </section>

      {/* Entry form */}
      {canCreate && (
        <section className="rounded-lg border p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Raise a manual adjustment — {processName}, {period}
          </h3>
          <div className="grid gap-2 sm:grid-cols-4">
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={type}
              onChange={(e) => setType(e.target.value as AdjustmentType)}
            >
              <option value="projected_revenue">Projected Revenue</option>
              <option value="penalty">Penalty</option>
              <option value="reward">Reward</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount (INR)"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              type="text"
              placeholder="Reason (required)"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs sm:col-span-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {formError && <p className="mt-1.5 text-[11px] text-rose-600">{formError}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={createMutation.isPending}
            className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {createMutation.isPending ? "Submitting…" : "Submit for approval"}
          </button>
          {createMutation.isSuccess && (
            <p className="mt-1.5 text-[11px] text-emerald-700">
              Submitted — pending approval. It will not affect any figure until approved.
            </p>
          )}
        </section>
      )}

      {/* Pending queue */}
      <section className="rounded-lg border p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Pending approval {pending.length > 0 && `(${pending.length})`}
        </h3>
        {listQuery.isLoading ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="text-xs text-slate-500">No adjustments awaiting review for this process/period.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((entry) => (
              <div key={entry.id} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">
                    {TYPE_LABEL[entry.adjustment_type]} — {currency(entry.amount)}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(entry.status)}`}>
                    {entry.status}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">{entry.reason}</p>
                <p className="mt-1 text-[10px] text-slate-400">
                  Raised by {entry.created_by_name || entry.created_by} on{" "}
                  {new Date(entry.created_at).toLocaleString("en-IN")}
                </p>
                {canApprove && (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => reviewMutation.mutate({ id: entry.id, decision: "approve" })}
                      disabled={reviewMutation.isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" /> Approve
                    </button>
                    {rejectingId === entry.id ? (
                      <>
                        <input
                          type="text"
                          placeholder="Rejection reason (required)"
                          className="h-6 rounded-md border border-input bg-background px-2 text-[11px]"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!rejectReason.trim()) return;
                            reviewMutation.mutate(
                              { id: entry.id, decision: "reject", reason: rejectReason.trim() },
                              { onSuccess: () => { setRejectingId(null); setRejectReason(""); } }
                            );
                          }}
                          disabled={reviewMutation.isPending}
                          className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" /> Confirm reject
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRejectingId(entry.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        <X className="h-3 w-3" /> Reject
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* History */}
      {decided.length > 0 && (
        <section className="rounded-lg border p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">History</h3>
          <div className="space-y-1.5">
            {decided.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-700">
                  {TYPE_LABEL[entry.adjustment_type]} — {currency(entry.amount)} — {entry.reason}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(entry.status)}`}>
                  {entry.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
