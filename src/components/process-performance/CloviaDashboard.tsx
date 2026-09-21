import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  PhoneIncoming, PhoneMissed, Timer, Users, Mail, MessageSquare, Star, ShieldCheck,
  CalendarDays, TrendingUp, PhoneOff, Repeat, LayoutDashboard, Headset, Grid3x3, PhoneOutgoing,
} from "lucide-react";
import { DashboardExportMenu, type ExportSlide } from "./DashboardKit";
import { CloviaLobSlide } from "./CloviaLobSlide";
import { CloviaInboundSlide } from "./CloviaInboundSlide";

// ── Types ────────────────────────────────────────────────────────────────
interface InboundSummary {
  total: number; answered: number; abandoned: number; ans_pct: number; abandon_pct: number;
  sl_pct: number; avg_handle: number; login_count: number; unique_phones: number;
  mandate: number; required: number;
}
interface TrendRow { date: string; login_count: number; offered: number; answered: number; sl_num: number; acht: number; unique_phones: number }
interface HourlyByDateRow { date: string; hour: number; offered: number; answered: number; sl_pct: number; acht: number }
interface AgentRow { agentId: string; agentName: string; offered: number; answered: number; sl_pct: number; acht: number; repeat_pct: number }

interface EmailChannel { available: true; totalAssigned: number; touched: number; closed: number; open: number; inProcess: number; reOpen: number; junk: number; trend: { date: string; assigned: number; closed: number }[] }
interface ChatChannel { available: true; totalChats: number; respondedChats: number; resolvedYes: number; resolvedNo: number; csatPct: number; avgChatDurationSec: number; trend: { date: string; chats: number }[] }
interface FeedbackChannel { available: true; totalFeedback: number; satisfiedCount: number; notSatisfiedCount: number; csatPct: number; dsatPct: number }
interface QualityChannel { available: true; auditsCount: number; avgScorePct: number; fatalCount: number }
interface ProductivityChannel { available: true; agentCount: number; presentDays: number; totalLoginSeconds: number; avgUtilizationPct: number; totalCallsLogged: number }
interface RechurnChannel { available: true; totalCalls: number; abandonedCount: number; byStatus: { status: string; count: number }[] }
interface DispositionChannel { available: true; totalTickets: number; ftrCount: number; ftrPct: number; topReasons: { reason: string; count: number }[] }
interface OutboundChannel { available: true; totalCalls: number; connectedCalls: number; connectedPct: number; avgTalkSec: number; agentCount: number; trend: { date: string; calls: number; connected: number }[] }
interface ChannelsData {
  from: string; to: string;
  email: EmailChannel; chat: ChatChannel; feedback: FeedbackChannel; quality: QualityChannel;
  productivity: ProductivityChannel; rechurn: RechurnChannel; disposition: DispositionChannel;
  outbound: OutboundChannel;
}

const formatSecs = (s: number) => {
  const total = Math.round(s || 0);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
};
const formatShortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = localDateStr(now);
  return { from, to };
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-purple-500" />
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, tone,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className={`mb-2 inline-flex rounded-xl p-2 ${tone}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xl font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-slate-700">{title}</p>
      {children}
    </div>
  );
}

/** Snapshot of InboundSlide's already-fetched data, lifted to the parent
 * purely for the "Export" feature -- no new fetch, no new calculation. */
export interface InboundExportData {
  summary: InboundSummary | null;
  trend: TrendRow[] | null;
  agents: AgentRow[] | null;
  hourlyByDate: HourlyByDateRow[] | null;
  selectedDate: string;
}

// ── Inbound slide ────────────────────────────────────────────────────────
function InboundSlide({ from, to, onData }: { from: string; to: string; onData?: (d: InboundExportData) => void }) {
  const [summary, setSummary] = useState<InboundSummary | null>(null);
  const [trend, setTrend] = useState<TrendRow[] | null>(null);
  const [hourlyByDate, setHourlyByDate] = useState<HourlyByDateRow[] | null>(null);
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = `startDate=${from}&endDate=${to}`;
      const [s, t, hbd, a] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: InboundSummary }>(`/api/inbound/project/clovia?${qs}`),
        hrmsApi.get<{ success: boolean; data: TrendRow[] }>(`/api/inbound/project/clovia/trend?${qs}`),
        hrmsApi.get<{ success: boolean; data: HourlyByDateRow[] }>(`/api/inbound/project/clovia/hourly-by-date?${qs}`),
        hrmsApi.get<{ success: boolean; data: AgentRow[] }>(`/api/inbound/project/clovia/agents?${qs}`),
      ]);
      setSummary(s.data);
      setTrend(t.data);
      setHourlyByDate(hbd.data);
      setAgents(a.data);
      const dates = [...new Set(hbd.data.map((r) => r.date))].sort();
      setSelectedDate((prev) => (prev && dates.includes(prev) ? prev : dates[dates.length - 1] ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Clovia Inbound data.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    onData?.({ summary, trend, agents, hourlyByDate, selectedDate });
  }, [summary, trend, agents, hourlyByDate, selectedDate, onData]);

  const dates = useMemo(() => [...new Set((hourlyByDate ?? []).map((r) => r.date))].sort(), [hourlyByDate]);
  const hours = useMemo(() => [...new Set((hourlyByDate ?? []).map((r) => r.hour))].sort((a, b) => a - b), [hourlyByDate]);
  const cellByDateHour = useMemo(() => {
    const m = new Map<string, HourlyByDateRow>();
    for (const r of hourlyByDate ?? []) m.set(`${r.date}|${r.hour}`, r);
    return m;
  }, [hourlyByDate]);
  const maxOffered = useMemo(() => Math.max(1, ...(hourlyByDate ?? []).map((r) => r.offered)), [hourlyByDate]);
  const slotRows = useMemo(
    () => (hourlyByDate ?? []).filter((r) => r.date === selectedDate).sort((a, b) => a.hour - b.hour),
    [hourlyByDate, selectedDate],
  );
  const slotTotals = useMemo(() => {
    const offered = slotRows.reduce((s, r) => s + r.offered, 0);
    const answered = slotRows.reduce((s, r) => s + r.answered, 0);
    return { offered, answered, sl_pct: offered ? Math.round((slotRows.reduce((s, r) => s + (r.sl_pct * r.offered) / 100, 0) / offered) * 10000) / 100 : 0 };
  }, [slotRows]);

  if (loading && !summary) return <Spinner />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!summary) return null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        <KpiCard icon={PhoneIncoming} label="Call Offered" value={summary.total.toLocaleString("en-IN")} tone="bg-purple-50 text-purple-600" />
        <KpiCard icon={PhoneIncoming} label="Call Answered" value={summary.answered.toLocaleString("en-IN")} tone="bg-fuchsia-50 text-fuchsia-600" />
        <KpiCard icon={TrendingUp} label="AL %" value={`${summary.ans_pct}%`} tone="bg-emerald-50 text-emerald-600" />
        <KpiCard icon={PhoneMissed} label="Abandoned" value={`${summary.abandoned} (${summary.abandon_pct}%)`} tone="bg-red-50 text-red-600" />
        <KpiCard icon={Headset} label="SL %" value={`${summary.sl_pct}%`} tone="bg-sky-50 text-sky-600" />
        <KpiCard icon={Timer} label="ACHT" value={formatSecs(summary.avg_handle)} tone="bg-amber-50 text-amber-600" />
        <KpiCard icon={Users} label="Agents Logged In" value={String(summary.login_count)} sub={`req ${summary.required} / mandate ${summary.mandate}`} tone="bg-indigo-50 text-indigo-600" />
        <KpiCard icon={Repeat} label="Unique Callers" value={summary.unique_phones.toLocaleString("en-IN")} tone="bg-teal-50 text-teal-600" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm lg:col-span-2">
          <p className="mb-3 text-sm font-semibold text-slate-700">Date-wise Call Performance</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend ?? []} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="offered" name="Offered" stroke="#9333ea" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="answered" name="Answered" stroke="#0ea5e9" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="py-2 pr-3 text-right font-semibold">Offered</th>
                  <th className="py-2 pr-3 text-right font-semibold">Answered</th>
                  <th className="py-2 pr-3 text-right font-semibold">SL%</th>
                  <th className="py-2 pr-0 text-right font-semibold">ACHT</th>
                </tr>
              </thead>
              <tbody>
                {(trend ?? []).map((r) => {
                  const slPct = r.answered ? Math.round((r.sl_num / r.answered) * 10000) / 100 : 0;
                  return (
                    <tr key={r.date} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 pr-3 font-medium text-slate-700">{formatShortDate(r.date)}</td>
                      <td className="py-2 pr-3 text-right text-slate-600">{r.offered}</td>
                      <td className="py-2 pr-3 text-right text-slate-600">{r.answered}</td>
                      <td className="py-2 pr-3 text-right text-slate-600">{slPct}%</td>
                      <td className="py-2 pr-0 text-right text-slate-600">{formatSecs(r.acht)}</td>
                    </tr>
                  );
                })}
                {(trend ?? []).length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">Slot-wise Performance</p>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
            >
              {dates.map((d) => <option key={d} value={d}>{formatShortDate(d)}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Hour</th>
                  <th className="py-2 pr-3 text-right font-semibold">Offered</th>
                  <th className="py-2 pr-3 text-right font-semibold">SL%</th>
                  <th className="py-2 pr-0 text-right font-semibold">ACHT</th>
                </tr>
              </thead>
              <tbody>
                {slotRows.map((r) => (
                  <tr key={r.hour} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 pr-3 text-slate-700">{String(r.hour).padStart(2, "0")}:00</td>
                    <td className="py-1.5 pr-3 text-right text-slate-600">{r.offered}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-600">{r.sl_pct}%</td>
                    <td className="py-1.5 pr-0 text-right text-slate-600">{formatSecs(r.acht)}</td>
                  </tr>
                ))}
                {slotRows.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">No data.</td></tr>
                )}
              </tbody>
              {slotRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 font-semibold text-slate-700">
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 pr-3 text-right">{slotTotals.offered}</td>
                    <td className="py-2 pr-3 text-right">{slotTotals.sl_pct}%</td>
                    <td className="py-2 pr-0 text-right">—</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Grid3x3 className="h-4 w-4 text-slate-400" /> Hourly Call Volume Heatmap
        </p>
        <div className="overflow-x-auto">
          <table className="border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white px-2 py-1 text-left font-semibold text-slate-500">Hour</th>
                {dates.map((d) => (
                  <th key={d} className="px-1.5 py-1 text-center font-semibold text-slate-500">{formatShortDate(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h}>
                  <td className="sticky left-0 bg-white px-2 py-1 font-medium text-slate-600">{String(h).padStart(2, "0")}:00</td>
                  {dates.map((d) => {
                    const cell = cellByDateHour.get(`${d}|${h}`);
                    const v = cell?.offered ?? 0;
                    const intensity = v / maxOffered;
                    return (
                      <td
                        key={d}
                        className="px-1.5 py-1 text-center text-slate-700"
                        style={{ backgroundColor: v > 0 ? `rgba(147, 51, 234, ${0.12 + intensity * 0.55})` : "transparent" }}
                        title={`${formatShortDate(d)} ${h}:00 — Offered ${v}, SL ${cell?.sl_pct ?? 0}%`}
                      >
                        {v > 0 ? v : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {hours.length === 0 && (
                <tr><td className="py-6 text-center text-slate-400" colSpan={dates.length + 1}>No data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SectionCard title={`Agent-wise Performance (${(agents ?? []).length} agents)`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">Agent</th>
                <th className="py-2 pr-3 text-right font-semibold">Offered</th>
                <th className="py-2 pr-3 text-right font-semibold">Answered</th>
                <th className="py-2 pr-3 text-right font-semibold">SL%</th>
                <th className="py-2 pr-3 text-right font-semibold">ACHT</th>
                <th className="py-2 pr-0 text-right font-semibold">Repeat%</th>
              </tr>
            </thead>
            <tbody>
              {(agents ?? []).map((a) => (
                <tr key={a.agentId} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-700">{a.agentName}</div>
                    <div className="text-[11px] text-slate-400">{a.agentId}</div>
                  </td>
                  <td className="py-2 pr-3 text-right text-slate-600">{a.offered}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{a.answered}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{a.sl_pct}%</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{formatSecs(a.acht)}</td>
                  <td className="py-2 pr-0 text-right text-slate-600">{a.repeat_pct}%</td>
                </tr>
              ))}
              {(agents ?? []).length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-slate-400">No agent data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Channels slide ───────────────────────────────────────────────────────
function ChannelsSlide({ from, to, onData }: { from: string; to: string; onData?: (d: ChannelsData | null) => void }) {
  const [data, setData] = useState<ChannelsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ChannelsData }>(
        `/api/process-performance/clovia-channels-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Clovia channel data.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => { onData?.(data); }, [data, onData]);

  if (loading && !data) return <Spinner />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Outbound">
          <div className="grid grid-cols-4 gap-3 text-center">
            <div><p className="text-lg font-bold text-slate-800">{data.outbound.totalCalls.toLocaleString("en-IN")}</p><p className="text-[11px] text-slate-400">Dialed</p></div>
            <div><p className="text-lg font-bold text-emerald-600">{data.outbound.connectedCalls.toLocaleString("en-IN")}</p><p className="text-[11px] text-slate-400">Connected</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.outbound.connectedPct}%</p><p className="text-[11px] text-slate-400">Connected%</p></div>
            <div><p className="text-lg font-bold text-slate-800">{formatSecs(data.outbound.avgTalkSec)}</p><p className="text-[11px] text-slate-400">Avg Talk</p></div>
          </div>
          {data.outbound.trend.length > 0 && (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={data.outbound.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="calls" name="Dialed" fill="#9333ea" radius={[3, 3, 0, 0]} />
                <Bar dataKey="connected" name="Connected" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {data.outbound.totalCalls === 0 && (
            <p className="mt-2 text-center text-[11px] text-slate-400">No outbound data uploaded yet for this period — Uploader → Outbound.</p>
          )}
        </SectionCard>

        <SectionCard title="Email">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-lg font-bold text-slate-800">{data.email.totalAssigned}</p><p className="text-[11px] text-slate-400">Assigned</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.email.closed}</p><p className="text-[11px] text-slate-400">Closed</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.email.open}</p><p className="text-[11px] text-slate-400">Open</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.email.inProcess}</p><p className="text-[11px] text-slate-400">In Process</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.email.reOpen}</p><p className="text-[11px] text-slate-400">Re-open</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.email.junk}</p><p className="text-[11px] text-slate-400">Junk</p></div>
          </div>
          {data.email.trend.length > 0 && (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={data.email.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="assigned" name="Assigned" fill="#9333ea" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {data.email.totalAssigned === 0 && (
            <p className="mt-2 text-center text-[11px] text-slate-400">No email data uploaded yet for this period — Uploader → Email Raw.</p>
          )}
        </SectionCard>

        <SectionCard title="Chat">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-lg font-bold text-slate-800">{data.chat.totalChats}</p><p className="text-[11px] text-slate-400">Chats</p></div>
            <div><p className="text-lg font-bold text-slate-800">{formatSecs(data.chat.avgChatDurationSec)}</p><p className="text-[11px] text-slate-400">Avg Duration</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.chat.csatPct}%</p><p className="text-[11px] text-slate-400">Resolved%</p></div>
          </div>
          {data.chat.trend.length > 0 && (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={data.chat.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="chats" name="Chats" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {data.chat.totalChats === 0 && (
            <p className="mt-2 text-center text-[11px] text-slate-400">No chat data uploaded yet for this period — Uploader → Chat.</p>
          )}
        </SectionCard>

        <SectionCard title="Feedback / CSAT">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-lg font-bold text-slate-800">{data.feedback.totalFeedback}</p><p className="text-[11px] text-slate-400">Feedback</p></div>
            <div><p className="text-lg font-bold text-emerald-600">{data.feedback.csatPct}%</p><p className="text-[11px] text-slate-400">C-SAT%</p></div>
            <div><p className="text-lg font-bold text-red-600">{data.feedback.dsatPct}%</p><p className="text-[11px] text-slate-400">D-SAT%</p></div>
          </div>
          {data.feedback.totalFeedback === 0 && (
            <p className="mt-2 text-center text-[11px] text-slate-400">No feedback data uploaded yet for this period — Uploader → Feedback.</p>
          )}
        </SectionCard>

        <SectionCard title="Quality Audit">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-lg font-bold text-slate-800">{data.quality.auditsCount}</p><p className="text-[11px] text-slate-400">Audits</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.quality.avgScorePct}%</p><p className="text-[11px] text-slate-400">Avg Score</p></div>
            <div><p className="text-lg font-bold text-red-600">{data.quality.fatalCount}</p><p className="text-[11px] text-slate-400">Fatal</p></div>
          </div>
          {data.quality.auditsCount === 0 && (
            <p className="mt-2 text-center text-[11px] text-slate-400">No quality audit data uploaded yet for this period — Uploader → Quality.</p>
          )}
        </SectionCard>

        <SectionCard title="Productivity (APR)">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-lg font-bold text-slate-800">{data.productivity.agentCount}</p><p className="text-[11px] text-slate-400">Agents</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.productivity.avgUtilizationPct}%</p><p className="text-[11px] text-slate-400">Utilization</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.productivity.presentDays}</p><p className="text-[11px] text-slate-400">Present Days</p></div>
          </div>
          {data.productivity.agentCount === 0 && (
            <p className="mt-2 text-center text-[11px] text-slate-400">No APR data uploaded yet for this period — Uploader → APR.</p>
          )}
        </SectionCard>

        <SectionCard title="Disposition / FTR">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-lg font-bold text-slate-800">{data.disposition.totalTickets.toLocaleString("en-IN")}</p><p className="text-[11px] text-slate-400">Tickets</p></div>
            <div><p className="text-lg font-bold text-emerald-600">{data.disposition.ftrPct}%</p><p className="text-[11px] text-slate-400">FTR%</p></div>
            <div><p className="text-lg font-bold text-slate-800">{data.disposition.ftrCount.toLocaleString("en-IN")}</p><p className="text-[11px] text-slate-400">FTR Count</p></div>
          </div>
          {data.disposition.totalTickets === 0 ? (
            <p className="mt-2 text-center text-[11px] text-slate-400">No disposition data uploaded yet for this period — Uploader → Disposition.</p>
          ) : (
            <div className="mt-3 text-xs">
              <p className="mb-1 font-semibold text-slate-500">Top Reasons</p>
              {data.disposition.topReasons.map((r) => (
                <div key={r.reason} className="flex justify-between border-b border-slate-50 py-0.5"><span className="text-slate-600">{r.reason}</span><span className="font-medium text-slate-800">{r.count}</span></div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Rechurn Calls">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div><p className="text-lg font-bold text-slate-800">{data.rechurn.totalCalls}</p><p className="text-[11px] text-slate-400">Total Calls</p></div>
            <div><p className="text-lg font-bold text-amber-600">{data.rechurn.abandonedCount}</p><p className="text-[11px] text-slate-400">Abandoned</p></div>
          </div>
          {data.rechurn.totalCalls === 0 ? (
            <p className="mt-2 text-center text-[11px] text-slate-400">No rechurn call data uploaded yet for this period — Uploader → Rechurn Call.</p>
          ) : (
            <div className="mt-3 text-xs">
              <p className="mb-1 font-semibold text-slate-500">By Status</p>
              {data.rechurn.byStatus.map((r) => (
                <div key={r.status} className="flex justify-between border-b border-slate-50 py-0.5"><span className="text-slate-600">{r.status}</span><span className="font-medium text-slate-800">{r.count}</span></div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/** Snapshot of OverviewSlide's already-fetched data, lifted to the parent
 * purely for the "Export" feature -- no new fetch, no new calculation. */
export interface OverviewExportData {
  summary: InboundSummary | null;
  channels: ChannelsData | null;
}

// ── Overview slide ───────────────────────────────────────────────────────
function OverviewSlide({ from, to, onData }: { from: string; to: string; onData?: (d: OverviewExportData) => void }) {
  const [summary, setSummary] = useState<InboundSummary | null>(null);
  const [channels, setChannels] = useState<ChannelsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = `startDate=${from}&endDate=${to}`;
      const [s, c] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: InboundSummary }>(`/api/inbound/project/clovia?${qs}`),
        hrmsApi.get<{ success: boolean; data: ChannelsData }>(`/api/process-performance/clovia-channels-dashboard?from=${from}&to=${to}`),
      ]);
      setSummary(s.data);
      setChannels(c.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Clovia overview.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => { onData?.({ summary, channels }); }, [summary, channels, onData]);

  if (loading && !summary) return <Spinner />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!summary || !channels) return null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard icon={PhoneIncoming} label="Inbound Offered" value={summary.total.toLocaleString("en-IN")} sub={`SL ${summary.sl_pct}%`} tone="bg-purple-50 text-purple-600" />
        <KpiCard icon={PhoneOff} label="Outbound Dialed" value={channels.outbound.totalCalls.toLocaleString("en-IN")} sub={channels.outbound.totalCalls === 0 ? "no data yet" : `${channels.outbound.connectedPct}% connected`} tone="bg-fuchsia-50 text-fuchsia-600" />
        <KpiCard icon={Mail} label="Emails" value={channels.email.totalAssigned.toLocaleString("en-IN")} sub={channels.email.totalAssigned === 0 ? "no data yet" : `${channels.email.closed} closed`} tone="bg-sky-50 text-sky-600" />
        <KpiCard icon={MessageSquare} label="Chats" value={channels.chat.totalChats.toLocaleString("en-IN")} sub={channels.chat.totalChats === 0 ? "no data yet" : `${channels.chat.csatPct}% resolved`} tone="bg-teal-50 text-teal-600" />
        <KpiCard icon={Star} label="Feedback CSAT" value={channels.feedback.totalFeedback === 0 ? "—" : `${channels.feedback.csatPct}%`} sub={channels.feedback.totalFeedback === 0 ? "no data yet" : `${channels.feedback.totalFeedback} responses`} tone="bg-amber-50 text-amber-600" />
        <KpiCard icon={ShieldCheck} label="Quality Score" value={channels.quality.auditsCount === 0 ? "—" : `${channels.quality.avgScorePct}%`} sub={channels.quality.auditsCount === 0 ? "no data yet" : `${channels.quality.auditsCount} audits`} tone="bg-indigo-50 text-indigo-600" />
        <KpiCard icon={Users} label="Agents (APR)" value={channels.productivity.agentCount === 0 ? "—" : String(channels.productivity.agentCount)} sub={channels.productivity.agentCount === 0 ? "no data yet" : `${channels.productivity.avgUtilizationPct}% utilization`} tone="bg-rose-50 text-rose-600" />
      </div>
      <SectionCard title="Snapshot">
        <p className="text-xs text-slate-500">
          Every number here is real, uploaded Clovia data — Inbound from live call detail records, and Outbound/Email/
          Chat/Feedback/Quality/Productivity from what has been uploaded via Uploader (Outbound / Email Raw / Chat /
          Feedback / Quality / APR). Any section still showing "no data yet" simply has no rows uploaded for the
          selected date range yet.
        </p>
      </SectionCard>
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────
/**
 * Clovia's dedicated dashboard -- three slides sharing one date range.
 * Inbound is real, live dialer_db data (same source as every other
 * company's shared Inbound tab, via /api/inbound/project/clovia/*).
 * Channels (Outbound/Email/Chat/Feedback/Quality/Productivity/Disposition/
 * Rechurn) read the real db_masmis.cl_* tables the CL_*_MASMIS Uploader
 * entries write into -- see clovia-channels-dashboard.service.ts's own
 * doc comment for why this reads those tables and not an earlier,
 * differently-named set that turned out to have no real uploads in it.
 * Any section can still show "no data yet" if nothing was uploaded for
 * the selected date range -- that is an honest empty state, never a
 * fabricated number.
 */
export function CloviaDashboard() {
  const [slide, setSlide] = useState<"overview" | "inbound" | "email" | "chat" | "outbound" | "channels">("overview");
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const setRange = useCallback((f: string, t: string) => { setFrom(f); setTo(t); }, []);

  const tabs: Array<{ key: typeof slide; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "inbound", label: "Inbound", icon: PhoneIncoming },
    { key: "email", label: "Email", icon: Mail },
    { key: "chat", label: "Chat", icon: MessageSquare },
    { key: "outbound", label: "Outbound", icon: PhoneOutgoing },
    { key: "channels", label: "Channels", icon: Grid3x3 },
  ];

  // ── Export: each slide component already fetches its own data; these
  // snapshots are lifted up (via each slide's optional `onData` callback)
  // purely so the shared DashboardExportMenu can mirror what's on screen.
  // No new fetch, no new calculation -- see InboundSlide/ChannelsSlide/
  // OverviewSlide's `onData` effects above.
  const [overviewExport, setOverviewExport] = useState<OverviewExportData | null>(null);
  const [inboundExport, setInboundExport] = useState<InboundExportData | null>(null);
  const [channelsExport, setChannelsExport] = useState<ChannelsData | null>(null);
  const handleOverviewData = useCallback((d: OverviewExportData) => setOverviewExport(d), []);
  const handleInboundData = useCallback((d: InboundExportData) => setInboundExport(d), []);
  const handleChannelsData = useCallback((d: ChannelsData | null) => setChannelsExport(d), []);

  const exportSlides = useMemo<ExportSlide[]>(() => {
    const overviewKpis = overviewExport?.summary && overviewExport?.channels
      ? [
        { label: "Inbound Offered", value: overviewExport.summary.total.toLocaleString("en-IN") },
        { label: "Outbound Dialed", value: overviewExport.channels.outbound.totalCalls.toLocaleString("en-IN") },
        { label: "Emails", value: overviewExport.channels.email.totalAssigned.toLocaleString("en-IN") },
        { label: "Chats", value: overviewExport.channels.chat.totalChats.toLocaleString("en-IN") },
        { label: "Feedback CSAT", value: overviewExport.channels.feedback.totalFeedback === 0 ? "—" : `${overviewExport.channels.feedback.csatPct}%` },
        { label: "Quality Score", value: overviewExport.channels.quality.auditsCount === 0 ? "—" : `${overviewExport.channels.quality.avgScorePct}%` },
        { label: "Agents (APR)", value: overviewExport.channels.productivity.agentCount === 0 ? "—" : String(overviewExport.channels.productivity.agentCount) },
      ]
      : [];
    const overviewSlide: ExportSlide = { title: "Overview", kpis: overviewKpis };

    const summary = inboundExport?.summary ?? null;
    const trend = inboundExport?.trend ?? [];
    const agentsList = inboundExport?.agents ?? [];
    const hourlyByDate = inboundExport?.hourlyByDate ?? [];
    const selectedDate = inboundExport?.selectedDate ?? "";
    const dates = [...new Set(hourlyByDate.map((r) => r.date))].sort();
    const hours = [...new Set(hourlyByDate.map((r) => r.hour))].sort((a, b) => a - b);
    const cellByDateHour = new Map<string, HourlyByDateRow>();
    for (const r of hourlyByDate) cellByDateHour.set(`${r.date}|${r.hour}`, r);
    const slotRows = hourlyByDate.filter((r) => r.date === selectedDate).sort((a, b) => a.hour - b.hour);
    const slotOffered = slotRows.reduce((s, r) => s + r.offered, 0);
    const slotSlPct = slotOffered
      ? Math.round((slotRows.reduce((s, r) => s + (r.sl_pct * r.offered) / 100, 0) / slotOffered) * 10000) / 100
      : 0;
    const inboundSlide: ExportSlide = {
      title: "Inbound",
      kpis: summary
        ? [
          { label: "Call Offered", value: summary.total.toLocaleString("en-IN") },
          { label: "Call Answered", value: summary.answered.toLocaleString("en-IN") },
          { label: "AL %", value: `${summary.ans_pct}%` },
          { label: "Abandoned", value: `${summary.abandoned} (${summary.abandon_pct}%)` },
          { label: "SL %", value: `${summary.sl_pct}%` },
          { label: "ACHT", value: formatSecs(summary.avg_handle) },
          { label: "Agents Logged In", value: String(summary.login_count) },
          { label: "Unique Callers", value: summary.unique_phones.toLocaleString("en-IN") },
        ]
        : [],
      tables: [
        {
          title: "Date-wise Call Performance",
          columns: ["Date", "Offered", "Answered", "SL%", "ACHT"],
          rows: trend.map((r) => {
            const slPct = r.answered ? Math.round((r.sl_num / r.answered) * 10000) / 100 : 0;
            return [formatShortDate(r.date), r.offered, r.answered, `${slPct}%`, formatSecs(r.acht)];
          }),
        },
        {
          title: `Slot-wise Performance (${selectedDate ? formatShortDate(selectedDate) : "—"})`,
          columns: ["Hour", "Offered", "SL%", "ACHT"],
          rows: [
            ...slotRows.map((r) => [`${String(r.hour).padStart(2, "0")}:00`, r.offered, `${r.sl_pct}%`, formatSecs(r.acht)]),
            ...(slotRows.length > 0 ? [["Total", slotOffered, `${slotSlPct}%`, "—"]] : []),
          ],
        },
        {
          title: "Hourly Call Volume (Offered) Heatmap",
          columns: ["Hour", ...dates.map(formatShortDate)],
          rows: hours.map((h) => [
            `${String(h).padStart(2, "0")}:00`,
            ...dates.map((d) => cellByDateHour.get(`${d}|${h}`)?.offered ?? 0),
          ]),
        },
        {
          title: `Agent-wise Performance (${agentsList.length} agents)`,
          columns: ["Agent", "Agent ID", "Offered", "Answered", "SL%", "ACHT", "Repeat%"],
          rows: agentsList.map((a) => [a.agentName, a.agentId, a.offered, a.answered, `${a.sl_pct}%`, formatSecs(a.acht), `${a.repeat_pct}%`]),
        },
      ],
    };

    const ch = channelsExport;
    const channelsSlide: ExportSlide = {
      title: "Channels",
      kpis: ch
        ? [
          { label: "Outbound – Dialed", value: ch.outbound.totalCalls.toLocaleString("en-IN") },
          { label: "Outbound – Connected", value: ch.outbound.connectedCalls.toLocaleString("en-IN") },
          { label: "Outbound – Connected%", value: `${ch.outbound.connectedPct}%` },
          { label: "Outbound – Avg Talk", value: formatSecs(ch.outbound.avgTalkSec) },
          { label: "Email – Assigned", value: String(ch.email.totalAssigned) },
          { label: "Email – Closed", value: String(ch.email.closed) },
          { label: "Email – Open", value: String(ch.email.open) },
          { label: "Email – In Process", value: String(ch.email.inProcess) },
          { label: "Email – Re-open", value: String(ch.email.reOpen) },
          { label: "Email – Junk", value: String(ch.email.junk) },
          { label: "Chat – Chats", value: String(ch.chat.totalChats) },
          { label: "Chat – Avg Duration", value: formatSecs(ch.chat.avgChatDurationSec) },
          { label: "Chat – Resolved%", value: `${ch.chat.csatPct}%` },
          { label: "Feedback – Feedback", value: String(ch.feedback.totalFeedback) },
          { label: "Feedback – C-SAT%", value: `${ch.feedback.csatPct}%` },
          { label: "Feedback – D-SAT%", value: `${ch.feedback.dsatPct}%` },
          { label: "Quality Audit – Audits", value: String(ch.quality.auditsCount) },
          { label: "Quality Audit – Avg Score", value: `${ch.quality.avgScorePct}%` },
          { label: "Quality Audit – Fatal", value: String(ch.quality.fatalCount) },
          { label: "Productivity (APR) – Agents", value: String(ch.productivity.agentCount) },
          { label: "Productivity (APR) – Utilization", value: `${ch.productivity.avgUtilizationPct}%` },
          { label: "Productivity (APR) – Present Days", value: String(ch.productivity.presentDays) },
          { label: "Disposition/FTR – Tickets", value: ch.disposition.totalTickets.toLocaleString("en-IN") },
          { label: "Disposition/FTR – FTR%", value: `${ch.disposition.ftrPct}%` },
          { label: "Disposition/FTR – FTR Count", value: ch.disposition.ftrCount.toLocaleString("en-IN") },
          { label: "Rechurn Calls – Total Calls", value: String(ch.rechurn.totalCalls) },
          { label: "Rechurn Calls – Abandoned", value: String(ch.rechurn.abandonedCount) },
        ]
        : [],
      tables: ch
        ? [
          { title: "Disposition – Top Reasons", columns: ["Reason", "Count"], rows: ch.disposition.topReasons.map((r) => [r.reason, r.count]) },
          { title: "Rechurn – By Status", columns: ["Status", "Count"], rows: ch.rechurn.byStatus.map((r) => [r.status, r.count]) },
        ]
        : [],
    };

    return [overviewSlide, inboundSlide, channelsSlide];
  }, [overviewExport, inboundExport, channelsExport]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSlide(t.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${slide === t.key ? "bg-purple-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={to}
            min={from}
            max={localDateStr(new Date())}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm"
          />
          <button
            type="button"
            onClick={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
          >
            This Month
          </button>
        </div>
      </div>

      {/* The Overview, Inbound, Email, Chat and Outbound slides carry their own export menu (Value + week +
          date columns); this shell menu serves the earlier Channels slide and the Classic inbound view. */}
      {(() => {
        const menu = (title: string) => (
          <div className="flex justify-end">
            <DashboardExportMenu
              reportTitle="Clovia — Process Performance"
              fileBaseName="Clovia_Dashboard"
              raw={{ dashboard: "clovia", from, to }}
              subtitle={`${from} to ${to}`}
              slides={exportSlides}
              activeSlideTitle={title}
            />
          </div>
        );
        return (
          <>
            {slide === "overview" && (
              <div className="space-y-5">
                <OverviewSlide from={from} to={to} onData={handleOverviewData} />
                <CloviaLobSlide lob="overview" from={from} to={to} onRangeChange={setRange} hideHero />
              </div>
            )}
            {slide === "inbound" && (
              <CloviaInboundSlide
                from={from} to={to} onRangeChange={setRange}
                classic={<div className="space-y-5">{menu("Inbound")}<InboundSlide from={from} to={to} onData={handleInboundData} /></div>}
              />
            )}
            {slide === "email" && <CloviaLobSlide lob="email" from={from} to={to} onRangeChange={setRange} />}
            {slide === "chat" && <CloviaLobSlide lob="chat" from={from} to={to} onRangeChange={setRange} />}
            {slide === "outbound" && <CloviaLobSlide lob="outbound" from={from} to={to} onRangeChange={setRange} />}
            {slide === "channels" && (
              <div className="space-y-5">
                {menu("Channels")}
                <ChannelsSlide from={from} to={to} onData={handleChannelsData} />
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
