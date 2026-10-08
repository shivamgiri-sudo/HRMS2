// src/components/finance/ledger/FinancialStatementsContent.tsx
//
// Balance sheet and profit and loss in the layout a chartered accountant reviews: two-sided T format,
// group subtotals with the accounts under each, brackets for negatives, Indian digit grouping, and the
// total of each side ruled off. Built from the trial balance on the server, so it moves with the ledger.
// Styling follows the HRMS design system: blue for financial data, rounded-2xl soft-shadow cards, KPI
// tiles with tone colours, 44px touch targets on phones, and nothing that relies on colour alone.
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, Landmark, Printer, RefreshCw, Scale, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";

type Line = { accountId: string; accountType: string; name: string; amount: number };
type Group = { group: string; total: number; lines: Line[] };
type Statements = {
  asOf: string | null;
  trialBalanceBalanced: boolean;
  trialBalance: { totalDebit: number; totalCredit: number; rows: number };
  balanceSheet: {
    liabilities: Group[]; assets: Group[]; profitAndLoss: number;
    totalLiabilities: number; totalAssets: number; difference: number;
  };
  profitAndLoss: { income: Group[]; expenses: Group[]; totalIncome: number; totalExpenses: number; surplus: number };
};

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Accounting style: 1,23,456.00 and (1,23,456.00) for a negative. */
function fmt(value: number): string {
  const n = Number(value ?? 0);
  if (Math.abs(n) < 0.005) return "-";
  return n < 0 ? `(${INR.format(Math.abs(n))})` : INR.format(n);
}

/** Lakh and crore wording for the headline tiles. */
function short(value: number): string {
  const n = Math.abs(Number(value ?? 0));
  const sign = value < 0 ? "-" : "";
  if (n >= 1e7) return `${sign}₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${sign}₹${(n / 1e5).toFixed(2)} L`;
  return `${sign}₹${INR.format(n)}`;
}

const amountClass = (n: number) => (n < 0 ? "text-rose-700" : "text-slate-900");

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name: string, text: string) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type Tone = "blue" | "slate" | "green" | "red" | "amber";
const TONES: Record<Tone, { bg: string; text: string; border: string }> = {
  blue: { bg: "bg-[#edf4ff]", text: "text-[#0b63e5]", border: "border-[#dce8fb]" },
  slate: { bg: "bg-[#f1f4f8]", text: "text-[#0b1f44]", border: "border-[#e3e9f2]" },
  green: { bg: "bg-[#eaf8ef]", text: "text-[#15803d]", border: "border-[#d7f0df]" },
  red: { bg: "bg-[#fff0f1]", text: "text-[#dc2626]", border: "border-[#ffdadd]" },
  amber: { bg: "bg-[#fff4e8]", text: "text-[#b45309]", border: "border-[#fee3c5]" },
};

function Tile({ label, value, helper, tone, icon: Icon }: { label: string; value: string; helper: string; tone: Tone; icon: typeof Scale }) {
  const t = TONES[tone];
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-2xl border ${t.border} bg-white p-3 shadow-[0_1px_3px_rgba(37,99,235,0.08),0_4px_12px_rgba(37,99,235,0.06)]`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${t.bg} ${t.text}`} aria-hidden>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        <div className={`truncate text-lg font-bold tabular-nums ${t.text}`}>{value}</div>
        <div className="truncate text-[11px] text-slate-500">{helper}</div>
      </div>
    </div>
  );
}

function GroupRows({ groups, open, toggle }: { groups: Group[]; open: Set<string>; toggle: (key: string) => void }) {
  return (
    <>
      {groups.map((g) => {
        const isOpen = open.has(g.group);
        return (
          <Fragment key={g.group}>
            <tr className="border-b border-slate-100 transition-colors duration-200 hover:bg-blue-50/60">
              <th scope="row" className="py-0 pr-2 text-left font-normal">
                <button
                  type="button"
                  className="flex min-h-11 w-full cursor-pointer items-center gap-1.5 rounded-md text-left font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:min-h-8 print:min-h-0 print:cursor-default"
                  onClick={() => toggle(g.group)}
                  aria-expanded={isOpen}
                  aria-label={`${g.group}, ${isOpen ? "hide" : "show"} accounts`}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 print:hidden" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 print:hidden" aria-hidden />}
                  <span className="min-w-0 break-words">{g.group}</span>
                </button>
              </th>
              <td className={`py-1.5 text-right font-mono text-sm font-semibold tabular-nums ${amountClass(g.total)}`}>{fmt(g.total)}</td>
            </tr>
            {isOpen &&
              g.lines.map((l) => (
                <tr key={`${l.accountType}:${l.accountId}`} className="border-b border-slate-50 text-slate-600">
                  <th scope="row" className="py-1 pl-7 pr-2 text-left text-[13px] font-normal"><span className="break-words">{l.name}</span></th>
                  <td className={`py-1 text-right font-mono text-[13px] tabular-nums ${l.amount < 0 ? "text-rose-700" : ""}`}>{fmt(l.amount)}</td>
                </tr>
              ))}
          </Fragment>
        );
      })}
    </>
  );
}

function Side({ title, groups, extra, total, open, toggle }: {
  title: string; groups: Group[]; extra?: { label: string; amount: number }; total: number; open: Set<string>; toggle: (k: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="border-b-2 border-slate-800 pb-1 text-xs font-bold uppercase tracking-wider text-slate-700">{title}</div>
      <table className="w-full text-sm">
        <caption className="sr-only">{title}</caption>
        <tbody>
          <GroupRows groups={groups} open={open} toggle={toggle} />
          {extra && (
            <tr className="border-b border-slate-100">
              <th scope="row" className="py-1.5 pr-2 text-left font-semibold text-slate-800">{extra.label}</th>
              <td className={`py-1.5 text-right font-mono text-sm font-semibold tabular-nums ${amountClass(extra.amount)}`}>{fmt(extra.amount)}</td>
            </tr>
          )}
          {groups.length === 0 && !extra && (
            <tr><td colSpan={2} className="py-4 text-center text-xs text-slate-500">Nothing posted</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-y-4 border-double border-slate-800">
            <th scope="row" className="py-1.5 text-left text-sm font-bold text-slate-900">Total</th>
            <td className={`py-1.5 text-right font-mono text-sm font-bold tabular-nums ${amountClass(total)}`}>{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 rounded-2xl border border-blue-100 bg-white p-4" role="status" aria-live="polite">
      <p className="text-sm text-slate-600">Building the statements from the ledger. This can take up to a minute the first time.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />)}
      </div>
      <div className="h-48 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
    </div>
  );
}

export function FinancialStatementsContent() {
  const [asOf, setAsOf] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["financial-statements", asOf],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: Statements }>(
        `/api/finance/ledger-reports/financial-statements${asOf ? `?asOfDate=${encodeURIComponent(asOf)}` : ""}`,
      );
      return res.data;
    },
    staleTime: 60_000,
  });
  const data = query.data;

  const toggle = (key: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  const allGroups = useMemo(
    () => (data ? [...data.balanceSheet.liabilities, ...data.balanceSheet.assets, ...data.profitAndLoss.income, ...data.profitAndLoss.expenses].map((g) => g.group) : []),
    [data],
  );

  const exportCsv = () => {
    if (!data) return;
    const rows: string[][] = [["Statement", "Side", "Group", "Account", "Amount"]];
    const add = (statement: string, side: string, groups: Group[]) =>
      groups.forEach((g) => g.lines.forEach((l) => rows.push([statement, side, g.group, l.name, l.amount.toFixed(2)])));
    add("Balance Sheet", "Liabilities", data.balanceSheet.liabilities);
    rows.push(["Balance Sheet", "Liabilities", "Profit and Loss A/c", "", data.balanceSheet.profitAndLoss.toFixed(2)]);
    add("Balance Sheet", "Assets", data.balanceSheet.assets);
    add("Profit and Loss", "Income", data.profitAndLoss.income);
    add("Profit and Loss", "Expenses", data.profitAndLoss.expenses);
    download(`financial-statements-${data.asOf ?? "to-date"}.csv`, rows.map((r) => r.map(csvCell).join(",")).join("\r\n"));
  };

  const asOnLabel = data?.asOf ? `as on ${new Date(`${data.asOf}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : "to date";
  const btn = "h-11 w-full cursor-pointer gap-1.5 rounded-xl transition-all duration-200 sm:h-8 sm:w-auto";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="w-full sm:w-auto">
          <Label htmlFor="fs-as-of" className="text-xs font-semibold">As on</Label>
          <Input id="fs-as-of" type="date" className="h-11 w-full rounded-xl text-sm sm:h-8 sm:w-40 sm:text-xs" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <Button type="button" variant="outline" size="sm" className={btn} onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Refresh
        </Button>
        <Button type="button" variant="outline" size="sm" className={btn} onClick={() => setOpen(new Set(open.size ? [] : allGroups))} disabled={!data}>
          {open.size ? "Collapse all" : "Expand all"}
        </Button>
        <Button type="button" variant="outline" size="sm" className={btn} onClick={exportCsv} disabled={!data}>
          <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
        </Button>
        <Button type="button" variant="outline" size="sm" className={btn} onClick={() => window.print()} disabled={!data}>
          <Printer className="h-3.5 w-3.5" aria-hidden /> Print
        </Button>
      </div>

      {query.isLoading && <Skeleton />}
      {query.isError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-700" role="alert">
          The statements could not be loaded. Use Refresh to try again.
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
            <Tile label="Total assets" value={short(data.balanceSheet.totalAssets)} helper={asOnLabel} tone="blue" icon={Landmark} />
            <Tile label="Liabilities and P&L" value={short(data.balanceSheet.totalLiabilities)} helper="Including surplus or deficit" tone="slate" icon={Scale} />
            <Tile
              label={data.profitAndLoss.surplus >= 0 ? "Net surplus" : "Net deficit"}
              value={short(data.profitAndLoss.surplus)}
              helper={`Income ${short(data.profitAndLoss.totalIncome)} · Expenses ${short(data.profitAndLoss.totalExpenses)}`}
              tone={data.profitAndLoss.surplus >= 0 ? "green" : "red"}
              icon={TrendingUp}
            />
            <Tile
              label="Books check"
              value={data.balanceSheet.difference === 0 ? "Balanced" : short(Math.abs(data.balanceSheet.difference))}
              helper={data.balanceSheet.difference === 0 ? "Assets equal liabilities" : "Assets and liabilities differ"}
              tone={data.balanceSheet.difference === 0 ? "green" : "amber"}
              icon={data.balanceSheet.difference === 0 ? CheckCircle2 : AlertTriangle}
            />
          </div>

          {data.balanceSheet.difference !== 0 && (
            <div className="flex gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                <b>Assets and liabilities differ by {fmt(Math.abs(data.balanceSheet.difference))}.</b> The ledger holds only what has been posted through HRMS. Opening balances, share capital, reserves and fixed assets are not in it, so this is the position of the posted books, not a complete balance sheet.
                {!data.trialBalanceBalanced && ` The trial balance itself does not balance (debits ${fmt(data.trialBalance.totalDebit)}, credits ${fmt(data.trialBalance.totalCredit)}).`}
              </p>
            </div>
          )}

          <Tabs defaultValue="balance-sheet">
            <TabsList className="print:hidden">
              <TabsTrigger value="balance-sheet" className="cursor-pointer">Balance Sheet</TabsTrigger>
              <TabsTrigger value="pnl" className="cursor-pointer">Profit and Loss</TabsTrigger>
            </TabsList>

            <TabsContent value="balance-sheet">
              <section className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-[0_1px_3px_rgba(37,99,235,0.08),0_4px_12px_rgba(37,99,235,0.06)] print:border-0 print:shadow-none">
                <header className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-white print:bg-none print:text-slate-900">
                  <h2 className="text-base font-semibold">Balance Sheet</h2>
                  <p className="text-xs text-blue-100 print:text-slate-600">{asOnLabel} · amounts in ₹ · posted ledger only</p>
                </header>
                <div className="flex flex-col gap-6 p-4 md:flex-row">
                  <Side
                    title="Liabilities"
                    groups={data.balanceSheet.liabilities}
                    extra={{ label: data.balanceSheet.profitAndLoss >= 0 ? "Profit and Loss A/c (surplus)" : "Profit and Loss A/c (deficit)", amount: data.balanceSheet.profitAndLoss }}
                    total={data.balanceSheet.totalLiabilities}
                    open={open}
                    toggle={toggle}
                  />
                  <Side title="Assets" groups={data.balanceSheet.assets} total={data.balanceSheet.totalAssets} open={open} toggle={toggle} />
                </div>
              </section>
            </TabsContent>

            <TabsContent value="pnl">
              <section className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-[0_1px_3px_rgba(37,99,235,0.08),0_4px_12px_rgba(37,99,235,0.06)] print:border-0 print:shadow-none">
                <header className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-white print:bg-none print:text-slate-900">
                  <h2 className="text-base font-semibold">Profit and Loss Account</h2>
                  <p className="text-xs text-blue-100 print:text-slate-600">{asOnLabel} · amounts in ₹</p>
                </header>
                <div className="p-4">
                  <div className="flex flex-col gap-6 md:flex-row">
                    <Side title="Expenses" groups={data.profitAndLoss.expenses} total={data.profitAndLoss.totalExpenses} open={open} toggle={toggle} />
                    <Side title="Income" groups={data.profitAndLoss.income} total={data.profitAndLoss.totalIncome} open={open} toggle={toggle} />
                  </div>
                  <div className="mt-4 flex justify-between border-t-2 border-slate-800 pt-2 text-sm font-bold text-slate-900">
                    <span>{data.profitAndLoss.surplus >= 0 ? "Net surplus for the period" : "Net deficit for the period"}</span>
                    <span className={`font-mono tabular-nums ${amountClass(data.profitAndLoss.surplus)}`}>{fmt(data.profitAndLoss.surplus)}</span>
                  </div>
                </div>
              </section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
