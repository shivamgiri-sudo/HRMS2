import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { RoleInsightsPanel } from "@/components/insights/RoleInsightsPanel";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

type ApiResponse<T> = { success: boolean; data: T };
type InboxItem = { id: string; title: string; description?: string | null; priority: string; module_key: string; task_type: string; due_at?: string | null; status: string; action_url?: string | null; owner_name?: string | null; aging_hours?: number | null; escalation_level?: number | null; decision_required_from?: string | null };
type EventItem = { id: string; title: string; message?: string | null; severity: string; module_key: string; event_type: string; created_at: string; action_url?: string | null };
type HealthCheck = { code: string; label: string; count: number; severity: string };
type TabKey = "inbox" | "events" | "health" | "risks";

const priorityClass: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
  info: "bg-blue-100 text-blue-700 border-blue-200",
};

function Badge({ value }: { value: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${priorityClass[value] ?? priorityClass.info}`}>{String(value || "info").replace(/_/g, " ")}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">{text}</div>;
}

export default function NativeControlTower() {
  const { roleKeys } = useWorkforceAccess();
  const [tab, setTab] = useState<TabKey>("inbox");
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [health, setHealth] = useState<{ checks: HealthCheck[]; total_issues: number }>({ checks: [], total_issues: 0 });
  const [risks, setRisks] = useState<any>({ open_risks: [], counts: {}, generated_risks: [] });
  const [teamData, setTeamData] = useState<any>({ manager: null, direct_reports: [], team_summary: { total: 0, by_designation: {}, by_department: {} } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [standupMode, setStandupMode] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const openInbox = useMemo(() => inbox.filter((i) => i.status !== "completed"), [inbox]);
  const openInboxCount = openInbox.length;
  const criticalEventCount = useMemo(() => events.filter((e) => e.severity === "critical" || e.severity === "high").length, [events]);
  const allRisks = useMemo(() => [...(risks.generated_risks ?? []), ...(risks.open_risks ?? [])], [risks]);
  const highRiskCount = allRisks.filter((risk: any) => ["critical", "high"].includes(risk.severity ?? "medium")).length;
  const commandScore = Math.max(0, 100 - openInboxCount * 3 - criticalEventCount * 5 - Number(health.total_issues ?? 0) * 2 - highRiskCount * 5);

  const searchText = (values: unknown[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return values.join(" ").toLowerCase().includes(q);
  };
  const severityOk = (value: string) => severityFilter === "all" || value === severityFilter;
  let filteredInbox = openInbox.filter((i) => searchText([i.title, i.description, i.module_key, i.task_type, i.owner_name]) && severityOk(i.priority));
  if (standupMode) {
    filteredInbox = filteredInbox.sort((a, b) => (b.aging_hours ?? 0) - (a.aging_hours ?? 0)).slice(0, 20);
  }
  const filteredEvents = events.filter((e) => searchText([e.title, e.message, e.module_key, e.event_type]) && severityOk(e.severity));
  const filteredHealth = health.checks.filter((h) => searchText([h.label, h.code]) && severityOk(h.severity));
  const filteredRisks = allRisks.filter((r: any) => searchText([r.title, r.description, r.module_key, r.risk_type, r.action_required]) && severityOk(r.severity ?? "medium"));

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [inboxRes, eventRes, healthRes, riskRes, teamRes] = await Promise.all([
        hrmsApi.get<ApiResponse<InboxItem[]>>("/api/control-tower/inbox"),
        hrmsApi.get<ApiResponse<EventItem[]>>("/api/control-tower/events?limit=100"),
        hrmsApi.get<ApiResponse<{ checks: HealthCheck[]; total_issues: number }>>("/api/control-tower/master-data-health"),
        hrmsApi.get<ApiResponse<any>>("/api/control-tower/risks"),
        hrmsApi.get<ApiResponse<any>>("/api/control-tower/my-team").catch(() => ({ data: { manager: null, direct_reports: [], team_summary: { total: 0, by_designation: {}, by_department: {} } } })),
      ]);
      setInbox(inboxRes.data ?? []);
      setEvents(eventRes.data ?? []);
      setHealth(healthRes.data ?? { checks: [], total_issues: 0 });
      setRisks(riskRes.data ?? { open_risks: [], counts: {}, generated_risks: [] });
      setLastRefresh(formatISTTime());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    const t = window.setInterval(loadAll, 60_000);
    return () => window.clearInterval(t);
  }, []);

  async function completeItem(id: string) {
    await hrmsApi.patch(`/api/control-tower/inbox/${id}/complete`, {});
    await loadAll();
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-blue-200">MAS Callnet PeopleOS</p>
              <h1 className="mt-2 text-3xl font-bold">Control Tower</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-200">One action layer for pending work, operational events, master-data health, employee risk, roster alerts, and leadership escalations.</p>
              {lastRefresh && <p className="mt-2 text-xs text-blue-100">Last refresh: {lastRefresh}</p>}
            </div>
            <button onClick={() => void loadAll()} className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow hover:bg-slate-100" disabled={loading}>{loading ? "Refreshing..." : "Refresh now"}</button>
          </div>
        </div>

        <RoleInsightsPanel roles={roleKeys} title="Control tower insights" />

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <div className="grid gap-4 md:grid-cols-5">
          <div className={`rounded-2xl border p-5 shadow-sm ${commandScore >= 85 ? "bg-emerald-50" : commandScore >= 65 ? "bg-amber-50" : "bg-red-50"}`}><p className="text-xs font-semibold uppercase text-slate-500">Command Score</p><p className="mt-2 text-3xl font-bold">{commandScore}%</p></div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase text-slate-500">Open Inbox</p><p className="mt-2 text-3xl font-bold">{openInboxCount}</p></div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase text-slate-500">High Events</p><p className="mt-2 text-3xl font-bold">{criticalEventCount}</p></div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase text-slate-500">Master Issues</p><p className="mt-2 text-3xl font-bold">{health.total_issues}</p></div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase text-slate-500">Open Risks</p><p className="mt-2 text-3xl font-bold">{allRisks.length}</p></div>
        </div>

        <div className="grid gap-3 rounded-3xl border bg-white p-4 shadow-sm md:grid-cols-[1fr_180px]">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all control tower records..." className="h-11 rounded-2xl border bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-400" />
          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="h-11 rounded-2xl border bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-blue-400">
            {['all', 'critical', 'high', 'medium', 'low', 'info'].map((v) => <option key={v} value={v}>{v === 'all' ? 'All severity' : v}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {(["inbox", "events", "health", "risks"] as TabKey[]).map((key) => (
              <button key={key} onClick={() => setTab(key)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === key ? "bg-blue-600 text-white" : "bg-white text-slate-700 border"}`}>{key.toUpperCase()}</button>
            ))}
          </div>
          {tab === "inbox" && (
            <button
              onClick={() => setStandupMode(!standupMode)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${standupMode ? "bg-violet-600 text-white" : "bg-white text-slate-700 border"}`}
            >
              Daily Standup (Top 20)
            </button>
          )}
        </div>

        {tab === "inbox" && <div className="rounded-3xl border bg-white p-4 shadow-sm"><h2 className="mb-4 text-lg font-bold">Unified Work Inbox {standupMode && <span className="ml-2 rounded-full bg-violet-100 px-3 py-1 text-sm font-bold text-violet-700">Top 20 by Age</span>}</h2>{filteredInbox.length === 0 ? <Empty text="No open inbox items match the current filters." /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b text-left"><tr><th className="p-3 font-semibold text-slate-600">Title</th><th className="p-3 font-semibold text-slate-600">Owner</th><th className="p-3 font-semibold text-slate-600">Aging (hrs)</th><th className="p-3 font-semibold text-slate-600">Escalation</th><th className="p-3 font-semibold text-slate-600">Priority</th><th className="p-3 font-semibold text-slate-600">Actions</th></tr></thead><tbody>{filteredInbox.map((item) => <tr key={item.id} className="border-b hover:bg-slate-50"><td className="p-3"><div className="font-bold">{item.title}</div><div className="text-xs text-slate-500">{item.module_key} · {item.task_type}</div>{item.description && <div className="mt-1 text-xs text-slate-600">{item.description}</div>}</td><td className="p-3 text-slate-700">{item.owner_name ?? "—"}</td><td className="p-3 tabular-nums text-slate-700">{item.aging_hours ?? 0}</td><td className="p-3"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${item.escalation_level === 3 ? "bg-red-100 text-red-700" : item.escalation_level === 2 ? "bg-orange-100 text-orange-700" : item.escalation_level === 1 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>L{item.escalation_level ?? 0}</span></td><td className="p-3"><Badge value={item.priority} /></td><td className="p-3"><div className="flex gap-2">{item.action_url && <a href={item.action_url} className="rounded-xl border px-2 py-1 text-xs font-semibold hover:bg-slate-50">Open</a>}<button onClick={() => void completeItem(item.id)} className="rounded-xl bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700">Done</button></div></td></tr>)}</tbody></table></div>}</div>}
        {tab === "events" && <div className="rounded-3xl border bg-white p-4 shadow-sm"><h2 className="mb-4 text-lg font-bold">Real-time Event Feed</h2><div className="space-y-3">{filteredEvents.length === 0 && <Empty text="No events match the current filters." />}{filteredEvents.map((event) => <div key={event.id} className="rounded-2xl border p-4"><div className="flex flex-wrap items-center gap-2"><Badge value={event.severity} /><span className="text-xs font-semibold text-slate-500">{event.module_key} · {event.event_type}</span></div><h3 className="mt-2 font-bold">{event.title}</h3>{event.message && <p className="mt-1 text-sm text-slate-600">{event.message}</p>}<p className="mt-2 text-xs text-slate-500">{formatIST(event.created_at)}</p></div>)}</div></div>}
        {tab === "health" && <div className="rounded-3xl border bg-white p-4 shadow-sm"><h2 className="mb-4 text-lg font-bold">Master Data Health</h2>{filteredHealth.length === 0 ? <Empty text="No master-data checks match the current filters." /> : <div className="grid gap-3 md:grid-cols-2">{filteredHealth.map((check) => <div key={check.code} className="rounded-2xl border p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-bold">{check.label}</h3><Badge value={check.severity} /></div><p className="mt-2 text-3xl font-bold">{check.count}</p><p className="text-xs text-slate-500">{check.code}</p></div>)}</div>}</div>}
        {tab === "risks" && <div className="rounded-3xl border bg-white p-4 shadow-sm"><h2 className="mb-4 text-lg font-bold">Management Risk Engine</h2><div className="space-y-3">{filteredRisks.length === 0 && <Empty text="No risks match the current filters." />}{filteredRisks.map((risk: any, idx: number) => <div key={risk.id ?? idx} className="rounded-2xl border p-4"><div className="flex flex-wrap items-center gap-2"><Badge value={risk.severity ?? "medium"} /><span className="text-xs font-semibold text-slate-500">{risk.module_key ?? risk.risk_type}</span></div><h3 className="mt-2 font-bold">{risk.title}</h3>{risk.description && <p className="mt-1 text-sm text-slate-600">{risk.description}</p>}{risk.action_required && <p className="mt-2 text-sm font-semibold text-slate-700">Action: {risk.action_required}</p>}</div>)}</div></div>}
      </div>
    </DashboardLayout>
  );
}
