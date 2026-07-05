import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { portalApi, clearPortalToken } from "@/lib/portalApi";
import { KpiScorecardGrid } from "@/components/portal/KpiScorecardGrid";
import { GlidePathChart } from "@/components/portal/GlidePathChart";
import {
  Loader2, LogOut, Briefcase, RefreshCw, CheckCircle, Clock, AlertCircle, XCircle,
  FileText, Activity, Users, MessageSquare, ClipboardList, Shield, User, ArrowRight
} from "lucide-react";

const TABS = ["Performance", "Glide Paths", "Action Plans", "Governance", "Attrition", "Commentary"] as const;
type Tab = typeof TABS[number];

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export default function PortalProcessDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("Performance");
  const [period, setPeriod] = useState(currentPeriod());

  // Process meta (dynamic)
  const procInfo = useQuery({
    queryKey: ["portal-proc-info", id],
    queryFn: () => portalApi.getProcess(id!),
    enabled: !!id,
  });
  const processName = procInfo.data?.data?.process_name ?? "Loading…";
  const clientName = procInfo.data?.data?.client_name ?? "";
  const ragStatus = procInfo.data?.data?.rag ?? null;

  // Queries
  const kpis = useQuery({ queryKey: ["portal-kpis", id, period], queryFn: () => portalApi.getKpis(id!, period), enabled: tab === "Performance" });
  const glide = useQuery({ queryKey: ["portal-glide", id, period], queryFn: () => portalApi.getGlidePaths(id!, period), enabled: tab === "Glide Paths" });
  const actions = useQuery({ queryKey: ["portal-actions", id], queryFn: () => portalApi.getActionPlans(id!), enabled: tab === "Action Plans" });
  const governance = useQuery({ queryKey: ["portal-gov", id, period], queryFn: () => portalApi.getGovernance(id!, period), enabled: tab === "Governance" });
  const attrition = useQuery({ queryKey: ["portal-attrition", id, period], queryFn: () => portalApi.getAttrition(id!, period), enabled: tab === "Attrition" });
  const commentary = useQuery({ queryKey: ["portal-commentary", id, period], queryFn: () => portalApi.getCommentary(id!, period), enabled: tab === "Commentary" });

  function handleLogout() {
    clearPortalToken();
    navigate("/portal/login");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-blue-600/30 selection:text-white">
      {/* Glow Rings background */}
      <div className="absolute top-0 right-0 w-[400px] h-[300px] bg-blue-600/5 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-emerald-600/5 blur-[100px] pointer-events-none" />

      {/* TOP HEADER COMMAND BAR */}
      <header className="sticky top-0 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/80 z-40">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white font-bold shadow-md shadow-blue-900/50">
              M
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold tracking-tight text-white">MAS CALLNET</span>
                <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">PORTAL 2.0</span>
              </div>
              <p className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">BPO Client Command Center</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-4 bg-slate-950/40 border border-slate-800 px-3 py-1.5 rounded-lg">
            <div className="text-right">
              <p className="text-xs font-bold text-white leading-tight">{clientName}</p>
              <p className="text-[9px] text-slate-500 font-semibold">{processName}</p>
            </div>
            <div className="w-1.5 h-6 bg-slate-800" />
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase">Active</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-800/40 border border-slate-800/60 rounded-full px-2.5 py-1 text-slate-300">
              <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">
                CP
              </div>
              <span className="text-xs font-medium hidden md:inline">Client Partner</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all duration-200 border border-transparent hover:border-rose-500/20"
              title="Logout from portal"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* DASHBOARD TITLE BLOCK */}
      <div className="bg-slate-900/30 border-b border-slate-800/30 py-6">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-blue-400" />
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Operational Dashboard</p>
            </div>
            <h1 className="text-2xl font-extrabold text-white mt-1">
              {clientName} <span className="text-slate-500 font-normal">/</span> {processName}
            </h1>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full shadow-md ${ragStatus === "green" ? "bg-emerald-500 shadow-emerald-500/50" : ragStatus === "amber" ? "bg-amber-500 shadow-amber-500/50" : "bg-red-500 shadow-red-500/50"}`} />
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">Overall RAG</p>
                <p className={`text-xs font-bold ${ragStatus === "green" ? "text-emerald-400" : ragStatus === "amber" ? "text-amber-400" : ragStatus === "red" ? "text-red-400" : "text-slate-400"}`}>
                  {ragStatus === "green" ? "Green (On Track)" : ragStatus === "amber" ? "Amber (Monitor)" : ragStatus === "red" ? "Red (At Risk)" : "—"}
                </p>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide mb-0.5">Period</p>
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-300 outline-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* TAB SLIDER MENU */}
      <div className="bg-slate-900/20 border-b border-slate-800/50 sticky top-16 z-30 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-1 overflow-x-auto no-scrollbar py-2">
            {TABS.map(t => {
              const isActive = tab === t;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 whitespace-nowrap flex items-center gap-2 border ${
                    isActive
                      ? "bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/40"
                      : "bg-transparent text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/30"
                  }`}
                >
                  {t === "Performance" && <Activity className="w-3.5 h-3.5" />}
                  {t === "Glide Paths" && <RefreshCw className="w-3.5 h-3.5" />}
                  {t === "Action Plans" && <ClipboardList className="w-3.5 h-3.5" />}
                  {t === "Governance" && <Shield className="w-3.5 h-3.5" />}
                  {t === "Attrition" && <Users className="w-3.5 h-3.5" />}
                  {t === "Commentary" && <MessageSquare className="w-3.5 h-3.5" />}
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* PORTLET CONTAINER MODULE */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {tab === "Performance" && (
          kpis.isLoading ? (
            <div className="py-20 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            </div>
          ) : (
            <KpiScorecardGrid scorecards={kpis.data?.data ?? []} />
          )
        )}
        
        {tab === "Glide Paths" && (
          glide.isLoading ? (
            <div className="py-20 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            </div>
          ) : (glide.data?.data ?? []).length === 0 ? (
            <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-8 text-center">
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-bold text-slate-200">Continuous Operational Excellence</p>
              <p className="text-slate-500 text-xs mt-1">All metrics are currently exceeding targets — no active Glide Paths required.</p>
            </div>
          ) : (
            <div className="grid gap-6">
              {(glide.data?.data ?? []).map((p: any) => (
                <GlidePathChart key={p.metric_id} path={p} />
              ))}
            </div>
          )
        )}

        {tab === "Action Plans" && (
          <ActionPlansTab data={actions.data?.data ?? []} loading={actions.isLoading} />
        )}

        {tab === "Governance" && (
          <GovernanceTab data={governance.data?.data ?? []} loading={governance.isLoading} />
        )}

        {tab === "Attrition" && (
          <AttritionTab data={attrition.data?.data} loading={attrition.isLoading} />
        )}

        {tab === "Commentary" && (
          <CommentaryTab data={commentary.data?.data} loading={commentary.isLoading} processId={id!} period={period} />
        )}
      </main>
    </div>
  );
}

// ----------------------------------------------------
// 📋 ACTION PLANS TAB VIEW COMPONENT
// ----------------------------------------------------
function ActionPlansTab({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-8 text-center">
        <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="font-bold text-slate-200">No Action Plans Found</p>
        <p className="text-slate-500 text-xs mt-1">Operations team hasn't registered any corrective action plans for this cycle.</p>
      </div>
    );
  }

  const byMetric = data.reduce((acc, item) => {
    const key = item.metric_code;
    if (!acc[key]) acc[key] = { name: item.metric_name, items: [] };
    acc[key].items.push(item);
    return acc;
  }, {} as Record<string, { name: string; items: any[] }>);

  const STATUS_TAG = {
    planned: "bg-slate-800 text-slate-300 border-slate-700",
    in_progress: "bg-blue-900/30 text-blue-400 border-blue-500/20",
    done: "bg-emerald-900/30 text-emerald-400 border-emerald-500/20",
    delayed: "bg-rose-900/30 text-rose-400 border-rose-500/20"
  };

  const STATUS_ICON = {
    planned: <Clock className="w-3.5 h-3.5" />,
    in_progress: <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: "3s" }} />,
    done: <CheckCircle className="w-3.5 h-3.5" />,
    delayed: <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
  };

  const LEVEL_LABEL: Record<string, string> = {
    analyst: "Analyst",
    tl: "Team Leader",
    process_manager: "Process Manager",
    branch_head: "Branch Head"
  };

  return (
    <div className="space-y-6">
      {Object.entries(byMetric).map(([code, { name, items }]: any) => (
        <div key={code} className="bg-slate-900/60 border border-slate-800/80 rounded-xl overflow-hidden shadow-xl">
          <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-bold text-white">
                {name} <span className="text-slate-500 font-normal">({code})</span>
              </h3>
            </div>
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-bold">
              {items.length} Plan{items.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-slate-500 text-[10px] font-bold tracking-widest uppercase border-b border-slate-800 bg-slate-950/20">
                  <th className="px-5 py-3">Action Details</th>
                  <th className="px-5 py-3">Owner Designation</th>
                  <th className="px-5 py-3">Due Date</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {items.map((item: any) => (
                  <tr key={item.id} className="hover:bg-slate-800/20 transition-colors">
                    <td className="px-5 py-4 text-slate-200 font-medium">{item.action_text}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-blue-950 text-blue-300 border border-blue-900 px-2 py-0.5 rounded font-semibold">
                          {LEVEL_LABEL[item.owner_level as keyof typeof LEVEL_LABEL]}
                        </span>
                        <span className="text-slate-300 font-medium">{item.owner_name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-400 font-mono text-xs">
                      {formatISTDate(item.due_date)}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${STATUS_TAG[item.status as keyof typeof STATUS_TAG]}`}>
                        {STATUS_ICON[item.status as keyof typeof STATUS_ICON]}
                        <span className="capitalize">{item.status.replace("_", " ")}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------
// 🛡 GOVERNANCE TAB VIEW COMPONENT
// ----------------------------------------------------
function GovernanceTab({ data, loading }: { data: any[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  const LEVELS = ["analyst", "tl", "process_manager", "branch_head"] as const;
  
  const LEVEL_TITLE: Record<string, string> = {
    analyst: "Analyst Audits",
    tl: "Team Leader Walkthroughs",
    process_manager: "Process Manager Calibrations",
    branch_head: "Branch Head Operational Reviews"
  };

  const RAG_BAR_COLOR = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-rose-500"
  };

  const RAG_TEXT_COLOR = {
    green: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-rose-400"
  };

  const byLevel = LEVELS.reduce((acc, l) => {
    acc[l] = data.filter((a: any) => a.level === l);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {LEVELS.map(level => {
        const activities = byLevel[level];
        const overall = activities.length
          ? Math.round(activities.reduce((s: number, a: any) => s + a.completion_pct, 0) / activities.length)
          : 0;
        
        const rag = overall >= 90 ? "green" : overall >= 75 ? "amber" : "red";

        return (
          <div key={level} className="bg-slate-900/60 border border-slate-800/80 rounded-xl overflow-hidden shadow-lg flex flex-col justify-between">
            <div>
              <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                <p className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                  {LEVEL_TITLE[level].split(" ")[0]} Check
                </p>
                <span className={`text-sm font-extrabold ${RAG_TEXT_COLOR[rag]}`}>
                  {overall}%
                </span>
              </div>

              <div className="p-4 space-y-4">
                {activities.map((a: any) => (
                  <div key={a.activity_id} className="space-y-1.5">
                    <div className="flex justify-between items-start">
                      <p className="text-xs font-semibold text-slate-200 line-clamp-1">{a.activity_name}</p>
                      <span className={`text-[10px] font-bold ${RAG_TEXT_COLOR[a.rag as keyof typeof RAG_TEXT_COLOR]}`}>
                        {a.completion_pct}%
                      </span>
                    </div>

                    <div className="h-1.5 bg-slate-950 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${RAG_BAR_COLOR[a.rag as keyof typeof RAG_BAR_COLOR]}`}
                        style={{ width: `${Math.min(a.completion_pct, 100)}%` }}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between text-[9px] text-slate-500">
                      <span>Cycle Target: {a.required_count}</span>
                      <span className="font-mono">Completed: {a.completed_count}</span>
                    </div>
                  </div>
                ))}

                {activities.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-6">No audits scheduled.</p>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-950/20 border-t border-slate-800/40">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span>Overall Status</span>
                <span className={RAG_TEXT_COLOR[rag]}>{rag === "green" ? "Exceeding" : rag === "amber" ? "Warning" : "Critical"}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------
// 👥 ATTRITION TAB VIEW COMPONENT
// ----------------------------------------------------
function AttritionTab({ data, loading }: { data: any; loading: boolean }) {
  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-8 text-center">
        <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="font-bold text-slate-200">No Attrition Logs</p>
        <p className="text-slate-500 text-xs mt-1">No personnel movement records published for this dashboard period.</p>
      </div>
    );
  }

  const sanctioned = data.sanctioned_strength || 1;
  const actualRatio = Math.round((data.headcount / sanctioned) * 100);

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: "Active Headcount", value: data.headcount, sub: `${actualRatio}% of sanctioned staff (${sanctioned})`, color: "text-blue-400" },
          { label: "Voluntary Exits", value: data.voluntary_count, sub: "Resignations / Career growth", color: "text-amber-400" },
          { label: "Involuntary Exits", value: data.involuntary_count, sub: "Performance / Policy breach", color: "text-rose-400" },
          { label: "Average Floor Tenure", value: `${data.avg_tenure_months} Months`, sub: "Average analyst lifecycle", color: "text-emerald-400" }
        ].map(card => (
          <div key={card.label} className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-lg">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{card.label}</p>
            <p className={`text-3xl font-extrabold ${card.color}`}>{card.value}</p>
            <p className="text-[10px] text-slate-400 font-medium mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Exit reasons breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-lg md:col-span-2">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-blue-400" /> Key Exit Reason Timelines
          </h4>
          
          <div className="space-y-4">
            {data.top_exit_reasons && data.top_exit_reasons.map((r: any, i: number) => {
              const maxCount = data.top_exit_reasons[0]?.count || 1;
              const ratio = Math.round((r.count / maxCount) * 100);
              
              return (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-200">{r.reason}</span>
                    <span className="text-slate-400 font-bold">{r.count} Agent{r.count !== 1 ? "s" : ""}</span>
                  </div>

                  <div className="h-2 bg-slate-950 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${ratio}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {(!data.top_exit_reasons || data.top_exit_reasons.length === 0) && (
              <p className="text-xs text-slate-500 text-center py-8">No reason logs recorded.</p>
            )}
          </div>
        </div>

        {/* Strength meter */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-lg flex flex-col justify-between">
          <div>
            <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-4">
              Floor Strength Capacity
            </h4>
            <div className="text-center py-4">
              <div className="inline-block relative">
                <svg className="w-28 h-28 transform -rotate-90">
                  <circle cx="56" cy="56" r="48" fill="transparent" stroke="#1e293b" strokeWidth="8" />
                  <circle
                    cx="56"
                    cy="56"
                    r="48"
                    fill="transparent"
                    stroke="#2563eb"
                    strokeWidth="8"
                    strokeDasharray={301.6}
                    strokeDashoffset={301.6 - (301.6 * Math.min(actualRatio, 100)) / 100}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-extrabold text-white">{actualRatio}%</span>
                  <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wide">Capacity</span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center text-xs text-slate-400 border-t border-slate-800/40 pt-3">
            <span className="font-semibold text-white">{data.headcount} Agents</span> on floor vs <span className="font-semibold text-white">{sanctioned} sanctioned</span> positions
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 💬 MANAGEMENT COMMENTARY TAB VIEW COMPONENT
// ----------------------------------------------------
function CommentaryTab({
  data,
  loading,
  processId,
  period
}: {
  data: any;
  loading: boolean;
  processId: string;
  period: string;
}) {
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-8 text-center">
        <MessageSquare className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="font-bold text-slate-200">No Operations Commentary</p>
        <p className="text-slate-500 text-xs mt-1">Operations management has not published any reviews or bulletins for this period.</p>
      </div>
    );
  }

  async function handleAcknowledge() {
    setBusy(true);
    try {
      await portalApi.acknowledgeCommentary(data.id);
      window.location.reload();
    } catch (e: any) {
      alert(e.message || "Failed to acknowledge comment.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    setBusy(true);
    try {
      await portalApi.replyCommentary(data.id, replyText);
      setReplyText("");
      window.location.reload();
    } catch (e: any) {
      alert(e.message || "Failed to submit comment reply.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Main post */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute -top-px left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />
        
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-4 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600/10 text-blue-400 border border-blue-500/20 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">{data.author_name}</p>
              <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                {data.author_designation} · {formatISTDate(data.published_at)}
              </p>
            </div>
          </div>

          <div>
            {data.acknowledged_at ? (
              <span className="text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full">
                ✓ Acknowledged
              </span>
            ) : (
              <span className="text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-full animate-pulse">
                Awaiting Acknowledgement
              </span>
            )}
          </div>
        </div>

        <div className="text-slate-300 text-sm whitespace-pre-line leading-relaxed pl-1 py-1">
          {data.body}
        </div>

        {/* Acknowledge Button */}
        {!data.acknowledged_at && (
          <div className="mt-6 pt-4 border-t border-slate-800/40">
            <button
              onClick={handleAcknowledge}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg disabled:opacity-50 transition-all shadow-md shadow-emerald-950"
            >
              {busy ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Approving...
                </>
              ) : (
                <>
                  Acknowledge & Accept Report <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Replies stack */}
      {data.replies && data.replies.length > 0 && (
        <div className="space-y-4">
          <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 ml-6 flex items-center gap-1">
            <MessageSquare className="w-3 h-3 text-slate-600" /> Discussion History
          </h4>

          <div className="space-y-3 pl-6 border-l-2 border-slate-800/80">
            {data.replies.map((r: any) => (
              <div key={r.id} className="bg-slate-900/40 border border-slate-800/40 rounded-xl p-4 shadow-md">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] bg-slate-800 text-slate-400 font-bold px-2 py-0.5 rounded">
                      Client Team
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {formatISTDate(r.created_at)}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed font-medium">{r.reply_text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response input */}
      <form onSubmit={handleReply} className="bg-slate-900/20 border border-slate-800/50 rounded-xl p-4 space-y-3">
        <div className="relative">
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            maxLength={1000}
            className="w-full bg-slate-950/80 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg p-3 text-xs text-white placeholder-slate-500 resize-none h-20 transition-all font-medium"
            placeholder="Address the operations manager or request specific focus areas..."
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500 font-bold font-mono">
            {replyText.length} / 1000 characters
          </span>
          
          <button
            type="submit"
            disabled={busy || !replyText.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg disabled:opacity-50 transition-all shadow-md shadow-blue-950"
          >
            {busy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1 inline-block" /> Posting...
              </>
            ) : (
              "Submit Comment"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
