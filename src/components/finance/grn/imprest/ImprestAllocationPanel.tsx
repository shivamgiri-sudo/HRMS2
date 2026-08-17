import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, RefreshCw, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import { dateLabel, money } from "@/components/finance/grn/grn-format";
import {
  GRN_TR, GrnAlert, GrnButton, GrnCard, GrnCardHeader, GrnCellSub, GrnChip, GrnEmptyState,
  GrnFieldRow, GrnIconButton, GrnInput, GrnSelect, GrnTable, GrnTd, GrnTextarea, GrnTh,
} from "@/components/finance/grn/grn-ui";

/**
 * Imprest allocation (Requirement 6).
 *
 * An allocation puts money INTO a branch float. It is the credit side of the ledger whose debit
 * side is the imprest voucher, so the two must be read together — which is why the current
 * float balance sits at the top of the form rather than on a separate screen. Someone topping
 * up a float needs to know what is already in it.
 *
 * The manager list drives everything. A branch float belongs to an appointed Imprest Manager
 * (Req 8), effective-dated, so the picker shows only appointments live today: allocating to a
 * manager whose term ended would credit a float nobody is accountable for.
 *
 * Nothing here computes a balance. The balance is derived server-side from the ledger, and a
 * second implementation in the browser is how the two eventually disagree.
 */

type Manager = {
  id: string;
  branch_id: string;
  branch_name?: string | null;
  employee_name?: string | null;
  employee_code?: string | null;
  tally_name?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
};

type Allocation = {
  id: string;
  allocation_no: string;
  branch_name?: string | null;
  manager_name?: string | null;
  allocation_date: string;
  amount: number;
  payment_mode?: string | null;
  bank_name?: string | null;
  reference_no?: string | null;
  status: string;
  remarks?: string | null;
};

/**
 * These are the EXACT members of imprest_allocation.payment_mode's ENUM, and they must stay that
 * way. The list previously read bank_transfer / neft / cheque / demand_draft — lower case, with
 * underscores — and MySQL accepts none of them, so every allocation failed with
 * "Data truncated for column 'payment_mode' at row 1" no matter which option was chosen. Not just
 * the default: all nine values were invalid, so raising an imprest allocation was impossible.
 *
 * "demand_draft" is deliberately absent rather than renamed: the column has no Demand Draft
 * member, and inventing one here would only move the same truncation error somewhere else.
 * Use "Other" until a migration adds it.
 */
const PAYMENT_MODES = [
  "Bank Transfer", "NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash", "Adjustment", "Other",
];

const EMPTY_DRAFT = {
  imprestManagerId: "",
  allocationDate: new Date().toISOString().slice(0, 10),
  amount: "",
  paymentMode: "Bank Transfer",
  bankName: "",
  referenceNo: "",
  transactionDate: "",
  remarks: "",
};

function statusTone(status: string) {
  if (status === "disbursed") return "ok" as const;
  if (status === "rejected") return "crit" as const;
  return "warn" as const;
}

function unwrap<T>(response: unknown): T[] {
  const body = (response as any)?.data ?? response;
  const rows = body?.data ?? body?.rows ?? body;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export function ImprestAllocationPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [showForm, setShowForm] = useState(false);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);

  const managersQuery = useQuery({
    queryKey: ["imprest-managers"],
    queryFn: async () => unwrap<Manager>(await hrmsApi.get<any>("/api/finance/imprest/managers")),
  });

  const allocationsQuery = useQuery({
    queryKey: ["imprest-allocations"],
    queryFn: async () =>
      unwrap<Allocation>(await hrmsApi.get<any>("/api/finance/imprest/allocations")),
  });

  const managers = managersQuery.data ?? [];
  const allocations = allocationsQuery.data ?? [];
  const selectedManager = useMemo(
    () => managers.find((m) => m.id === draft.imprestManagerId) ?? null,
    [managers, draft.imprestManagerId],
  );

  // The float the allocation is about to credit. Server-derived, from the ledger.
  const balanceQuery = useQuery({
    queryKey: ["imprest-balance", draft.imprestManagerId],
    enabled: Boolean(draft.imprestManagerId),
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const r = await hrmsApi.get<any>(
        `/api/finance/imprest/reports/balance?imprestManagerId=${encodeURIComponent(draft.imprestManagerId)}`
          + `&from=1900-01-01&to=${today}`,
      );
      const body = (r as any)?.data ?? r;
      return (body?.data ?? body) as { closing_balance?: number } | null;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["imprest-allocations"] });
    queryClient.invalidateQueries({ queryKey: ["imprest-balance"] });
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!selectedManager) throw new Error("Choose an imprest manager");
      return hrmsApi.post<any>("/api/finance/imprest/allocations", {
        imprestManagerId: draft.imprestManagerId,
        // Taken from the manager's appointment, never typed: an allocation must credit the
        // branch the manager actually holds.
        branchId: selectedManager.branch_id,
        allocationDate: draft.allocationDate,
        amount: Number(draft.amount),
        paymentMode: draft.paymentMode,
        bankName: draft.bankName || undefined,
        referenceNo: draft.referenceNo || undefined,
        transactionDate: draft.transactionDate || undefined,
        remarks: draft.remarks || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Allocation raised", description: "It is now awaiting review." });
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      refresh();
    },
    onError: (e: Error) =>
      toast({ title: "Could not raise the allocation", description: e.message, variant: "destructive" }),
  });

  const review = useMutation({
    mutationFn: async (input: { id: string; decision: "approve" | "reject"; remarks?: string }) =>
      hrmsApi.post<any>(`/api/finance/imprest/allocations/${input.id}/review`, {
        decision: input.decision,
        remarks: input.remarks,
      }),
    onSuccess: (_d, v) => {
      toast({
        title: v.decision === "approve" ? "Allocation disbursed" : "Allocation rejected",
        description:
          v.decision === "approve" ? "The float has been credited." : undefined,
      });
      setRejecting(null);
      refresh();
    },
    onError: (e: Error) =>
      toast({ title: "Could not complete", description: e.message, variant: "destructive" }),
  });

  const amountInvalid = draft.amount !== "" && !(Number(draft.amount) > 0);

  return (
    <div className="space-y-4">
      <GrnCard>
        <GrnCardHeader
          title="Raise an allocation"
          description="Puts money into a branch float. It is credited only once the allocation is approved."
          action={
            <GrnChip active={showForm} onClick={() => setShowForm((open) => !open)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {showForm ? "Close" : "New allocation"}
            </GrnChip>
          }
        />

        {showForm && (
          <div>
            <GrnFieldRow
              label="Imprest manager"
              required
              hint={
                managers.length
                  ? "Only appointments live today are listed."
                  : "No imprest manager is appointed. Set one up in the Imprest Manager master first."
              }
            >
              <GrnSelect
                value={draft.imprestManagerId}
                onChange={(e) => setDraft((d) => ({ ...d, imprestManagerId: e.target.value }))}
              >
                <option value="">— choose —</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {(m.employee_name ?? m.tally_name ?? "Unnamed")} · {m.branch_name ?? "no branch"}
                  </option>
                ))}
              </GrnSelect>
            </GrnFieldRow>

            {selectedManager && (
              <GrnFieldRow label="Float in hand">
                <span className="font-grn-mono text-[15px] font-bold tabular-nums text-grn-ink">
                  {balanceQuery.isLoading
                    ? "…"
                    : money(balanceQuery.data?.closing_balance ?? 0)}
                </span>
                <GrnCellSub>
                  Derived from the ledger, not a stored balance.
                </GrnCellSub>
              </GrnFieldRow>
            )}

            <GrnFieldRow label="Allocation date" required>
              <GrnInput
                type="date"
                className="w-[190px]"
                value={draft.allocationDate}
                onChange={(e) => setDraft((d) => ({ ...d, allocationDate: e.target.value }))}
              />
            </GrnFieldRow>

            <GrnFieldRow
              label="Amount"
              required
              error={amountInvalid ? "Enter an amount greater than zero." : undefined}
            >
              <GrnInput
                type="number"
                min="0"
                step="0.01"
                className="w-[190px] text-right tabular-nums"
                value={draft.amount}
                onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
              />
            </GrnFieldRow>

            <GrnFieldRow label="Payment mode">
              <GrnSelect
                value={draft.paymentMode}
                onChange={(e) => setDraft((d) => ({ ...d, paymentMode: e.target.value }))}
              >
                {PAYMENT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </GrnSelect>
            </GrnFieldRow>

            <GrnFieldRow
              label="Reference / UTR"
              hint="Mode, bank and reference together must be unique — the same guard the vendor payment ledger uses to stop a transfer being recorded twice."
            >
              <div className="flex flex-wrap gap-2">
                <GrnInput
                  className="w-[190px]"
                  placeholder="Bank"
                  value={draft.bankName}
                  onChange={(e) => setDraft((d) => ({ ...d, bankName: e.target.value }))}
                />
                <GrnInput
                  className="w-[220px]"
                  placeholder="UTR / cheque no."
                  value={draft.referenceNo}
                  onChange={(e) => setDraft((d) => ({ ...d, referenceNo: e.target.value }))}
                />
                <GrnInput
                  type="date"
                  className="w-[170px]"
                  aria-label="Transaction date"
                  value={draft.transactionDate}
                  onChange={(e) => setDraft((d) => ({ ...d, transactionDate: e.target.value }))}
                />
              </div>
            </GrnFieldRow>

            <GrnFieldRow label="Remarks">
              <GrnTextarea
                rows={2}
                value={draft.remarks}
                onChange={(e) => setDraft((d) => ({ ...d, remarks: e.target.value }))}
              />
            </GrnFieldRow>

            <div className="flex items-center justify-end gap-2 border-t border-grn-line px-4 py-3">
              <GrnChip active={false} onClick={() => { setDraft(EMPTY_DRAFT); setShowForm(false); }}>
                Cancel
              </GrnChip>
              <GrnButton
                disabled={
                  create.isPending || !draft.imprestManagerId || !(Number(draft.amount) > 0)
                }
                onClick={() => create.mutate()}
              >
                Raise allocation
              </GrnButton>
            </div>
          </div>
        )}
      </GrnCard>

      <GrnCard>
        <GrnCardHeader
          title="Allocations"
          description={allocations.length ? `${allocations.length} shown` : undefined}
          action={
            <GrnIconButton aria-label="Refresh" onClick={() => allocationsQuery.refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 ${allocationsQuery.isFetching ? "animate-spin" : ""}`} />
            </GrnIconButton>
          }
        />

        {allocations.length === 0 ? (
          <GrnEmptyState
            title={allocationsQuery.isLoading ? "Loading…" : "No allocations yet"}
            description={
              allocationsQuery.isLoading
                ? undefined
                : "Allocations you raise for branches you can see will appear here."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <GrnTable>
              <thead>
                <tr>
                  <GrnTh>Allocation</GrnTh>
                  <GrnTh>Branch / Manager</GrnTh>
                  <GrnTh>Mode / Reference</GrnTh>
                  <GrnTh className="text-right">Amount</GrnTh>
                  <GrnTh>Status</GrnTh>
                  <GrnTh>Action</GrnTh>
                </tr>
              </thead>
              <tbody>
                {allocations.map((row) => (
                  <tr key={row.id} className={GRN_TR}>
                    <GrnTd>
                      <span className="font-mono">{row.allocation_no}</span>
                      <GrnCellSub>{dateLabel(row.allocation_date)}</GrnCellSub>
                    </GrnTd>
                    <GrnTd>
                      {row.branch_name ?? "—"}
                      <GrnCellSub>{row.manager_name ?? "—"}</GrnCellSub>
                    </GrnTd>
                    <GrnTd>
                      {(row.payment_mode ?? "—").replace(/_/g, " ")}
                      <GrnCellSub>{row.reference_no ?? row.bank_name ?? "—"}</GrnCellSub>
                    </GrnTd>
                    <GrnTd className="text-right tabular-nums">{money(row.amount)}</GrnTd>
                    <GrnTd>
                      <StatusStamp tone={statusTone(row.status)}>
                        {row.status.replace(/_/g, " ")}
                      </StatusStamp>
                    </GrnTd>
                    <GrnTd>
                      {row.status === "disbursed" || row.status === "rejected" ? (
                        <span className="text-[11px] text-grn-ink-soft">settled</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <GrnIconButton
                            aria-label={`Approve ${row.allocation_no}`}
                            disabled={review.isPending}
                            onClick={() => review.mutate({ id: row.id, decision: "approve" })}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </GrnIconButton>
                          <GrnIconButton
                            aria-label={`Reject ${row.allocation_no}`}
                            onClick={() => setRejecting({ id: row.id, reason: "" })}
                          >
                            <X className="h-3.5 w-3.5" />
                          </GrnIconButton>
                        </div>
                      )}
                    </GrnTd>
                  </tr>
                ))}
              </tbody>
            </GrnTable>
          </div>
        )}

        {rejecting && (
          <div className="border-t border-grn-line p-3">
            {/* A rejection reason is mandatory server-side too; asking here avoids a round trip
                that only ever returns the same message. */}
            <GrnAlert tone="warn">
              Rejecting an allocation does not credit the float. Say why — the reason is kept on
              the allocation's history.
            </GrnAlert>
            <GrnTextarea
              className="mt-2"
              rows={2}
              placeholder="Reason"
              value={rejecting.reason}
              onChange={(e) => setRejecting((r) => (r ? { ...r, reason: e.target.value } : r))}
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <GrnChip active={false} onClick={() => setRejecting(null)}>Cancel</GrnChip>
              <GrnButton
                disabled={!rejecting.reason.trim() || review.isPending}
                onClick={() =>
                  review.mutate({
                    id: rejecting.id,
                    decision: "reject",
                    remarks: rejecting.reason.trim(),
                  })
                }
              >
                Reject
              </GrnButton>
            </div>
          </div>
        )}
      </GrnCard>
    </div>
  );
}
