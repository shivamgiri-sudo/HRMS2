import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  MessageSquare, Gauge, Clock3, ShoppingBag, IndianRupee, Percent, Repeat, ShieldCheck, Info, MousePointerClick, Inbox,
} from "lucide-react";
import {
  Spinner, KpiCard, SectionCard, DashboardExportMenu, formatINR, type ExportSlide,
} from "./DashboardKit";
import { BellavitaChatPeriodDrawer, type PeriodTarget } from "./BellavitaChatPeriodDrawer";
import { TOOLTIP_PROPS, fmtDate, fmtN, fmtShortDay } from "./lpCallShared";

/**
 * Bellavita Chat "Overview": the Chat Dashboard BVO snapshot table for MTD,
 * each week and each day, with a Chat / Kenaz / Bevzilla user-type filter.
 * "Overall" is those three combined -- nothing else. Every definition
 * (including why sales are counted per unique bella_vita_order_id) is in the
 * backend's bellavita-chat-overview.service.ts header. Clicking a column
 * header opens that period's drill-down.
 */

type UserType = "Overall" | "Chat" | "Kenaz" | "Bevzilla";
const USER_TYPES: Array<{ key: UserType; label: string; hint: string }> = [
  { key: "Overall", label: "Overall", hint: "Chat + Kenaz + Bevzilla" },
  { key: "Chat", label: "Chat", hint: "user_type = Chat" },
  { key: "Kenaz", label: "Kenaz", hint: "user_type = Kenaz" },
  { key: "Bevzilla", label: "Bevzilla", hint: "user_type = Bevzilla" },
];
const CAPACITY_TYPES = ["Chat", "Kenaz", "Bevzilla"] as const;

interface Column { key: string; label: string; kind: "mtd" | "week" | "day"; from: string; to: string }
interface Values {
  plannedCapacity: number | null; overallChat: number; capacityUtilizationPct: number | null; frtPct: number;
  repeat24: number; repeat48: number; repeat72: number; repeatMore72: number; unique: number; withoutAgentFrt: number;
  saleMade: number | null; revenue: number | null; aov: number | null;
  convOverallPct: number | null; convUniquePct: number | null;
  duplicateOrderRows: number | null; duplicateRevenue: number | null;
}
interface Integrity {
  saleRows: number; uniqueOrders: number; duplicateRows: number;
  grossRevenue: number; revenue: number; duplicateRevenue: number; blankOrderIdRows: number;
}
interface OverviewData {
  from: string; to: string; userType: UserType; columns: Column[]; values: Record<string, Values>;
  daily: Array<{ date: string; overall: number; unique: number; saleMade: number | null }>;
  salesAvailable: boolean; salesNote: string | null; integrity: Integrity | null;
  capacity: { month: string; byType: Record<(typeof CAPACITY_TYPES)[number], number | null> };
  latestChatDate: string | null; dailyColumnsOmitted: boolean; canSetCapacity: boolean;
}

type Fmt = "count" | "pct0" | "pct1" | "inr";
interface MetricRow { key: keyof Values; label: string; fmt: Fmt; group?: "integrity" }
const METRICS: MetricRow[] = [
  { key: "plannedCapacity", label: "Planned Capacity", fmt: "count" },
  { key: "overallChat", label: "Overall Chat Volume", fmt: "count" },
  { key: "capacityUtilizationPct", label: "Capacity Utilization", fmt: "pct0" },
  { key: "frtPct", label: "FRT%", fmt: "pct0" },
  { key: "repeat24", label: "Repeat 24hrs Chat", fmt: "count" },
  { key: "repeat48", label: "Repeat 48hrs Chat", fmt: "count" },
  { key: "repeat72", label: "Repeat 72hrs Chat", fmt: "count" },
  { key: "repeatMore72", label: "Repeat Chat More then 72hrs", fmt: "count" },
  { key: "unique", label: "Unique Chat Volume", fmt: "count" },
  { key: "withoutAgentFrt", label: "With Out Agent FRT Chat Volume", fmt: "count" },
  { key: "saleMade", label: "Sale Made", fmt: "count" },
  { key: "revenue", label: "Revenue", fmt: "inr" },
  { key: "aov", label: "AOV", fmt: "inr" },
  { key: "convOverallPct", label: "Conversion % On Overall", fmt: "pct1" },
  { key: "convUniquePct", label: "Conversion % On Unique", fmt: "pct1" },
  { key: "duplicateOrderRows", label: "Duplicate order rows (ignored)", fmt: "count", group: "integrity" },
  { key: "duplicateRevenue", label: "Duplicate revenue (excluded)", fmt: "inr", group: "integrity" },
];

function format(v: number | null, fmt: Fmt): string {
  if (v === null || v === undefined) return "—";
  switch (fmt) {
    case "count": return fmtN(v);
    case "pct0": return `${Math.round(v)}%`;
    case "pct1": return `${Math.round(v * 10) / 10}%`;
    case "inr": return formatINR(v);
  }
}

const monthLabel = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
};

export function BellavitaChatOverview({
  apiPath, from, to, onRangeChange,
}: { apiPath: string; from: string; to: string; onRangeChange: (from: string, to: string) => void }) {
  const [userType, setUserType] = useState<UserType>("Overall");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<PeriodTarget | null>(null);
  const [capType, setCapType] = useState<(typeof CAPACITY_TYPES)[number]>("Chat");
  const [capValue, setCapValue] = useState("");
  const [capBusy, setCapBusy] = useState(false);
  const [capMsg, setCapMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: OverviewData }>(
        `${apiPath}/overview?from=${from}&to=${to}&userType=${userType}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Bellavita Chat overview.");
    } finally {
      setLoading(false);
    }
  }, [apiPath, from, to, userType]);

  useEffect(() => { void load(); }, [load]);

  async function saveCapacity() {
    if (!data) return;
    setCapBusy(true);
    setCapMsg("");
    try {
      await hrmsApi.put(`${apiPath}/planned-capacity`, { userType: capType, month: data.capacity.month, capacity: Number(capValue) });
      setCapValue("");
      setCapMsg(`Saved planned capacity for ${capType}, ${monthLabel(data.capacity.month)}.`);
      await load();
    } catch (err) {
      setCapMsg(err instanceof Error ? err.message : "Could not save the planned capacity.");
    } finally {
      setCapBusy(false);
    }
  }

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    return [{
      title: "Overview",
      tables: [{
        title: `Chat Dashboard BVO — ${data.userType}`,
        columns: ["Metric", ...data.columns.map((c) => c.label)],
        rows: METRICS.map((m) => [m.label, ...data.columns.map((c) => format(data.values[c.key]?.[m.key] as number | null, m.fmt))]),
      }],
    }];
  }, [data]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const mtd = data.values.mtd;
  const mtdLabel = data.columns[0]?.label ?? "MTD";
  const empty = mtd.overallChat === 0;
  const capMissing = data.capacity.byType[capType] === null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardExportMenu
          reportTitle={`Bellavita — Chat Dashboard BVO (${data.userType})`}
          fileBaseName={`Bellavita_Chat_${data.userType}`}
          raw={{ dashboard: "bellavita_chat_overview", from: data.from, to: data.to }}
          subtitle={`${fmtDate(data.from)} to ${fmtDate(data.to)}`}
          slides={exportSlides}
          activeSlideTitle="Overview"
        />
        <div role="tablist" aria-label="User type" className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
          {USER_TYPES.map((t) => (
            <button
              key={t.key} type="button" role="tab" aria-selected={userType === t.key} title={t.hint}
              onClick={() => setUserType(t.key)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                userType === t.key ? "bg-white text-rose-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {empty && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          <span className="inline-flex items-center gap-2"><Inbox className="h-4 w-4" />
            No chats between {fmtDate(data.from)} and {fmtDate(data.to)}
            {data.latestChatDate ? <> — the newest uploaded chat is from <strong>{fmtDate(data.latestChatDate)}</strong>.</> : "."}
          </span>
          {data.latestChatDate && (
            <button
              type="button"
              onClick={() => onRangeChange(`${data.latestChatDate!.slice(0, 7)}-01`, data.latestChatDate!)}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-amber-700"
            >
              Show that month
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={MessageSquare} label="Overall Chat Volume" value={fmtN(mtd.overallChat)} sub={data.userType === "Overall" ? "Chat + Kenaz + Bevzilla" : `user_type = ${data.userType}`} tone="rose" />
        <KpiCard icon={Repeat} label="Unique Chat Volume" value={fmtN(mtd.unique)} sub={`${mtd.overallChat ? Math.round((mtd.unique / mtd.overallChat) * 1000) / 10 : 0}% of overall`} tone="sky" />
        <KpiCard icon={Clock3} label="FRT%" value={`${Math.round(mtd.frtPct)}%`} sub="chats answered IN TAT" tone="emerald" />
        <KpiCard icon={Gauge} label="Capacity Utilization" value={format(mtd.capacityUtilizationPct, "pct0")} sub={mtd.plannedCapacity !== null ? `of ${fmtN(mtd.plannedCapacity)} planned` : "planned capacity not set"} tone="violet" />
        <KpiCard icon={ShoppingBag} label="Sale Made" value={format(mtd.saleMade, "count")} sub={data.salesAvailable ? "unique orders" : "not available"} tone="teal" />
        <KpiCard icon={IndianRupee} label="Revenue" value={format(mtd.revenue, "inr")} sub={data.salesAvailable ? "one amount per order" : "not available"} tone="amber" />
        <KpiCard icon={IndianRupee} label="AOV" value={format(mtd.aov, "inr")} sub="revenue / sale made" tone="indigo" />
        <KpiCard icon={Percent} label="Conversion %" value={`${format(mtd.convOverallPct, "pct1")}`} sub={`on unique: ${format(mtd.convUniquePct, "pct1")}`} tone="cyan" />
      </div>

      {data.integrity && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600"><ShieldCheck className="h-4 w-4" /></span>
          <div className="min-w-0 text-xs leading-relaxed text-slate-600">
            <p className="text-sm font-bold text-slate-700">Sales are counted once per bella_vita_order_id</p>
            <p className="mt-0.5">
              <b>{fmtN(data.integrity.uniqueOrders)}</b> unique orders from <b>{fmtN(data.integrity.saleRows)}</b> sale rows —{" "}
              <b className="text-rose-600">{fmtN(data.integrity.duplicateRows)}</b> duplicate rows ignored (an order repeats once per line item).
              Revenue is <b>{formatINR(data.integrity.revenue)}</b>; adding the duplicates would have shown{" "}
              <b>{formatINR(data.integrity.grossRevenue)}</b>, overstating it by <b className="text-rose-600">{formatINR(data.integrity.duplicateRevenue)}</b>.
              {data.integrity.blankOrderIdRows > 0 && <> {fmtN(data.integrity.blankOrderIdRows)} sale row(s) have no order id and can't be de-duplicated, so they are not counted.</>}
            </p>
          </div>
        </div>
      )}
      {data.salesNote && (
        <p className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{data.salesNote}
        </p>
      )}

      <SectionCard icon={MessageSquare} title={`Chat Dashboard BVO — ${data.userType}`} tone="rose"
        footnote={`Click a column heading for that period's detail. ${mtdLabel} covers ${fmtDate(data.from)} to ${fmtDate(data.to)}. Weeks are 7-day blocks from the 1st of the month. A month's planned capacity covers the whole month; a week or day gets its share by days.${data.dailyColumnsOmitted ? " Daily columns are hidden for ranges longer than 62 days." : ""}`}
      >
        <div className="overflow-x-auto rounded-xl border border-[#c9a978]/50">
          <table className="border-collapse text-center text-[13px] tabular-nums">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[260px] border-b border-[#0f1a44] bg-[#1c2a5e] px-4 py-3 text-left text-sm font-bold text-white">
                  Chat Dashboard BVO
                </th>
                {data.columns.map((c) => (
                  <th key={c.key} className="border-b border-l border-[#0f1a44] bg-[#1c2a5e] p-0 text-sm font-bold text-white">
                    <button
                      type="button" title={`Open ${c.label}`}
                      onClick={() => setDrawer({ label: c.label, from: c.from, to: c.to })}
                      className="group flex w-full min-w-[86px] items-center justify-center gap-1 px-3 py-3 transition-colors hover:bg-[#2a3b7d] focus:bg-[#2a3b7d] focus:outline-none"
                    >
                      {c.label}
                      <MousePointerClick className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70 group-focus:opacity-70" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m, idx) => {
                const firstIntegrity = m.group === "integrity" && METRICS[idx - 1]?.group !== "integrity";
                return (
                  <tr key={m.key} className={firstIntegrity ? "border-t-[3px] border-[#1c2a5e]/30" : ""}>
                    <td className="sticky left-0 z-10 border-b border-[#e7d6ad] bg-[#fff2cc] px-4 py-2.5 text-left font-medium text-slate-800">{m.label}</td>
                    {data.columns.map((c) => {
                      const v = data.values[c.key]?.[m.key] as number | null | undefined;
                      const isMtd = c.kind === "mtd";
                      return (
                        <td
                          key={c.key}
                          className={`border-b border-l border-[#e7d6ad] px-3 py-2.5 ${
                            isMtd ? "bg-[#f4b183] font-bold text-slate-900" : m.group === "integrity" ? "bg-[#fde9d9] text-slate-700" : "bg-[#f8cbad]/60 text-slate-800"
                          }`}
                        >
                          {format(v ?? null, m.fmt)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard icon={MessageSquare} title="Date-wise volume and sales" tone="indigo" footnote="Bars are overall chats; the lines are unique chats and sales made (unique orders).">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 10 }} />
            <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} />
            <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="l" dataKey="overall" name="Overall chats" fill="#fecdd3" radius={[4, 4, 0, 0]} />
            <Line yAxisId="l" type="monotone" dataKey="unique" name="Unique chats" stroke="#e11d48" strokeWidth={2.5} dot={{ r: 3 }} />
            {data.salesAvailable && <Line yAxisId="r" type="monotone" dataKey="saleMade" name="Sale made" stroke="#0ea5e9" strokeWidth={2.5} dot={{ r: 3 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </SectionCard>

      {(data.canSetCapacity || CAPACITY_TYPES.some((t) => data.capacity.byType[t] === null)) && (
        <SectionCard icon={Gauge} title={`Planned capacity — ${monthLabel(data.capacity.month)}`} tone="violet"
          footnote="Planned capacity is a business commitment, so it is entered by an admin rather than derived from data. It is stored per user type and per month; Overall uses the three added together.">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
            {CAPACITY_TYPES.map((t) => (
              <span key={t}>{t}: <b className="text-slate-800">{data.capacity.byType[t] === null ? "not set" : fmtN(data.capacity.byType[t] as number)}</b></span>
            ))}
          </div>
          {data.canSetCapacity ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={capType} onChange={(e) => setCapType(e.target.value as (typeof CAPACITY_TYPES)[number])} aria-label="User type"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none"
              >
                {CAPACITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                type="number" min={1} inputMode="numeric" value={capValue} onChange={(e) => setCapValue(e.target.value)}
                placeholder={capMissing ? "Chats for the month" : `Now ${fmtN(data.capacity.byType[capType] as number)}`}
                aria-label="Planned capacity for the month"
                className="w-44 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none"
              />
              <button
                type="button" onClick={() => void saveCapacity()} disabled={capBusy || !(Number(capValue) > 0)}
                className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {capBusy ? "Saving…" : "Save"}
              </button>
              {capMsg && <span className="text-[11px] text-slate-500">{capMsg}</span>}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-slate-400">Ask an admin to set the planned capacity for this month.</p>
          )}
        </SectionCard>
      )}

      {drawer && (
        <BellavitaChatPeriodDrawer apiPath={apiPath} target={drawer} userType={userType} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}
