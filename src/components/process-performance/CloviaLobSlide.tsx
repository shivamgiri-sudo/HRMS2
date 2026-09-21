import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, MessageSquare, PhoneOutgoing, PhoneIncoming, LayoutDashboard, Inbox } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner, DashboardHero, DashboardExportMenu, type ExportSlide } from "./DashboardKit";
import {
  KpiGrid, InsightList, ChartCard, DataTable, DetailDrawer, NotesPanel, periodExportTables, specTableExport, fmtDate, fmtVal,
  type LobPayload, type PeriodBreakdown, type DrillTarget,
} from "./CloviaReportKit";

/**
 * One generic Clovia LOB slide (Overview / Inbound add-ons / Email / Chat /
 * Outbound). The server returns a report spec; see CloviaReportKit.tsx. Each
 * slide owns its export menu: the Excel/PDF "Value" column is the whole range
 * and is followed by one column per week (W-1 = days 1-7 of the month ...) and
 * one per date, from GET .../periods (same definitions as the headline).
 */

export type CloviaLob = "overview" | "inbound" | "email" | "chat" | "outbound";

const META: Record<CloviaLob, { icon: React.ComponentType<{ className?: string }>; eyebrow: string; title: string; gradient: string; raw: string; filter?: { key: "dept" | "campaign"; label: string; all: string } }> = {
  overview: { icon: LayoutDashboard, eyebrow: "Clovia · Process Performance", title: "Scorecard — all LOBs", gradient: "from-purple-600 via-fuchsia-600 to-purple-700", raw: "clovia" },
  inbound: { icon: PhoneIncoming, eyebrow: "Clovia · Inbound", title: "CSAT, Quality, Rechurn & Tickets", gradient: "from-blue-600 via-indigo-600 to-blue-700", raw: "clovia_inbound" },
  email: { icon: Mail, eyebrow: "Clovia · Process Performance", title: "Email Performance", gradient: "from-sky-600 via-cyan-600 to-sky-700", raw: "clovia_email" },
  chat: { icon: MessageSquare, eyebrow: "Clovia · Process Performance", title: "Chat Performance", gradient: "from-emerald-600 via-teal-600 to-emerald-700", raw: "clovia_chat", filter: { key: "dept", label: "Filter by department", all: "All departments" } },
  outbound: { icon: PhoneOutgoing, eyebrow: "Clovia · Process Performance", title: "Outbound Performance", gradient: "from-violet-600 via-purple-600 to-violet-700", raw: "clovia_outbound", filter: { key: "campaign", label: "Filter by campaign", all: "All campaigns" } },
};

export function CloviaLobSlide({ lob, from, to, onRangeChange, hideHero }: { lob: CloviaLob; from: string; to: string; onRangeChange: (from: string, to: string) => void; hideHero?: boolean }) {
  const meta = META[lob];
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState("");
  const [data, setData] = useState<LobPayload | null>(null);
  const [periods, setPeriods] = useState<PeriodBreakdown | null>(null);
  const [periodsState, setPeriodsState] = useState<"loading" | "ready" | "failed">("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const qs = useMemo(() => `from=${from}&to=${to}${meta.filter && filter !== "all" ? `&${meta.filter.key}=${encodeURIComponent(filter)}` : ""}`, [from, to, filter, meta.filter]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: LobPayload }>(`/api/process-performance/clovia-lob/${lob}?${qs}`);
      setData(res.data);
      setTab((t) => (res.data.tabs.some((x) => x.key === t) ? t : res.data.tabs[0]?.key ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load this Clovia slide.");
    } finally { setLoading(false); }
  }, [lob, qs]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    setPeriodsState("loading");
    hrmsApi.get<{ success: boolean; data: PeriodBreakdown }>(`/api/process-performance/clovia-lob/${lob}/periods?${qs}`)
      .then((r) => { if (!cancelled) { setPeriods(r.data); setPeriodsState("ready"); } })
      .catch(() => { if (!cancelled) { setPeriods(null); setPeriodsState("failed"); } });
    return () => { cancelled = true; };
  }, [lob, qs]);

  const firstTab = data?.tabs[0]?.key ?? "";
  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    return data.tabs.map((t, i) => {
      const kpis = data.kpis.filter((k) => (k.tab ?? firstTab) === t.key).map((k) => ({ label: k.label, value: fmtVal(k.value, k.fmt) }));
      const ins = data.insights.filter((x) => (x.tab ?? firstTab) === t.key);
      return {
        title: t.label,
        kpis: i === 0 ? [] : kpis,
        tables: [
          // Metric | Value | W-1 .. | 1-Sep .. -- on the first slide, from the server's per-period endpoint.
          ...(i === 0 ? periodExportTables(periods) : []),
          ...(i === 0 && kpis.length > 0 && !periods ? [{ title: "Headline metrics (whole range)", columns: ["Metric", "Value"], rows: kpis.map((k) => [k.label, k.value]) }] : []),
          ...data.tables.filter((tb) => tb.tab === t.key).map(specTableExport),
          ...(ins.length ? [{ title: "Key insights", columns: ["Insight"], rows: ins.map((x) => [x.text]) }] : []),
          ...(i === 0 ? [{ title: "Data notes and omitted metrics", columns: ["Note"], rows: data.notes.map((n) => [n]) }] : []),
        ],
      };
    });
  }, [data, periods, firstTab]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error && !data) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const activeTab = tab || firstTab;
  const kpis = data.kpis.filter((k) => (k.tab ?? firstTab) === activeTab);
  const insights = data.insights.filter((i) => (i.tab ?? firstTab) === activeTab);
  const charts = data.charts.filter((c) => c.tab === activeTab);
  const tables = data.tables.filter((t) => t.tab === activeTab);
  const activeLabel = data.tabs.find((t) => t.key === activeTab)?.label ?? data.tabs[0]?.label ?? "";
  const opts = meta.filter ? data.options[meta.filter.key] ?? [] : [];

  return (
    <div className="space-y-5">
      {!hideHero && (
        <DashboardHero<string> icon={meta.icon} eyebrow={meta.eyebrow} title={meta.title} tabs={data.tabs} activeTab={activeTab} onTabChange={setTab} gradient={meta.gradient} />
      )}
      {hideHero && (
        <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
          {data.tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${activeTab === t.key ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{t.label}</button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {periodsState === "loading" ? (
            <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-500">Preparing week &amp; date columns for export…</span>
          ) : (
            <DashboardExportMenu
              reportTitle={`Clovia — ${data.label}`} fileBaseName={`Clovia_${data.label.replace(/[^A-Za-z]+/g, "_")}`}
              raw={{ dashboard: meta.raw, from, to }} subtitle={`${from} to ${to}${filter !== "all" ? ` · ${filter}` : ""}`}
              slides={exportSlides} activeSlideTitle={activeLabel}
            />
          )}
          {meta.filter && opts.length > 0 && (
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="h-8 w-[200px] bg-white text-xs" aria-label={meta.filter.label}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{meta.filter.all}</SelectItem>
                {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        {loading && <span className="text-[11px] font-medium text-slate-400">Refreshing…</span>}
      </div>
      {periodsState === "failed" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">The week-wise and date-wise columns could not be loaded, so a download would only carry the overall Value column. Change the range or reload to retry.</div>
      )}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {data.empty && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          <span className="inline-flex items-center gap-2"><Inbox className="h-4 w-4" />No {data.label.toLowerCase()} data between {fmtDate(from)} and {fmtDate(to)}{data.latestDate ? <> — the newest uploaded date is <strong>{fmtDate(data.latestDate)}</strong>.</> : "."}</span>
          {data.latestDate && <button type="button" onClick={() => onRangeChange(`${data.latestDate!.slice(0, 7)}-01`, data.latestDate!)} className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-700">Show that month</button>}
        </div>
      )}

      <KpiGrid kpis={kpis} />
      <InsightList insights={insights} />
      {charts.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{charts.map((c) => <ChartCard key={c.key} spec={c} onDrill={(kind, key) => setDrill({ kind, key })} />)}</div>}
      {tables.map((t) => <DataTable key={t.key} spec={t} onRow={(kind, key) => setDrill({ kind, key })} />)}
      {activeTab === firstTab && <NotesPanel notes={data.notes} definitions={data.definitions} coverage={data.coverage} />}

      <DetailDrawer lob={lob} target={drill} query={qs} onClose={() => setDrill(null)} />
    </div>
  );
}
