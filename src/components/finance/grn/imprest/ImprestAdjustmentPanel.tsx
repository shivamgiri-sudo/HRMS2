import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { money } from "@/components/finance/grn/grn-format";
import {
  GrnAlert, GrnButton, GrnCard, GrnCardHeader, GrnCellSub, GrnChip, GrnFieldRow,
  GrnInput, GrnSelect, GrnTextarea,
} from "@/components/finance/grn/grn-ui";

/**
 * The Imprest Adjustment screen (Requirement 5 remediation).
 *
 * A manual correcting entry against a manager's float, for exactly one situation: the float is
 * wrong for a reason with no real transaction behind it. The most common cause is a historical
 * db_bill migration gap — a top-up payment that was never matched to a manager and silently
 * dropped, while the matching spend WAS migrated and attached to whichever manager holds the
 * branch today. There is no bank transfer, no vendor, no GRN to point at, which is exactly why
 * this is a separate screen rather than a mode buried in "Raise an allocation": a real allocation
 * implies a real funded top-up, and a real voucher implies a real receipt. Neither applies here.
 *
 * Posts entryType "adjustment" (imprest-ledger.service.ts), which the Report tab already
 * reserves its own line for (opening + allocated − vouchers − returns +/− adjustments =
 * closing), so a correction is always visibly labelled as one, never mistaken for a top-up.
 *
 * Same write roles as an allocation (Finance Head, Super Admin — Owner ruling 2026-08-17): this
 * moves the float exactly like an allocation does.
 */

type Manager = {
  id: string;
  branch_id: string;
  branch_name?: string | null;
  employee_name?: string | null;
  tally_name?: string | null;
};

const EMPTY_DRAFT = {
  imprestManagerId: "",
  direction: "credit" as "credit" | "debit",
  amount: "",
  transactionDate: new Date().toISOString().slice(0, 10),
  reason: "",
};

function unwrap<T>(response: unknown): T[] {
  const body = (response as any)?.data ?? response;
  const rows = body?.data ?? body?.rows ?? body;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export function ImprestAdjustmentPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const managersQuery = useQuery({
    queryKey: ["imprest-managers"],
    queryFn: async () => unwrap<Manager>(await hrmsApi.get<any>("/api/finance/imprest/managers")),
  });
  const managers = managersQuery.data ?? [];
  const selectedManager = useMemo(
    () => managers.find((m) => m.id === draft.imprestManagerId) ?? null,
    [managers, draft.imprestManagerId],
  );

  // The float this adjustment is about to move. Same server-derived read the allocation panel
  // uses — never computed here, so it cannot drift from what the report shows.
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

  const reasonTooShort = draft.reason.trim().length > 0 && draft.reason.trim().length < 10;
  const amountInvalid = draft.amount !== "" && !(Number(draft.amount) > 0);
  const canSubmit =
    Boolean(draft.imprestManagerId)
    && Number(draft.amount) > 0
    && draft.reason.trim().length >= 10;

  const post = useMutation({
    mutationFn: async () => {
      if (!selectedManager) throw new Error("Choose an imprest manager");
      return hrmsApi.post<any>(`/api/finance/imprest/managers/${selectedManager.id}/adjustment`, {
        direction: draft.direction,
        amount: Number(draft.amount),
        transactionDate: draft.transactionDate,
        reason: draft.reason.trim(),
      });
    },
    onSuccess: (response) => {
      const data = (response as any)?.data ?? response;
      toast({
        title: "Adjustment posted",
        description: `New balance: ${money(data?.balanceAfter ?? 0)}`,
      });
      setDraft(EMPTY_DRAFT);
      queryClient.invalidateQueries({ queryKey: ["imprest-balance"] });
    },
    onError: (e: Error) =>
      toast({ title: "Could not post the adjustment", description: e.message, variant: "destructive" }),
  });

  return (
    <GrnCard>
      <GrnCardHeader
        title="Imprest adjustment"
        description="A manual correcting entry — not a top-up, not a voucher."
      />

      <div className="px-4 pt-3">
        <GrnAlert tone="warn">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              Use this only when a float is wrong because of a data issue — most commonly a
              historical top-up payment that was never recorded against this manager. It is not
              a bank-funded top-up (use Allocation) and not a receipted spend (use a GRN
              voucher). There is no invoice or bank reference behind this entry, so the reason
              you give is the entire record of why it exists — it will be visible on this
              manager&apos;s ledger and history forever.
            </div>
          </div>
        </GrnAlert>
      </div>

      <div>
        <GrnFieldRow
          label="Imprest manager"
          required
          hint={
            managers.length
              ? "Only appointments live today are listed."
              : "No imprest manager is appointed. Set one up in the Managers tab first."
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
              {balanceQuery.isLoading ? "…" : money(balanceQuery.data?.closing_balance ?? 0)}
            </span>
            <GrnCellSub>Derived from the ledger, not a stored balance.</GrnCellSub>
          </GrnFieldRow>
        )}

        <GrnFieldRow label="Direction" required>
          <div className="flex gap-2">
            <GrnChip
              active={draft.direction === "credit"}
              onClick={() => setDraft((d) => ({ ...d, direction: "credit" }))}
            >
              Credit — add money to the float
            </GrnChip>
            <GrnChip
              active={draft.direction === "debit"}
              onClick={() => setDraft((d) => ({ ...d, direction: "debit" }))}
            >
              Debit — remove money from the float
            </GrnChip>
          </div>
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

        <GrnFieldRow label="Transaction date" required>
          <GrnInput
            type="date"
            className="w-[190px]"
            value={draft.transactionDate}
            onChange={(e) => setDraft((d) => ({ ...d, transactionDate: e.target.value }))}
          />
        </GrnFieldRow>

        <GrnFieldRow
          label="Reason"
          required
          hint="At least 10 characters. This is what a reviewer sees months from now when they ask why this manager's float doesn't match documented allocations."
          error={reasonTooShort ? "A few more words — this is the only record of why." : undefined}
        >
          <GrnTextarea
            rows={3}
            placeholder="e.g. db_bill migration: top-up payment dated 12-Mar-2026 (₹50,000, NEFT) was never matched to a manager during the historical import and was silently dropped. Verified against db_bill imprest_allotment_master row #4821."
            value={draft.reason}
            onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
          />
        </GrnFieldRow>

        <div className="flex items-center justify-end gap-2 border-t border-grn-line px-4 py-3">
          <GrnButton disabled={!canSubmit || post.isPending} onClick={() => post.mutate()}>
            Post adjustment
          </GrnButton>
        </div>
      </div>
    </GrnCard>
  );
}
