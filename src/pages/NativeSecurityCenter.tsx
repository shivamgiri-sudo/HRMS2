import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Eye, KeyRound, Loader, Lock, RefreshCcw, ShieldAlert, ShieldCheck, UserCog, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { RoleInsightsPanel } from "@/components/insights/RoleInsightsPanel";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

type SecuritySummary = {
  securityScore: number;
  loginsToday: number;
  failedLoginsToday: number;
  passwordResetsToday: number;
  roleChangesToday: number;
  exportsToday: number;
  sensitiveViewsToday: number;
  highRiskToday: number;
  activeUsers: number;
  inactiveUsers: number;
};

type SecurityEvent = {
  id: number;
  event_type: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  module_key?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  actor_user_id?: string | null;
  actor_role?: string | null;
  target_employee_id?: string | null;
  title: string;
  description?: string | null;
  reason?: string | null;
  ip_address?: string | null;
  created_at: string;
};

const severityClass: Record<string, string> = {
  info: "bg-blue-50 text-blue-700 border-blue-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

function Badge({ value }: { value: string }) {
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-bold capitalize ${severityClass[value] ?? severityClass.info}`}>{value.replace(/_/g, " ")}</span>;
}

function StatCard({ title, value, icon, tone, sub }: { title: string; value: string | number; icon: React.ReactNode; tone: string; sub?: string }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-400">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function scoreTone(score: number) {
  if (score >= 85) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 65) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

export default function NativeSecurityCenter() {
  const { roleKeys } = useWorkforceAccess();
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (severity !== "all") params.set("severity", severity);
      if (eventType !== "all") params.set("eventType", eventType);
      const [summaryRes, eventsRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: SecuritySummary }>("/api/security-center/summary"),
        hrmsApi.get<{ success: boolean; data: SecurityEvent[] }>(`/api/security-center/events?${params}`),
      ]);
      setSummary(summaryRes.data);
      setEvents(eventsRes.data ?? []);
    } catch (err: any) {
      setMessage(err?.message || "Unable to load security center.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [severity, eventType]);

  const eventTypes = useMemo(() => Array.from(new Set(events.map((event) => event.event_type))).sort(), [events]);
  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((event) => [event.event_type, event.title, event.description, event.module_key, event.actor_role, event.ip_address].join(" ").toLowerCase().includes(q));
  }, [events, query]);

  const exportCsv = () => {
    const header = ["Created At", "Severity", "Event", "Module", "Actor", "Role", "Title", "IP", "Reason"];
    const lines = [header, ...filteredEvents.map((event) => [event.created_at, event.severity, event.event_type, event.module_key ?? "", event.actor_user_id ?? "", event.actor_role ?? "", event.title, event.ip_address ?? "", event.reason ?? ""])]
      .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines], { type: "text/csv;charset=utf-8" }));
    a.download = `security-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const s = summary ?? { securityScore: 100, loginsToday: 0, failedLoginsToday: 0, passwordResetsToday: 0, roleChangesToday: 0, exportsToday: 0, sensitiveViewsToday: 0, highRiskToday: 0, activeUsers: 0, inactiveUsers: 0 };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.25em] text-blue-200">IT Security · Data Governance</p>
              <h1 className="mt-2 text-3xl font-black">Security Center</h1>
              <p className="mt-2 max-w-4xl text-sm text-slate-200">Monitor failed logins, role changes, exports, sensitive-data access, and high-risk system events.</p>
            </div>
            <button onClick={() => load()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-slate-100 disabled:opacity-50">
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </button>
          </div>
        </div>

        <RoleInsightsPanel roles={roleKeys} title="Security and data governance insights" />

        {message && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{message}</div>}

        <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
          <div className={`rounded-3xl border p-5 shadow-sm ${scoreTone(s.securityScore)}`}>
            <p className="text-sm font-black uppercase tracking-wide">Security Score</p>
            <p className="mt-2 text-3xl font-black">{s.securityScore}%</p>
            <p className="mt-1 text-xs font-bold">{s.securityScore >= 85 ? "Green" : s.securityScore >= 65 ? "Amber" : "Red"}</p>
          </div>
          <StatCard title="Logins" value={s.loginsToday} icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" sub="today" />
          <StatCard title="Failed" value={s.failedLoginsToday} icon={<ShieldAlert className="h-5 w-5" />} tone="bg-red-50 text-red-700" sub="today" />
          <StatCard title="Resets" value={s.passwordResetsToday} icon={<KeyRound className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" sub="today" />
          <StatCard title="Role Changes" value={s.roleChangesToday} icon={<UserCog className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" sub="today" />
          <StatCard title="Exports" value={s.exportsToday} icon={<Download className="h-5 w-5" />} tone="bg-orange-50 text-orange-700" sub="today" />
          <StatCard title="PII Views" value={s.sensitiveViewsToday} icon={<Eye className="h-5 w-5" />} tone="bg-cyan-50 text-cyan-700" sub="today" />
          <StatCard title="High Risk" value={s.highRiskToday} icon={<AlertTriangle className="h-5 w-5" />} tone="bg-red-50 text-red-700" sub="today" />
        </div>

        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1fr_170px_220px_auto]">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events, actor, module, IP..." className="h-11 rounded-2xl border bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-400" />
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="h-11 rounded-2xl border bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-blue-400">
              {['all','critical','high','medium','low','info'].map((v) => <option key={v} value={v}>{v === 'all' ? 'All severity' : v}</option>)}
            </select>
            <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="h-11 rounded-2xl border bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-blue-400">
              <option value="all">All event types</option>
              {eventTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
            </select>
            <button onClick={exportCsv} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"><Download className="h-4 w-4" />Export</button>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-950">Security Event Timeline</h2>
                <p className="text-sm text-slate-500">{filteredEvents.length} events</p>
              </div>
              {loading && <Loader className="h-5 w-5 animate-spin text-slate-400" />}
            </div>
          </div>
          {filteredEvents.length === 0 ? (
            <div className="py-16 text-center text-slate-400"><ShieldCheck className="mx-auto mb-3 h-10 w-10 opacity-40" /><p className="font-semibold">No security events found.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-4">Time</th><th className="p-4">Severity</th><th className="p-4">Event</th><th className="p-4">Module</th><th className="p-4">Actor</th><th className="p-4">Title</th><th className="p-4">IP</th></tr></thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <tr key={event.id} className="border-t hover:bg-slate-50">
                      <td className="p-4 font-mono text-xs text-slate-500">{formatIST(event.created_at)}</td>
                      <td className="p-4"><Badge value={event.severity} /></td>
                      <td className="p-4 font-bold text-slate-800">{event.event_type.replace(/_/g, " ")}</td>
                      <td className="p-4 text-slate-600">{event.module_key ?? "—"}</td>
                      <td className="p-4"><div className="font-mono text-xs text-slate-600">{event.actor_user_id ?? "system"}</div><div className="text-xs text-slate-400">{event.actor_role ?? "—"}</div></td>
                      <td className="p-4"><div className="font-bold text-slate-950">{event.title}</div>{event.description && <div className="mt-1 max-w-md truncate text-xs text-slate-500">{event.description}</div>}</td>
                      <td className="p-4 font-mono text-xs text-slate-500">{event.ip_address ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <div className="flex gap-3">
            <Lock className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-black">Next governance hooks to connect</p>
              <p className="mt-1">Wire salary view, bank view, PAN/Aadhaar view, role changes, payroll exports, and employee exports to POST /api/security-center/events or /export-audit.</p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
