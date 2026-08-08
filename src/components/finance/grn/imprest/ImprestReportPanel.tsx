import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { dateLabel, money } from "@/components/finance/grn/grn-format";
import {
  GRN_TR, GrnAlert, GrnCard, GrnCardHeader, GrnCellSub, GrnChip, GrnEmptyState, GrnIconButton,
  GrnInput, GrnMetric, GrnMetricStrip, GrnSelect, GrnTable, GrnTd, GrnTh,
} from "@/components/finance/grn/grn-ui";

/**
 * Imprest report (Requirement 7).
 *
 *   Opening + Allocations + Positive adjustments
 *          − Vouchers − Returns − Negative adjustments  =  Closing
 *
 * The identity is the report. Opening is everything strictly before the window, so consecutive
 * periods chain: one period's closing IS the next one's opening, by construction rather than by
 * convention. That is what makes the report reconcilable at all, and it is why the panel shows
 * the arithmetic across the top rather than only a closing figure.
 *
 * Every number comes from the server, which derives them from the append-only ledger. Nothing
 * is recomputed here — a second implementation in the browser is how two balances diverge.
 *
 * The export hits the API rather than serialising what is on screen. The server resolves rows
 * through the same branch entitlement as the list, so an export cannot contain a row the table
 * would not show.
 */

type Manager = {
  id: string;
  branch_name?: string | null;
  employee_name?: string | null;
  tally_name?: string | null;
};

/** One row of the Imprest Details report, in the supplied workbook's own terms. */
type DetailRow = {
  serial: number;
  transaction_date: string;
  grn_number?: string | null;
  expense_head?: string | null;
  expense_sub_head?: string | null;
  inflow: number;
  outflow: number;
  balance: number;
  payment_mode?: string | null;
  cheque_no?: string | null;
  bank_name?: string | null;
  remarks?: string | null;
};

type DetailsReport = {
  opening_balance: number;
  rows: DetailRow[];
  totals: { inflow: number; outflow: number };
  closing_balance: number;
};

type Summary = {
  opening_balance: number;
  allocated: number;
  voucher_utilisation: number;
  returned: number;
  adjustments: number;
  closing_balance: number;
};

function unwrap<T>(response: unknown): T {
  const body = (response as any)?.data ?? response;
  return (body?.data ?? body) as T;
}

/** First and last day of the current month — the window a float is normally reviewed over. */
function defaultWindow() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(first), to: iso(last) };
}

export function ImprestReportPanel() {
  const [range, setRange] = useState(defaultWindow);
  const [managerId, setManagerId] = useState("");

  const managersQuery = useQuery({
    queryKey: ["imprest-managers"],
    queryFn: async () => {
      const rows = unwrap<Manager[]>(await hrmsApi.get<any>("/api/finance/imprest/managers"));
      return Array.isArray(rows) ? rows : [];
    },
  });

  const query = `from=${range.from}&to=${range.to}`
    + (managerId ? `&imprestManagerId=${encodeURIComponent(managerId)}` : "");

  const summaryQuery = useQuery({
    queryKey: ["imprest-summary", range.from, range.to, managerId],
    enabled: Boolean(range.from && range.to),
    queryFn: async () =>
      unwrap<Summary>(await hrmsApi.get<any>(`/api/finance/imprest/reports/balance?${query}`)),
  });

  const detailsQuery = useQuery({
    queryKey: ["imprest-details", range.from, range.to, managerId],
    enabled: Boolean(range.from && range.to),
    queryFn: async () =>
      unwrap<DetailsReport>(await hrmsApi.get<any>(`/api/finance/imprest/reports/details?${query}`)),
  });

  const summary = summaryQuery.data;
  const details = detailsQuery.data;
  const entries = details?.rows ?? [];
  const managers = managersQuery.data ?? [];

  const refresh = () => { summaryQuery.refetch(); detailsQuery.refetch(); };

  return (
    <div className="space-y-4">
      <GrnCard>
        <GrnCardHeader
          title="Imprest report"
          description="Opening, movements and closing for the selected window."
          action={
            <div className="flex items-center gap-1">
              <GrnChip
                active={false}
                onClick={() => {
                  // Straight to the API so the file is produced by the same scope resolution as
                  // the table — never serialised from what happens to be loaded on screen.
                  window.open(`/api/finance/imprest/reports/details/export?${query}`, "_blank", "noopener");
                }}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                Export
              </GrnChip>
              <GrnIconButton aria-label="Refresh" onClick={refresh}>
                <RefreshCw
                  className={`h-3.5 w-3.5 ${summaryQuery.isFetching || detailsQuery.isFetching ? "animate-spin" : ""}`}
                />
              </GrnIconButton>
            </div>
          }
        />

        <div className="flex flex-wrap items-end gap-2 border-b border-grn-line px-4 py-3">
          <label className="text-[11px] font-semibold text-grn-ink">
            From
            <GrnInput
              type="date"
              className="mt-1 w-[165px]"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            />
          </label>
          <label className="text-[11px] font-semibold text-grn-ink">
            To
            <GrnInput
              type="date"
              className="mt-1 w-[165px]"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </label>
          <label className="text-[11px] font-semibold text-grn-ink">
            Imprest manager
            <GrnSelect
              className="mt-1 w-[260px]"
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
            >
              <option value="">All branches I can see</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {(m.employee_name ?? m.tally_name ?? "Unnamed")} · {m.branch_name ?? "no branch"}
                </option>
              ))}
            </GrnSelect>
          </label>
        </div>

        {range.to < range.from ? (
          <div className="p-4">
            <GrnAlert tone="crit">The end date falls before the start date.</GrnAlert>
          </div>
        ) : (
          <GrnMetricStrip columns={6}>
            <GrnMetric label="Opening" value={money(summary?.opening_balance ?? 0)} />
            <GrnMetric label="Allocated" value={money(summary?.allocated ?? 0)} tone="ok" />
            <GrnMetric label="Vouchers" value={money(summary?.voucher_utilisation ?? 0)} tone="warn" />
            <GrnMetric label="Returned" value={money(summary?.returned ?? 0)} />
            <GrnMetric label="Adjustments" value={money(summary?.adjustments ?? 0)} />
            <GrnMetric
              label="Closing"
              value={money(summary?.closing_balance ?? 0)}
              tone={(summary?.closing_balance ?? 0) < 0 ? "crit" : "info"}
            />
          </GrnMetricStrip>
        )}
      </GrnCard>

      <GrnCard>
        <GrnCardHeader
          title="Imprest Details"
          description={
            entries.length
              ? `${entries.length} entries · opening ${money(details?.opening_balance ?? 0)}`
              : undefined
          }
        />
        {entries.length === 0 ? (
          <GrnEmptyState
            title={detailsQuery.isLoading ? "Loading…" : "No movement in this window"}
            description={
              detailsQuery.isLoading
                ? undefined
                : "Nothing was allocated, spent or returned between these dates."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            {/* Columns and their order are the supplied Imprest_Details workbook's, exactly.
                Finance reconciles against this shape, so it is a contract rather than a layout
                choice — see imprest-details-report.contract.test.ts. */}
            <GrnTable>
              <thead>
                <tr>
                  <GrnTh>S.No.</GrnTh>
                  <GrnTh>Date</GrnTh>
                  <GrnTh>GRN</GrnTh>
                  <GrnTh>Exp. Head</GrnTh>
                  <GrnTh>Exp. SubHead</GrnTh>
                  <GrnTh className="text-right">INFLOW</GrnTh>
                  <GrnTh className="text-right">OUTFLOW</GrnTh>
                  <GrnTh className="text-right">Balance</GrnTh>
                  <GrnTh>Mode</GrnTh>
                  <GrnTh>Chq No</GrnTh>
                  <GrnTh>Bank</GrnTh>
                  <GrnTh>Remarks</GrnTh>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={`${row.serial}-${row.grn_number ?? row.transaction_date}`} className={GRN_TR}>
                    <GrnTd className="tabular-nums">{row.serial}</GrnTd>
                    <GrnTd>{dateLabel(row.transaction_date)}</GrnTd>
                    <GrnTd><span className="font-mono">{row.grn_number ?? ""}</span></GrnTd>
                    <GrnTd>{row.expense_head ?? ""}</GrnTd>
                    <GrnTd>{row.expense_sub_head ?? ""}</GrnTd>
                    {/* Zero prints as a bare 0, as the workbook has it — not a dash and not a
                        blank, both of which would break a column someone sums. */}
                    <GrnTd className="text-right tabular-nums">
                      {row.inflow ? money(row.inflow) : "0"}
                    </GrnTd>
                    <GrnTd className="text-right tabular-nums">
                      {row.outflow ? money(row.outflow) : "0"}
                    </GrnTd>
                    <GrnTd className="text-right font-semibold tabular-nums">{money(row.balance)}</GrnTd>
                    <GrnTd>{row.payment_mode ?? ""}</GrnTd>
                    <GrnTd>{row.cheque_no ?? ""}</GrnTd>
                    <GrnTd>{row.bank_name ?? ""}</GrnTd>
                    <GrnTd>
                      <span className="line-clamp-2">{row.remarks ?? ""}</span>
                    </GrnTd>
                  </tr>
                ))}
                {/* The total row is part of the format: "Total" sits in the Exp. SubHead column
                    and Balance is deliberately blank — the total of a running balance is
                    meaningless. Closing is shown in the strip above instead. */}
                <tr className={GRN_TR}>
                  <GrnTd /><GrnTd /><GrnTd /><GrnTd />
                  <GrnTd className="font-semibold">Total</GrnTd>
                  <GrnTd className="text-right font-semibold tabular-nums">
                    {details ? money(details.totals.inflow) : "0"}
                  </GrnTd>
                  <GrnTd className="text-right font-semibold tabular-nums">
                    {details ? money(details.totals.outflow) : "0"}
                  </GrnTd>
                  <GrnTd /><GrnTd /><GrnTd /><GrnTd /><GrnTd />
                </tr>
              </tbody>
            </GrnTable>
          </div>
        )}
      </GrnCard>
    </div>
  );
}
