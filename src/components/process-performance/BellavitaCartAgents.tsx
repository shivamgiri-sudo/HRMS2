import { useCallback, useEffect, useMemo, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Trophy, Search, ListFilter, Bot, MousePointerClick, Users, IndianRupee, ShoppingCart, PhoneCall, Info } from "lucide-react";
import { Spinner, KpiCard, SectionCard, DashboardExportMenu, formatINR, type ExportSlide } from "./DashboardKit";
import { BellavitaCartAgentDrawer } from "./BellavitaCartAgentDrawer";
import type { CartColumn } from "./BellavitaCartSnapshot";
import { fmtDate, fmtN, secToHms } from "./lpCallShared";

/**
 * Agent Performance for Abandoned Cart, laid out like the reference sheet:
 * Agent | Sale | APR | Allocation metrics, then revenue by MTD / week / day.
 * Definitions are in the backend's bellavita-cart-snapshot.service.ts header.
 * Every row opens a drill-down drawer.
 */

interface AgentRow {
  empId: string; name: string; doj: string | null; tenureDays: number | null; bucket: string | null;
  status: "Active" | "InActive" | "Not in APR"; tl: string;
  saleMade: number; cod: number; paid: number; rto: number; codPct: number; paidPct: number; rtoPct: number;
  rtoAmount: number; revenue: number; avgSalePerDay: number;
  attendanceDays: number; manDays: number; calls: number;
  avgLoginSec: number; avgNetLoginSec: number; avgBreakSec: number; avgTalkSec: number; avgDispoSec: number;
  acht: number; occupancyPct: number;
  allocation: number; connected: number; connectedPct: number; convPct: number;
  byPeriod: Record<string, { sales: number; revenue: number }>;
}
interface AgentsData {
  from: string; to: string; dataThrough: string | null; columns: CartColumn[]; agents: AgentRow[];
  totals: { saleMade: number; revenue: number; allocation: number; connected: number; calls: number; agentsActive: number };
  otherAgents: { count: number; allocation: number };
  autoDialer: { allocation: number; connected: number; connectedPct: number; sharePct: number };
  targetNote: string;
}

type StatusFilter = "all" | "Active" | "InActive";
const STATUS_STYLE: Record<AgentRow["status"], string> = {
  Active: "bg-emerald-100 text-emerald-700", InActive: "bg-rose-100 text-rose-700", "Not in APR": "bg-slate-100 text-slate-500",
};

const GROUPS = [
  { title: "Agent Metric", cls: "bg-[#fbe5d6] text-slate-800", span: 7 },
  { title: "Sale Metric", cls: "bg-[#c6e0b4] text-slate-800", span: 10 },
  { title: "APR Metric", cls: "bg-[#5bc0de] text-white", span: 9 },
  { title: "Allocation Metrics", cls: "bg-[#8fd6c4] text-slate-800", span: 3 },
] as const;

const TH = "whitespace-nowrap border-b border-l border-white/60 px-3 py-2 text-[11px] font-bold";
const TD = "whitespace-nowrap border-b border-l border-slate-100 px-3 py-2";

export function BellavitaCartAgents({
  apiPath, from, to,
}: { apiPath: string; from: string; to: string }) {
  const [data, setData] = useState<AgentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: AgentsData }>(`${apiPath}/agents?from=${from}&to=${to}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the agent performance.");
    } finally {
      setLoading(false);
    }
  }, [apiPath, from, to]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.agents ?? []).filter((a) =>
      (status === "all" || a.status === status) &&
      (!q || a.name.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q) || a.tl.toLowerCase().includes(q)));
  }, [data, search, status]);

  const top = useMemo(() => (data?.agents ?? []).filter((a) => a.saleMade > 0).slice(0, 3), [data]);
  const maxRevenue = Math.max(1, ...(data?.agents ?? []).map((a) => a.revenue));

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    return [{
      title: "Agent Performance",
      tables: [{
        title: "Agent-wise Abandon Cart",
        columns: [
          "Emp Id", "Agent", "DOJ", "Tenure", "Bucket", "Status", "TL", "Sale Made", "COD", "Paid", "RTO", "COD %", "Paid %",
          "RTO Amount", "Revenue", "RTO %", "Sales/day", "Answered", "Avg Login", "Avg Net Login", "Avg Break", "Avg Talk", "Avg Dispo",
          "ACHT", "Occup %", "Attendance", "Man Days", "Allocation", "Connected %", "Conv %",
        ],
        rows: data.agents.map((a) => [
          a.empId, a.name, a.doj ? fmtDate(a.doj) : "—", a.tenureDays ?? "—", a.bucket ?? "—", a.status, a.tl || "—",
          a.saleMade, a.cod, a.paid, a.rto, `${a.codPct}%`, `${a.paidPct}%`, formatINR(a.rtoAmount), formatINR(a.revenue), `${a.rtoPct}%`, a.avgSalePerDay,
          a.calls, secToHms(a.avgLoginSec), secToHms(a.avgNetLoginSec), secToHms(a.avgBreakSec), secToHms(a.avgTalkSec), secToHms(a.avgDispoSec),
          a.acht, `${a.occupancyPct}%`, a.attendanceDays, a.manDays, a.allocation, `${a.connectedPct}%`, `${a.convPct}%`,
        ]),
      }, {
        title: "Revenue by period",
        columns: ["Agent", ...data.columns.map((c) => c.label)],
        rows: data.agents.map((a) => [a.name, ...data.columns.map((c) => formatINR(a.byPeriod[c.key]?.revenue ?? 0))]),
      }],
    }];
  }, [data]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const t = data.totals;
  const ad = data.autoDialer;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardExportMenu
          reportTitle="Bellavita — Abandon Cart Agent Performance"
          fileBaseName="Bellavita_Cart_Agents"
          raw={{ dashboard: "bellavita_cart", from: data.from, to: data.to }}
          subtitle={`${fmtDate(data.from)} to ${fmtDate(data.to)}`}
          slides={exportSlides}
          activeSlideTitle="Agent Performance"
        />
        {data.dataThrough && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            Cart data through {fmtDate(data.dataThrough)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={Users} label="Active agents" value={String(t.agentsActive)} sub={`${data.agents.length} listed`} tone="indigo" />
        <KpiCard icon={ShoppingCart} label="Sales (unique orders)" value={fmtN(t.saleMade)} tone="emerald" />
        <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(t.revenue)} tone="amber" />
        <KpiCard icon={PhoneCall} label="Agent allocation" value={fmtN(t.allocation)} sub={`${t.allocation ? Math.round((t.connected / t.allocation) * 100) : 0}% connected`} tone="teal" />
      </div>

      <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-fuchsia-100 bg-fuchsia-50/50 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fuchsia-100 text-fuchsia-600"><Bot className="h-4 w-4" /></span>
        <div className="min-w-0 text-xs leading-relaxed text-slate-600">
          <p className="text-sm font-bold text-slate-700">{ad.sharePct}% of the carts went to the auto-dialer, not an agent</p>
          <p className="mt-0.5">
            The auto-dialer (VDAD) was allocated <b>{fmtN(ad.allocation)}</b> carts (<b>{ad.sharePct}%</b> of all) and connected only{" "}
            <b className="text-rose-600">{ad.connectedPct}%</b> of them, against <b className="text-emerald-600">{t.allocation ? Math.round((t.connected / t.allocation) * 100) : 0}%</b> for
            agents. It is not listed as an agent below.
            {data.otherAgents.count > 0 && <> {data.otherAgents.count} other ids touched {fmtN(data.otherAgents.allocation)} carts with no Abandon Cart login or sale and are not listed.</>}
          </p>
        </div>
      </div>

      {top.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {top.map((a, i) => (
            <button
              key={a.empId} type="button" onClick={() => setOpen(a.empId)}
              className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              <div className={`absolute inset-x-0 top-0 h-1 ${["bg-amber-400", "bg-slate-300", "bg-orange-300"][i]}`} />
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${["bg-amber-100 text-amber-700", "bg-slate-100 text-slate-600", "bg-orange-100 text-orange-700"][i]}`}>
                  <Trophy className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{a.name}</p>
                  <p className="text-[11px] text-slate-400">{fmtN(a.saleMade)} sales · {a.convPct}% conversion</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-lg font-bold text-emerald-600">{formatINR(a.revenue)}</p>
                  <p className="text-[10px] text-slate-400">revenue</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agent, id or TL..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-fuchsia-400 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Status" className="inline-flex rounded-xl bg-slate-100 p-1">
            {(["all", "Active", "InActive"] as StatusFilter[]).map((s) => (
              <button
                key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all ${status === s ? "bg-white text-fuchsia-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
            <MousePointerClick className="h-3 w-3" /> Click a row for detail
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />{rows.length} of {data.agents.length}
          </span>
        </div>
      </div>

      <SectionCard icon={Users} title="Agent-wise Abandon Cart" tone="rose"
        footnote="Times are averages per agent per day. Occupancy = (talk + dispo time) / net login time. Sales are unique orders; COD/Paid/RTO count those orders. Revenue by period is on the right.">
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="border-collapse text-center text-xs tabular-nums">
            <thead>
              <tr>
                {GROUPS.map((g) => <th key={g.title} colSpan={g.span} className={`border-b border-l border-white/60 px-3 py-2 text-sm font-bold ${g.cls}`}>{g.title}</th>)}
                <th colSpan={data.columns.length} className="border-b border-l border-white/60 bg-[#7030a0] px-3 py-2 text-sm font-bold text-white">Revenue by period</th>
              </tr>
              <tr className="bg-slate-50 text-slate-600">
                {["Emp Id", "Agent Name", "DOJ", "Tenure", "Bucket", "Status", "TL Name",
                  "Sale Made", "COD", "Paid", "RTO", "COD %", "Paid %", "RTO Amount", "Revenue", "RTO %", "Sales/day",
                  "Answered", "Avg Login", "Avg Net Login", "Avg Break", "Avg Talk", "Avg Dispo", "ACHT", "Occup %", "Att. days",
                  "Total Allocation", "Connected %", "Conv %"].map((h) => <th key={h} className={TH}>{h}</th>)}
                {data.columns.map((c) => <th key={c.key} className={`${TH} bg-[#e4d3f0] text-slate-800`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr
                  key={a.empId} role="button" tabIndex={0} aria-label={`Open ${a.name}`} onClick={() => setOpen(a.empId)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(a.empId); } }}
                  className="cursor-pointer bg-white transition-colors hover:bg-fuchsia-50/50 focus:bg-fuchsia-50/60 focus:outline-none"
                >
                  <td className={`${TD} font-medium text-slate-500`}>{a.empId}</td>
                  <td className={`${TD} text-left font-semibold text-slate-800`}>{a.name}</td>
                  <td className={TD}>{a.doj ? fmtDate(a.doj) : "—"}</td>
                  <td className={TD}>{a.tenureDays ?? "—"}</td>
                  <td className={TD}>{a.bucket ?? "—"}</td>
                  <td className={TD}><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[a.status]}`}>{a.status}</span></td>
                  <td className={TD}>{a.tl || "—"}</td>
                  <td className={`${TD} font-semibold text-slate-800`}>{fmtN(a.saleMade)}</td>
                  <td className={TD}>{a.cod}</td>
                  <td className={TD}>{a.paid}</td>
                  <td className={TD}>{a.rto}</td>
                  <td className={TD}>{a.codPct}%</td>
                  <td className={TD}>{a.paidPct}%</td>
                  <td className={TD}>{formatINR(a.rtoAmount)}</td>
                  <td className={`${TD} bg-[#f4b183]/40 font-bold text-slate-900`}>
                    <div className="flex items-center gap-2">
                      <span>{formatINR(a.revenue)}</span>
                      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-white/70 md:block"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${(a.revenue / maxRevenue) * 100}%` }} /></span>
                    </div>
                  </td>
                  <td className={TD}>{a.rtoPct}%</td>
                  <td className={TD}>{a.avgSalePerDay}</td>
                  <td className={TD}>{fmtN(a.calls)}</td>
                  <td className={TD}>{a.attendanceDays ? secToHms(a.avgLoginSec) : "—"}</td>
                  <td className={TD}>{a.attendanceDays ? secToHms(a.avgNetLoginSec) : "—"}</td>
                  <td className={TD}>{a.attendanceDays ? secToHms(a.avgBreakSec) : "—"}</td>
                  <td className={TD}>{a.attendanceDays ? secToHms(a.avgTalkSec) : "—"}</td>
                  <td className={TD}>{a.attendanceDays ? secToHms(a.avgDispoSec) : "—"}</td>
                  <td className={TD}>{a.attendanceDays ? a.acht : "—"}</td>
                  <td className={TD}>{a.attendanceDays ? `${a.occupancyPct}%` : "—"}</td>
                  <td className={TD}>{a.attendanceDays || "—"}</td>
                  <td className={`${TD} bg-[#8fd6c4]/25`}>{fmtN(a.allocation)}</td>
                  <td className={`${TD} bg-[#8fd6c4]/25`}>{a.connectedPct}%</td>
                  <td className={`${TD} bg-[#8fd6c4]/25 font-semibold`}>{a.convPct}%</td>
                  {data.columns.map((c) => (
                    <td key={c.key} className={`${TD} ${c.kind === "mtd" ? "bg-[#f4b183]/40 font-bold" : c.kind === "week" ? "bg-[#fbe5d6]/60" : "bg-[#deebf7]/60"}`}>
                      {a.byPeriod[c.key]?.revenue ? formatINR(a.byPeriod[c.key].revenue) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={29 + data.columns.length} className="py-8 text-center text-slate-400">No agents match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <p className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{data.targetNote}
      </p>

      {open && <BellavitaCartAgentDrawer apiPath={apiPath} empId={open} from={data.from} to={data.to} onClose={() => setOpen(null)} />}
    </div>
  );
}
