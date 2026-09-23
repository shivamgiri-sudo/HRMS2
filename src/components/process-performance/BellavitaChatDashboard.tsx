import { useMemo, useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, PieChart, Pie, Cell, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  MessageSquare, Gauge, Clock3, Repeat, Users, Search, ListFilter, Layers, Loader2,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  formatShortDate, formatINR, currentMonthRange, localDateStr, type ExportSlide,
} from "./DashboardKit";
import { BellavitaChatLobSnapshot } from "./BellavitaChatLobSnapshot";
import { BellavitaChatOverview } from "./BellavitaChatOverview";

const CHAT_API = "/api/process-performance/bellavita-chat-dashboard";

/**
 * Bellavita's real Chat performance dashboard -- live aggregates over
 * db_masmis.bb_chat (189,018 rows, confirmed live 2026-09-17), via GET
 * /api/process-performance/bellavita-chat-dashboard. See the backend
 * service's own header comment for why "Resolved" comes from ticket_status
 * rather than the misleadingly-named is_resolved column (which holds
 * decimal numbers, not a boolean, on live data), and why there's no CSAT
 * KPI (bb_chat has no csat_rating column at all -- confirmed via SHOW
 * COLUMNS, unlike its Neemans sibling table).
 */

interface Headline {
  totalTickets: number; resolvedPct: number; repeatPct: number;
  uniqueCount: number; repeatCount: number;
  avgFrtMin: number; avgResolutionMin: number; avgWaitTimeMin: number;
  activeAgents: number; activeTls: number;
}
interface TrendRow { date: string; tickets: number; uniqueCount: number; resolvedPct: number }
interface DispositionRow { disposition: string; count: number; pct: number }
interface TlRow {
  tlName: string; tickets: number; uniqueCount: number;
  frtPct: number; inTatPct: number; repeatPct: number;
  saleCount: number; amount: number; conversionPct: number;
}
interface AgentRow {
  agent: string; empId: string; tickets: number; uniqueCount: number;
  saleChatCount: number; conversionPct: number;
  resolvedPct: number; avgWaitTimeMin: number;
  revenue: number | null;
}
interface PeriodColumn { key: string; label: string; kind: "week" | "day" }
interface PeriodMetrics {
  totalTickets: number; uniqueCount: number; repeatCount: number; resolvedPct: number; repeatPct: number;
  avgFrtMin: number; avgResolutionMin: number; avgWaitTimeMin: number; activeAgents: number; activeTls: number;
}
interface PeriodBreakdown {
  columns: PeriodColumn[];
  metrics: Record<string, PeriodMetrics>;
  dispositions: Record<string, Record<string, number>>;
  dailyColumnsOmitted: boolean;
}
interface DashboardData {
  headline: Headline; from: string; to: string;
  dateWiseTrend: TrendRow[]; dispositionBreakdown: DispositionRow[]; byTl: TlRow[]; agents: AgentRow[];
  lobOptions: string[];
  latestAvailableDate: string | null;
  chatDataThrough: string | null;
}

const DISPOSITION_COLORS = ["#e11d48", "#f59e0b", "#0ea5e9", "#8b5cf6", "#059669", "#64748b", "#ec4899"];

/** Same "day-of-month 1-7 -> W-1, 8-14 -> W-2, ..." convention this app's
 * other week-wise drill-downs already use (see BellavitaSaleDashboard.tsx's
 * own weekBucket). Keyed by month too, so a range spanning more than one
 * month never merges two different months' "W-1" into one bucket. */
function weekBucket(iso: string): { key: string; label: string } {
  const day = Number(iso.slice(8, 10));
  const monthKey = iso.slice(0, 7);
  const weekNum = Math.ceil(day / 7);
  const startDay = (weekNum - 1) * 7 + 1;
  const daysInMonth = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).getDate();
  const endDay = Math.min(startDay + 6, daysInMonth);
  const monLabel = new Date(iso).toLocaleDateString("en-IN", { month: "short" });
  return { key: `${monthKey}-W${weekNum}`, label: `W-${weekNum} (${startDay}-${endDay} ${monLabel})` };
}

interface TlTrendRow { date: string; tickets: number; uniqueCount: number; saleCount: number; conversionPct: number; amount: number }
interface WeekAgg { key: string; label: string; tickets: number; uniqueCount: number; saleCount: number; amount: number }

/** Right-side drill-down for one TL-wise Summary row: that TL's own
 * date-wise AND week-wise Total Chat/Unique/Sale Count/Amount/Conversion%,
 * fetched fresh from /tl-trend (never reuses the summary table's already-
 * loaded row) -- same convention as Bellavita Sale's EntityDrillDrawer. */
function TlTrendDrawer({
  tlName, from, to, lob, onClose,
}: { tlName: string | null; from: string; to: string; lob: string; onClose: () => void }) {
  const [rows, setRows] = useState<TlTrendRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tlName) return;
    let cancelled = false;
    setRows(null); setError(""); setLoading(true);
    const lobQs = lob ? `&lob=${encodeURIComponent(lob)}` : "";
    hrmsApi.get<{ success: boolean; data: TlTrendRow[] }>(
      `${CHAT_API}/tl-trend?from=${from}&to=${to}&tlName=${encodeURIComponent(tlName)}${lobQs}`,
    )
      .then((res) => { if (!cancelled) setRows(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load this TL's detail."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tlName, from, to, lob]);

  const weekly = useMemo<WeekAgg[]>(() => {
    if (!rows) return [];
    const byWeek = new Map<string, WeekAgg>();
    for (const r of rows) {
      const wk = weekBucket(r.date);
      const cur = byWeek.get(wk.key) ?? { key: wk.key, label: wk.label, tickets: 0, uniqueCount: 0, saleCount: 0, amount: 0 };
      cur.tickets += r.tickets;
      cur.uniqueCount += r.uniqueCount;
      cur.saleCount += r.saleCount;
      cur.amount += r.amount;
      byWeek.set(wk.key, cur);
    }
    return [...byWeek.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [rows]);

  return (
    <Sheet open={!!tlName} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">TL</span>
            <SheetTitle className="text-base font-bold text-slate-800">{tlName}</SheetTitle>
          </div>
          <SheetDescription className="text-[11px] text-slate-400">
            {from} to {to} · Week-wise and date-wise performance for this TL only.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-5 py-4">
          {loading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {error && <p className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
          {rows && (
            <>
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Week-wise</p>
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full border-collapse text-center text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="border border-slate-200 px-2 py-1.5">Week</th>
                        <th className="border border-slate-200 px-2 py-1.5">Total Chat</th>
                        <th className="border border-slate-200 px-2 py-1.5">Unique Chat</th>
                        <th className="border border-slate-200 px-2 py-1.5">Sale Count</th>
                        <th className="border border-slate-200 px-2 py-1.5">Amount</th>
                        <th className="border border-slate-200 px-2 py-1.5">Conv%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekly.map((w) => (
                        <tr key={w.key}>
                          <td className="border border-slate-200 px-2 py-1.5 text-left font-medium text-slate-700">{w.label}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{w.tickets.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{w.uniqueCount.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-emerald-700">{w.saleCount.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-emerald-700">{formatINR(w.amount)}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-indigo-700">{w.tickets > 0 ? Math.round((w.saleCount / w.tickets) * 1000) / 10 : 0}%</td>
                        </tr>
                      ))}
                      {weekly.length === 0 && (
                        <tr><td colSpan={6} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Date-wise</p>
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full border-collapse text-center text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="border border-slate-200 px-2 py-1.5">Date</th>
                        <th className="border border-slate-200 px-2 py-1.5">Total Chat</th>
                        <th className="border border-slate-200 px-2 py-1.5">Unique Chat</th>
                        <th className="border border-slate-200 px-2 py-1.5">Sale Count</th>
                        <th className="border border-slate-200 px-2 py-1.5">Amount</th>
                        <th className="border border-slate-200 px-2 py-1.5">Conv%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.date}>
                          <td className="border border-slate-200 px-2 py-1.5 font-medium text-slate-700">{formatShortDate(r.date)}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{r.tickets.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{r.uniqueCount.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-emerald-700">{r.saleCount.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-emerald-700">{formatINR(r.amount)}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-indigo-700">{r.conversionPct}%</td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr><td colSpan={6} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface AgentTarget { agent: string; empId: string }
interface AgentTrendRow {
  date: string; tickets: number; uniqueCount: number; saleChatCount: number; conversionPct: number; resolvedPct: number; revenue: number | null;
}
interface AgentWeekAgg { key: string; label: string; tickets: number; uniqueCount: number; saleChatCount: number; revenue: number | null }

/** Right-side drill-down for one Agent-wise row (Top 5 / Bottom 5 or the
 * overall table): that agent's own date-wise AND week-wise performance,
 * fetched fresh from /agent-trend -- same convention as TlTrendDrawer
 * above. Revenue only appears when the row has a real emp_id (bb_sale has
 * no agent-name column to join by), matching that row's own "—" for
 * revenue when empId is blank. */
function AgentTrendDrawer({
  target, from, to, lob, onClose,
}: { target: AgentTarget | null; from: string; to: string; lob: string; onClose: () => void }) {
  const [rows, setRows] = useState<AgentTrendRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setRows(null); setError(""); setLoading(true);
    const lobQs = lob ? `&lob=${encodeURIComponent(lob)}` : "";
    const empQs = target.empId ? `&empId=${encodeURIComponent(target.empId)}` : "";
    hrmsApi.get<{ success: boolean; data: AgentTrendRow[] }>(
      `${CHAT_API}/agent-trend?from=${from}&to=${to}&agent=${encodeURIComponent(target.agent)}${lobQs}${empQs}`,
    )
      .then((res) => { if (!cancelled) setRows(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load this agent's detail."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target, from, to, lob]);

  const hasRevenue = !!target?.empId;

  const weekly = useMemo<AgentWeekAgg[]>(() => {
    if (!rows) return [];
    const byWeek = new Map<string, AgentWeekAgg>();
    for (const r of rows) {
      const wk = weekBucket(r.date);
      const cur = byWeek.get(wk.key) ?? { key: wk.key, label: wk.label, tickets: 0, uniqueCount: 0, saleChatCount: 0, revenue: hasRevenue ? 0 : null };
      cur.tickets += r.tickets;
      cur.uniqueCount += r.uniqueCount;
      cur.saleChatCount += r.saleChatCount;
      if (cur.revenue !== null) cur.revenue += r.revenue ?? 0;
      byWeek.set(wk.key, cur);
    }
    return [...byWeek.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [rows, hasRevenue]);

  return (
    <Sheet open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">Agent</span>
            <SheetTitle className="text-base font-bold text-slate-800">{target?.agent}</SheetTitle>
          </div>
          <SheetDescription className="text-[11px] text-slate-400">
            {from} to {to} · Week-wise and date-wise performance for this agent only.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-5 py-4">
          {loading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {error && <p className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
          {rows && (
            <>
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Week-wise</p>
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full border-collapse text-center text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="border border-slate-200 px-2 py-1.5">Week</th>
                        <th className="border border-slate-200 px-2 py-1.5">Total Chat</th>
                        <th className="border border-slate-200 px-2 py-1.5">Unique Chat</th>
                        <th className="border border-slate-200 px-2 py-1.5">Sale Chats</th>
                        <th className="border border-slate-200 px-2 py-1.5">Conv%</th>
                        <th className="border border-slate-200 px-2 py-1.5">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekly.map((w) => (
                        <tr key={w.key}>
                          <td className="border border-slate-200 px-2 py-1.5 text-left font-medium text-slate-700">{w.label}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{w.tickets.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{w.uniqueCount.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-emerald-700">{w.saleChatCount.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-indigo-700">{w.tickets > 0 ? Math.round((w.saleChatCount / w.tickets) * 1000) / 10 : 0}%</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-amber-700">{w.revenue !== null ? formatINR(w.revenue) : "—"}</td>
                        </tr>
                      ))}
                      {weekly.length === 0 && (
                        <tr><td colSpan={6} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Date-wise</p>
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full border-collapse text-center text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="border border-slate-200 px-2 py-1.5">Date</th>
                        <th className="border border-slate-200 px-2 py-1.5">Total Chat</th>
                        <th className="border border-slate-200 px-2 py-1.5">Unique Chat</th>
                        <th className="border border-slate-200 px-2 py-1.5">Sale Chats</th>
                        <th className="border border-slate-200 px-2 py-1.5">Conv%</th>
                        <th className="border border-slate-200 px-2 py-1.5">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.date}>
                          <td className="border border-slate-200 px-2 py-1.5 font-medium text-slate-700">{formatShortDate(r.date)}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{r.tickets.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 text-slate-600">{r.uniqueCount.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-emerald-700">{r.saleChatCount.toLocaleString("en-IN")}</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-indigo-700">{r.conversionPct}%</td>
                          <td className="border border-slate-200 px-2 py-1.5 font-semibold text-amber-700">{r.revenue !== null ? formatINR(r.revenue) : "—"}</td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr><td colSpan={6} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Compact 5-row table shared by the Top 5 / Bottom 5 Performers cards. */
function AgentMiniTable({ rows, onRowClick }: { rows: AgentRow[]; onRowClick: (a: AgentRow) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <th className="py-2 pr-3 font-semibold">Agent</th>
            <th className="py-2 pr-3 text-right font-semibold">Unique</th>
            <th className="py-2 pr-3 text-right font-semibold">Conversion %</th>
            <th className="py-2 pr-0 text-right font-semibold">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr
              key={`${a.empId}-${a.agent}`} onClick={() => onRowClick(a)} role="button" tabIndex={0}
              className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-rose-50/40"
            >
              <td className="py-2.5 pr-3">
                <div className="font-medium text-rose-700 underline-offset-2 hover:underline">{a.agent}</div>
                <div className="text-[11px] text-slate-400">{a.empId || "—"}</div>
              </td>
              <td className="py-2.5 pr-3 text-right text-slate-600">{a.uniqueCount.toLocaleString("en-IN")}</td>
              <td className="py-2.5 pr-3 text-right font-semibold text-emerald-600">{a.conversionPct}%</td>
              <td className="py-2.5 pr-0 text-right font-semibold text-amber-700">{a.revenue !== null ? formatINR(a.revenue) : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** "overview" is the new Chat Dashboard BVO snapshot (new_bb_chat). The other
 * tabs -- including "legacy", the previous Overview -- still read the older
 * bb_chat table and keep working as before. */
type TabKey = "overview" | "tl" | "agents" | "snapshot" | "legacy";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "tl", label: "TL-wise" },
  { key: "agents", label: "Agent-wise" },
  { key: "snapshot", label: "Snapshot" },
  { key: "legacy", label: "Legacy" },
];

export function BellavitaChatDashboard() {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const [agentSearch, setAgentSearch] = useState("");
  const [lob, setLob] = useState("");
  const [drawerTl, setDrawerTl] = useState<string | null>(null);
  const [drawerAgent, setDrawerAgent] = useState<AgentTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const lobQs = lob ? `&lob=${encodeURIComponent(lob)}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/bellavita-chat-dashboard?from=${from}&to=${to}${lobQs}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Bellavita Chat dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to, lob]);

  // The legacy bb_chat aggregate is slow, so it only loads for the tabs that use it.
  const needsLegacy = tab === "tl" || tab === "agents" || tab === "legacy";
  useEffect(() => { if (needsLegacy) void load(); }, [load, needsLegacy]);

  // Week-wise / date-wise figures for the export: every download carries a Value column plus
  // one column per week and per day. Loaded alongside the page so the export is never missing them.
  const [periods, setPeriods] = useState<PeriodBreakdown | null>(null);
  const [periodsState, setPeriodsState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    if (!needsLegacy) return;
    let cancelled = false;
    setPeriodsState("loading");
    const lobQs = lob ? `&lob=${encodeURIComponent(lob)}` : "";
    hrmsApi
      .get<{ success: boolean; data: PeriodBreakdown }>(`${CHAT_API}/period-breakdown?from=${from}&to=${to}${lobQs}`)
      .then((res) => { if (!cancelled) { setPeriods(res.data); setPeriodsState("ready"); } })
      .catch(() => { if (!cancelled) { setPeriods(null); setPeriodsState("failed"); } });
    return () => { cancelled = true; };
  }, [from, to, lob, needsLegacy]);

  const filteredAgents = useMemo(() => {
    const rows = data?.agents ?? [];
    const q = agentSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q));
  }, [data, agentSearch]);

  /** Top 5 / Bottom 5 ranked by a composite of Unique Chat, Conversion % and
   * Revenue -- each metric turned into a 0..1 percentile rank within this
   * period's agents, then averaged, so no single metric (e.g. a big chat
   * volume with poor conversion) dominates the ranking on its own. Agents
   * with no real emp_id (revenue: null, can't be joined to bb_sale) rank
   * lowest on that one dimension rather than being excluded outright. */
  const { topAgents, bottomAgents } = useMemo(() => {
    const rows = data?.agents ?? [];
    if (rows.length === 0) return { topAgents: [] as AgentRow[], bottomAgents: [] as AgentRow[] };
    const percentileRank = (pick: (a: AgentRow) => number): Map<AgentRow, number> => {
      const sorted = [...rows].sort((a, b) => pick(a) - pick(b));
      const m = new Map<AgentRow, number>();
      sorted.forEach((r, i) => m.set(r, sorted.length > 1 ? i / (sorted.length - 1) : 1));
      return m;
    };
    const uniqueRank = percentileRank((a) => a.uniqueCount);
    const convRank = percentileRank((a) => a.conversionPct);
    const revRank = percentileRank((a) => a.revenue ?? -1);
    const scored = rows
      .map((row) => ({ row, score: ((uniqueRank.get(row) ?? 0) + (convRank.get(row) ?? 0) + (revRank.get(row) ?? 0)) / 3 }))
      .sort((a, b) => b.score - a.score);
    return {
      topAgents: scored.slice(0, 5).map((s) => s.row),
      bottomAgents: scored.slice(-5).reverse().map((s) => s.row),
    };
  }, [data]);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const hl = data.headline;
    // Metric | Value | W-1 .. W-n | 1-Sep .. n -- the Value column is the whole selected range.
    const p = periods;
    const periodHead = (p?.columns ?? []).map((c) => c.label);
    const metricDefs: Array<{ label: string; range: string | number; pick: (m: PeriodMetrics) => string | number }> = [
      { label: "Total Tickets", range: hl.totalTickets, pick: (m) => m.totalTickets },
      { label: "Unique Chats", range: hl.uniqueCount, pick: (m) => m.uniqueCount },
      { label: "Repeat Chats", range: hl.repeatCount, pick: (m) => m.repeatCount },
      { label: "Resolved %", range: `${hl.resolvedPct}%`, pick: (m) => `${m.resolvedPct}%` },
      { label: "Repeat %", range: `${hl.repeatPct}%`, pick: (m) => `${m.repeatPct}%` },
      { label: "Avg FRT", range: `${hl.avgFrtMin}m`, pick: (m) => `${m.avgFrtMin}m` },
      { label: "Avg Resolution", range: `${hl.avgResolutionMin}m`, pick: (m) => `${m.avgResolutionMin}m` },
      { label: "Avg Wait Time", range: `${hl.avgWaitTimeMin}m`, pick: (m) => `${m.avgWaitTimeMin}m` },
      { label: "Active Agents", range: hl.activeAgents, pick: (m) => m.activeAgents },
      { label: "Active TLs", range: hl.activeTls, pick: (m) => m.activeTls },
    ];
    const overview: ExportSlide = {
      title: "Overview",
      tables: [
        {
          title: "Overview metrics",
          columns: ["Metric", "Value", ...periodHead],
          rows: metricDefs.map((d) => [
            d.label, d.range, ...(p?.columns ?? []).map((c) => (p?.metrics[c.key] ? d.pick(p.metrics[c.key]) : 0)),
          ]),
        },
        {
          title: "Disposition Breakdown",
          columns: ["Disposition", "Count", "Share", ...periodHead],
          rows: data.dispositionBreakdown.map((d) => [
            d.disposition, d.count, `${d.pct}%`, ...(p?.columns ?? []).map((c) => p?.dispositions[c.key]?.[d.disposition] ?? 0),
          ]),
        },
      ],
    };
    const tl: ExportSlide = {
      title: "TL-wise",
      tables: [{
        title: "TL-wise Summary",
        columns: ["TL Name", "Total Chat", "Unique Chat", "FRT %", "IN TAT %", "Repeat %", "Sale Count", "Amount", "Conversion %"],
        rows: data.byTl.map((r) => [
          r.tlName, r.tickets, r.uniqueCount, `${r.frtPct}%`, `${r.inTatPct}%`, `${r.repeatPct}%`,
          r.saleCount, formatINR(r.amount), `${r.conversionPct}%`,
        ]),
      }],
    };
    const agentsSlide: ExportSlide = {
      title: "Agent-wise",
      tables: [{
        title: "Agent-wise Chat Performance",
        columns: ["Agent", "Emp ID", "Total Chats", "Unique", "Sale Chats", "Conversion %", "Resolved %", "Avg Wait Time"],
        rows: data.agents.map((a) => [
          a.agent, a.empId, a.tickets, a.uniqueCount, a.saleChatCount, `${a.conversionPct}%`,
          `${a.resolvedPct}%`, a.avgWaitTimeMin ? `${a.avgWaitTimeMin}m` : "—",
        ]),
      }],
    };
    return [overview, tl, agentsSlide];
  }, [data, periods]);

  const headline = data?.headline;

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={MessageSquare} eyebrow="Bellavita · Process Performance" title="Chat Sale Performance"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-rose-500 via-pink-500 to-rose-600"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {needsLegacy && periodsState === "loading" ? (
          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-500">Preparing week &amp; date columns for export…</span>
        ) : needsLegacy ? (
          <DashboardExportMenu
            reportTitle="Bellavita — Chat Sale Performance"
            fileBaseName="Bellavita_Chat"
            raw={{ dashboard: "bellavita_chat", from, to, lob: lob || undefined }}
            subtitle={`${from} to ${to}`}
            slides={exportSlides}
            activeSlideTitle={tab === "tl" ? "TL-wise" : tab === "agents" ? "Agent-wise" : "Overview"}
          />
        ) : <span />}
        <div className="flex flex-wrap items-center gap-2">
          {needsLegacy && (
            <select
              value={lob}
              onChange={(e) => setLob(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors focus:border-rose-400 focus:outline-none"
            >
              <option value="">All LOBs</option>
              {(data?.lobOptions ?? []).map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          )}
          <DateRangeToolbar
            from={from} to={to} onFrom={setFrom} onTo={setTo}
            onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
            resetLabel="This Month" accentFocus="focus:border-rose-400"
          />
        </div>
      </div>

      {needsLegacy && periodsState === "failed" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          The week-wise and date-wise figures couldn't be loaded, so a download from this tab would only carry the overall Value column. Change the date range or reload to retry.
        </div>
      )}

      {tab === "overview" && (
        <BellavitaChatOverview
          apiPath={CHAT_API} from={from} to={to}
          onRangeChange={(f, t) => { setFrom(f); setTo(t); }}
        />
      )}

      {needsLegacy && loading && !data && <Spinner tone="blue" />}
      {needsLegacy && error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {needsLegacy && data && headline && headline.totalTickets === 0 && data.latestAvailableDate && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          <span>
            No chat tickets between {from} and {to} — the most recent uploaded data is from{" "}
            <strong>{data.latestAvailableDate}</strong>, so this window is real, just outside where the data currently ends.
          </span>
          <button
            type="button"
            onClick={() => {
              const end = new Date(data.latestAvailableDate!);
              const start = new Date(end);
              start.setDate(start.getDate() - 6);
              setFrom(localDateStr(start));
              setTo(localDateStr(end));
            }}
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-amber-700"
          >
            Show last 7 days of available data
          </button>
        </div>
      )}

      {needsLegacy && data && data.chatDataThrough && data.chatDataThrough < to && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          Total Chat, Unique, Conversion % and Resolved % below only reflect data through{" "}
          <strong>{data.chatDataThrough}</strong> — db_masmis.bb_chat has no chat_date recorded past that date for
          the current upload, even though {to} was selected. Amount/Revenue figures are not affected (they come
          from bb_sale, a separate, complete table for the full selected range).
        </div>
      )}

      {tab === "legacy" && data && headline && (
      <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-10">
        <KpiCard icon={MessageSquare} label="Total Tickets" value={headline.totalTickets.toLocaleString("en-IN")} sub="overall" tone="rose" />
        <KpiCard icon={MessageSquare} label="Unique Chats" value={headline.uniqueCount.toLocaleString("en-IN")} sub={`${headline.totalTickets > 0 ? Math.round((headline.uniqueCount / headline.totalTickets) * 10000) / 100 : 0}% of overall`} tone="sky" />
        <KpiCard icon={Repeat} label="Repeat Chats" value={headline.repeatCount.toLocaleString("en-IN")} sub={`${headline.repeatPct}% of overall`} tone="violet" />
        <KpiCard icon={Gauge} label="Resolved %" value={`${headline.resolvedPct}%`} tone="emerald" />
        <KpiCard icon={Clock3} label="Avg FRT" value={`${headline.avgFrtMin}m`} tone="sky" />
        <KpiCard icon={Clock3} label="Avg Resolution" value={`${headline.avgResolutionMin}m`} tone="indigo" />
        <KpiCard icon={Clock3} label="Avg Wait Time" value={`${headline.avgWaitTimeMin}m`} tone="amber" />
        <KpiCard icon={Users} label="Active Agents" value={String(headline.activeAgents)} tone="teal" />
        <KpiCard icon={Users} label="Active TLs" value={String(headline.activeTls)} tone="cyan" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
        <SectionCard icon={MessageSquare} title="Date-wise Tickets — Overall vs Unique" tone="rose">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="bbChatFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e11d48" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#e11d48" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="bbChatUniqueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="tickets" name="Overall" stroke="#e11d48" strokeWidth={2.5} fill="url(#bbChatFill)" />
              <Area type="monotone" dataKey="uniqueCount" name="Unique" stroke="#0ea5e9" strokeWidth={2} fill="url(#bbChatUniqueFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </SectionCard>
        </div>
        <SectionCard icon={Layers} title="Disposition Breakdown" tone="violet">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.dispositionBreakdown} dataKey="count" nameKey="disposition" cx="50%" cy="50%" innerRadius={44} outerRadius={82} paddingAngle={2} label={(p: { disposition?: string }) => p.disposition ?? ""}>
                {data.dispositionBreakdown.map((entry, i) => (
                  <Cell key={entry.disposition} fill={DISPOSITION_COLORS[i % DISPOSITION_COLORS.length]} stroke="white" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
      </>
      )}

      {tab === "tl" && data && (
      <div className="space-y-4">
        <SectionCard icon={Users} title="TL-wise Comparison" tone="rose" footnote="Bars are Total Chat and Sale Count (left axis); the line is Conversion % (right axis).">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data.byTl} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="tlName" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="tickets" name="Total Chat" fill="#fecdd3" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="l" dataKey="saleCount" name="Sale Count" fill="#a7f3d0" radius={[4, 4, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="conversionPct" name="Conversion %" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard
          icon={Users} title="TL-wise Summary" tone="rose"
          footnote="Click a TL name for its date-wise and week-wise breakdown. Amount is SUM(bb_sale.amount) for that TL where campaign = 'Chat', over the same date range — a real figure from Bellavita's sale table, matched by TL name. It reflects every Chat-channel sale for that TL and does not narrow further when the LOB filter above is set to Bevzilla or Kenaz specifically, since bb_sale has no such split."
        >
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[880px] border-collapse text-center text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-slate-300">
                  <th className="border-b border-slate-700 bg-slate-800 py-2.5 px-3 font-bold text-white">TL Name</th>
                  <th className="border-b border-l border-slate-700 bg-slate-800 py-2.5 px-3 font-bold text-white">Total Chat</th>
                  <th className="border-b border-l border-slate-700 bg-slate-800 py-2.5 px-3 font-bold text-white">Unique Chat</th>
                  <th className="border-b border-l border-slate-700 bg-slate-800 py-2.5 px-3 font-bold text-white">FRT %</th>
                  <th className="border-b border-l border-slate-700 bg-slate-800 py-2.5 px-3 font-bold text-white">IN TAT %</th>
                  <th className="border-b border-l border-slate-700 bg-slate-800 py-2.5 px-3 font-bold text-white">Repeat %</th>
                  <th className="border-b border-l-2 border-emerald-400/40 bg-emerald-900 py-2.5 px-3 font-bold text-white">Sale Count</th>
                  <th className="border-b border-emerald-900 bg-emerald-900 py-2.5 px-3 font-bold text-white">Amount</th>
                  <th className="border-b border-l-2 border-indigo-400/40 bg-indigo-950 py-2.5 px-3 font-bold text-white">Conversion %</th>
                </tr>
              </thead>
              <tbody>
                {data.byTl.map((r, i) => (
                  <tr
                    key={r.tlName} onClick={() => setDrawerTl(r.tlName)} role="button" tabIndex={0}
                    className={`cursor-pointer transition-colors hover:bg-rose-50/40 ${i % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}
                  >
                    <td className="border-b border-slate-50 py-2.5 px-3 text-center font-medium text-rose-700 underline-offset-2 hover:underline">{r.tlName}</td>
                    <td className="border-b border-l border-slate-50 py-2.5 px-3 text-center text-slate-600">{r.tickets.toLocaleString("en-IN")}</td>
                    <td className="border-b border-l border-slate-50 py-2.5 px-3 text-center text-slate-600">{r.uniqueCount.toLocaleString("en-IN")}</td>
                    <td className="border-b border-l border-slate-50 py-2.5 px-3 text-center text-slate-600">{r.frtPct}%</td>
                    <td className="border-b border-l border-slate-50 py-2.5 px-3 text-center text-slate-600">{r.inTatPct}%</td>
                    <td className="border-b border-l border-slate-50 py-2.5 px-3 text-center text-slate-600">{r.repeatPct}%</td>
                    <td className="border-b border-l-2 border-emerald-100 bg-emerald-50/40 py-2.5 px-3 text-center font-semibold text-emerald-700">{r.saleCount.toLocaleString("en-IN")}</td>
                    <td className="border-b border-emerald-100 bg-emerald-50/40 py-2.5 px-3 text-center font-semibold text-emerald-700">{formatINR(r.amount)}</td>
                    <td className="border-b border-l-2 border-indigo-100 bg-indigo-50/40 py-2.5 px-3 text-center font-bold text-indigo-700">{r.conversionPct}%</td>
                  </tr>
                ))}
                {data.byTl.length === 0 && (
                  <tr><td colSpan={9} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
      )}

      {tab === "agents" && data && (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard icon={Users} title="Top 5 Performers" tone="emerald" footnote="Ranked by a combined percentile of Unique Chat, Conversion % and Revenue. Click a row for date-wise/week-wise detail.">
            <AgentMiniTable rows={topAgents} onRowClick={(a) => setDrawerAgent({ agent: a.agent, empId: a.empId })} />
          </SectionCard>
          <SectionCard icon={Users} title="Bottom 5 Performers" tone="amber" footnote="Same combined ranking, lowest 5. Click a row for date-wise/week-wise detail.">
            <AgentMiniTable rows={bottomAgents} onRowClick={(a) => setDrawerAgent({ agent: a.agent, empId: a.empId })} />
          </SectionCard>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input type="text" value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} placeholder="Search agent name or ID..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-rose-400 focus:outline-none" />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />{filteredAgents.length} of {data.agents.length} agents
          </span>
        </div>
        <SectionCard
          icon={Users} title="Overall Agent-wise Chat Performance" tone="rose"
          footnote="Click a row for date-wise/week-wise detail. Some rows show 'Unassigned' — agent_name/emp_id is NULL on part of the uploaded data (visible on the most recent upload batches), which this dashboard reflects rather than guesses. Sale Chats counts disposition = 'Saleschat' specifically — the separate 'Inactive sale chat' disposition (visible in Disposition Breakdown) is not counted here, since 'inactive' means it didn't convert. Revenue is '—' for rows with no real emp_id to join bb_sale by."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Agent</th>
                  <th className="py-2 pr-3 text-right font-semibold">Total Chats</th>
                  <th className="py-2 pr-3 text-right font-semibold">Unique</th>
                  <th className="py-2 pr-3 text-right font-semibold">Sale Chats</th>
                  <th className="py-2 pr-3 text-right font-semibold">Conversion %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Resolved %</th>
                  <th className="py-2 pr-3 text-right font-semibold">Avg Wait Time</th>
                  <th className="py-2 pr-0 text-right font-semibold">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((a) => (
                  <tr
                    key={`${a.empId}-${a.agent}`} onClick={() => setDrawerAgent({ agent: a.agent, empId: a.empId })} role="button" tabIndex={0}
                    className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-rose-50/40"
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-rose-700 underline-offset-2 hover:underline">{a.agent}</div>
                      <div className="text-[11px] text-slate-400">{a.empId || "—"}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.tickets.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.uniqueCount.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.saleChatCount.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-emerald-600">{a.conversionPct}%</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{a.resolvedPct}%</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.avgWaitTimeMin ? `${a.avgWaitTimeMin}m` : "—"}</td>
                    <td className="py-2.5 pr-0 text-right font-semibold text-amber-700">{a.revenue !== null ? formatINR(a.revenue) : "—"}</td>
                  </tr>
                ))}
                {filteredAgents.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
      )}

      {tab === "snapshot" && <BellavitaChatLobSnapshot />}

      <TlTrendDrawer tlName={drawerTl} from={from} to={to} lob={lob} onClose={() => setDrawerTl(null)} />
      <AgentTrendDrawer target={drawerAgent} from={from} to={to} lob={lob} onClose={() => setDrawerAgent(null)} />
    </div>
  );
}
