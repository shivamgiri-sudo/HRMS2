import { useEffect, useMemo, useState } from "react";
import { Award, Heart, RefreshCcw, ShieldAlert, Sparkles, Trophy, Users, Zap, TrendingUp, Activity } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type WatchRow = {
  employee_id: string;
  employee_name: string;
  employee_code?: string;
  branch_name?: string;
  process_name?: string;
  engagement_score: number;
  risk_label: string;
  snapshot_date: string;
};

type KudosFeed = {
  kudos_id: string;
  sender_name: string;
  receiver_name: string;
  kudos_title?: string;
  kudos_icon?: string;
  kudos_category?: string;
  custom_message?: string;
  points_awarded: number;
  reaction_count: number;
  sent_at: string;
};

type Data = {
  summary: Array<{ risk_label: string; count: number; avg_score: number }>;
  watchlist: WatchRow[];
  kudos_feed: KudosFeed[];
};

function RiskPill({ label }: { label: string }) {
  const cls = label === "attrition_risk" ? "bg-red-50 text-red-700 border border-red-200" :
    label === "watchlist" ? "bg-amber-50 text-amber-700 border border-amber-200" :
    label === "highly_engaged" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
    "bg-blue-50 text-blue-700 border border-blue-200";
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{label.replace(/_/g, " ")}</span>;
}

export default function NativeEngagementCommandCenter() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Data }>("/api/engagement-intelligence/command-center");
      setData(res.data);
    } catch (err: any) {
      setMessage(err?.message || "Unable to load engagement command center");
    } finally {
      setLoading(false);
    }
  };

  const scan = async () => {
    setLoading(true);
    try {
      await hrmsApi.post("/api/engagement-intelligence/scan", { limit: 500 });
      setMessage("Engagement health scan completed.");
      await load();
    } catch (err: any) {
      setMessage(err?.message || "Scan failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const summary = useMemo(() => {
    const map = new Map((data?.summary ?? []).map((s) => [s.risk_label, s]));
    const total = (data?.summary ?? []).reduce((a, b) => a + Number(b.count ?? 0), 0);
    const avg = total ? (data?.summary ?? []).reduce((a, b) => a + Number(b.count ?? 0) * Number(b.avg_score ?? 0), 0) / total : 0;
    return { total, avg, highly: map.get("highly_engaged")?.count ?? 0, watch: map.get("watchlist")?.count ?? 0, risk: map.get("attrition_risk")?.count ?? 0 };
  }, [data]);

  return (
    <DashboardLayout>
      <main className="space-y-8 p-6 lg:p-8">
        {/* Hero Header */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-700 p-8 text-white shadow-2xl shadow-purple-200/40">
          <div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-pink-400/20 blur-2xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                <Sparkles className="h-3.5 w-3.5" /> People Experience
              </div>
              <h1 className="text-4xl font-black tracking-tight">Engagement Command Center</h1>
              <p className="mt-2 max-w-2xl text-purple-100">
                Track recognition, kudos momentum, engagement health, watchlist employees, and attrition-risk signals.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl bg-white/20 px-4 py-2.5 text-sm font-bold text-white backdrop-blur-sm hover:bg-white/30 transition-all disabled:opacity-50">
                <RefreshCcw className="h-4 w-4" /> Refresh
              </button>
              <button onClick={scan} disabled={loading} className="rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-purple-700 shadow-lg hover:bg-purple-50 transition-all disabled:opacity-50">
                Run health scan
              </button>
            </div>
          </div>
        </div>

        {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard title="Employees scanned" value={summary.total} note="Latest health snapshot" icon={<Sparkles className="h-5 w-5" />} color="from-violet-400 to-purple-500" />
          <MetricCard title="Average score" value={`${Math.round(summary.avg)}%`} note="Engagement health" icon={<Trophy className="h-5 w-5" />} color="from-blue-400 to-indigo-500" />
          <MetricCard title="Highly engaged" value={summary.highly} note="Strong signals" icon={<Award className="h-5 w-5" />} color="from-emerald-400 to-teal-500" />
          <MetricCard title="Watchlist" value={summary.watch} note="Manager check-in" icon={<ShieldAlert className="h-5 w-5" />} color="from-amber-400 to-orange-500" />
          <MetricCard title="Attrition risk" value={summary.risk} note="HR action required" icon={<Heart className="h-5 w-5" />} color="from-rose-400 to-pink-500" />
        </div>

        {/* Watchlist + Kodos */}
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          {/* Watchlist */}
          <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-lg shadow-slate-200/40">
            <div className="border-b border-slate-100 p-6">
              <h2 className="text-xl font-black text-slate-950 flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-600" /> Engagement Watchlist
              </h2>
              <p className="text-sm text-slate-500 mt-1">Lowest health score employees should be reviewed by manager/HR.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>{['Employee','Branch / Process','Score','Risk','Snapshot'].map((h) => <th key={h} className="p-4 font-bold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(data?.watchlist ?? []).map((r) => (
                    <tr key={r.employee_id} className="border-t border-slate-100 hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="font-bold text-slate-950">{r.employee_name}</div>
                        <div className="font-mono text-xs text-slate-500">{r.employee_code ?? r.employee_id.slice(0, 8)}</div>
                      </td>
                      <td className="p-4 text-slate-600">
                        <div className="font-medium">{r.branch_name ?? '—'}</div>
                        <div className="text-xs">{r.process_name ?? '—'}</div>
                      </td>
                      <td className="p-4">
                        <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold ${r.engagement_score >= 80 ? 'bg-emerald-50 text-emerald-700' : r.engagement_score >= 60 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                          {Math.round(Number(r.engagement_score ?? 0))}%
                        </div>
                      </td>
                      <td className="p-4"><RiskPill label={r.risk_label} /></td>
                      <td className="p-4 font-mono text-xs text-slate-500">{r.snapshot_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Kudos Wall */}
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/40">
            <h2 className="text-xl font-black text-slate-950 mb-1 flex items-center gap-2">
              <Heart className="h-5 w-5 text-rose-500" /> Live Kudos Wall
            </h2>
            <p className="mb-4 text-sm text-slate-500">Latest appreciation moments across the organization.</p>
            <div className="max-h-[620px] space-y-3 overflow-auto pr-1">
              {(data?.kudos_feed ?? []).map((k) => (
                <div key={k.kudos_id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 hover:shadow-md transition-all hover:-translate-y-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-950">{k.receiver_name}</p>
                      <p className="text-xs text-slate-500">from {k.sender_name} · {k.kudos_title ?? 'General appreciation'}</p>
                    </div>
                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-700">+{k.points_awarded}</span>
                  </div>
                  {k.custom_message && <p className="mt-3 text-sm text-slate-700">"{k.custom_message}"</p>}
                  <p className="mt-3 text-xs text-slate-400">{k.reaction_count} reactions · {k.sent_at?.slice(0, 10)}</p>
                </div>
              ))}
              {(data?.kudos_feed ?? []).length === 0 && <p className="text-sm text-slate-500 py-4">Kudos will appear here.</p>}
            </div>
          </div>
        </div>
      </main>
    </DashboardLayout>
  );
}

function MetricCard({ title, value, note, icon, color }: { title: string; value: React.ReactNode; note: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="group relative overflow-hidden rounded-[2rem] border-0 bg-white p-5 shadow-lg shadow-slate-200/30 hover:shadow-xl hover:shadow-slate-300/40 transition-all duration-300 hover:-translate-y-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-500">{title}</p>
          <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
          <p className="mt-1 text-xs text-slate-400 font-medium">{note}</p>
        </div>
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-white shadow-lg shadow-current/30 transition-transform duration-300 group-hover:scale-110`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
