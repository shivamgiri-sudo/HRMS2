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

type LedgerEntry = {
  id: string;
  transaction_date: string;
  branch_name?: string | null;
  entry_type: string;
  direction: "credit" | "debit";
  amount: number;
  narration?: string | null;
  reference_type?: string | null;
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

  const ledgerQuery = useQuery({
    queryKey: ["imprest-ledger", range.from, range.to, managerId],
    enabled: Boolean(range.from && range.to),
    queryFn: async () => {
      const rows = unwrap<LedgerEntry[]>(await hrmsApi.get<any>(`/api/finance/imprest/ledger?${query}`));
      return Array.isArray(rows) ? rows : [];
    },
  });

  const summary = summaryQuery.data;
  const entries = ledgerQuery.data ?? [];
  const managers = managersQuery.data ?? [];

  // Running balance, opened at the period's opening figure so the last row equals closing.
  let running = summary?.opening_balance ?? 0;

  const refresh = () => { summaryQuery.refetch(); ledgerQuery.refetch(); };

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
                  window.open(`/api/finance/imprest/ledger/export?${query}`, "_blank", "noopener");
                }}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                Export
              </GrnChip>
              <GrnIconButton aria-label="Refresh" onClick={refresh}>
                <RefreshCw
                  className={`h-3.5 w-3.5 ${summaryQuery.isFetching || ledgerQuery.isFetching ? "animate-spin" : ""}`}
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
          title="Ledger"
          description={entries.length ? `${entries.length} entries` : undefined}
        />
        {entries.length === 0 ? (
          <GrnEmptyState
            title={ledgerQuery.isLoading ? "Loading…" : "No movement in this window"}
            description={
              ledgerQuery.isLoading
                ? undefined
                : "Nothing was allocated, spent or returned between these dates."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <GrnTable>
              <thead>
                <tr>
                  <GrnTh>Date</GrnTh>
                  <GrnTh>Branch</GrnTh>
                  <GrnTh>Entry</GrnTh>
                  <GrnTh>Narration</GrnTh>
                  <GrnTh className="text-right">Debit</GrnTh>
                  <GrnTh className="text-right">Credit</GrnTh>
                  <GrnTh className="text-right">Balance</GrnTh>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const debit = entry.direction === "debit" ? Number(entry.amount ?? 0) : 0;
                  const credit = entry.direction === "credit" ? Number(entry.amount ?? 0) : 0;
                  running = Math.round((running + credit - debit) * 100) / 100;
                  return (
                    <tr key={entry.id} className={GRN_TR}>
                      <GrnTd>{dateLabel(entry.transaction_date)}</GrnTd>
                      <GrnTd>{entry.branch_name ?? "—"}</GrnTd>
                      <GrnTd>
                        {entry.entry_type.replace(/_/g, " ")}
                        <GrnCellSub>{(entry.reference_type ?? "").replace(/_/g, " ")}</GrnCellSub>
                      </GrnTd>
                      <GrnTd>
                        <span className="line-clamp-2">{entry.narration ?? "—"}</span>
                      </GrnTd>
                      <GrnTd className="text-right tabular-nums">{debit ? money(debit) : "—"}</GrnTd>
                      <GrnTd className="text-right tabular-nums">{credit ? money(credit) : "—"}</GrnTd>
                      <GrnTd className="text-right font-semibold tabular-nums">{money(running)}</GrnTd>
                    </tr>
                  );
                })}
              </tbody>
            </GrnTable>
          </div>
        )}
      </GrnCard>
    </div>
  );
}
