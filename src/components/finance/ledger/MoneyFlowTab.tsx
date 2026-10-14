// src/components/finance/ledger/MoneyFlowTab.tsx
/**
 * Ledger Analytics "Money Flow" — MAS Callnet client money from provision to bank, beside vendor
 * payables. Every figure opens the rows behind it (MoneyFlowRowsSheet), whose total equals the figure.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDownCircle, ArrowUpCircle, ChevronRight, ClipboardList, FileText, Landmark, Loader2, RotateCcw, Wallet,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { ComponentType } from "react";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { money, moneyCompact } from "@/components/finance/client-billing/shared";
import { getMoneyFlow, getMoneyFlowOptions, type AgeBucket, type DrillKey, type MoneyFlowFilters } from "@/lib/moneyFlowApi";
import { MoneyFlowRowsSheet } from "./MoneyFlowRowsSheet";

const AGE_LABEL: Record<AgeBucket, string> = {
  not_due: "Not due", d0_30: "1–30 days", d31_60: "31–60", d61_90: "61–90", d90_plus: "90+ days",
};

function currentFy(d = new Date()): string {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
const fyOptions = () => {
  const start = Number(currentFy().slice(0, 4));
  return [0, 1, 2].map((i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, "0")}`);
};

const ageingConfig = {
  receivable: { label: "Clients owe us", color: "#2563eb" },
  payable: { label: "We owe vendors", color: "#f59e0b" },
} satisfies ChartConfig;
const weeklyConfig = {
  recorded: { label: "Received", color: "#6366f1" },
  banked: { label: "In bank", color: "#10b981" },
} satisfies ChartConfig;

type Tone = "blue" | "indigo" | "emerald" | "rose" | "amber" | "slate";
const TONE: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-700", indigo: "bg-indigo-50 text-indigo-700", emerald: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-700", amber: "bg-amber-50 text-amber-700", slate: "bg-slate-100 text-slate-700",
};

function Kpi({ label, value, sub, tone, icon: Icon, onClick }: {
  label: string; value: number; sub: string; tone: Tone; icon: ComponentType<{ className?: string }>; onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={money(value)}
      className={`group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors duration-200 ${onClick ? "cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${TONE[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-2 text-xl font-bold tabular-nums text-slate-900">{moneyCompact(value)}</div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-600">
        {sub}
        {onClick && <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
    </Tag>
  );
}

export function MoneyFlowTab() {
  const [filters, setFilters] = useState<MoneyFlowFilters>({ financeYear: currentFy() });
  const [drill, setDrill] = useState<{ key: DrillKey; title: string } | null>(null);
  const open = (key: DrillKey, title: string) => setDrill({ key, title });

  const summary = useQuery({ queryKey: ["money-flow", filters], queryFn: () => getMoneyFlow(filters) });
  const options = useQuery({ queryKey: ["money-flow-options", filters.financeYear], queryFn: () => getMoneyFlowOptions(filters) });
  const s = summary.data;

  const ageing = useMemo(() => (s ? s.receivablesAgeing.map((r, i) => ({
    key: r.key, bucket: AGE_LABEL[r.key], receivable: r.amount, payable: s.payablesAgeing[i]?.amount ?? 0,
  })) : []), [s]);
  const maxFunnel = Math.max(1, ...(s?.funnel.map((f) => f.amount) ?? [1]));

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-slate-600">Finance year</span>
          <Select value={filters.financeYear} onValueChange={(v) => setFilters({ ...filters, financeYear: v })}>
            <SelectTrigger className="w-32 cursor-pointer"><SelectValue /></SelectTrigger>
            <SelectContent>{fyOptions().map((fy) => <SelectItem key={fy} value={fy}>{fy}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-slate-600">Branch</span>
          <Select value={filters.branchId ?? "all"} onValueChange={(v) => setFilters({ ...filters, branchId: v === "all" ? undefined : v })}>
            <SelectTrigger className="w-48 cursor-pointer"><SelectValue placeholder="All branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {options.data?.branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <div className="min-w-[240px] flex-1 space-y-1 sm:max-w-sm">
          <span className="block text-xs font-medium text-slate-600">Client</span>
          <SearchableSelect
            options={[{ value: "", label: "All clients" }, ...(options.data?.clients ?? []).map((c) => ({ value: c, label: c }))]}
            value={filters.client ?? ""}
            onChange={(v) => setFilters({ ...filters, client: v || undefined })}
            placeholder="All clients"
            loading={options.isLoading}
          />
        </div>
        {(filters.branchId || filters.client) && (
          <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setFilters({ financeYear: filters.financeYear })}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        )}
        <p className="ml-auto text-xs text-slate-500">MAS Callnet India Pvt Ltd · as of {s?.asOf ?? "…"}</p>
      </div>

      {summary.isError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Could not load Money Flow: {(summary.error as Error).message}
        </div>
      )}

      {summary.isLoading || !s ? (
        <div className="flex h-40 items-center justify-center gap-2 text-sm text-slate-600">
          {summary.isLoading && <Loader2 className="h-4 w-4 animate-spin" />} {summary.isLoading ? "Loading money flow…" : null}
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Expected" value={s.kpis.expected.amount} sub={`${s.kpis.expected.count} provisions not billed`} tone="slate" icon={ClipboardList} onClick={() => open("provision", "Approved provision not billed yet")} />
            <Kpi label="Billed" value={s.kpis.billed.amount} sub={`${s.kpis.billed.count} bills in ${s.financeYear}`} tone="blue" icon={FileText} onClick={() => open("billed", `Bills raised in ${s.financeYear}`)} />
            <Kpi label="Received" value={s.kpis.received.amount} sub={`+ TDS ${moneyCompact(s.kpis.received.tds)}`} tone="indigo" icon={ArrowDownCircle} onClick={() => open("received", "Bills with money received")} />
            <Kpi label="Outstanding" value={s.kpis.outstanding.amount} sub={`${s.kpis.outstanding.count} bills open`} tone="amber" icon={Wallet} onClick={() => open("outstanding", "Outstanding bills")} />
            <Kpi label="Overdue" value={s.kpis.overdue.amount} sub={`${s.kpis.overdue.count} past due date`} tone="rose" icon={AlertTriangle} onClick={() => open("overdue", "Overdue bills")} />
            <Kpi label="In bank this month" value={s.kpis.bankedThisMonth.amount} sub={`${moneyCompact(s.kpis.awaitingBank)} awaiting bank`} tone="emerald" icon={Landmark} />
            <Kpi label="Payables due" value={s.kpis.payables.amount} sub={`${s.kpis.payables.count} vendor GRNs`} tone="amber" icon={ArrowUpCircle} onClick={() => open("payables", "Vendor payables due")} />
          </div>

          {/* Funnel */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">From provision to cash</h3>
            <p className="text-xs text-slate-600">Each stage holds the money still sitting there; click a stage for its rows.</p>
            <ol className="mt-4 space-y-2">
              {s.funnel.map((f, i) => (
                <li key={f.key}>
                  <button
                    type="button"
                    onClick={() => open(f.key, f.label)}
                    className="group grid w-full cursor-pointer grid-cols-[1.5rem_minmax(9rem,13rem)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">{i + 1}</span>
                    <span className="truncate text-sm text-slate-800">{f.label}</span>
                    <span className="h-3 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className={`block h-full rounded-full ${f.key === "paid" ? "bg-emerald-500" : i < 3 ? "bg-slate-400" : "bg-blue-500"}`}
                        style={{ width: `${Math.max(f.amount > 0 ? 1.5 : 0, (f.amount / maxFunnel) * 100)}%` }}
                      />
                    </span>
                    <span className="whitespace-nowrap text-right text-sm tabular-nums">
                      <span className="font-semibold text-slate-900">{money(f.amount)}</span>
                      <span className="ml-2 text-xs text-slate-500">{f.count}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Ageing */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Ageing — receivables vs payables</h3>
              <p className="text-xs text-slate-600">Days past due date. Click a bar for the bills.</p>
              <ChartContainer config={ageingConfig} className="mt-3 h-[260px] w-full">
                <BarChart data={ageing} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="bucket" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={(v) => moneyCompact(v)} width={80} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => `${ageingConfig[n as keyof typeof ageingConfig]?.label ?? n}: ${money(Number(v))}`} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="receivable" fill="var(--color-receivable)" radius={[4, 4, 0, 0]} className="cursor-pointer"
                    onClick={(d: { payload?: { key: AgeBucket; bucket: string } }) => d.payload && open(d.payload.key, `Outstanding — ${d.payload.bucket}`)} />
                  <Bar dataKey="payable" fill="var(--color-payable)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </section>

            {/* Weekly incoming */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Money in by week</h3>
              <p className="text-xs text-slate-600">Receipts recorded in HRMS vs released to bank, last 12 weeks.</p>
              {s.weeklyIncoming.length ? (
                <ChartContainer config={weeklyConfig} className="mt-3 h-[260px] w-full">
                  <BarChart data={s.weeklyIncoming} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="weekStart" tickLine={false} axisLine={false} fontSize={11}
                      tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} />
                    <YAxis tickFormatter={(v) => moneyCompact(v)} width={80} fontSize={11} />
                    <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => `${weeklyConfig[n as keyof typeof weeklyConfig]?.label ?? n}: ${money(Number(v))}`} />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="recorded" fill="var(--color-recorded)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="banked" fill="var(--color-banked)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="mt-10 text-center text-sm text-slate-600">No receipts recorded in the last 12 weeks.</p>
              )}
            </section>
          </div>

          {/* Top clients */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="px-5 pt-5">
              <h3 className="text-sm font-semibold text-slate-900">Top clients by outstanding</h3>
              <p className="text-xs text-slate-600">Click a client to filter the whole page to it.</p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-xs text-slate-600">
                    <th className="px-5 py-2 text-left font-semibold">Client</th>
                    <th className="px-3 py-2 text-right font-semibold">Open bills</th>
                    <th className="px-3 py-2 text-right font-semibold">Outstanding</th>
                    <th className="px-5 py-2 text-right font-semibold">Of which overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {s.topClients.length === 0 && (
                    <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-600">Nothing outstanding.</td></tr>
                  )}
                  {s.topClients.map((c) => (
                    <tr key={c.client} className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50"
                      onClick={() => setFilters({ ...filters, client: c.client })}>
                      <td className="px-5 py-2 font-medium text-slate-900">{c.client}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.bills}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(c.outstanding)}</td>
                      <td className={`px-5 py-2 text-right tabular-nums ${c.overdue > 0 ? "font-semibold text-rose-700" : "text-slate-500"}`}>{money(c.overdue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {s.settlementSources.clientPayments > 0 && (
            <p className="text-xs text-slate-500">
              {s.settlementSources.clientPayments} bill{s.settlementSources.clientPayments === 1 ? "" : "s"} take their paid figures from the
              Client Payments screen / I-Spark (marked “CP” in the rows) until their collections are recorded as HRMS receipts.
            </p>
          )}
        </>
      )}

      <MoneyFlowRowsSheet drill={drill} filters={filters} onClose={() => setDrill(null)} />
    </div>
  );
}
