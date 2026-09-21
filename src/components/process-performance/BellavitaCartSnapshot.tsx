import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  ShoppingCart, PhoneCall, IndianRupee, Percent, Users, ShieldCheck, Info, MousePointerClick, Inbox,
} from "lucide-react";
import { Spinner, KpiCard, SectionCard, DashboardExportMenu, formatINR, type ExportSlide } from "./DashboardKit";
import { TOOLTIP_PROPS, fmtDate, fmtN, fmtShortDay } from "./lpCallShared";

/**
 * Bellavita Abandoned Cart snapshot: the Overview / Sale / Revenue metrics for
 * MTD, each week and each day, laid out like the reference sheet. Every
 * definition (and how it was checked against the sheet) is in the backend's
 * bellavita-cart-snapshot.service.ts header. Clicking a period heading opens
 * that period in the Agent Performance tab.
 */

export interface CartColumn { key: string; label: string; kind: "mtd" | "week" | "day"; from: string; to: string }
interface Values {
  overallBase: number; workableCases: number; dndCases: number;
  uniqueAttempted: number; uniqueConnected: number; uniqueConnectedPct: number;
  sameDayUniqueAttempt: number; sameDayUniqueConnect: number; sameDayUniqueConnectPct: number;
  ncConnect: number; cpa: number | null; revenue: number; saleCount: number;
  convBasePct: number; convUniqueConnectPct: number;
  target: number | null; overallRevenueBau: number; achievementPct: number | null; aov: number;
  codOrders: number; paidOrders: number; rtoOrders: number; rtoRevenue: number;
  duplicateCartRows: number; duplicateOrderRows: number; duplicateRevenue: number;
}
interface Integrity {
  saleRows: number; uniqueOrders: number; duplicateRows: number; grossRevenue: number; revenue: number;
  duplicateRevenue: number; blankOrderIdRows: number; cartRows: number; uniqueCarts: number; duplicateCartRows: number;
}
interface SnapshotData {
  from: string; to: string; dataThrough: string | null; columns: CartColumn[]; values: Record<string, Values>;
  integrity: Integrity; targetNote: string; dailyColumnsOmitted: boolean;
  daily: Array<{ date: string; base: number; connected: number; saleCount: number; revenue: number }>;
}

type Fmt = "count" | "pct0" | "pct2" | "inr";
interface Row { key: keyof Values; label: string; fmt: Fmt }
interface Section { title: string; head: string; label: string; rows: Row[] }

/** Colors follow the reference sheet: green Overview, blue Sale Metrics, dark-green Revenue Metrics. */
const SECTIONS: Section[] = [
  {
    title: "Overview", head: "bg-[#c6e0b4] text-slate-800", label: "bg-[#f8cbad]",
    rows: [
      { key: "overallBase", label: "Overall Base count", fmt: "count" },
      { key: "workableCases", label: "Workable Cases", fmt: "count" },
      { key: "dndCases", label: "DND Cases", fmt: "count" },
      { key: "uniqueAttempted", label: "Overall Unique attempted", fmt: "count" },
      { key: "uniqueConnected", label: "Overall unique connected", fmt: "count" },
      { key: "uniqueConnectedPct", label: "Overall Unique connected %", fmt: "pct0" },
      { key: "sameDayUniqueAttempt", label: "Same Day UniqueAttempt", fmt: "count" },
      { key: "sameDayUniqueConnect", label: "Same Day Unique Connect", fmt: "count" },
      { key: "sameDayUniqueConnectPct", label: "Same Day Unique Connect %", fmt: "pct0" },
      { key: "ncConnect", label: "NC Connect", fmt: "count" },
      { key: "cpa", label: "CPA", fmt: "count" },
    ],
  },
  {
    title: "Sale Metrics", head: "bg-[#0070c0] text-white", label: "bg-[#92d050]",
    rows: [
      { key: "revenue", label: "REVENUE", fmt: "inr" },
      { key: "saleCount", label: "Sale Count", fmt: "count" },
    ],
  },
  {
    title: "Conversion", head: "bg-[#00b050] text-white", label: "bg-[#00d05a]",
    rows: [
      { key: "convBasePct", label: "Conversion on Base", fmt: "pct2" },
      { key: "convUniqueConnectPct", label: "Conversion On Unique connect", fmt: "pct2" },
    ],
  },
  {
    title: "Revenue Metrics", head: "bg-[#0e4b1f] text-white", label: "bg-[#c6e0b4]",
    rows: [
      { key: "target", label: "Target", fmt: "count" },
      { key: "overallRevenueBau", label: "Overall Revenue_BAU", fmt: "inr" },
      { key: "achievementPct", label: "Achievement %", fmt: "pct0" },
      { key: "aov", label: "AOV", fmt: "inr" },
    ],
  },
  {
    title: "Orders and data checks", head: "bg-slate-700 text-white", label: "bg-slate-100",
    rows: [
      { key: "codOrders", label: "COD orders", fmt: "count" },
      { key: "paidOrders", label: "Paid orders", fmt: "count" },
      { key: "rtoOrders", label: "RTO orders", fmt: "count" },
      { key: "rtoRevenue", label: "RTO revenue", fmt: "inr" },
      { key: "duplicateCartRows", label: "Duplicate cart rows (ignored)", fmt: "count" },
      { key: "duplicateOrderRows", label: "Duplicate order rows (ignored)", fmt: "count" },
      { key: "duplicateRevenue", label: "Duplicate revenue (excluded)", fmt: "inr" },
    ],
  },
];

function format(v: number | null | undefined, fmt: Fmt): string {
  if (v === null || v === undefined) return "—";
  switch (fmt) {
    case "count": return fmtN(Math.round(v));
    case "pct0": return `${Math.round(v)}%`;
    case "pct2": return `${Math.round(v * 100) / 100}%`;
    case "inr": return formatINR(v);
  }
}

export function BellavitaCartSnapshot({
  apiPath, from, to, onOpenPeriod,
}: { apiPath: string; from: string; to: string; onOpenPeriod: (from: string, to: string) => void }) {
  const [data, setData] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: SnapshotData }>(`${apiPath}/snapshot?from=${from}&to=${to}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Abandoned Cart snapshot.");
    } finally {
      setLoading(false);
    }
  }, [apiPath, from, to]);
  useEffect(() => { void load(); }, [load]);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    return [{
      title: "Snapshot",
      tables: SECTIONS.map((s) => ({
        title: s.title,
        columns: [s.title, ...data.columns.map((c) => c.label)],
        rows: s.rows.map((r) => [r.label, ...data.columns.map((c) => format(data.values[c.key]?.[r.key] as number | null, r.fmt))]),
      })),
    }];
  }, [data]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const m = data.values.mtd;
  const empty = !m || m.overallBase === 0;
  const ig = data.integrity;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardExportMenu
          reportTitle="Bellavita — Abandon Cart Snapshot"
          fileBaseName="Bellavita_Cart_Snapshot"
          raw={{ dashboard: "bellavita_cart", from: data.from, to: data.to }}
          subtitle={`${fmtDate(data.from)} to ${fmtDate(data.to)}`}
          slides={exportSlides}
          activeSlideTitle="Snapshot"
        />
        {data.dataThrough && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            Cart data through {fmtDate(data.dataThrough)}
          </span>
        )}
      </div>

      {empty && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          <Inbox className="h-4 w-4" /> No abandoned-cart records between {fmtDate(data.from)} and {fmtDate(data.to)}.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <KpiCard icon={ShoppingCart} label="Overall Base" value={fmtN(m.overallBase)} sub="unique carts" tone="rose" />
        <KpiCard icon={PhoneCall} label="Unique Connected" value={fmtN(m.uniqueConnected)} sub={`${Math.round(m.uniqueConnectedPct)}% of attempted`} tone="teal" />
        <KpiCard icon={Percent} label="Same Day Connect" value={`${Math.round(m.sameDayUniqueConnectPct)}%`} sub={`${fmtN(m.sameDayUniqueConnect)} carts`} tone="sky" />
        <KpiCard icon={Users} label="CPA" value={m.cpa === null ? "—" : fmtN(m.cpa)} sub="cases per agent" tone="indigo" />
        <KpiCard icon={ShoppingCart} label="Sale Count" value={fmtN(m.saleCount)} sub="unique orders" tone="emerald" />
        <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(m.revenue)} sub={`AOV ${formatINR(m.aov)}`} tone="amber" />
        <KpiCard icon={Percent} label="Conversion" value={format(m.convBasePct, "pct2")} sub={`on unique connect ${format(m.convUniqueConnectPct, "pct2")}`} tone="violet" />
      </div>

      <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600"><ShieldCheck className="h-4 w-4" /></span>
        <div className="min-w-0 text-xs leading-relaxed text-slate-600">
          <p className="text-sm font-bold text-slate-700">Carts and orders are each counted once</p>
          <p className="mt-0.5">
            <b>{fmtN(ig.uniqueCarts)}</b> unique carts from <b>{fmtN(ig.cartRows)}</b> cart rows
            ({fmtN(ig.duplicateCartRows)} duplicate rows ignored). <b>{fmtN(ig.uniqueOrders)}</b> unique orders from{" "}
            <b>{fmtN(ig.saleRows)}</b> sale rows — <b className="text-rose-600">{fmtN(ig.duplicateRows)}</b> duplicate rows ignored.
            Revenue is <b>{formatINR(ig.revenue)}</b>; adding the duplicate rows would have shown <b>{formatINR(ig.grossRevenue)}</b>.
          </p>
        </div>
      </div>
      <p className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{data.targetNote}
      </p>

      <SectionCard
        icon={ShoppingCart} title="Abandon Cart snapshot" tone="rose"
        footnote={`Click a period heading to see its agents. Weeks are 7-day blocks from the 1st of the month.${data.dailyColumnsOmitted ? " Daily columns are hidden for ranges longer than 62 days." : ""}`}
      >
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="border-collapse text-center text-[13px] tabular-nums">
            {SECTIONS.map((sec) => (
              <tbody key={sec.title}>
                <tr>
                  <th className={`sticky left-0 z-10 min-w-[230px] border-b border-white/60 px-4 py-2.5 text-left text-sm font-bold ${sec.head}`}>{sec.title}</th>
                  {data.columns.map((c) => (
                    <th key={c.key} className={`border-b border-l border-white/60 p-0 text-sm font-bold ${sec.head}`}>
                      <button
                        type="button" title={`Agents for ${c.label}`} onClick={() => onOpenPeriod(c.from, c.to)}
                        className="group flex w-full min-w-[78px] items-center justify-center gap-1 px-3 py-2.5 transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                      >
                        {c.label}
                        <MousePointerClick className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
                      </button>
                    </th>
                  ))}
                </tr>
                {sec.rows.map((r) => (
                  <tr key={r.key}>
                    <td className={`sticky left-0 z-10 border-b border-white/70 px-4 py-2.5 text-left font-medium text-slate-800 ${sec.label}`}>{r.label}</td>
                    {data.columns.map((c) => {
                      const v = data.values[c.key]?.[r.key] as number | null | undefined;
                      const kind = c.kind;
                      return (
                        <td
                          key={c.key}
                          className={`border-b border-l border-white/70 px-3 py-2.5 ${
                            kind === "mtd" ? "bg-[#f4b183] font-bold text-slate-900" : kind === "week" ? "bg-[#fbe5d6] text-slate-800" : "bg-[#deebf7] text-slate-800"
                          }`}
                        >
                          {format(v ?? null, r.fmt)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr aria-hidden="true"><td colSpan={data.columns.length + 1} className="h-2 bg-white" /></tr>
              </tbody>
            ))}
          </table>
        </div>
      </SectionCard>

      <SectionCard icon={ShoppingCart} title="Date-wise carts, connects and sales" tone="indigo" footnote="Bars are unique carts; lines are unique connected carts and sales (unique orders).">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 10 }} />
            <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
            <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="l" dataKey="base" name="Unique carts" fill="#fbcfe8" radius={[4, 4, 0, 0]} />
            <Line yAxisId="l" type="monotone" dataKey="connected" name="Unique connected" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line yAxisId="r" type="monotone" dataKey="saleCount" name="Sale count" stroke="#e11d48" strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  );
}
