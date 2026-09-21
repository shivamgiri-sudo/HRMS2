import { useEffect, useMemo, useState, useCallback } from "react";
import {
  MessageSquare, Gauge, Clock3, Repeat, Users, ShoppingCart, IndianRupee, Star,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  formatINR, currentMonthRange, type ExportSlide,
} from "./DashboardKit";
import { ComboTrend, Donut, RankBars, fmtNum, fmtPct, PALETTE } from "./NeemansCharts";

const API = "/api/process-performance/gnc-chat-dashboard";

/**
 * GNC Chat dashboard -- live over db_masmis.gnc_chat + gnc_sale (campaign =
 * 'Chat'), reverse-engineered from the user's own reference workbook
 * (GNC_Chat_Dashboard_Sep'26.xlsb). See gnc-chat-dashboard.service.ts for the
 * full formula-by-formula validation writeup this dashboard is built on.
 */

interface Headline {
  totalChats: number; uniqueChats: number; repeatChats: number;
  frtInTatPct: number; resolutionInTatPct: number;
  orders: number; conversionPct: number; grossRevenue: number; netRevenue: number;
  avgCsat: number; csatResponses: number;
}
interface TrendRow {
  date: string; totalChats: number; uniqueChats: number;
  frtInTatPct: number; resolutionInTatPct: number; orders: number; revenue: number;
}
interface NamedCount { count: number; pct: number }
interface AgentRow {
  agent: string; totalChats: number; uniqueChats: number;
  frtInTatPct: number; resolutionInTatPct: number;
}
interface DashboardData {
  from: string; to: string;
  headline: Headline;
  dateWiseTrend: TrendRow[];
  qrcBreakdown: Array<{ qrc: string } & NamedCount>;
  channelBreakdown: Array<{ channel: string } & NamedCount>;
  statusBreakdown: Array<{ status: string } & NamedCount>;
  csatBreakdown: Array<{ rating: number; count: number }>;
  tagBreakdown: Array<{ tag: string; count: number }>;
  agents: AgentRow[];
  saleLinkage: {
    matched: Array<{ agent: string; saleCount: number; revenue: number }>;
    unmatchedSaleNames: Array<{ name: string; saleCount: number; revenue: number }>;
  };
}

type TabKey = "overview" | "agents" | "sale_linkage";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agent-wise" },
  { key: "sale_linkage", label: "Sale Linkage" },
];

export function GncChatDashboard() {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(`${API}?from=${from}&to=${to}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the GNC Chat dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const headline = data?.headline;

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const hl = data.headline;
    const overview: ExportSlide = {
      title: "Overview",
      kpis: [
        { label: "Total Chats", value: fmtNum(hl.totalChats) },
        { label: "Unique Chats", value: fmtNum(hl.uniqueChats) },
        { label: "Repeat Chats", value: fmtNum(hl.repeatChats) },
        { label: "FRT In-TAT % (60 sec)", value: `${hl.frtInTatPct}%` },
        { label: "Resolution In-TAT % (60 min)", value: `${hl.resolutionInTatPct}%` },
        { label: "Orders (Chat)", value: fmtNum(hl.orders) },
        { label: "Conversion % (orders / unique)", value: `${hl.conversionPct}%` },
        { label: "Gross Revenue", value: formatINR(hl.grossRevenue) },
        { label: "Net Revenue", value: formatINR(hl.netRevenue) },
        { label: "Avg CSAT", value: `${hl.avgCsat} (${hl.csatResponses} responses)` },
      ],
      tables: [
        {
          title: "Date-wise Trend",
          columns: ["Date", "Total Chats", "Unique Chats", "FRT In-TAT %", "Resolution In-TAT %", "Orders", "Revenue"],
          rows: data.dateWiseTrend.map((r) => [r.date, r.totalChats, r.uniqueChats, `${r.frtInTatPct}%`, `${r.resolutionInTatPct}%`, r.orders, formatINR(r.revenue)]),
        },
        {
          title: "QRC Breakdown",
          columns: ["QRC", "Count", "Share"],
          rows: data.qrcBreakdown.map((r) => [r.qrc, r.count, `${r.pct}%`]),
        },
        {
          title: "Channel Breakdown",
          columns: ["Channel", "Count", "Share"],
          rows: data.channelBreakdown.map((r) => [r.channel, r.count, `${r.pct}%`]),
        },
        {
          title: "Ticket Status Breakdown",
          columns: ["Status", "Count", "Share"],
          rows: data.statusBreakdown.map((r) => [r.status, r.count, `${r.pct}%`]),
        },
        {
          title: "CSAT Breakdown",
          columns: ["Rating", "Count"],
          rows: data.csatBreakdown.map((r) => [r.rating, r.count]),
        },
      ],
    };
    const agentsSlide: ExportSlide = {
      title: "Agent-wise",
      tables: [{
        title: "Agent-wise Chat Performance",
        columns: ["Agent", "Total Chats", "Unique Chats", "FRT In-TAT %", "Resolution In-TAT %"],
        rows: data.agents.map((a) => [a.agent, a.totalChats, a.uniqueChats, `${a.frtInTatPct}%`, `${a.resolutionInTatPct}%`]),
      }],
    };
    const saleLinkage: ExportSlide = {
      title: "Sale Linkage",
      tables: [
        {
          title: "Matched to a chat agent",
          columns: ["Agent", "Sale Count", "Revenue"],
          rows: data.saleLinkage.matched.map((r) => [r.agent, r.saleCount, formatINR(r.revenue)]),
        },
        {
          title: "Unmatched sale names (no corresponding chat agent name)",
          columns: ["Name (as in gnc_sale)", "Sale Count", "Revenue"],
          rows: data.saleLinkage.unmatchedSaleNames.map((r) => [r.name, r.saleCount, formatINR(r.revenue)]),
        },
      ],
    };
    return [overview, agentsSlide, saleLinkage];
  }, [data]);

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={MessageSquare} eyebrow="GNC · Process Performance" title="Chat Performance"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-emerald-600 via-teal-600 to-emerald-700"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {data ? (
          <DashboardExportMenu
            reportTitle="GNC — Chat Performance"
            fileBaseName="GNC_Chat"
            raw={{ dashboard: "gnc_chat", from, to }}
            subtitle={`${from} to ${to}`}
            slides={exportSlides}
            activeSlideTitle={tab === "agents" ? "Agent-wise" : tab === "sale_linkage" ? "Sale Linkage" : "Overview"}
          />
        ) : <span />}
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
          resetLabel="This Month" accentFocus="focus:border-emerald-400"
        />
      </div>

      {loading && !data && <Spinner tone="emerald" />}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {data && headline && (
        <>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
            <strong>Validation findings vs the source workbook:</strong> the reference file mislabels the FRT KPI as
            "In TAT (Within 10 Sec)" in one tile while its own formula and column header elsewhere use a 60-second
            threshold — this dashboard uses 60 seconds (verified against the workbook's own live formula). The
            workbook also carries an older, unrelated "Chat Raw" sheet whose stale Total Chat Count (6,877) disagrees
            with the authoritative "Chat" sheet (6,017) it sits next to — this dashboard is built only on the
            authoritative sheet, matching the live <code>gnc_chat</code> table (no live counterpart exists for
            "Chat Raw").
          </div>

          {tab === "overview" && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <KpiCard icon={MessageSquare} label="Total Chats" value={fmtNum(headline.totalChats)} tone="emerald" />
                <KpiCard icon={Users} label="Unique Chats" value={fmtNum(headline.uniqueChats)} sub={`${fmtPct(headline.totalChats > 0 ? Math.round((headline.uniqueChats / headline.totalChats) * 10000) / 100 : 0)} of overall`} tone="sky" />
                <KpiCard icon={Repeat} label="Repeat Chats" value={fmtNum(headline.repeatChats)} tone="violet" />
                <KpiCard icon={Gauge} label="FRT In-TAT %" value={`${headline.frtInTatPct}%`} sub="within 60 sec" tone="teal" />
                <KpiCard icon={Clock3} label="Resolution In-TAT %" value={`${headline.resolutionInTatPct}%`} sub="within 60 min" tone="indigo" />
                <KpiCard icon={ShoppingCart} label="Orders (Chat)" value={fmtNum(headline.orders)} tone="amber" />
                <KpiCard icon={Gauge} label="Conversion %" value={`${headline.conversionPct}%`} sub="orders / unique chats" tone="rose" />
                <KpiCard icon={IndianRupee} label="Gross Revenue" value={formatINR(headline.grossRevenue)} tone="emerald" />
                <KpiCard icon={IndianRupee} label="Net Revenue" value={formatINR(headline.netRevenue)} tone="cyan" />
                <KpiCard icon={Star} label="Avg CSAT" value={String(headline.avgCsat)} sub={`${headline.csatResponses} responses`} tone="amber" />
              </div>

              <SectionCard icon={MessageSquare} title="Date-wise Chats &amp; TAT" tone="emerald">
                <ComboTrend
                  data={data.dateWiseTrend.map((r) => ({
                    date: r.date, totalChats: r.totalChats, uniqueChats: r.uniqueChats,
                    frtInTatPct: r.frtInTatPct, resolutionInTatPct: r.resolutionInTatPct,
                  }))}
                  series={[
                    { key: "totalChats", name: "Total Chats", kind: "area", color: "#10b981" },
                    { key: "uniqueChats", name: "Unique Chats", kind: "area", color: "#0ea5e9" },
                    { key: "frtInTatPct", name: "FRT In-TAT %", kind: "line", color: "#f59e0b", axis: "right", format: (v) => `${v}%` },
                    { key: "resolutionInTatPct", name: "Resolution In-TAT %", kind: "line", color: "#7c3aed", axis: "right", format: (v) => `${v}%` },
                  ]}
                />
              </SectionCard>

              <SectionCard icon={IndianRupee} title="Date-wise Orders &amp; Revenue (Sale, campaign = Chat)" tone="amber">
                <ComboTrend
                  data={data.dateWiseTrend.map((r) => ({ date: r.date, orders: r.orders, revenue: r.revenue }))}
                  series={[
                    { key: "orders", name: "Orders", kind: "bar", color: "#f59e0b" },
                    { key: "revenue", name: "Revenue", kind: "line", color: "#059669", axis: "right", format: (v) => formatINR(v) },
                  ]}
                />
              </SectionCard>

              <div className="grid gap-4 lg:grid-cols-3">
                <SectionCard icon={Gauge} title="QRC Breakdown" tone="violet" footnote="qrc is the workbook's own Disposition-sheet lookup, already precomputed on the uploaded gnc_chat rows.">
                  <Donut data={data.qrcBreakdown.map((r) => ({ name: r.qrc, value: r.count }))} centerLabel="Total" centerValue={fmtNum(headline.totalChats)} />
                </SectionCard>
                <SectionCard icon={MessageSquare} title="Channel Breakdown" tone="sky">
                  <Donut data={data.channelBreakdown.map((r) => ({ name: r.channel, value: r.count }))} colors={["#25D366", "#E1306C"]} />
                </SectionCard>
                <SectionCard icon={Gauge} title="Ticket Status Breakdown" tone="teal">
                  <Donut data={data.statusBreakdown.map((r) => ({ name: r.status, value: r.count }))} />
                </SectionCard>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <SectionCard icon={Star} title="CSAT Breakdown" tone="amber" footnote={`Only ${headline.csatResponses} of ${headline.totalChats} chats have a CSAT response (bracketed rating format, e.g. "[5]", parsed to its first number).`}>
                  <RankBars data={data.csatBreakdown.map((r) => ({ name: `${r.rating} star`, value: r.count }))} />
                </SectionCard>
                <SectionCard icon={Repeat} title="Top Tags" tone="rose" footnote="Raw tags field (up to 15 shown) -- a finer-grained view than the qrc bucket above, kept separate since the two are distinct live columns.">
                  <RankBars data={data.tagBreakdown.map((r) => ({ name: r.tag, value: r.count }))} maxRows={15} colors={PALETTE} />
                </SectionCard>
              </div>
            </>
          )}

          {tab === "agents" && (
            <SectionCard
              icon={Users} title="Agent-wise Chat Performance" tone="emerald"
              footnote="Grouped by first_agent_name (never null), not agent_name (null on 189 still-queued tickets) -- matching the workbook's own Agent Wise Performance sheet, which groups the same way."
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="py-2 pr-3 font-semibold">Agent</th>
                      <th className="py-2 pr-3 text-right font-semibold">Total Chats</th>
                      <th className="py-2 pr-3 text-right font-semibold">Unique</th>
                      <th className="py-2 pr-3 text-right font-semibold">FRT In-TAT %</th>
                      <th className="py-2 pr-0 text-right font-semibold">Resolution In-TAT %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agents.map((a) => (
                      <tr key={a.agent} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-emerald-50/40">
                        <td className="py-2.5 pr-3 font-medium text-slate-700">{a.agent}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-600">{fmtNum(a.totalChats)}</td>
                        <td className="py-2.5 pr-3 text-right text-slate-600">{fmtNum(a.uniqueChats)}</td>
                        <td className="py-2.5 pr-3 text-right font-semibold text-teal-600">{a.frtInTatPct}%</td>
                        <td className="py-2.5 pr-0 text-right font-semibold text-indigo-600">{a.resolutionInTatPct}%</td>
                      </tr>
                    ))}
                    {data.agents.length === 0 && (
                      <tr><td colSpan={5} className="py-6 text-center text-slate-400">No agents for this period.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {tab === "sale_linkage" && (
            <div className="space-y-4">
              <SectionCard
                icon={IndianRupee} title="Matched to a Chat Agent" tone="emerald"
                footnote="Linked by name only (gnc_chat has no employee-code column) -- case/spacing/trailing-dot normalized, but never forced across a different surname."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-2 pr-3 font-semibold">Agent</th>
                        <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                        <th className="py-2 pr-0 text-right font-semibold">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.saleLinkage.matched.map((r) => (
                        <tr key={r.agent} className="border-b border-slate-50 last:border-0">
                          <td className="py-2.5 pr-3 font-medium text-slate-700">{r.agent}</td>
                          <td className="py-2.5 pr-3 text-right text-slate-600">{fmtNum(r.saleCount)}</td>
                          <td className="py-2.5 pr-0 text-right font-semibold text-emerald-600">{formatINR(r.revenue)}</td>
                        </tr>
                      ))}
                      {data.saleLinkage.matched.length === 0 && (
                        <tr><td colSpan={3} className="py-6 text-center text-slate-400">No matches for this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <SectionCard
                icon={Repeat} title="Unmatched Sale Names" tone="amber"
                footnote="These names appear in gnc_sale (campaign = 'Chat') for this period but have no matching agent name in gnc_chat over the same range -- shown here rather than guessed or silently dropped."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-2 pr-3 font-semibold">Name (as in gnc_sale)</th>
                        <th className="py-2 pr-3 text-right font-semibold">Sale Count</th>
                        <th className="py-2 pr-0 text-right font-semibold">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.saleLinkage.unmatchedSaleNames.map((r) => (
                        <tr key={r.name} className="border-b border-slate-50 last:border-0">
                          <td className="py-2.5 pr-3 font-medium text-slate-700">{r.name}</td>
                          <td className="py-2.5 pr-3 text-right text-slate-600">{fmtNum(r.saleCount)}</td>
                          <td className="py-2.5 pr-0 text-right font-semibold text-amber-600">{formatINR(r.revenue)}</td>
                        </tr>
                      ))}
                      {data.saleLinkage.unmatchedSaleNames.length === 0 && (
                        <tr><td colSpan={3} className="py-6 text-center text-slate-400">Every sale name matched an agent this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}
