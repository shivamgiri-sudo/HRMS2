import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Phone, Clock, CheckCircle, AlertTriangle, ChevronRight,
  RotateCcw, ArrowLeft, BarChart2,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProjectSummary {
  key: string;
  name: string;
  total: number;
  answered: number;
  abandoned: number;
  ans_pct: number;
  abandon_pct: number;
  avg_wait: number;
  avg_handle: number;
  sl_pct: number;
  fcr_pct?: number;
}
interface ConsolidatedPoint { date: string; offered: number; answered: number; sl_pct: number }
interface ProjectTrend { date: string; offered: number; answered: number; sl_num: number }
interface HourlyPoint { hour: number; offered: number; answered: number }
interface LobRow { campaign: string; offered: number; answered: number; answeredPct: number; abandonPct: number; slPct: number; acht: number; uniquePhones: number }

const PROJECT_COLORS: Record<string, string> = {
  GNC: "bg-emerald-500",
  Bellavita: "bg-pink-500",
  Clovia: "bg-purple-500",
  Neemans: "bg-amber-500",
  Viega: "bg-blue-500",
  Exicom: "bg-indigo-500",
  "DU Bangladesh": "bg-orange-500",
};

const today = () => new Date().toISOString().slice(0, 10);
const sevenDaysAgo = () => {
  const d = new Date(); d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
    </div>
  );
}

function SLBadge({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-emerald-100 text-emerald-700"
    : pct >= 60 ? "bg-amber-100 text-amber-700"
    : "bg-red-100 text-red-600";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${color}`}>{pct.toFixed(1)}%</span>;
}

// ── Project Card ───────────────────────────────────────────────────────────────
function ProjectCard({ p, onClick }: { p: ProjectSummary; onClick: () => void }) {
  const color = PROJECT_COLORS[p.name] ?? "bg-slate-500";
  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-2xl border border-slate-100 bg-white p-4 shadow-sm text-left hover:border-blue-200 hover:shadow-md transition-all"
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`rounded-xl px-3 py-1 text-xs font-bold text-white ${color}`}>{p.name}</div>
        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-lg font-bold text-slate-800">{p.total.toLocaleString()}</p>
          <p className="text-xs text-slate-500">Total</p>
        </div>
        <div>
          <p className="text-lg font-bold text-emerald-600">{p.ans_pct.toFixed(1)}%</p>
          <p className="text-xs text-slate-500">Ans Rate</p>
        </div>
        <div>
          <p className="text-lg font-bold text-emerald-600">{p.abandon_pct.toFixed(1)}%</p>
          <p className="text-xs text-slate-500">AL %</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-50 pt-2">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-slate-400" />
          <span className="text-xs text-slate-500">AvgWait {p.avg_wait}s</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">SL</span>
          <SLBadge pct={p.sl_pct} />
        </div>
        {p.fcr_pct != null && (
          <div className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-blue-400" />
            <span className="text-xs text-slate-500">FCR {p.fcr_pct.toFixed(1)}%</span>
          </div>
        )}
      </div>
    </button>
  );
}

// ── Consolidated summary view ──────────────────────────────────────────────────
function AllProjectsView({ from, to }: { from: string; to: string }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [trend, setTrend] = useState<ConsolidatedPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialerUnavailable, setDialerUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setDialerUnavailable(false);
    const qs = `startDate=${from}&endDate=${to}`;
    try {
      const [projRes, trendRes] = await Promise.all([
        hrmsApi.get<{ data: ProjectSummary[]; _unavailable?: boolean }>(`/api/inbound/summary?${qs}`),
        hrmsApi.get<{ data: ConsolidatedPoint[]; _unavailable?: boolean }>(`/api/inbound/consolidated-trend?${qs}`),
      ]);
      if ((projRes as any)._unavailable) setDialerUnavailable(true);
      setProjects(projRes.data ?? []);
      setTrend(trendRes.data ?? []);
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Spinner />;

  const totals = projects.reduce(
    (acc, p) => ({ total: acc.total + p.total, answered: acc.answered + p.answered, abandoned: acc.abandoned + p.abandoned }),
    { total: 0, answered: 0, abandoned: 0 }
  );
  const overallAns = totals.total ? ((totals.answered / totals.total) * 100).toFixed(1) : "—";
  const overallAbandon = totals.total ? ((totals.abandoned / totals.total) * 100).toFixed(1) : "—";

  return (
    <div className="space-y-5">
      {dialerUnavailable && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
          <span>Dialler data source is not connected. Contact your system administrator to configure <code className="font-mono text-xs">DIALER_DB_*</code> environment variables.</span>
        </div>
      )}
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Calls", value: totals.total.toLocaleString(), icon: Phone, color: "text-blue-600 bg-blue-50" },
          { label: "Answer Rate", value: `${overallAns}%`, icon: CheckCircle, color: "text-emerald-600 bg-emerald-50" },
          { label: "Abandon Rate", value: `${overallAbandon}%`, icon: AlertTriangle, color: "text-red-500 bg-red-50" },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className={`mb-2 inline-flex rounded-xl p-2 ${s.color}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-bold text-slate-800">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Consolidated trend */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">Consolidated Inbound Trend</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Line type="monotone" dataKey="offered" name="Offered" stroke="#94A3B8" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="answered" name="Answered" stroke="#10B981" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="sl_pct" name="SL %" stroke="#3B82F6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Analysis — every process ranked side by side on the same metrics */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-1 text-sm font-semibold text-slate-700">Process-wise Analysis</p>
        <p className="mb-3 text-xs text-slate-400">Every inbound process, ranked by Service Level — same live call-detail data as each process's own dashboard.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">#</th>
                <th className="py-2 pr-3 font-semibold">Process</th>
                <th className="py-2 pr-3 text-right font-semibold">Offered</th>
                <th className="py-2 pr-3 text-right font-semibold">Answered</th>
                <th className="py-2 pr-3 text-right font-semibold">AL%</th>
                <th className="py-2 pr-3 text-right font-semibold">Abandon%</th>
                <th className="py-2 pr-3 text-right font-semibold">SL%</th>
                <th className="py-2 pr-3 text-right font-semibold">ACHT</th>
                <th className="py-2 pr-0 text-right font-semibold">Avg Wait</th>
              </tr>
            </thead>
            <tbody>
              {[...projects].sort((a, b) => b.sl_pct - a.sl_pct).map((p, i) => (
                <tr key={p.key} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50" onClick={() => navigate(`/call-master/inbound/${p.key}`)}>
                  <td className="py-2 pr-3 text-slate-400">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-lg px-2 py-0.5 text-[11px] font-bold text-white ${PROJECT_COLORS[p.name] ?? "bg-slate-500"}`}>{p.name}</span>
                  </td>
                  <td className="py-2 pr-3 text-right text-slate-600">{p.total.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{p.answered.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{p.ans_pct.toFixed(1)}%</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${p.abandon_pct < 90 ? "text-red-600" : "text-slate-600"}`}>{p.abandon_pct.toFixed(1)}%</td>
                  <td className="py-2 pr-3 text-right"><SLBadge pct={p.sl_pct} /></td>
                  <td className="py-2 pr-3 text-right text-slate-600">{p.avg_handle}s</td>
                  <td className="py-2 pr-0 text-right text-slate-600">{p.avg_wait}s</td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Project cards grid */}
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Click a project for detailed view</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map(p => (
          <ProjectCard key={p.key} p={p} onClick={() => navigate(`/call-master/inbound/${p.key}`)} />
        ))}
      </div>
    </div>
  );
}

// ── Single project detail view ─────────────────────────────────────────────────
// Exported so Process Performance V2's per-company "Inbound" dashboard tab can
// reuse this exact live dialer_db view instead of standing up a second copy of
// the same summary/trend/hourly fetch-and-render logic.
export function ProjectDetailView({ projectKey, from, to }: { projectKey: string; from: string; to: string }) {
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [trend, setTrend] = useState<ProjectTrend[]>([]);
  const [hourly, setHourly] = useState<HourlyPoint[]>([]);
  const [lob, setLob] = useState<LobRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = `startDate=${from}&endDate=${to}`;
    try {
      const [summRes, trendRes, hourlyRes, lobRes] = await Promise.all([
        hrmsApi.get<{ data: ProjectSummary }>(`/api/inbound/project/${projectKey}?${qs}`),
        hrmsApi.get<{ data: ProjectTrend[] }>(`/api/inbound/project/${projectKey}/trend?${qs}`),
        hrmsApi.get<{ data: HourlyPoint[] }>(`/api/inbound/project/${projectKey}/hourly?${qs}`),
        hrmsApi.get<{ data: LobRow[] }>(`/api/inbound/project/${projectKey}/lob?${qs}`),
      ]);
      setSummary(summRes.data);
      setTrend(trendRes.data ?? []);
      setHourly(hourlyRes.data ?? []);
      setLob(lobRes.data ?? []);
    } finally { setLoading(false); }
  }, [projectKey, from, to]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Spinner />;
  if (!summary) return <p className="py-12 text-center text-sm text-slate-400">No data for this project / date range.</p>;

  const color = PROJECT_COLORS[summary.name] ?? "bg-slate-500";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${color}`}>{summary.name}</div>
        <p className="text-sm text-slate-500">Project detail view</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Total Calls", value: summary.total.toLocaleString(), color: "blue" },
          { label: "Answer Rate", value: `${summary.ans_pct.toFixed(1)}%`, color: "green" },
          { label: "AL %", value: `${summary.abandon_pct.toFixed(1)}%`, color: "green" },
          { label: "Service Level", value: `${summary.sl_pct.toFixed(1)}%`, color: "amber" },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="text-2xl font-bold text-slate-800">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Avg Wait Time", value: `${summary.avg_wait}s` },
          { label: "Avg Handle Time", value: `${summary.avg_handle}s` },
          { label: "Answered Calls", value: summary.answered.toLocaleString() },
          { label: "FCR", value: summary.fcr_pct != null ? `${summary.fcr_pct.toFixed(1)}%` : "N/A" },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="text-xl font-bold text-slate-800">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Daily Trend</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="offered" name="Offered" stroke="#94A3B8" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="answered" name="Answered" stroke="#10B981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="sl_num" name="SL Count" stroke="#3B82F6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Hourly Distribution</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourly} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickFormatter={(v: number) => `${v}:00`} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(v: unknown) => `${v}:00`}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="offered" name="Offered" fill="#94A3B8" radius={[3,3,0,0]} />
              <Bar dataKey="answered" name="Answered" fill="#10B981" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LOB-wise breakdown -- this project's real dialer_db CampaignName
          values ARE its LOBs (e.g. Bellavita's Luxury/Organic/Complaint/
          Order/Product sub-brands, GNC's 6 query-type campaigns). */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">LOB-wise Breakdown</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3 font-semibold">LOB / Campaign</th>
                <th className="py-2 pr-3 text-right font-semibold">Offered</th>
                <th className="py-2 pr-3 text-right font-semibold">Answered</th>
                <th className="py-2 pr-3 text-right font-semibold">AL%</th>
                <th className="py-2 pr-3 text-right font-semibold">Abandon%</th>
                <th className="py-2 pr-3 text-right font-semibold">SL%</th>
                <th className="py-2 pr-3 text-right font-semibold">ACHT</th>
                <th className="py-2 pr-0 text-right font-semibold">Unique Callers</th>
              </tr>
            </thead>
            <tbody>
              {lob.map((r) => (
                <tr key={r.campaign} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-3 font-medium text-slate-700">{r.campaign}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{r.offered.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{r.answered.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{r.answeredPct}%</td>
                  <td className={`py-2 pr-3 text-right font-semibold ${r.abandonPct < 90 ? "text-red-600" : "text-slate-600"}`}>{r.abandonPct}%</td>
                  <td className="py-2 pr-3 text-right"><SLBadge pct={r.slPct} /></td>
                  <td className="py-2 pr-3 text-right text-slate-600">{r.acht}s</td>
                  <td className="py-2 pr-0 text-right text-slate-600">{r.uniquePhones.toLocaleString()}</td>
                </tr>
              ))}
              {lob.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-slate-400">No LOB data for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function NativeInboundDashboard() {
  const { hasAnyRole } = useWorkforceAccess();
  const canAccess = hasAnyRole("super_admin","admin","ceo","manager","process_manager","operations_manager","qa","quality_analyst");
  const { projectKey } = useParams<{ projectKey?: string }>();
  const navigate = useNavigate();

  const [from, setFrom] = useState(sevenDaysAgo());
  const [to, setTo]     = useState(today());

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <div className="rounded-2xl border border-red-100 bg-red-50 px-8 py-6 text-center">
            <p className="font-semibold text-red-700">Access Restricted</p>
            <p className="mt-1 text-sm text-red-500">You don't have permission to view Inbound analytics.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            {projectKey && (
              <button onClick={() => navigate("/call-master/inbound")}
                className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200">
                <ArrowLeft className="h-4 w-4" /> All Projects
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <BarChart2 className="h-5 w-5 text-blue-600" />
                Inbound Dashboard
                {projectKey && <span className="ml-1 text-blue-600">— {projectKey}</span>}
              </h1>
              <p className="text-sm text-slate-500">
                {projectKey ? "Per-project call performance" : "All inbound projects — summary and SL tracking"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm" />
            <span className="text-slate-400 text-sm">—</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm" />
            <button onClick={() => { setFrom(sevenDaysAgo()); setTo(today()); }}
              className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          </div>
        </div>

        {projectKey
          ? <ProjectDetailView projectKey={projectKey} from={from} to={to} />
          : <AllProjectsView from={from} to={to} />
        }
      </div>
    </DashboardLayout>
  );
}
