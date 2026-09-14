import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Wallet, TrendingDown, TrendingUp, ReceiptText, FileText } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { money, dateLabel, grnStatusTone, labelStatus } from "@/components/finance/grn/grn-format";
import {
  GRN_TR,
  GrnCard,
  GrnCardHeader,
  GrnCellSub,
  GrnChip,
  GrnEmptyState,
  GrnIconButton,
  GrnInput,
  GrnMetric,
  GrnMetricStrip,
  GrnTable,
  GrnTd,
  GrnTh,
} from "@/components/finance/grn/grn-ui";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import { GrnDetailDrawer } from "@/components/finance/grn/GrnDetailDrawer";

// ── Types ─────────────────────────────────────────────────────────────────────

type MyRecord = {
  id: string;
  branch_id: string;
  branch_name: string | null;
  employee_name: string | null;
  tally_name: string | null;
  effective_from: string;
  effective_to: string | null;
  current_balance: number;
};

type Allocation = {
  id: string;
  allocation_no: string;
  allocation_date: string;
  amount: number;
  payment_mode: string | null;
  bank_name: string | null;
  reference_no: string | null;
  remarks: string | null;
  status: string;
  disbursed_at: string | null;
};

type VoucherRow = {
  id: string;
  grn_number: string;
  bill_date: string | null;
  head: string | null;
  sub_head: string | null;
  description: string | null;
  amount: number | null;
  amount_with_tax: number | null;
  status: string;
  cost_centre_name: string | null;
  created_at: string | null;
};

type PeriodSummary = {
  opening_balance: number;
  allocated: number;
  voucher_utilisation: number;
  returned: number;
  adjustments: number;
  closing_balance: number;
};

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
  reference_id?: string | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function allocationStatusTone(status: string) {
  if (status === "disbursed") return "ok" as const;
  if (status === "rejected") return "crit" as const;
  if (status === "submitted" || status === "branch_head_approved") return "info" as const;
  return "info" as const;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ImprestHolderDashboard() {
  const { toast } = useToast();
  const [detailGrnId, setDetailGrnId] = useState<string | null>(null);
  const [statFrom, setStatFrom] = useState(firstOfMonth());
  const [statTo, setStatTo] = useState(today());
  const [activeTab, setActiveTab] = useState<"statement" | "allocations" | "vouchers">("statement");

  // Resolve the current user's manager record + live balance
  const myQuery = useQuery({
    queryKey: ["imprest-my"],
    queryFn: async (): Promise<MyRecord | MyRecord[] | null> => {
      const res = await hrmsApi.get<any>("/api/finance/imprest/my");
      return res?.data ?? null;
    },
  });

  const myRecord: MyRecord | null = Array.isArray(myQuery.data)
    ? myQuery.data[0] ?? null
    : (myQuery.data as MyRecord | null);

  // Period summary for the stat strip
  const summaryQuery = useQuery({
    queryKey: ["imprest-my-period-summary", myRecord?.id, statFrom, statTo],
    queryFn: async (): Promise<PeriodSummary> => {
      const params = new URLSearchParams({
        imprestManagerId: myRecord!.id,
        from: statFrom,
        to: statTo,
      });
      const res = await hrmsApi.get<any>(`/api/finance/imprest/reports/balance?${params}`);
      return res?.data ?? res ?? {};
    },
    enabled: Boolean(myRecord?.id),
  });

  // All allocations (topups) for this holder
  const allocationsQuery = useQuery({
    queryKey: ["imprest-my-allocations", myRecord?.id],
    queryFn: async (): Promise<Allocation[]> => {
      const res = await hrmsApi.get<any>(
        `/api/finance/imprest/allocations?imprestManagerId=${myRecord!.id}&limit=200`
      );
      return (res?.data ?? res ?? []) as Allocation[];
    },
    enabled: Boolean(myRecord?.id),
  });

  // All vouchers (imprest GRNs) for this holder
  const vouchersQuery = useQuery({
    queryKey: ["imprest-my-vouchers", myRecord?.id],
    queryFn: async (): Promise<VoucherRow[]> => {
      const res = await hrmsApi.get<any>(
        `/api/finance/grns?grnType=imprest&imprestManagerId=${myRecord!.id}&limit=500`
      );
      return ((res?.data ?? res?.rows ?? res ?? []) as VoucherRow[]);
    },
    enabled: Boolean(myRecord?.id),
  });

  // Full running statement
  const statementQuery = useQuery({
    queryKey: ["imprest-my-statement", myRecord?.id, statFrom, statTo],
    queryFn: async (): Promise<{ rows: DetailRow[]; opening_balance: number; closing_balance: number }> => {
      const params = new URLSearchParams({
        imprestManagerId: myRecord!.id,
        from: statFrom,
        to: statTo,
      });
      const res = await hrmsApi.get<any>(`/api/finance/imprest/reports/details?${params}`);
      return res?.data ?? res ?? { rows: [], opening_balance: 0, closing_balance: 0 };
    },
    enabled: Boolean(myRecord?.id) && activeTab === "statement",
  });

  // ── Loading / not-a-holder states ──

  if (myQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-grn-ink-soft" />
      </div>
    );
  }

  if (!myRecord) {
    return (
      <GrnCard>
        <GrnEmptyState
          icon={<Wallet className="h-9 w-9" />}
          title="No active float assigned"
          description="You are not currently appointed as an imprest float holder for any branch."
        />
      </GrnCard>
    );
  }

  const summary = summaryQuery.data;
  const balance = myRecord.current_balance;
  const allocations = allocationsQuery.data ?? [];
  const vouchers = vouchersQuery.data ?? [];
  const statement = statementQuery.data;

  return (
    <>
      <GrnDetailDrawer
        grnId={detailGrnId}
        onClose={() => setDetailGrnId(null)}
      />

      <GrnCard>
        <GrnCardHeader
          title="My Float Account"
          description={`${myRecord.branch_name ?? "Branch"} — ${myRecord.tally_name ?? "Imprest Float"} · Active since ${dateLabel(myRecord.effective_from)}`}
        />

        {/* ── Live balance banner ── */}
        <div className="border-b border-grn-line-soft bg-grn-card px-5 py-4">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-grn-ink-soft">
                Current Balance
              </p>
              <p className="mt-0.5 text-[28px] font-bold tracking-[-0.02em] text-grn-brand">
                {money(balance, 2)}
              </p>
            </div>
            {/* Period filters for the summary strip */}
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-grn-ink-soft">Period:</span>
              <GrnInput
                type="date"
                className="h-7 w-[130px] text-xs"
                value={statFrom}
                onChange={(e) => setStatFrom(e.target.value)}
              />
              <span className="text-grn-ink-soft">to</span>
              <GrnInput
                type="date"
                className="h-7 w-[130px] text-xs"
                value={statTo}
                onChange={(e) => setStatTo(e.target.value)}
              />
            </div>
          </div>

          {/* Period summary strip */}
          {summaryQuery.isLoading ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-grn-ink-soft">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading period summary…
            </div>
          ) : summary ? (
            <GrnMetricStrip className="mt-3 !border-0 !p-0">
              <GrnMetric label="Opening" value={money(summary.opening_balance, 0)} />
              <GrnMetric label="Received (Topups)" value={money(summary.allocated, 0)} tone="ok" />
              <GrnMetric label="Spent (Vouchers)" value={money(summary.voucher_utilisation, 0)} tone="crit" />
              {summary.returned !== 0 && (
                <GrnMetric label="Returned" value={money(summary.returned, 0)} />
              )}
              {summary.adjustments !== 0 && (
                <GrnMetric label="Adjustments" value={money(summary.adjustments, 0)} />
              )}
              <GrnMetric label="Closing" value={money(summary.closing_balance, 0)} tone="ok" />
            </GrnMetricStrip>
          ) : null}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1.5 border-b border-grn-line-soft px-5 py-3">
          <GrnChip active={activeTab === "statement"} onClick={() => setActiveTab("statement")}>
            Statement
          </GrnChip>
          <GrnChip active={activeTab === "allocations"} onClick={() => setActiveTab("allocations")}>
            Topups Received
            {allocations.length > 0 && (
              <span className="ml-1 rounded-full bg-grn-brand/10 px-1.5 font-bold text-grn-brand">
                {allocations.length}
              </span>
            )}
          </GrnChip>
          <GrnChip active={activeTab === "vouchers"} onClick={() => setActiveTab("vouchers")}>
            Expenses / Vouchers
            {vouchers.length > 0 && (
              <span className="ml-1 rounded-full bg-grn-brand/10 px-1.5 font-bold text-grn-brand">
                {vouchers.length}
              </span>
            )}
          </GrnChip>
        </div>

        {/* ── Statement tab ── */}
        {activeTab === "statement" && (
          <>
            <div className="flex items-center justify-between px-5 py-2">
              <span className="text-xs text-grn-ink-soft">
                Running balance from {statFrom} to {statTo}
              </span>
              <GrnIconButton
                onClick={() => void statementQuery.refetch()}
                title="Refresh"
                aria-label="Refresh statement"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${statementQuery.isFetching ? "animate-spin" : ""}`} />
              </GrnIconButton>
            </div>
            {statementQuery.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-grn-ink-soft" />
              </div>
            ) : !statement?.rows?.length ? (
              <GrnEmptyState
                icon={<ReceiptText className="h-9 w-9" />}
                title="No transactions in this period"
                description="Change the date range above to see earlier activity."
              />
            ) : (
              <GrnTable minWidth={820}>
                <thead>
                  <tr>
                    <GrnTh sticky={false}>#</GrnTh>
                    <GrnTh sticky={false}>Date</GrnTh>
                    <GrnTh sticky={false}>GRN / Ref</GrnTh>
                    <GrnTh sticky={false}>Expense Head</GrnTh>
                    <GrnTh sticky={false} align="right">Inflow (₹)</GrnTh>
                    <GrnTh sticky={false} align="right">Outflow (₹)</GrnTh>
                    <GrnTh sticky={false} align="right">Balance (₹)</GrnTh>
                    <GrnTh sticky={false}>Mode / Bank</GrnTh>
                    <GrnTh sticky={false}>Remarks</GrnTh>
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((row) => (
                    <tr
                      key={row.serial}
                      className={`${GRN_TR} ${row.grn_number ? "cursor-pointer" : ""}`}
                      onClick={() => {
                        if (row.reference_id) setDetailGrnId(row.reference_id);
                      }}
                    >
                      <GrnTd>
                        <span className="text-[11px] text-grn-ink-soft">{row.serial}</span>
                      </GrnTd>
                      <GrnTd>{dateLabel(row.transaction_date)}</GrnTd>
                      <GrnTd>
                        {row.grn_number ? (
                          <span className="font-grn-mono font-semibold text-grn-brand">
                            {row.grn_number}
                          </span>
                        ) : (
                          <span className="text-grn-ink-soft">—</span>
                        )}
                      </GrnTd>
                      <GrnTd>
                        <span>{row.expense_head ?? "—"}</span>
                        {row.expense_sub_head && (
                          <GrnCellSub>{row.expense_sub_head}</GrnCellSub>
                        )}
                      </GrnTd>
                      <GrnTd align="right">
                        {row.inflow > 0 ? (
                          <span className="font-semibold text-green-700">{money(row.inflow, 0)}</span>
                        ) : (
                          <span className="text-grn-ink-soft">—</span>
                        )}
                      </GrnTd>
                      <GrnTd align="right">
                        {row.outflow > 0 ? (
                          <span className="font-semibold text-red-600">{money(row.outflow, 0)}</span>
                        ) : (
                          <span className="text-grn-ink-soft">—</span>
                        )}
                      </GrnTd>
                      <GrnTd align="right">
                        <span className={`font-bold ${row.balance < 0 ? "text-red-600" : "text-grn-ink"}`}>
                          {money(row.balance, 0)}
                        </span>
                      </GrnTd>
                      <GrnTd>
                        <span>{row.payment_mode ?? "—"}</span>
                        {row.bank_name && <GrnCellSub>{row.bank_name}</GrnCellSub>}
                        {row.cheque_no && <GrnCellSub>Chq: {row.cheque_no}</GrnCellSub>}
                      </GrnTd>
                      <GrnTd>
                        <span className="max-w-[140px] truncate" title={row.remarks ?? ""}>
                          {row.remarks ?? "—"}
                        </span>
                      </GrnTd>
                    </tr>
                  ))}
                </tbody>
              </GrnTable>
            )}
          </>
        )}

        {/* ── Allocations / Topups tab ── */}
        {activeTab === "allocations" && (
          <>
            <div className="flex items-center justify-between px-5 py-2">
              <span className="text-xs text-grn-ink-soft">All imprest topups credited to your float</span>
              <GrnIconButton
                onClick={() => void allocationsQuery.refetch()}
                title="Refresh"
                aria-label="Refresh allocations"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${allocationsQuery.isFetching ? "animate-spin" : ""}`} />
              </GrnIconButton>
            </div>
            {allocationsQuery.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-grn-ink-soft" />
              </div>
            ) : !allocations.length ? (
              <GrnEmptyState
                icon={<TrendingUp className="h-9 w-9" />}
                title="No topups received yet"
              />
            ) : (
              <GrnTable minWidth={760}>
                <thead>
                  <tr>
                    <GrnTh sticky={false}>Allocation #</GrnTh>
                    <GrnTh sticky={false}>Date</GrnTh>
                    <GrnTh sticky={false} align="right">Amount</GrnTh>
                    <GrnTh sticky={false}>Payment Mode</GrnTh>
                    <GrnTh sticky={false}>Bank / Ref</GrnTh>
                    <GrnTh sticky={false}>Status</GrnTh>
                    <GrnTh sticky={false}>Remarks</GrnTh>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((alloc) => (
                    <tr key={alloc.id} className={GRN_TR}>
                      <GrnTd>
                        <span className="font-grn-mono font-bold text-grn-brand">
                          {alloc.allocation_no}
                        </span>
                      </GrnTd>
                      <GrnTd>{dateLabel(alloc.allocation_date)}</GrnTd>
                      <GrnTd align="right">
                        <span className="font-semibold text-green-700">{money(alloc.amount, 0)}</span>
                      </GrnTd>
                      <GrnTd>{alloc.payment_mode ?? "—"}</GrnTd>
                      <GrnTd>
                        <span>{alloc.bank_name ?? "—"}</span>
                        {alloc.reference_no && (
                          <GrnCellSub>Ref: {alloc.reference_no}</GrnCellSub>
                        )}
                      </GrnTd>
                      <GrnTd>
                        <StatusStamp tone={allocationStatusTone(alloc.status)}>
                          {alloc.status.replace(/_/g, " ")}
                        </StatusStamp>
                        {alloc.disbursed_at && (
                          <GrnCellSub>Credited {dateLabel(alloc.disbursed_at)}</GrnCellSub>
                        )}
                      </GrnTd>
                      <GrnTd>
                        <span className="max-w-[160px] truncate" title={alloc.remarks ?? ""}>
                          {alloc.remarks ?? "—"}
                        </span>
                      </GrnTd>
                    </tr>
                  ))}
                </tbody>
              </GrnTable>
            )}
          </>
        )}

        {/* ── Vouchers / Expenses tab ── */}
        {activeTab === "vouchers" && (
          <>
            <div className="flex items-center justify-between px-5 py-2">
              <span className="text-xs text-grn-ink-soft">
                All expense vouchers raised against your float — click a row for full details
              </span>
              <GrnIconButton
                onClick={() => void vouchersQuery.refetch()}
                title="Refresh"
                aria-label="Refresh vouchers"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${vouchersQuery.isFetching ? "animate-spin" : ""}`} />
              </GrnIconButton>
            </div>
            {vouchersQuery.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-grn-ink-soft" />
              </div>
            ) : !vouchers.length ? (
              <GrnEmptyState
                icon={<TrendingDown className="h-9 w-9" />}
                title="No expense vouchers raised yet"
              />
            ) : (
              <GrnTable minWidth={900}>
                <thead>
                  <tr>
                    <GrnTh sticky={false}>GRN #</GrnTh>
                    <GrnTh sticky={false}>Bill Date</GrnTh>
                    <GrnTh sticky={false}>Expense Head</GrnTh>
                    <GrnTh sticky={false}>Description</GrnTh>
                    <GrnTh sticky={false}>Cost Centre</GrnTh>
                    <GrnTh sticky={false} align="right">Amount</GrnTh>
                    <GrnTh sticky={false}>Status</GrnTh>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v) => (
                    <tr
                      key={v.id}
                      className={`${GRN_TR} cursor-pointer`}
                      onClick={() => setDetailGrnId(v.id)}
                    >
                      <GrnTd>
                        <span className="font-grn-mono font-bold text-grn-brand">{v.grn_number}</span>
                      </GrnTd>
                      <GrnTd>{dateLabel(v.bill_date)}</GrnTd>
                      <GrnTd>
                        <span>{v.head ?? "—"}</span>
                        {v.sub_head && <GrnCellSub>{v.sub_head}</GrnCellSub>}
                      </GrnTd>
                      <GrnTd>
                        <span
                          className="max-w-[180px] truncate block"
                          title={v.description ?? ""}
                        >
                          {v.description ?? "—"}
                        </span>
                      </GrnTd>
                      <GrnTd>{v.cost_centre_name ?? "—"}</GrnTd>
                      <GrnTd align="right">
                        <span className="font-semibold">
                          {money(v.amount_with_tax ?? v.amount, 0)}
                        </span>
                      </GrnTd>
                      <GrnTd>
                        <StatusStamp tone={grnStatusTone(v.status)}>
                          {labelStatus(v.status)}
                        </StatusStamp>
                      </GrnTd>
                    </tr>
                  ))}
                </tbody>
              </GrnTable>
            )}
          </>
        )}
      </GrnCard>
    </>
  );
}
