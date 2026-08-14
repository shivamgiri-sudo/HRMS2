import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, RefreshCw, Search, Undo2, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import {
  dateLabel,
  grnStatusTone,
  labelStatus,
  money,
} from "@/components/finance/grn/grn-format";
import {
  GRN_TR,
  GrnButton,
  GrnCard,
  GrnCardHeader,
  GrnCellSub,
  GrnEmptyState,
  GrnIconButton,
  GrnInput,
  GrnSelect,
  GrnTable,
  GrnTd,
  GrnTh,
} from "@/components/finance/grn/grn-ui";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";

/**
 * GRN Search (Requirement 14).
 *
 * Separate from the History tab, which is a status-chip view of recent activity. This answers
 * the operator's actual question — "which GRNs are this vendor's, in August, over a lakh,
 * still unpaid" — and every filter is applied server-side, on the same scoped query the list
 * endpoint already uses. Filtering in the browser would only ever narrow the page you were
 * already allowed to see, which is not the same thing.
 *
 * Deliberately no second detail page. Opening a result raises the same review sheet the
 * approval queue uses, so there is one GRN detail surface rather than two that drift.
 */

type GrnRow = {
  id: string;
  grn_number: string;
  grn_type: "vendor" | "imprest";
  invoice_number?: string | null;
  bill_date?: string | null;
  vendor_name?: string | null;
  branch_name?: string | null;
  head?: string | null;
  sub_head?: string | null;
  amount?: number | null;
  amount_with_tax?: number | null;
  status: string;
  billing_cycle_status?: "OPEN" | "BOOKED" | "CLOSED" | null;
  accounting_period?: string | null;
  is_multi_month?: number | null;
  created_by_name?: string | null;
  created_at?: string | null;
  source_type?: 'new' | 'legacy' | null;
  legacy_entry_status?: string | null;
};

type Filters = {
  grnNumber: string;
  invoiceNumber: string;
  head: string;
  subHead: string;
  status: string;
  grnType: string;
  billingCycleStatus: string;
  accountingPeriod: string;
  billDateFrom: string;
  billDateTo: string;
  amountFrom: string;
  amountTo: string;
  multiMonth: string;
  source: string;
  branchId: string;
  processId: string;
  costCentreId: string;
};

const EMPTY: Filters = {
  grnNumber: "", invoiceNumber: "", head: "", subHead: "", status: "", grnType: "",
  billingCycleStatus: "", accountingPeriod: "", billDateFrom: "", billDateTo: "",
  amountFrom: "", amountTo: "", multiMonth: "",
  source: "new", branchId: "", processId: "", costCentreId: "",
};

const STATUS_OPTIONS = [
  ["", "Any workflow status"],
  ["draft", "Draft"],
  ["submitted", "Branch Head queue"],
  ["branch_head_approved", "Finance Head queue"],
  ["pending_accounts_payment", "Accounts payment"],
  ["payment_scheduled", "Payment scheduled"],
  ["partially_paid", "Partially paid"],
  ["paid", "Paid"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"],
  ["consumption_reversed", "Consumption reversed"],
] as const;

/** UNCLASSIFIED is not a stored value — the API turns it into IS NULL, which is what every
 *  GRN raised before the column existed carries. */
const BILLING_OPTIONS = [
  ["", "Any billing status"],
  ["OPEN", "Open"],
  ["BOOKED", "Booked"],
  ["CLOSED", "Closed"],
  ["UNCLASSIFIED", "Not classified"],
] as const;

export function GrnSearchWorkspace({
  onOpenGrn,
}: {
  /** Raises the shared review sheet. Kept as a prop so this file owns no detail surface. */
  onOpenGrn?: (grnId: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refetchResults = () => queryClient.invalidateQueries({ queryKey: ["grn-search"] });

  /**
   * Requirement 9's other half. `returnGrn` had a UI and `resubmitReturnedGrn` did not, so a
   * returned GRN was stuck: Finance could send it back and the raiser had no way to send it on
   * again. The endpoint existed and was tested the whole time.
   */
  const resubmit = useMutation({
    mutationFn: async (id: string) => hrmsApi.post<any>(`/api/finance/grns/${id}/resubmit`, {}),
    onSuccess: () => {
      toast({ title: "Resubmitted", description: "It goes back through Branch Head approval." });
      refetchResults();
    },
    onError: (e: Error) => toast({ title: "Could not resubmit", description: e.message, variant: "destructive" }),
  });

  /** Requirement 4. The setter existed with no caller, so the status could be seen and never set. */
  const billingCycle = useMutation({
    mutationFn: async (input: { id: string; next: string | null }) =>
      hrmsApi.patch<any>(`/api/finance/grns/${input.id}/billing-cycle`, {
        billingCycleStatus: input.next,
      }),
    onSuccess: () => { toast({ title: "Billing status updated" }); refetchResults(); },
    onError: (e: Error) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });

  const branches = useQuery({
    queryKey: ["org-branches"],
    queryFn: async () => {
      const r = await hrmsApi.get<any>("/api/org/branches?limit=200");
      return ((r as any)?.data?.data ?? (r as any)?.data ?? []) as Array<{
        id: string; branch_name: string;
      }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const processes = useQuery({
    queryKey: ["org-processes"],
    queryFn: async () => {
      const r = await hrmsApi.get<any>("/api/org/processes?limit=200");
      return ((r as any)?.data?.data ?? (r as any)?.data ?? []) as Array<{
        id: string; process_name: string;
      }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const costCentres = useQuery({
    queryKey: ["org-cost-centres"],
    queryFn: async () => {
      const r = await hrmsApi.get<any>("/api/org/cost-centres?limit=500&active_status=1");
      return ((r as any)?.data?.data ?? (r as any)?.data ?? []) as Array<{
        id: string; cost_centre_name: string; cost_centre_code: string;
      }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);

  const activeCount = Object.values(applied).filter(Boolean).length;

  const query = useQuery({
    queryKey: ["grn-search", applied],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      for (const [key, value] of Object.entries(applied)) {
        if (value) params.set(key, value);
      }
      if (!applied.source) params.set("source", "new");
      const r = await hrmsApi.get<any>(`/api/finance/grns?${params.toString()}`);
      const body = (r as any)?.data ?? r;
      return ((body?.rows ?? body?.data ?? body ?? []) as GrnRow[]);
    },
    // Only runs once something is applied. An unfiltered search on first paint would pull the
    // widest possible result set for no reason.
    enabled: activeCount > 0,
  });

  const rows = Array.isArray(query.data) ? query.data : [];
  const set = (key: keyof Filters) => (value: string) =>
    setDraft((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-3">
      <GrnCard>
        <GrnCardHeader
          title="Search GRNs"
          description="Every filter is applied on the server, within the branches you can see"
          action={
            activeCount > 0 ? (
              <GrnIconButton
                aria-label="Clear all filters"
                onClick={() => { setDraft(EMPTY); setApplied(EMPTY); }}
              >
                <X className="h-3.5 w-3.5" />
              </GrnIconButton>
            ) : undefined
          }
        />
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <GrnInput placeholder="GRN number" value={draft.grnNumber}
            onChange={(e) => set("grnNumber")(e.target.value)} />
          <GrnInput placeholder="Invoice / bill number" value={draft.invoiceNumber}
            onChange={(e) => set("invoiceNumber")(e.target.value)} />
          <GrnInput placeholder="Head" value={draft.head}
            onChange={(e) => set("head")(e.target.value)} />
          <GrnInput placeholder="Sub-head" value={draft.subHead}
            onChange={(e) => set("subHead")(e.target.value)} />

          <GrnSelect value={draft.source} onChange={(e) => {
            const nextSource = e.target.value;
            // Process filtering only works for source="new" (backend joins g.process_id
            // directly). "legacy"/"all" go through listLegacyGrns, which links Process via
            // employees.cost_centre_id — empty on nearly every employee row, so the filter
            // silently zeroed every legacy result rather than erroring (delta-audit
            // 2026-08-14, Section K item 7, Option B approved: remove from the UI until the
            // legacy join is rebuilt). Clearing processId here, not just disabling the
            // control below, so a value picked before switching source can't linger and get
            // sent anyway.
            setDraft((f) => ({ ...f, source: nextSource, processId: nextSource === "new" ? f.processId : "" }));
          }}>
            <option value="new">New HRMS only</option>
            <option value="legacy">Legacy (db_bill) only</option>
            <option value="all">All sources</option>
          </GrnSelect>

          <GrnSelect value={draft.branchId} onChange={(e) => set("branchId")(e.target.value)}>
            <option value="">Any branch</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.branch_name}</option>
            ))}
          </GrnSelect>

          <GrnSelect
            value={draft.processId}
            disabled={draft.source !== "new"}
            title={draft.source !== "new" ? "Process filtering only works for New HRMS only — switch source to use it" : undefined}
            onChange={(e) => set("processId")(e.target.value)}
          >
            <option value="">{draft.source !== "new" ? "Process filter unavailable for this source" : "Any process"}</option>
            {(processes.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.process_name}</option>
            ))}
          </GrnSelect>

          <GrnSelect value={draft.costCentreId} onChange={(e) => set("costCentreId")(e.target.value)}>
            <option value="">Any cost centre</option>
            {(costCentres.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.cost_centre_name} ({c.cost_centre_code})</option>
            ))}
          </GrnSelect>

          <GrnSelect value={draft.status} onChange={(e) => set("status")(e.target.value)}>
            {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </GrnSelect>
          <GrnSelect value={draft.billingCycleStatus}
            onChange={(e) => set("billingCycleStatus")(e.target.value)}>
            {BILLING_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </GrnSelect>
          <GrnSelect value={draft.grnType} onChange={(e) => set("grnType")(e.target.value)}>
            <option value="">Any type</option>
            <option value="vendor">Vendor</option>
            <option value="imprest">Imprest</option>
          </GrnSelect>
          <GrnSelect value={draft.multiMonth} onChange={(e) => set("multiMonth")(e.target.value)}>
            <option value="">Multi-month: any</option>
            <option value="true">Multi-month only</option>
            <option value="false">Single month only</option>
          </GrnSelect>

          {/* Safari never implemented input[type=month] — it degrades to a bare text box with
              no picker. Styled to this module's own tokens rather than the default theme, so it
              still reads as part of the GRN surface. */}
          <MonthYearPicker
            value={draft.accountingPeriod}
            onChange={set("accountingPeriod")}
            selectClassName={"h-[34px] rounded-[8px] border border-grn-line bg-white px-[8px] text-[12.5px] text-grn-ink focus:outline-none focus:ring-2 focus:ring-grn-brand/15"}
          />
          <GrnInput type="date" aria-label="Bill date from" value={draft.billDateFrom}
            onChange={(e) => set("billDateFrom")(e.target.value)} />
          <GrnInput type="date" aria-label="Bill date to" value={draft.billDateTo}
            onChange={(e) => set("billDateTo")(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <GrnInput inputMode="decimal" placeholder="Amount from" value={draft.amountFrom}
              onChange={(e) => set("amountFrom")(e.target.value)} />
            <GrnInput inputMode="decimal" placeholder="Amount to" value={draft.amountTo}
              onChange={(e) => set("amountTo")(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-grn-line px-3 py-2">
          <span className="text-xs text-grn-ink-soft">
            {activeCount === 0 ? "No filters applied" : `${activeCount} filter${activeCount === 1 ? "" : "s"} applied`}
          </span>
          <GrnButton onClick={() => setApplied(draft)}>
            <Search className="mr-1.5 h-3.5 w-3.5" /> Search
          </GrnButton>
        </div>
      </GrnCard>

      <GrnCard>
        <GrnCardHeader
          title="Results"
          description={activeCount === 0 ? undefined : `${rows.length} GRN${rows.length === 1 ? "" : "s"}`}
          action={
            <GrnIconButton aria-label="Refresh results" onClick={() => query.refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            </GrnIconButton>
          }
        />
        {activeCount === 0 ? (
          <GrnEmptyState title="Set a filter to search" description="Results are limited to 100 at a time." />
        ) : rows.length === 0 && !query.isFetching ? (
          <GrnEmptyState title="No GRN matches those filters" description="Try widening the date or amount range." />
        ) : (
          <div className="overflow-x-auto">
            <GrnTable>
              <thead>
                <tr>
                  <GrnTh>GRN</GrnTh>
                  <GrnTh>Invoice</GrnTh>
                  <GrnTh>Vendor</GrnTh>
                  <GrnTh>Head / Sub-head</GrnTh>
                  <GrnTh className="text-right">Amount</GrnTh>
                  <GrnTh>Workflow</GrnTh>
                  <GrnTh>Billing</GrnTh>
                  <GrnTh>Action</GrnTh>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`${GRN_TR} ${onOpenGrn && !String(row.id ?? "").startsWith("leg_") ? "cursor-pointer" : ""}`}
                    onClick={
                      onOpenGrn && !String(row.id ?? "").startsWith("leg_")
                        ? () => onOpenGrn(row.id)
                        : undefined
                    }
                  >
                    <GrnTd>
                      <span className="font-mono">{row.grn_number}</span>
                      {row.source_type === "legacy" && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          Legacy
                        </span>
                      )}
                      <GrnCellSub>
                        {row.branch_name ?? "—"}
                        {row.is_multi_month ? " · multi-month" : ""}
                      </GrnCellSub>
                    </GrnTd>
                    <GrnTd>
                      {row.invoice_number ?? "—"}
                      <GrnCellSub>{dateLabel(row.bill_date)}</GrnCellSub>
                    </GrnTd>
                    <GrnTd>{row.vendor_name ?? (row.grn_type === "imprest" ? "Imprest" : "—")}</GrnTd>
                    <GrnTd>
                      {row.head ?? "—"}
                      <GrnCellSub>{row.sub_head ?? "—"}</GrnCellSub>
                    </GrnTd>
                    {/* Right-aligned and tabular so columns of money line up on the decimal. */}
                    <GrnTd className="text-right tabular-nums">
                      {money(row.amount_with_tax ?? row.amount ?? 0)}
                    </GrnTd>
                    <GrnTd>
                      <StatusStamp tone={grnStatusTone(row.status)}>
                        {labelStatus(row.status)}
                      </StatusStamp>
                    </GrnTd>
                    <GrnTd>
                      {/* NULL is shown as "Not classified" rather than blank: the column
                          postdates these rows, and a blank cell reads as missing data.
                          Neutral tone for unclassified so it does not read as a problem. */}
                      <StatusStamp
                        tone={
                          row.billing_cycle_status === "CLOSED"
                            ? "ok"
                            : row.billing_cycle_status === "OPEN"
                              ? "info"
                              : row.billing_cycle_status === "BOOKED"
                                ? "warn"
                                : "neutral"
                        }
                      >
                        {row.billing_cycle_status ?? "Not classified"}
                      </StatusStamp>
                    </GrnTd>
                    <GrnTd>
                      <div className="flex items-center gap-1">
                        {/* Requirement 9's other half. Return was reachable and resubmit was
                            not, so a returned GRN was stuck: Finance could send it back and the
                            raiser had no way to send it on again. The endpoint existed. */}
                        {String(row.status).startsWith("returned_") && (
                          <GrnIconButton
                            aria-label={`Resubmit ${row.grn_number}`}
                            disabled={resubmit.isPending}
                            onClick={() => resubmit.mutate(row.id)}
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                          </GrnIconButton>
                        )}
                        {/* Requirement 4. The setter existed with no caller, so the status was
                            displayed and could never be set. Cycles OPEN -> BOOKED -> CLOSED ->
                            unclassified, which keeps "not classified" reachable — historical
                            rows are NULL and forcing a guess would be worse than leaving them. */}
                        <GrnIconButton
                          aria-label={`Change billing status of ${row.grn_number}`}
                          disabled={billingCycle.isPending}
                          onClick={() =>
                            billingCycle.mutate({ id: row.id, next: nextBillingStatus(row.billing_cycle_status) })
                          }
                        >
                          <RefreshCcw className="h-3.5 w-3.5" />
                        </GrnIconButton>
                      </div>
                    </GrnTd>
                  </tr>
                ))}
              </tbody>
            </GrnTable>
          </div>
        )}
      </GrnCard>
    </div>
  );
}

/**
 * OPEN -> BOOKED -> CLOSED -> unclassified, then round again.
 *
 * Cycling back to null on purpose: the column postdates most rows, so they are NULL and mean
 * "nobody has classified this". Forcing a guess would be worse than leaving it, so the
 * unclassified state has to stay reachable rather than being a one-way door out of it.
 */
function nextBillingStatus(current: string | null | undefined): string | null {
  if (current === "OPEN") return "BOOKED";
  if (current === "BOOKED") return "CLOSED";
  if (current === "CLOSED") return null;
  return "OPEN";
}
