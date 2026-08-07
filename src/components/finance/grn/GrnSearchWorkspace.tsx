import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
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
};

const EMPTY: Filters = {
  grnNumber: "", invoiceNumber: "", head: "", subHead: "", status: "", grnType: "",
  billingCycleStatus: "", accountingPeriod: "", billDateFrom: "", billDateTo: "",
  amountFrom: "", amountTo: "", multiMonth: "",
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

          <GrnInput type="month" aria-label="Accounting period" value={draft.accountingPeriod}
            onChange={(e) => set("accountingPeriod")(e.target.value)} />
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
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`${GRN_TR} ${onOpenGrn ? "cursor-pointer" : ""}`}
                    onClick={onOpenGrn ? () => onOpenGrn(row.id) : undefined}
                  >
                    <GrnTd>
                      <span className="font-mono">{row.grn_number}</span>
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
