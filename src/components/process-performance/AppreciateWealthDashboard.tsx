import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, PhoneCall, PhoneIncoming, PhoneOutgoing, Clock3, Users, IndianRupee, Percent, ShieldCheck, AlertTriangle, Layers,
  CalendarClock, Database, Gauge, Handshake, Info, Timer, Target,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu, currentMonthRange, type ExportSlide, type ExportTable,
} from "./DashboardKit";
import { PALETTE, TOOLTIP_PROPS, fmtDate, fmtN, fmtShortDay } from "./lpCallShared";
import { AppreciateWealthDrawer, type DrawerTarget } from "./AppreciateWealthDrawer";
import {
  ALL, DEFAULT_FILTERS, DataTable, Note, fmtCell, fmtHrs, fmtInr, fmtNum, fmtPct, fmtSecs, fmtStamp, hms,
  type Col, type DashboardData, type Filters, type Grid,
} from "./AppreciateWealthShared";

/**
 * Appreciate Wealth (company key appreciate_health) dashboards. Every number
 * comes from backend/.../appreciate-wealth-dashboard.service.ts -- its header
 * documents every definition, the de-duplication rules and the metrics that
 * are deliberately NOT shown. Read-only.
 */

type TabKey = "overview" | "datewise" | "billing" | "mandate" | "inbound" | "dialer" | "sales" | "agents" | "health";
const TABS: Array<{ key: TabKey; label: string; slide: string }> = [
  { key: "overview", label: "Overview", slide: "Overview" },
  { key: "datewise", label: "Date-wise", slide: "Overview" },
  { key: "billing", label: "Billing", slide: "Billing" },
  { key: "mandate", label: "Mandate", slide: "Mandate" },
  { key: "inbound", label: "Inbound", slide: "Inbound" },
  { key: "dialer", label: "Outbound Dialer", slide: "Outbound Dialer" },
  { key: "sales", label: "Outbound Sales", slide: "Outbound Sales" },
  { key: "agents", label: "Agent-wise", slide: "Agent-wise" },
  { key: "health", label: "Data Health", slide: "Data Health" },
];
const SLIDES = ["Overview", "Billing", "Mandate", "Inbound", "Outbound Dialer", "Outbound Sales", "Agent-wise", "Data Health"];
const SEG_COLORS: Record<string, string> = { Inbound: PALETTE.blue, Outbound: PALETTE.emerald, VKYC: PALETTE.violet };
const AXIS = { fontSize: 10 };

/* ----------------------------- export builders ---------------------------- */

const UNIT: Record<string, string> = { pct: " [%]", hrs: " [h]", secs: " [s]" };
function gridToTable(grid: Grid, columns: DashboardData["columns"]): ExportTable {
  const timed = grid.rows.length > 0 && grid.rows[0].values.length === columns.length;
  return {
    title: grid.title,
    columns: ["Metric", ...(timed ? columns.map((c) => c.label) : ["Value"])],
    rows: grid.rows.map((r) => {
      const unit = UNIT[r.fmt] && !/\[|\(s\)|%/.test(r.label) ? UNIT[r.fmt] : "";
      return [`${r.label}${unit}`, ...r.values.map((v) => (v === null ? 0 : v))];
    }),
  };
}

/* ------------------------------- small UI --------------------------------- */

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 min-w-[130px] rounded-lg border-slate-200 bg-white text-xs shadow-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.filter((o) => o !== ALL).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

const ChartCard = ({ title, icon, footnote, children }: { title: string; icon: typeof Layers; footnote?: string; children: ReactNode }) => (
  <SectionCard icon={icon} title={title} footnote={footnote}>{children}</SectionCard>
);

function Bar100({ pct, color = "#0ea5e9" }: { pct: number | null; color?: string }) {
  const v = pct ?? 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, v))}%`, backgroundColor: color }} /></div>
      <span>{pct === null ? "—" : fmtPct(pct)}</span>
    </div>
  );
}

const hourLbl = (h: number): string => `${String(h).padStart(2, "0")}:00`;

/* ------------------------------ period grids ------------------------------ */

function GridTable({ grid, columns, onColumn, onRow }: {
  grid: Grid; columns: DashboardData["columns"]; onColumn: (c: DashboardData["columns"][number]) => void; onRow: (label: string) => void;
}) {
  const timed = grid.rows.length > 0 && grid.rows[0].values.length === columns.length;
  const cols = timed ? columns : [{ key: "total", label: "Value", kind: "total" as const, from: "", to: "" }];
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="border-collapse text-center text-[13px] tabular-nums">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[260px] border-b border-slate-700 bg-slate-800 px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-white">Metric</th>
            {cols.map((c) => (
              <th key={c.key} className={`border-b border-l border-slate-700 p-0 text-xs font-bold text-white ${c.kind === "day" ? "bg-cyan-800" : c.kind === "week" ? "bg-indigo-800" : "bg-slate-800"}`}>
                {timed ? (
                  <button type="button" title={`Open ${c.label}`} onClick={() => onColumn(c)} className="w-full min-w-[78px] px-3 py-2.5 hover:bg-white/10 focus:bg-white/10 focus:outline-none">{c.label}</button>
                ) : <span className="block px-3 py-2.5">{c.label}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.label} onClick={() => onRow(r.label)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onRow(r.label); }}
              className={`cursor-pointer hover:bg-sky-50/70 focus:bg-sky-50/70 focus:outline-none ${r.bold ? "font-bold" : ""}`}>
              <td className="sticky left-0 z-10 border-b border-slate-100 bg-amber-50 px-4 py-2 text-left text-slate-800">{r.label}</td>
              {r.values.map((v, i) => (
                <td key={cols[i]?.key ?? i} className={`border-b border-l border-slate-100 px-3 py-2 ${cols[i]?.kind === "total" ? "bg-orange-100 font-bold text-slate-900" : cols[i]?.kind === "week" ? "bg-indigo-50/60" : "bg-sky-50/50"}`}>{fmtCell(v, r.fmt)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------- main ----------------------------------- */

export function AppreciateWealthDashboard() {
  const initial = useMemo(() => currentMonthRange(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [tab, setTab] = useState<TabKey>("overview");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [slide, setSlide] = useState("Overview");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const qs = new URLSearchParams({ from, to, ...filters });
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(`/api/process-performance/appreciate-wealth/dashboard?${qs.toString()}`);
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the Appreciate Wealth dashboard.");
    } finally { setLoading(false); }
  }, [from, to, filters]);
  useEffect(() => { void load(); }, [load]);

  const setF = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const o = data.overview.kpis, b = data.billing.kpis, i = data.inbound.kpis, d = data.dialer.kpis, s = data.sales.kpis;
    const kpis: Record<string, Array<{ label: string; value: string }>> = {
      Overview: [
        { label: "Agent-days", value: fmtNum(o.agentDays) }, { label: "Calls", value: fmtNum(o.calls) }, { label: "Connect %", value: fmtPct(o.connectPct) },
        { label: "Net login hours", value: fmtHrs(o.netLoginHrs) }, { label: "Late-login %", value: fmtPct(o.latePct) }, { label: "Inbound answer %", value: fmtPct(o.inboundAnswerPct) },
        { label: "Dialer connect %", value: fmtPct(o.dialerConnectPct) }, { label: "Total sales (Rs)", value: fmtInr(o.salesTotal) }, { label: "Contract value (Rs)", value: fmtInr(o.contractValue) },
      ],
      Billing: [{ label: "Agent-days", value: fmtNum(b.agentDays) }, { label: "Calls", value: fmtNum(b.calls) }, { label: "Connect %", value: fmtPct(b.connectPct) }, { label: "ACHT", value: fmtSecs(b.acht) }, { label: "Net occupancy", value: fmtPct(b.netOccupancyPct) }, { label: "Late-login %", value: fmtPct(b.latePct) }],
      Mandate: [{ label: "Mandate (FTE)", value: fmtNum(data.mandate.totals.mandate) }, { label: "Contract value (Rs)", value: fmtInr(data.mandate.totals.contractValue) }, { label: "Delivered net hours", value: fmtHrs(data.mandate.totals.deliveredHrs) }],
      Inbound: [{ label: "Calls", value: fmtNum(i.calls) }, { label: "Answered", value: fmtNum(i.answered) }, { label: "Answer %", value: fmtPct(i.answerPct) }, { label: "Inbound-type offered", value: fmtNum(i.inboundOffered) }],
      "Outbound Dialer": [{ label: "Legs", value: fmtNum(d.legs) }, { label: "Answered", value: fmtNum(d.answered) }, { label: "Connect %", value: fmtPct(d.connectPct) }],
      "Outbound Sales": [{ label: "LRS (Rs)", value: fmtInr(s.lrsA) }, { label: "Trade (Rs)", value: fmtInr(s.trA) }, { label: "MF (Rs)", value: fmtInr(s.mfA) }, { label: "Total (Rs)", value: fmtInr(s.total) }],
      "Agent-wise": [{ label: "Agents", value: fmtNum(data.agents.rows.length) }],
      "Data Health": [{ label: "Duplicate rows ignored", value: fmtNum(data.health.duplicates.reduce((a, x) => a + x.dropped, 0)) }, { label: "Conflicting sales values", value: fmtNum(data.health.conflictCount) }],
    };
    return SLIDES.map((title) => ({
      title, kpis: kpis[title],
      tables: data.grids.filter((g) => g.slide === title).map((g) => gridToTable(g, data.columns)),
    }));
  }, [data]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error && !data) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const activeSlide = TABS.find((t) => t.key === tab)?.slide ?? "Overview";
  const openDay = (from2: string, to2: string, label: string) => setDrawer({ kind: "day", from: from2, to: to2, label });
  const onGridRow = (grid: Grid, label: string) => {
    if (/^(Total|All)( |$)|^All others/.test(label)) return openDay(data.from, data.to, "Selected range");
    const dr = grid.drill;
    if (dr === "agent") return setDrawer({ kind: "agent", key: label });
    if (dr === "billing") return setDrawer({ kind: "billing", key: label });
    if (dr?.startsWith("group:")) { const [, src, dim] = dr.split(":"); return setDrawer({ kind: "group", source: src as "inbound" | "cdr", dim, value: label }); }
    return openDay(data.from, data.to, "Selected range");
  };
  const gridsFor = (title: string) => data.grids.filter((g) => g.slide === title);
  const renderGrids = (title: string) => gridsFor(title).map((g) => (
    <SectionCard key={g.id} icon={CalendarClock} title={g.title} footnote={g.note ?? "Click a column heading for that period, or a row for its detail. Weeks are 7-day blocks from the 1st of the month."}>
      <GridTable grid={g} columns={data.columns} onColumn={(c) => openDay(c.from, c.to, c.label)} onRow={(l) => onGridRow(g, l)} />
    </SectionCard>
  ));

  const empty = data.overview.kpis.agentDays === 0 && data.inbound.kpis.calls === 0 && data.dialer.kpis.legs === 0 && data.sales.kpis.agentDays === 0;
  const cov = data.overview.coverage;
  const latest = cov.filter((c) => c.lastDate).map((c) => c.lastDate as string).sort().pop();

  const showFilter = tab === "billing" ? "billing" : tab === "inbound" ? "inbound" : tab === "dialer" ? "dialer" : null;

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={TrendingUp} eyebrow="Appreciate Wealth" title="Wealth operations dashboards" tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
        activeTab={tab} onTabChange={setTab} gradient="from-sky-600 via-indigo-600 to-sky-800"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardExportMenu
          reportTitle="Appreciate Wealth" fileBaseName="Appreciate_Wealth" subtitle={`${fmtDate(data.from)} to ${fmtDate(data.to)}`}
          slides={exportSlides} activeSlideTitle={activeSlide} raw={{ dashboard: "appreciate_wealth", from: data.from, to: data.to }}
        />
        <DateRangeToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }} />
      </div>

      {showFilter && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-sm">
          {showFilter === "billing" && (<>
            <FilterSelect label="Segment" value={filters.segment} options={data.options.segments} onChange={setF("segment")} />
            <FilterSelect label="Billing type" value={filters.billingType} options={data.options.billingTypes} onChange={setF("billingType")} />
          </>)}
          {showFilter === "inbound" && (<>
            <FilterSelect label="Call type" value={filters.inCallType} options={data.options.inCallTypes} onChange={setF("inCallType")} />
            <FilterSelect label="Campaign" value={filters.inCampaign} options={data.options.inCampaigns} onChange={setF("inCampaign")} />
          </>)}
          {showFilter === "dialer" && (<>
            <FilterSelect label="Call type" value={filters.cdrCallType} options={data.options.cdrCallTypes} onChange={setF("cdrCallType")} />
            <FilterSelect label="Campaign" value={filters.cdrCampaign} options={data.options.cdrCampaigns} onChange={setF("cdrCampaign")} />
          </>)}
          <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">Clear filters</button>
          {loading && <span className="text-[11px] text-slate-400">Updating…</span>}
        </div>
      )}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {empty && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          <span>No Appreciate Wealth data between {fmtDate(data.from)} and {fmtDate(data.to)}{latest ? <> — the newest uploaded data is from <strong>{fmtDate(latest)}</strong>.</> : "."}</span>
          {latest && <button type="button" onClick={() => { setFrom(`${latest.slice(0, 7)}-01`); setTo(latest); }} className="rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-700">Show that month</button>}
        </div>
      )}

      {tab === "overview" && <OverviewTab data={data} openDay={openDay} setDrawer={setDrawer} />}
      {tab === "datewise" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-sm">
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              Metric set
              <Select value={slide} onValueChange={setSlide}>
                <SelectTrigger className="h-8 min-w-[190px] rounded-lg border-slate-200 bg-white text-xs shadow-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{SLIDES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <span className="text-[11px] text-slate-400">The same tables the Excel / PDF export carries: Value, week-wise (W-1…) and date-wise columns.{data.dailyColumnsOmitted ? " Daily columns are hidden for ranges longer than 62 days." : ""}</span>
          </div>
          {renderGrids(slide)}
        </div>
      )}
      {tab === "billing" && <BillingTab data={data} setDrawer={setDrawer} openDay={openDay} />}
      {tab === "mandate" && <MandateTab data={data} setDrawer={setDrawer} />}
      {tab === "inbound" && <InboundTab data={data} setDrawer={setDrawer} openDay={openDay} />}
      {tab === "dialer" && <DialerTab data={data} setDrawer={setDrawer} openDay={openDay} />}
      {tab === "sales" && <SalesTab data={data} setDrawer={setDrawer} openDay={openDay} />}
      {tab === "agents" && <AgentsTab data={data} setDrawer={setDrawer} />}
      {tab === "health" && <HealthTab data={data} setDrawer={setDrawer} openDay={openDay} />}

      <AppreciateWealthDrawer target={drawer} from={data.from} to={data.to} onClose={() => setDrawer(null)} onOpen={setDrawer} />
    </div>
  );
}

/* --------------------------------- tabs ----------------------------------- */

type TabProps = { data: DashboardData; setDrawer: (t: DrawerTarget) => void; openDay: (f: string, t: string, l: string) => void };
type SimpleTabProps = { data: DashboardData; setDrawer: (t: DrawerTarget) => void };

function OverviewTab({ data, openDay, setDrawer }: TabProps) {
  const k = data.overview.kpis;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard icon={Users} label="Agent-days" value={fmtNum(k.agentDays)} sub={`${k.agents} agents · agent-day report`} tone="sky" />
        <KpiCard icon={PhoneCall} label="Calls" value={fmtNum(k.calls)} sub={`${fmtNum(k.connected)} connected`} tone="indigo" />
        <KpiCard icon={Percent} label="Connect %" value={fmtPct(k.connectPct)} sub="connected / calls" tone="emerald" />
        <KpiCard icon={Clock3} label="Net login hours" value={fmtHrs(k.netLoginHrs)} sub={`ACHT ${fmtSecs(k.acht)}`} tone="teal" />
        <KpiCard icon={Gauge} label="Net occupancy" value={fmtPct(k.netOccPct)} sub="(talk+wrap) / net login" tone="violet" />
        <KpiCard icon={AlertTriangle} label="Late-login %" value={fmtPct(k.latePct)} sub="late_login_status = YES" tone="amber" />
        <KpiCard icon={PhoneIncoming} label="Inbound answer %" value={fmtPct(k.inboundAnswerPct)} sub={`${fmtNum(k.inboundAnswered)} of ${fmtNum(k.inboundOffered)} offered`} tone="blue" />
        <KpiCard icon={PhoneOutgoing} label="Dialer connect %" value={fmtPct(k.dialerConnectPct)} sub={`${fmtNum(k.dialerAnswered)} of ${fmtNum(k.dialerLegs)} legs`} tone="cyan" />
        <KpiCard icon={IndianRupee} label="LRS amount" value={fmtInr(k.lrsA)} tone="rose" />
        <KpiCard icon={IndianRupee} label="Trade amount" value={fmtInr(k.trA)} tone="rose" />
        <KpiCard icon={IndianRupee} label="MF amount" value={fmtInr(k.mfA)} sub={`Total ${fmtInr(k.salesTotal)}`} tone="rose" />
        <KpiCard icon={Handshake} label="Contract value" value={k.mandateMonths ? fmtInr(k.contractValue) : "—"} sub={k.mandateMonths ? "mandate × rate, months with a mandate" : "no mandate uploaded for this range"} tone="emerald" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Calls per day by segment" icon={PhoneCall} footnote="From the agent-day report (aw_billing). Click the table below or the Date-wise tab for a day's detail.">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.overview.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} onClick={(e) => { const d = e?.activeLabel; if (d) openDay(String(d), String(d), fmtDate(String(d))); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="date" tickFormatter={fmtShortDay} tick={AXIS} /><YAxis tick={AXIS} />
              <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="inbound" name="Inbound" stackId="c" fill={SEG_COLORS.Inbound} /><Bar dataKey="outbound" name="Outbound" stackId="c" fill={SEG_COLORS.Outbound} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Sales amount per day (Outbound)" icon={IndianRupee} footnote="aw_out, de-duplicated. LRS + Trade + Mutual Fund amounts.">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.overview.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(e) => { const d = e?.activeLabel; if (d) openDay(String(d), String(d), fmtDate(String(d))); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="date" tickFormatter={fmtShortDay} tick={AXIS} /><YAxis tick={AXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
              <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} formatter={(v) => fmtInr(Number(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="lrsA" name="LRS" stackId="s" fill={PALETTE.amber} /><Bar dataKey="trA" name="Trade" stackId="s" fill={PALETTE.rose} /><Bar dataKey="mfA" name="Mutual Fund" stackId="s" fill={PALETTE.teal} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Layers} title="Segment mix" footnote="Click a segment for its agents, days and mandate rows.">
          <DataTable rows={data.overview.segmentMix} rowKey={(r) => r.segment} onRow={(r) => setDrawer({ kind: "billing", key: r.segment })}
            cols={[
              { key: "s", header: "Segment", render: (r) => r.segment }, { key: "a", header: "Agents", align: "right", render: (r) => r.agents }, { key: "d", header: "Agent-days", align: "right", render: (r) => fmtNum(r.agentDays) },
              { key: "c", header: "Calls", align: "right", render: (r) => fmtNum(r.calls) }, { key: "h", header: "Net hours", align: "right", render: (r) => fmtHrs(r.netHrs) },
            ]} />
        </SectionCard>
        <SectionCard icon={Database} title="Data coverage" footnote="Each source is uploaded separately, so each covers different days. Click a row for its upload batches and blank-column profile.">
          <DataTable rows={data.overview.coverage} rowKey={(r) => r.table} onRow={(r) => setDrawer({ kind: "source", table: r.table })}
            cols={[
              { key: "s", header: "Source", render: (r) => r.source }, { key: "f", header: "From", render: (r) => (r.firstDate ? fmtDate(r.firstDate) : "—") }, { key: "l", header: "To", render: (r) => (r.lastDate ? fmtDate(r.lastDate) : "—") },
              { key: "d", header: "Days", align: "right", render: (r) => r.daysWithData || "—" }, { key: "n", header: "Rows in range", align: "right", render: (r) => fmtNum(r.rangeRows) },
            ]} />
        </SectionCard>
      </div>
      <Note><Info className="mr-1 inline h-3 w-3" />Billed revenue, SLA %, abandon % and lead-conversion % are not shown: the billing rule, SLA threshold and lead/allocation data are not in the uploaded tables (see Data Health).</Note>
    </div>
  );
}

function BillingTab({ data, setDrawer, openDay }: TabProps) {
  const b = data.billing;
  const k = b.kpis;
  const segs = data.options.segments;
  const groupCols = (label: string): Array<Col<(typeof b.bySegment)[number]>> => [
    { key: "n", header: label, render: (r) => r.name }, { key: "a", header: "Agents", align: "right", render: (r) => r.agents ?? "" }, { key: "d", header: "Agent-days", align: "right", render: (r) => fmtNum(r.agentDays) },
    { key: "c", header: "Calls", align: "right", render: (r) => fmtNum(r.calls) }, { key: "p", header: "Connect %", align: "right", render: (r) => (r.calls ? fmtPct(r.connectPct) : "—") },
    { key: "h", header: "Net h", align: "right", render: (r) => fmtHrs(r.netHrs) }, { key: "t", header: "ACHT", align: "right", render: (r) => fmtSecs(r.acht) },
    { key: "o", header: "Net occ.", align: "right", render: (r) => fmtPct(r.netOccPct) }, { key: "l", header: "Late %", align: "right", render: (r) => fmtPct(r.latePct) },
    { key: "b", header: "Break %", align: "right", render: (r) => fmtPct(r.breakPct) }, { key: "at", header: "Target att.", align: "right", render: (r) => fmtPct(r.attainPct) },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard icon={Users} label="Agent-days" value={fmtNum(k.agentDays)} sub={`${k.agents} agents`} tone="sky" />
        <KpiCard icon={PhoneCall} label="Calls" value={fmtNum(k.calls)} sub={`${fmtNum(k.connected)} connected · ${fmtPct(k.connectPct)}`} tone="indigo" />
        <KpiCard icon={Clock3} label="Net login hours" value={fmtHrs(k.netLoginHrs)} sub={`login ${fmtHrs(k.loginHrs)} · talk ${fmtHrs(k.talkHrs)}`} tone="teal" />
        <KpiCard icon={Timer} label="ACHT" value={fmtSecs(k.acht)} sub="(talk + wrap) / connected" tone="violet" />
        <KpiCard icon={Gauge} label="Occupancy" value={fmtPct(k.occupancyPct)} sub={`net occupancy ${fmtPct(k.netOccupancyPct)}`} tone="emerald" />
        <KpiCard icon={AlertTriangle} label="Late-login %" value={fmtPct(k.latePct)} sub={`break-exceed days ${k.breakExceedDays}`} tone="amber" />
        <KpiCard icon={Percent} label="Break % of login" value={fmtPct(k.breakPct)} sub="bio + lunch + tea breaks" tone="rose" />
        <KpiCard icon={Target} label="Outbound target attainment" value={fmtPct(k.attainPct)} sub={k.callsPerNetHr === null ? "calls / calling target" : `${(Math.round(k.callsPerNetHr * 10) / 10)} calls per net hr`} tone="cyan" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Calls per day by segment" icon={PhoneCall} footnote="VKYC agents make no dialer calls, so they add no bars; their hours are in the net-login chart.">
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={b.daily.map((d) => ({ date: d.date, ...d.bySegment, connectPct: d.connectPct }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
              onClick={(e) => { const d = e?.activeLabel; if (d) openDay(String(d), String(d), fmtDate(String(d))); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="date" tickFormatter={fmtShortDay} tick={AXIS} /><YAxis yAxisId="l" tick={AXIS} /><YAxis yAxisId="r" orientation="right" tick={AXIS} unit="%" />
              <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
              {segs.map((s) => <Bar key={s} yAxisId="l" dataKey={s} stackId="c" fill={SEG_COLORS[s] ?? PALETTE.slate} />)}
              <Line yAxisId="r" type="monotone" dataKey="connectPct" name="Connect %" stroke={PALETTE.rose} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Net login hours per day by segment" icon={Clock3}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={b.daily.map((d) => ({ date: d.date, ...d.netBySegment }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
              onClick={(e) => { const d = e?.activeLabel; if (d) openDay(String(d), String(d), fmtDate(String(d))); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="date" tickFormatter={fmtShortDay} tick={AXIS} /><YAxis tick={AXIS} />
              <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
              {segs.map((s) => <Bar key={s} dataKey={s} stackId="n" fill={SEG_COLORS[s] ?? PALETTE.slate} />)}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Layers} title="By segment"><DataTable rows={b.bySegment} rowKey={(r) => r.name} onRow={(r) => setDrawer({ kind: "billing", key: r.name })} cols={groupCols("Segment")} /></SectionCard>
        <SectionCard icon={Layers} title="By billing type"><DataTable rows={b.byBillingType} rowKey={(r) => r.name} onRow={(r) => setDrawer({ kind: "billing", key: r.name })} cols={groupCols("Billing type")} /></SectionCard>
      </div>
      <SectionCard icon={CalendarClock} title="Week-wise (7-day blocks from the 1st)">
        <DataTable rows={b.weekly} rowKey={(r) => r.week + r.from} onRow={(r) => openDay(r.from, r.to, `${r.week} (${fmtDate(r.from)} – ${fmtDate(r.to)})`)}
          cols={[
            { key: "w", header: "Week", render: (r) => r.week }, { key: "r", header: "Period", render: (r) => `${fmtDate(r.from)} – ${fmtDate(r.to)}` }, { key: "d", header: "Agent-days", align: "right", render: (r) => fmtNum(r.agentDays) },
            { key: "c", header: "Calls", align: "right", render: (r) => fmtNum(r.calls) }, { key: "p", header: "Connect %", align: "right", render: (r) => (r.calls ? fmtPct(r.connectPct) : "—") }, { key: "h", header: "Net h", align: "right", render: (r) => fmtHrs(r.netHrs) }, { key: "l", header: "Late %", align: "right", render: (r) => fmtPct(r.latePct) },
          ]} />
      </SectionCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Clock3} title="AUX time by code (hours)" footnote="Codes as uploaded; hours per code, not a composition (bio + bio-break + lunch + tea + tea-break = the gap between login and net login).">
          {b.aux.length === 0 ? <p className="text-xs text-slate-400">None</p> : (
            <ResponsiveContainer width="100%" height={Math.max(180, b.aux.length * 26)}>
              <BarChart data={b.aux} layout="vertical" margin={{ top: 4, right: 16, left: 60, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis type="number" tick={AXIS} /><YAxis type="category" dataKey="label" tick={AXIS} width={110} />
                <Tooltip {...TOOLTIP_PROPS} /><Bar dataKey="hours" name="Hours" fill={PALETTE.indigo} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
        <SectionCard icon={Users} title="Agents">
          <DataTable rows={b.byAgent} rowKey={(r) => r.agentId ?? r.name} onRow={(r) => setDrawer({ kind: "agent", key: r.agentId ?? r.name })} maxHeight="max-h-[440px]"
            cols={[{ key: "n", header: "Agent", render: (r) => r.name }, { key: "d", header: "Days", align: "right", render: (r) => r.agentDays }, { key: "c", header: "Calls", align: "right", render: (r) => fmtNum(r.calls) }, { key: "h", header: "Net h", align: "right", render: (r) => r.netHrs }, { key: "l", header: "Late %", align: "right", render: (r) => fmtPct(r.latePct) }]} />
        </SectionCard>
      </div>
      <SectionCard icon={CalendarClock} title="Agent-day records" footnote={b.daysTruncated ? "Latest 400 agent-days shown; totals above cover all of them." : "Click a row for every stored field."}>
        <DataTable rows={b.days} rowKey={(r) => String(r.id)} onRow={(r) => setDrawer({ kind: "agentDay", source: "billing", id: r.id })}
          cols={[
            { key: "d", header: "Date", render: (r) => fmtDate(r.date) }, { key: "a", header: "Agent", render: (r) => r.agent }, { key: "s", header: "Segment", render: (r) => r.segment }, { key: "b", header: "Billing type", render: (r) => r.billingType },
            { key: "c", header: "Calls", align: "right", render: (r) => fmtNum(r.calls) }, { key: "k", header: "Connected", align: "right", render: (r) => fmtNum(r.connected) }, { key: "h", header: "Net h", align: "right", render: (r) => r.netHrs }, { key: "l", header: "Late", render: (r) => (r.late ? "Yes" : "No") },
          ]} />
      </SectionCard>
    </div>
  );
}

function MandateTab({ data, setDrawer }: SimpleTabProps) {
  const m = data.mandate;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={Users} label="Mandate (FTE)" value={fmtNum(m.totals.mandate)} sub="months in range" tone="sky" />
        <KpiCard icon={IndianRupee} label="Contract value" value={m.table.length ? fmtInr(m.totals.contractValue) : "—"} sub="mandate × rate per FTE" tone="emerald" />
        <KpiCard icon={Clock3} label="Mandated hours" value={m.table.length ? fmtHrs(m.totals.mandatedHrs) : "—"} sub="mandate × hours per FTE" tone="violet" />
        <KpiCard icon={Gauge} label="Delivered net hours" value={fmtHrs(m.totals.deliveredHrs)} sub="agent-day report, same months" tone="teal" />
      </div>
      {m.noMandateMonths.length > 0 && <Note tone="amber">No mandate has been uploaded for {m.noMandateMonths.join(", ")}; those months show delivery only, with no contract value or utilisation.</Note>}
      <SectionCard icon={Handshake} title="Mandate vs delivery" footnote="Delivered = net login hours from the agent-day report for that billing type and month, inside the selected range (days covered shown). This is delivery against the mandate, not an invoice: the billing rule is not in the data, so no billed amount is computed.">
        <DataTable rows={m.table} rowKey={(r) => String(r.id)} onRow={(r) => setDrawer({ kind: "mandate", id: r.id })}
          cols={[
            { key: "m", header: "Month", render: (r) => r.month }, { key: "b", header: "Billing type", render: (r) => r.billingType }, { key: "f", header: "Mandate", align: "right", render: (r) => r.mandate },
            { key: "r", header: "Rate / FTE", align: "right", render: (r) => fmtInr(r.rate) }, { key: "v", header: "Contract value", align: "right", render: (r) => fmtInr(r.contractValue) },
            { key: "mh", header: "Mandated h", align: "right", render: (r) => (r.mandatedHrs === null ? "—" : fmtHrs(r.mandatedHrs)) }, { key: "dh", header: "Delivered h", align: "right", render: (r) => fmtHrs(r.deliveredHrs) },
            { key: "p", header: "% of mandated h", render: (r) => <Bar100 pct={r.hoursDeliveredPct} /> }, { key: "e", header: "FTE-eq", align: "right", render: (r) => r.fteEq ?? "—" },
            { key: "a", header: "Agents", align: "right", render: (r) => r.agents }, { key: "dd", header: "Days with data", align: "right", render: (r) => `${r.daysWithData} / ${r.daysInMonth}` },
          ]} />
      </SectionCard>
      {m.deliveredNoMandate.length > 0 && (
        <SectionCard icon={AlertTriangle} title="Delivered with no mandate row" footnote="Billing types that logged hours in a month with no uploaded mandate.">
          <DataTable rows={m.deliveredNoMandate} rowKey={(r) => r.month + r.billingType} onRow={(r) => setDrawer({ kind: "billing", key: r.billingType })}
            cols={[{ key: "m", header: "Month", render: (r) => r.month }, { key: "b", header: "Billing type", render: (r) => r.billingType }, { key: "h", header: "Net hours", align: "right", render: (r) => fmtHrs(r.deliveredHrs) }, { key: "d", header: "Agent-days", align: "right", render: (r) => fmtNum(r.agentDays) }]} />
        </SectionCard>
      )}
      <SectionCard icon={Database} title="Mandate upload history" footnote="The same month was uploaded more than once (as 'Sep-26' text and as an Excel serial). Only the latest row per month + billing type is used; older rows are marked Superseded.">
        <DataTable rows={m.history} rowKey={(r) => String(r.id)} onRow={(r) => setDrawer({ kind: "mandate", id: r.id })}
          cols={[
            { key: "i", header: "Row", render: (r) => r.id }, { key: "m", header: "Month (raw → parsed)", render: (r) => `${r.monthRaw} → ${r.month}` }, { key: "b", header: "Billing type", render: (r) => r.billingType },
            { key: "f", header: "Mandate", align: "right", render: (r) => r.mandate }, { key: "r", header: "Rate", align: "right", render: (r) => fmtInr(r.rate) }, { key: "h", header: "Hours / FTE (raw)", render: (r) => r.hoursRaw },
            { key: "s", header: "Status", render: (r) => (r.superseded ? "Superseded" : "Current") }, { key: "t", header: "Uploaded", render: (r) => fmtStamp(r.insertedAt) },
          ]} />
      </SectionCard>
    </div>
  );
}

function callCols(label: string, opts: { hangup?: boolean } = {}): Array<Col<DashboardData["inbound"]["byCampaign"][number]>> {
  return [
    { key: "n", header: label, render: (r) => r.name }, { key: "c", header: "Calls", align: "right", render: (r) => fmtNum(r.calls) }, { key: "a", header: "Answered", align: "right", render: (r) => fmtNum(r.answered) },
    { key: "p", header: "Answer %", render: (r) => <Bar100 pct={r.answerPct} color="#10b981" /> },
    ...(opts.hangup ? [] : [{ key: "t", header: "Avg talk", align: "right" as const, render: (r: { avgTalk: number | null }) => fmtSecs(r.avgTalk) }, { key: "h", header: "Avg handling", align: "right" as const, render: (r: { avgHandling: number | null }) => fmtSecs(r.avgHandling) }]),
  ];
}
const recentCols = (): Array<Col<DashboardData["inbound"]["recent"][number]>> => [
  { key: "d", header: "Date", render: (r) => fmtDate(r.date) }, { key: "t", header: "Start", render: (r) => hms(r.startS) }, { key: "ty", header: "Type", render: (r) => r.callType }, { key: "c", header: "Campaign", render: (r) => r.campaign },
  { key: "a", header: "Agent", render: (r) => r.agent }, { key: "s", header: "Status", render: (r) => r.status }, { key: "p", header: "Disposition", render: (r) => r.disposition }, { key: "k", header: "Talk", align: "right", render: (r) => `${r.talkS}s` },
];

function InboundTab({ data, setDrawer, openDay }: TabProps) {
  const i = data.inbound;
  const k = i.kpis;
  const g = (dim: string) => (r: { name: string }) => setDrawer({ kind: "group", source: "inbound", dim, value: r.name });
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard icon={PhoneIncoming} label="Calls (filter)" value={fmtNum(k.calls)} sub={`${fmtNum(k.uniqueCallers)} unique numbers`} tone="blue" />
        <KpiCard icon={Percent} label="Answer %" value={fmtPct(k.answerPct)} sub={`${fmtNum(k.answered)} answered · ${fmtNum(k.unanswered)} unanswered`} tone="emerald" />
        <KpiCard icon={Timer} label="Avg handling time" value={fmtSecs(k.avgHandling)} sub={`avg talk ${fmtSecs(k.avgTalk)}`} tone="violet" />
        <KpiCard icon={Clock3} label="Talk time" value={fmtHrs(k.talkHrs)} tone="teal" />
        <KpiCard icon={PhoneIncoming} label="Inbound-type offered" value={fmtNum(k.inboundOffered)} sub="distinct call ids, call type Inbound" tone="sky" />
        <KpiCard icon={Percent} label="Inbound-type answer %" value={fmtPct(k.inboundAnswerPct)} sub={`${fmtNum(k.inboundAnswered)} answered`} tone="cyan" />
        <KpiCard icon={AlertTriangle} label="Never reached an agent" value={fmtNum(k.inboundNoAgent)} sub="Inbound, unanswered, no agent" tone="amber" />
        <KpiCard icon={Timer} label="Avg speed of answer" value={fmtSecs(k.avgTta)} sub={`queue ${fmtSecs(k.avgQueue)} · only ${k.ttaN} calls carry it`} tone="rose" />
        <KpiCard icon={PhoneIncoming} label="Repeat calls" value={fmtNum(k.repeatCalls)} sub={`${fmtPct(k.repeatPct)} of calls (filter), by caller number`} tone="indigo" />
      </div>
      <Note>Call types in this file: Inbound (customer calls in), Manual (agent callbacks) and Progressive (auto-callback dialer). Speed of answer and queue time exist only in the older file layout, so they are averaged over the calls that have them (count shown). SLA % and abandon % are not shown: no SLA threshold is in the data.</Note>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Calls per day" icon={PhoneIncoming}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={i.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} onClick={(e) => { const d = e?.activeLabel; if (d) openDay(String(d), String(d), fmtDate(String(d))); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="date" tickFormatter={fmtShortDay} tick={AXIS} /><YAxis tick={AXIS} />
              <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="answered" name="Answered" stackId="a" fill={PALETTE.emerald} /><Bar dataKey="unanswered" name="Unanswered" stackId="a" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Calls by hour of day" icon={Clock3} footnote={i.hourUnknown ? `${i.hourUnknown} calls have no start time and are not in this chart.` : "Hour of call start."}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={i.byHour.map((h) => ({ ...h, label: hourLbl(h.hour) }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
              onClick={(e) => { const l = e?.activeLabel; if (l) setDrawer({ kind: "group", source: "inbound", dim: "hour", value: String(l) }); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="label" tick={AXIS} /><YAxis yAxisId="l" tick={AXIS} /><YAxis yAxisId="r" orientation="right" tick={AXIS} unit="%" />
              <Tooltip {...TOOLTIP_PROPS} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="calls" name="Calls" fill={PALETTE.sky} radius={[4, 4, 0, 0]} /><Line yAxisId="r" type="monotone" dataKey="answerPct" name="Answer %" stroke={PALETTE.emerald} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Layers} title="By call type"><DataTable rows={i.byCallType} rowKey={(r) => r.name} onRow={g("callType")} cols={callCols("Call type")} /></SectionCard>
        <SectionCard icon={Layers} title="By campaign"><DataTable rows={i.byCampaign} rowKey={(r) => r.name} onRow={g("campaign")} cols={callCols("Campaign")} /></SectionCard>
        <SectionCard icon={Layers} title="By skill"><DataTable rows={i.bySkill} rowKey={(r) => r.name} onRow={g("skill")} cols={callCols("Skill")} /></SectionCard>
        <SectionCard icon={Users} title="By agent"><DataTable rows={i.byAgent} rowKey={(r) => r.name} onRow={g("agent")} cols={callCols("Agent")} /></SectionCard>
        <SectionCard icon={Layers} title="By disposition (top 40)"><DataTable rows={i.byDisposition} rowKey={(r) => r.name} onRow={g("disposition")} cols={callCols("Disposition")} /></SectionCard>
        <SectionCard icon={Layers} title="Hang-up by" footnote="Only the older file layout carries hang-up data."><DataTable rows={i.byHangup} rowKey={(r) => r.name} onRow={g("hangup")} cols={callCols("Hang-up by", { hangup: true })} /></SectionCard>
      </div>
      <SectionCard icon={PhoneCall} title="Call records" footnote={i.recentTruncated ? `Latest ${i.recent.length} calls shown; every figure above covers all calls in the range.` : "Click a call for every stored field and its recording."}>
        <DataTable rows={i.recent} rowKey={(r) => String(r.id)} onRow={(r) => setDrawer({ kind: "call", source: "inbound", id: r.id })} cols={recentCols()} />
      </SectionCard>
    </div>
  );
}

function DialerTab({ data, setDrawer, openDay }: TabProps) {
  const c = data.dialer;
  const k = c.kpis;
  const g = (dim: string) => (r: { name: string }) => setDrawer({ kind: "group", source: "cdr", dim, value: r.name });
  const funnel = [
    { step: "Dialer legs", n: k.legs }, { step: "Answered legs", n: k.answered },
    { step: "Yes__Callback", n: k.callbackDispositions }, { step: "Yes__Lost", n: k.lostDispositions }, { step: "Yes__Success", n: k.successDispositions },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard icon={PhoneOutgoing} label="Legs (filter)" value={fmtNum(k.legs)} sub={`${fmtNum(k.uniqueNumbers)} unique numbers (Progressive + Manual)`} tone="sky" />
        <KpiCard icon={Percent} label="Connect %" value={fmtPct(k.connectPct)} sub={`${fmtNum(k.answered)} answered legs`} tone="emerald" />
        <KpiCard icon={Users} label="Unique numbers answered" value={fmtNum(k.uniqueAnswered)} sub={`of ${fmtNum(k.uniqueNumbers)} dialed`} tone="teal" />
        <KpiCard icon={Clock3} label="Talk time" value={fmtHrs(k.talkHrs)} sub={`avg ${fmtSecs(k.avgTalk)} per answered leg`} tone="violet" />
        <KpiCard icon={Handshake} label="Yes__Success" value={fmtNum(k.successDispositions)} sub="dispositions as uploaded" tone="rose" />
        <KpiCard icon={PhoneCall} label="Yes__Callback" value={fmtNum(k.callbackDispositions)} tone="amber" />
        <KpiCard icon={AlertTriangle} label="Yes__Lost" value={fmtNum(k.lostDispositions)} tone="red" />
        <KpiCard icon={Info} label="No disposition" value={fmtNum(k.noDispositionLegs)} sub="blank legs" tone="cyan" />
        <KpiCard icon={PhoneOutgoing} label="Repeat legs" value={fmtNum(k.repeatLegs)} sub={`${fmtPct(k.repeatPct)} of legs (filter), by caller number`} tone="indigo" />
      </div>
      <Note>Disposition is shown exactly as uploaded. "Yes__" is NOT read as "customer reached": e.g. Yes__Lost__RNR after 8 Attempts sits on Unanswered legs. One leg = one dialer row (an agent's call attempt); the same call id can appear under several agents.</Note>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Legs per day" icon={PhoneOutgoing}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={c.daily.map((d) => ({ ...d, connectPct: d.legs ? Math.round((d.answered / d.legs) * 1000) / 10 : 0 }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} onClick={(e) => { const d = e?.activeLabel; if (d) openDay(String(d), String(d), fmtDate(String(d))); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="date" tickFormatter={fmtShortDay} tick={AXIS} /><YAxis yAxisId="l" tick={AXIS} /><YAxis yAxisId="r" orientation="right" tick={AXIS} unit="%" />
              <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="legs" name="Legs" fill={PALETTE.sky} radius={[4, 4, 0, 0]} /><Bar yAxisId="l" dataKey="answered" name="Answered" fill={PALETTE.emerald} radius={[4, 4, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="connectPct" name="Connect %" stroke={PALETTE.rose} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Legs by hour of day (slot)" icon={Clock3} footnote={c.hourUnknown ? `${c.hourUnknown} legs have no start time.` : "Hour of the leg's start time (equals the file's slot column on every row)."}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={c.byHour.map((h) => ({ ...h, label: hourLbl(h.hour) }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} onClick={(e) => { const l = e?.activeLabel; if (l) setDrawer({ kind: "group", source: "cdr", dim: "hour", value: String(l) }); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="label" tick={AXIS} /><YAxis yAxisId="l" tick={AXIS} /><YAxis yAxisId="r" orientation="right" tick={AXIS} unit="%" />
              <Tooltip {...TOOLTIP_PROPS} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="legs" name="Legs" fill={PALETTE.sky} radius={[4, 4, 0, 0]} /><Line yAxisId="r" type="monotone" dataKey="connectPct" name="Connect %" stroke={PALETTE.emerald} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <ChartCard title="Disposition funnel" icon={Layers} footnote="Counts of legs. Yes__ steps are disposition labels, not a strict sub-set of Answered legs.">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={funnel} layout="vertical" margin={{ top: 4, right: 24, left: 40, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis type="number" tick={AXIS} /><YAxis type="category" dataKey="step" tick={AXIS} width={110} />
            <Tooltip {...TOOLTIP_PROPS} /><Bar dataKey="n" name="Legs" fill={PALETTE.indigo} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Layers} title="By campaign"><DataTable rows={c.byCampaign} rowKey={(r) => r.name} onRow={g("campaign")} cols={callCols("Campaign")} /></SectionCard>
        <SectionCard icon={Layers} title="By call type"><DataTable rows={c.byCallType} rowKey={(r) => r.name} onRow={g("callType")} cols={callCols("Call type")} /></SectionCard>
        <SectionCard icon={Layers} title="By disposition category">
          <DataTable<DashboardData["dialer"]["byCategory"][number]> rows={c.byCategory} rowKey={(r) => r.name} onRow={g("category")}
            cols={[{ key: "n", header: "Category", render: (r) => r.name }, { key: "l", header: "Legs", align: "right", render: (r) => fmtNum(r.legs) }, { key: "s", header: "Share", render: (r) => <Bar100 pct={r.sharePct} color="#6366f1" /> }, { key: "a", header: "Answered", align: "right", render: (r) => fmtNum(r.answered) }]} />
        </SectionCard>
        <SectionCard icon={Layers} title="Yes__ sub-reasons">
          <DataTable<DashboardData["dialer"]["byReason"][number]> rows={c.byReason} rowKey={(r) => r.name} onRow={(r) => setDrawer({ kind: "group", source: "cdr", dim: "category", value: r.name.split(" > ")[0] })}
            cols={[{ key: "n", header: "Category > reason", render: (r) => r.name }, { key: "l", header: "Legs", align: "right", render: (r) => fmtNum(r.legs) }, { key: "a", header: "Answered", align: "right", render: (r) => fmtNum(r.answered) }]} />
        </SectionCard>
        <SectionCard icon={Users} title="By agent"><DataTable rows={c.byAgent} rowKey={(r) => r.name} onRow={g("agent")} cols={callCols("Agent")} /></SectionCard>
        <SectionCard icon={Layers} title="By full disposition (top 40)"><DataTable rows={c.byDisposition} rowKey={(r) => r.name} onRow={g("disposition")} cols={callCols("Disposition")} /></SectionCard>
        <SectionCard icon={Layers} title="Hang-up by" footnote="hangup_by as uploaded; most legs carry no value.">
          <DataTable rows={c.byHangup} rowKey={(r) => r.name} onRow={g("hangup")} cols={callCols("Hang-up by", { hangup: true })} />
        </SectionCard>
      </div>
      <SectionCard icon={PhoneCall} title="Leg records" footnote={c.recentTruncated ? `Latest ${c.recent.length} legs shown; every figure above covers all legs in the range.` : "Click a leg for every stored field."}>
        <DataTable rows={c.recent} rowKey={(r) => String(r.id)} onRow={(r) => setDrawer({ kind: "call", source: "cdr", id: r.id })} cols={recentCols()} />
      </SectionCard>
    </div>
  );
}

function SalesTab({ data, setDrawer, openDay }: TabProps) {
  const s = data.sales;
  const k = s.kpis;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard icon={IndianRupee} label="LRS amount" value={fmtInr(k.lrsA)} sub={`${fmtNum(k.lrsC)} count · AOV ${fmtInr(k.lrsAov)} · target att. ${fmtPct(k.lrsAttain)}`} tone="amber" />
        <KpiCard icon={IndianRupee} label="Trade amount" value={fmtInr(k.trA)} sub={`${fmtNum(k.trC)} count · AOV ${fmtInr(k.trAov)} · target att. ${fmtPct(k.trAttain)}`} tone="rose" />
        <KpiCard icon={IndianRupee} label="Mutual Fund amount" value={fmtInr(k.mfA)} sub={`${fmtNum(k.mfC)} count · AOV ${fmtInr(k.mfAov)} · target att. ${fmtPct(k.mfAttain)}`} tone="teal" />
        <KpiCard icon={TrendingUp} label="Total sales" value={fmtInr(k.total)} sub={`${fmtNum(k.agentDays)} agent-days · ${k.agents} agents`} tone="emerald" />
        <KpiCard icon={Percent} label="Agent-days with a sale" value={fmtPct(k.productivePct)} sub="any LRS/Trade/MF amount > 0" tone="violet" />
        <KpiCard icon={Target} label="Agent-days with a target" value={fmtNum(k.targetAgentDays)} sub="target > 0 on at least one product" tone="sky" />
      </div>
      {s.conflicts > 0 && <Note tone="amber">{s.conflicts} sales values differ between re-uploads of the same agent-day (listed under Data Health). The complete-template row is used.</Note>}
      <Note>Target attainment = amount ÷ target over the agent-days whose target is above 0 (a target of 0 or blank means none was set; those days still count in the amount totals). The target columns are compared to the amount columns because their magnitudes match; the column meaning itself is not documented in the upload. Lead conversion % is not shown: there is no lead/allocation table.</Note>
      <ChartCard title="Sales amount per day" icon={IndianRupee}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={s.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(e) => { const d = e?.activeLabel; if (d) openDay(String(d), String(d), fmtDate(String(d))); }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="date" tickFormatter={fmtShortDay} tick={AXIS} /><YAxis tick={AXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
            <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} formatter={(v) => fmtInr(Number(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="lrsA" name="LRS" stackId="s" fill={PALETTE.amber} /><Bar dataKey="trA" name="Trade" stackId="s" fill={PALETTE.rose} /><Bar dataKey="mfA" name="Mutual Fund" stackId="s" fill={PALETTE.teal} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <SectionCard icon={Users} title="Agent leaderboard">
        <DataTable rows={s.byAgent} rowKey={(r) => r.agentId} onRow={(r) => setDrawer({ kind: "agent", key: r.agentId })}
          cols={[
            { key: "n", header: "Agent", render: (r) => r.name }, { key: "d", header: "Days", align: "right", render: (r) => r.agentDays },
            { key: "l", header: "LRS", align: "right", render: (r) => fmtInr(r.lrsA) }, { key: "la", header: "LRS att.", align: "right", render: (r) => fmtPct(r.lrsAttain) },
            { key: "t", header: "Trade", align: "right", render: (r) => fmtInr(r.trA) }, { key: "ta", header: "Trade att.", align: "right", render: (r) => fmtPct(r.trAttain) },
            { key: "m", header: "MF", align: "right", render: (r) => fmtInr(r.mfA) }, { key: "ma", header: "MF att.", align: "right", render: (r) => fmtPct(r.mfAttain) },
            { key: "tt", header: "Total", align: "right", render: (r) => <b>{fmtInr(r.total)}</b> },
          ]} />
      </SectionCard>
      <SectionCard icon={CalendarClock} title="Agent-day sales records" footnote={s.rowsTruncated ? "Latest 400 agent-days shown; totals above cover all of them." : "Click a row for every stored field and the other uploads of the same agent-day."}>
        <DataTable rows={s.rows} rowKey={(r) => String(r.id)} onRow={(r) => setDrawer({ kind: "agentDay", source: "out", id: r.id })}
          cols={[
            { key: "d", header: "Date", render: (r) => fmtDate(r.date) }, { key: "a", header: "Agent", render: (r) => r.agent },
            { key: "l", header: "LRS", align: "right", render: (r) => `${fmtInr(r.lrsA)} (${r.lrsC})` }, { key: "t", header: "Trade", align: "right", render: (r) => `${fmtInr(r.trA)} (${r.trC})` }, { key: "m", header: "MF", align: "right", render: (r) => `${fmtInr(r.mfA)} (${r.mfC})` },
            { key: "g", header: "Target", render: (r) => (r.hasTarget ? "Set" : "None") },
          ]} />
      </SectionCard>
    </div>
  );
}

function AgentsTab({ data, setDrawer }: SimpleTabProps) {
  return (
    <div className="space-y-5">
      <SectionCard icon={Users} title="Agent scorecard" footnote="One row per dialer agent id across the agent-day report and the outbound sales file. Click a row for the agent's days, AUX time, dispositions and upload audit.">
        <DataTable rows={data.agents.rows} rowKey={(r) => r.agentId} onRow={(r) => setDrawer({ kind: "agent", key: r.agentId })} maxHeight="max-h-[640px]"
          cols={[
            { key: "n", header: "Agent", render: (r) => r.name }, { key: "e", header: "Emp id", render: (r) => r.empId || "—" }, { key: "s", header: "Segment", render: (r) => r.segments },
            { key: "d", header: "Days", align: "right", render: (r) => r.agentDays }, { key: "c", header: "Calls", align: "right", render: (r) => fmtNum(r.calls) }, { key: "p", header: "Connect %", align: "right", render: (r) => (r.calls ? fmtPct(r.connectPct) : "—") },
            { key: "h", header: "Net h", align: "right", render: (r) => r.netHrs }, { key: "a", header: "ACHT", align: "right", render: (r) => fmtSecs(r.acht) }, { key: "o", header: "Net occ.", align: "right", render: (r) => fmtPct(r.netOccPct) },
            { key: "l", header: "Late days", align: "right", render: (r) => (r.agentDays ? `${r.lateDays} (${fmtPct(r.latePct, 0)})` : "—") }, { key: "sa", header: "Sales", align: "right", render: (r) => (r.salesDays ? fmtInr(r.salesTotal) : "—") },
          ]} />
      </SectionCard>
      {data.agents.withoutBilling > 0 && <Note>{data.agents.withoutBilling} agent(s) appear only in the sales file (no agent-day report row in this range).</Note>}
    </div>
  );
}

function HealthTab({ data, setDrawer, openDay }: TabProps) {
  const h = data.health;
  return (
    <div className="space-y-5">
      <SectionCard icon={ShieldCheck} title="How the numbers are protected" footnote="Every KPI is computed on de-duplicated rows; the raw upload is exported untouched on the Excel raw sheets.">
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">{h.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </SectionCard>
      <SectionCard icon={Database} title="Source tables (all uploads)" footnote="Dates arrive as text ('5-Sep-26') and as Excel serials ('46270'); both are parsed. Unparsed = date text neither format could read.">
        <DataTable rows={h.coverage} rowKey={(r) => r.table} onRow={(r) => setDrawer({ kind: "source", table: r.table })}
          cols={[
            { key: "s", header: "Source", render: (r) => r.source }, { key: "t", header: "Table", render: (r) => r.table }, { key: "f", header: "First", render: (r) => (r.firstDate ? fmtDate(r.firstDate) : "—") }, { key: "l", header: "Last", render: (r) => (r.lastDate ? fmtDate(r.lastDate) : "—") },
            { key: "d", header: "Days", align: "right", render: (r) => r.daysWithData || "—" }, { key: "se", header: "Serial dates", align: "right", render: (r) => fmtNum(r.serialDateRows) }, { key: "tx", header: "Text dates", align: "right", render: (r) => fmtNum(r.textDateRows) },
            { key: "u", header: "Unparsed", align: "right", render: (r) => fmtNum(r.unparsedDates) }, { key: "up", header: "Latest upload", render: (r) => fmtStamp(r.latestUpload) },
          ]} />
      </SectionCard>
      <SectionCard icon={Layers} title="Duplicate rows ignored (selected range)">
        <DataTable rows={h.duplicates} rowKey={(r) => r.source} onRow={(r) => setDrawer({ kind: "source", table: r.source })}
          cols={[{ key: "s", header: "Source", render: (r) => r.source }, { key: "k", header: "De-dup key", render: (r) => r.key }, { key: "r", header: "Uploaded", align: "right", render: (r) => fmtNum(r.raw) }, { key: "u", header: "Used", align: "right", render: (r) => fmtNum(r.kept) }, { key: "d", header: "Ignored", align: "right", render: (r) => fmtNum(r.dropped) }]} />
      </SectionCard>
      <SectionCard icon={AlertTriangle} title={`Conflicting sales values between re-uploads (${fmtN(h.conflictCount)})`} footnote="The same agent-day was uploaded more than once with different values. The complete-template row is used; the other value is shown for review.">
        <DataTable rows={h.conflicts} rowKey={(r) => r.date + r.agentId + r.field} onRow={(r) => setDrawer({ kind: "agent", key: r.agentId })}
          cols={[{ key: "d", header: "Date", render: (r) => fmtDate(r.date) }, { key: "a", header: "Agent", render: (r) => r.agentName }, { key: "f", header: "Field", render: (r) => r.field }, { key: "v", header: "Values seen", render: (r) => r.values }]} />
      </SectionCard>
      <SectionCard icon={Gauge} title="Call-level files vs the agent-day report" footnote="Where the CDR file is complete, its rows per agent equal the agent-day report's total_calls exactly. Coverage below 100% means the CDR upload for that day is partial - use the agent-day figures for totals.">
        <DataTable rows={h.reconciliation} rowKey={(r) => r.date} onRow={(r) => openDay(r.date, r.date, fmtDate(r.date))}
          cols={[
            { key: "d", header: "Date", render: (r) => fmtDate(r.date) }, { key: "o", header: "Outbound report calls", align: "right", render: (r) => fmtNum(r.outboundReportCalls) }, { key: "c", header: "Dialer CDR legs", align: "right", render: (r) => fmtNum(r.dialerCdrLegs) }, { key: "p", header: "Dialer coverage", align: "right", render: (r) => fmtPct(r.dialerCoveragePct) },
            { key: "i", header: "Inbound report calls", align: "right", render: (r) => fmtNum(r.inboundReportCalls) }, { key: "ic", header: "Inbound CDR rows", align: "right", render: (r) => fmtNum(r.inboundCdrLegs) }, { key: "ip", header: "Inbound coverage", align: "right", render: (r) => fmtPct(r.inboundCoveragePct) },
          ]} />
      </SectionCard>
      <Note>Repeated call ids (agent legs of one call): inbound file {h.multiLegCallIds.inbound}, dialer file {h.multiLegCallIds.dialer}. Blank dispositions: inbound {h.blankDisposition.inbound}, dialer {h.blankDisposition.dialer}. Days in range with no agent-day report: {h.missingDays}. Generated {fmtStamp(data.generatedAt)}.</Note>
    </div>
  );
}

// Keep the unused-import guard explicit: fmtN is used above via fmtN(h.conflictCount).
void fmtN;
