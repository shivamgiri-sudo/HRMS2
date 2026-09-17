import { useCallback, useEffect, useMemo, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { MessageSquare, Gauge, Clock3, Trophy, Layers, Users, Search } from "lucide-react";
import { Spinner, KpiCard, SectionCard } from "./DashboardKit";

/**
 * Neemans Chat, as its own standalone LOB dashboard -- same real
 * db_masmis.neemans_chat aggregate NeemansPerformanceDashboard's "Chat" tab
 * already computes (see neemans-performance-dashboard.service.ts's
 * getChatData(), now exported and also exposed on its own lightweight
 * endpoint, GET /api/process-performance/neemans-chat-dashboard), just
 * reachable directly the way Inbound and the Abandoned Cart dashboard
 * already are, instead of only inside a combined Sale/Allocation/Chat/
 * Productivity view. A TL who only cares about Chat performance shouldn't
 * have to load Sale + 57k Allocation rows to see it.
 */

interface ChatData {
  headline: { totalTickets: number; resolvedPct: number; avgFrtHrs: number; avgResolutionHrs: number; avgCsat: number };
  byLob: Array<{ lob: string; tickets: number; resolvedPct: number }>;
  agents: Array<{ agent: string; empId: string; tickets: number; resolvedPct: number; avgCsat: number }>;
}

export function NeemansChatDashboard() {
  const [data, setData] = useState<ChatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ChatData }>(
        "/api/process-performance/neemans-chat-dashboard",
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Neemans Chat dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredAgents = useMemo(() => {
    const rows = data?.agents ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q));
  }, [data, search]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { headline } = data;

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-600 to-violet-700 p-5 text-white shadow-lg sm:p-6">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{ backgroundImage: "radial-gradient(circle at 15% 20%, white, transparent 45%), radial-gradient(circle at 85% 85%, white, transparent 40%)" }}
        />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
            <MessageSquare className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">Neemans · Process Performance</p>
            <h2 className="text-lg font-bold sm:text-xl">Chat Performance</h2>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard icon={MessageSquare} label="Total Tickets" value={String(headline.totalTickets)} tone="indigo" />
        <KpiCard icon={Gauge} label="Resolved %" value={`${headline.resolvedPct}%`} tone="emerald" sub={headline.resolvedPct >= 90 ? "on target" : headline.resolvedPct >= 75 ? "watch" : "needs attention"} />
        <KpiCard icon={Clock3} label="Avg FRT" value={`${headline.avgFrtHrs}h`} tone="sky" sub="first response time" />
        <KpiCard icon={Clock3} label="Avg Resolution" value={`${headline.avgResolutionHrs}h`} tone="violet" sub="ticket close time" />
        <KpiCard icon={Trophy} label="Avg CSAT" value={String(headline.avgCsat || "—")} tone="amber" sub="customer rating" />
      </div>

      {headline.totalTickets < 20 && (
        <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
          Only {headline.totalTickets} chat ticket(s) uploaded so far (db_masmis.neemans_chat) — these numbers are real
          but thin, not placeholders. This view will fill out automatically as more chat exports are uploaded via
          Uploader → Chat Data, with no page change needed.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          icon={Layers}
          title="LOB-wise Tickets"
          tone="indigo"
          footnote="Which product line is generating the most chat volume, and how well each is being resolved — useful for spotting a LOB that needs more staffing or a process fix."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">LOB</th>
                  <th className="py-2 pr-3 text-right font-semibold">Tickets</th>
                  <th className="py-2 pr-0 text-right font-semibold">Resolved %</th>
                </tr>
              </thead>
              <tbody>
                {data.byLob.map((r) => (
                  <tr key={r.lob} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-indigo-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{r.lob}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{r.tickets}</td>
                    <td className={`py-2.5 pr-0 text-right font-semibold ${r.resolvedPct >= 90 ? "text-emerald-600" : r.resolvedPct >= 75 ? "text-amber-600" : "text-red-600"}`}>{r.resolvedPct}%</td>
                  </tr>
                ))}
                {data.byLob.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-slate-400">No data uploaded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="space-y-3">
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agent..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none"
            />
          </div>
          <SectionCard
            icon={Users}
            title="Agent-wise Chat Performance"
            tone="violet"
            footnote="Sorted by ticket volume — the agents at the bottom of Resolved% with meaningful ticket counts are the ones worth a coaching conversation."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Agent</th>
                    <th className="py-2 pr-3 text-right font-semibold">Tickets</th>
                    <th className="py-2 pr-3 text-right font-semibold">Resolved %</th>
                    <th className="py-2 pr-0 text-right font-semibold">Avg CSAT</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map((a) => (
                    <tr key={`${a.empId}-${a.agent}`} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-700">{a.agent}</div>
                        <div className="text-[11px] text-slate-400">{a.empId}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.tickets}</td>
                      <td className={`py-2.5 pr-3 text-right font-semibold ${a.resolvedPct >= 90 ? "text-emerald-600" : a.resolvedPct >= 75 ? "text-amber-600" : "text-red-600"}`}>{a.resolvedPct}%</td>
                      <td className="py-2.5 pr-0 text-right text-slate-600">{a.avgCsat || "—"}</td>
                    </tr>
                  ))}
                  {filteredAgents.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
