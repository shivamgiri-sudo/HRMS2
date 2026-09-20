import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { portalApi, clearPortalToken, getImpersonationInfo } from "@/lib/portalApi";
import { KpiScorecardGrid } from "@/components/portal/KpiScorecardGrid";
import { GlidePathChart } from "@/components/portal/GlidePathChart";
import { PortalKpiStrip, type KpiStripItem } from "@/components/portal/PortalKpiStrip";
import { ImpersonationBanner, IMPERSONATION_BANNER_HEIGHT_PX } from "@/components/portal/ImpersonationBanner";
import {
  Loader2, LogOut, Briefcase, CheckCircle, Clock, AlertCircle, RefreshCw,
  FileText, Activity, Users, MessageSquare, ClipboardList, Shield, User, ArrowRight,
  TrendingUp, Gauge, AlertTriangle, ListChecks, GraduationCap, Radio
} from "lucide-react";
import { formatISTDate } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

const TABS = ["Performance", "Operations", "Quality", "Workforce", "Glide Paths", "Action Plans", "Governance", "Live", "Attrition", "Training Compliance", "Commentary"] as const;
type Tab = typeof TABS[number];

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function clientInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "C";
  return (words[0][0] + (words[1]?.[0] ?? "")).toUpperCase();
}

export default function PortalProcessDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const governance = useQuery({ queryKey: ["portal-governance", id, period], queryFn: () => portalApi.getGovernance(id!, period), enabled: tab === "Governance" });
  const liveDashboard = useQuery({ queryKey: ["portal-live-dashboard", id], queryFn: () => portalApi.getLiveDashboard(id!), enabled: tab === "Live" });
  const operations = useQuery({ queryKey: ["portal-operations", id], queryFn: () => portalApi.getOperations(id!), enabled: tab === "Operations" });
  const quality = useQuery({ queryKey: ["portal-quality", id], queryFn: () => portalApi.getQuality(id!), enabled: tab === "Quality" });
  const workforce = useQuery({ queryKey: ["portal-workforce", id], queryFn: () => portalApi.getWorkforce(id!), enabled: tab === "Workforce" });
  const attrition = useQuery({ queryKey: ["portal-attrition", id, period], queryFn: () => portalApi.getAttrition(id!, period), enabled: tab === "Attrition" });
  const trainingCompliance = useQuery({ queryKey: ["portal-training-compliance", id, period], queryFn: () => portalApi.getTrainingCompliance(id!, period), enabled: tab === "Training Compliance" });
  const commentary = useQuery({ queryKey: ["portal-commentary", id, period], queryFn: () => portalApi.getCommentary(id!, period), enabled: tab === "Commentary" });

  // Revokes this session's jti server-side before clearing the local token -- same
  // defense-in-depth as ImpersonationBanner's Exit button, see its own comment.
  async function handleLogout() {
    try {
      await portalApi.logout();
    } finally {
      clearPortalToken();
      navigate("/portal/login");
    }
  }

  const { isImpersonating } = getImpersonationInfo();

  return (
    <div
      className="min-h-screen bg-slate-950 text-white font-sans selection:bg-blue-600/30 selection:text-white"
      style={isImpersonating ? { paddingTop: IMPERSONATION_BANNER_HEIGHT_PX } : undefined}
    >
      <ImpersonationBanner />
      {/* Glow Rings background */}
      <div className="absolute top-0 right-0 w-[400px] h-[300px] bg-blue-600/5 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-emerald-600/5 blur-[100px] pointer-events-none" />

      {/* TOP HEADER COMMAND BAR */}
      <header className="sticky top-0 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/80 z-40">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
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

          <div className="flex items-center gap-3 bg-slate-950/40 border border-slate-800 px-3 py-1.5 rounded-lg">
            <div className="text-right min-w-0">
              <p className="text-xs font-bold text-white leading-tight truncate max-w-[120px] sm:max-w-none">{clientName}</p>
              <p className="text-[9px] text-slate-500 font-semibold truncate max-w-[120px] sm:max-w-none">{processName}</p>
            </div>
            <div className="hidden sm:block w-1.5 h-6 bg-slate-800" />
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase hidden sm:inline">Active</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-800/40 border border-slate-800/60 rounded-full px-2.5 py-1 text-slate-300">
              <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">
                {clientInitials(clientName)}
              </div>
              <span className="text-xs font-medium hidden md:inline">{clientName || "Client"}</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all duration-200 border border-transparent hover:border-rose-500/20"
              title="Sign out of portal"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-xs font-medium hidden md:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* DASHBOARD TITLE BLOCK */}
      <div className="bg-slate-900/30 border-b border-slate-800/30 py-6">
        <div className="max-w-[1600px] mx-auto px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
              <div className={`w-2 h-2 rounded-full shadow-md ${
                ragStatus === "green" ? "bg-emerald-500 shadow-emerald-500/50"
                : ragStatus === "amber" ? "bg-amber-500 shadow-amber-500/50"
                : ragStatus === "red" ? "bg-red-500 shadow-red-500/50"
                : "bg-slate-600"
              }`} />
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">Overall RAG</p>
                <p className={`text-xs font-bold ${ragStatus === "green" ? "text-emerald-400" : ragStatus === "amber" ? "text-amber-400" : ragStatus === "red" ? "text-red-400" : "text-slate-400"}`}>
                  {ragStatus === "green" ? "Green (On Track)" : ragStatus === "amber" ? "Amber (Monitor)" : ragStatus === "red" ? "Red (At Risk)" : "Not Tracked"}
                </p>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide mb-0.5">Period</p>
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs font-bold text-slate-300 outline-none cursor-pointer focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* TAB SLIDER MENU */}
      <div className="bg-slate-900/20 border-b border-slate-800/50 sticky top-16 z-30 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-6">
          <div role="tablist" aria-label="Dashboard tabs" className="flex gap-1 overflow-x-auto no-scrollbar py-2">
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
                  {t === "Operations" && <Gauge className="w-3.5 h-3.5" />}
                  {t === "Quality" && <Shield className="w-3.5 h-3.5" />}
                  {t === "Workforce" && <Briefcase className="w-3.5 h-3.5" />}
                  {t === "Glide Paths" && <TrendingUp className="w-3.5 h-3.5" />}
                  {t === "Action Plans" && <ClipboardList className="w-3.5 h-3.5" />}
                  {t === "Governance" && <ListChecks className="w-3.5 h-3.5" />}
                  {t === "Live" && <Radio className="w-3.5 h-3.5" />}
                  {t === "Attrition" && <Users className="w-3.5 h-3.5" />}
                  {t === "Training Compliance" && <GraduationCap className="w-3.5 h-3.5" />}
                  {t === "Commentary" && <MessageSquare className="w-3.5 h-3.5" />}
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* PORTLET CONTAINER MODULE */}
      <main className="max-w-[1600px] mx-auto px-6 py-8">
        {tab === "Performance" && (
          kpis.isLoading ? (
            <div className="py-20 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            </div>
          ) : kpis.error ? (
            <TabErrorState error={kpis.error} onRetry={() => kpis.refetch()} />
          ) : (
            <div className="space-y-6">
              <PerformanceKpiStrip scorecards={kpis.data?.data ?? []} />
              <KpiScorecardGrid scorecards={kpis.data?.data ?? []} />
            </div>
          )
        )}
        
        {tab === "Glide Paths" && (
          glide.isLoading ? (
            <div className="py-20 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            </div>
          ) : glide.error ? (
            <TabErrorState error={glide.error} onRetry={() => glide.refetch()} />
          ) : (glide.data?.data?.paths ?? []).length === 0 ? (
            <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-8 text-center">
              <TrendingUp className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="font-bold text-slate-200">No Glide Paths Set</p>
              <p className="text-slate-500 text-xs mt-1">No improvement commitments have been set for this process yet.</p>
            </div>
          ) : (
            <div className="grid gap-6">
              {(glide.data?.data?.paths ?? []).map((p: any) => (
                <GlidePathChart key={p.metric_id} path={p} />
              ))}
            </div>
          )
        )}

        {tab === "Action Plans" && (
          actions.error ? (
            <TabErrorState error={actions.error} onRetry={() => actions.refetch()} />
          ) : (
            <ActionPlansTab data={actions.data?.data ?? []} loading={actions.isLoading} />
          )
        )}

        {tab === "Governance" && (
          governance.error ? (
            <TabErrorState error={governance.error} onRetry={() => governance.refetch()} />
          ) : (
            <GovernanceTab data={governance.data?.data ?? []} loading={governance.isLoading} />
          )
        )}

        {tab === "Live" && (
          liveDashboard.error ? (
            <TabErrorState error={liveDashboard.error} onRetry={() => liveDashboard.refetch()} />
          ) : (
            <LiveDashboardTab data={liveDashboard.data?.data} loading={liveDashboard.isLoading} />
          )
        )}

        {tab === "Operations" && (
          operations.error ? (
            <TabErrorState error={operations.error} onRetry={() => operations.refetch()} />
          ) : (
            <OperationsQualityTab data={operations.data?.data} loading={operations.isLoading} emptyLabel="operations" processId={id!} />
          )
        )}

        {tab === "Quality" && (
          quality.error ? (
            <TabErrorState error={quality.error} onRetry={() => quality.refetch()} />
          ) : (
            <OperationsQualityTab data={quality.data?.data} loading={quality.isLoading} emptyLabel="quality" processId={id!} />
          )
        )}

        {tab === "Workforce" && (
          workforce.error ? (
            <TabErrorState error={workforce.error} onRetry={() => workforce.refetch()} />
          ) : (
            <WorkforceTab data={workforce.data?.data} loading={workforce.isLoading} />
          )
        )}

        {tab === "Attrition" && (
          attrition.error ? (
            <TabErrorState error={attrition.error} onRetry={() => attrition.refetch()} />
          ) : (
            <AttritionTab data={attrition.data?.data} loading={attrition.isLoading} />
          )
        )}

        {tab === "Training Compliance" && (
          trainingCompliance.error ? (
            <TabErrorState error={trainingCompliance.error} onRetry={() => trainingCompliance.refetch()} />
          ) : (
            <TrainingComplianceTab data={trainingCompliance.data?.data} loading={trainingCompliance.isLoading} />
          )
        )}

        {tab === "Commentary" && (
          commentary.error ? (
            <TabErrorState error={commentary.error} onRetry={() => commentary.refetch()} />
          ) : (
            <CommentaryTab data={commentary.data?.data} loading={commentary.isLoading} processId={id!} period={period} queryClient={queryClient} />
          )
        )}
      </main>
    </div>
  );
}

// ----------------------------------------------------
// ⚠ SHARED TAB ERROR STATE — every tab query previously fell through to an
// empty array on fetch failure, which looked identical to "nothing configured
// yet" (a real, misleading state to be in) rather than "something broke, try
// again." No dedicated client-support inbox exists anywhere in this codebase
// to link to (see PortalOverview.tsx's own comment on the same finding), so
// this points at the account manager relationship instead of fabricating one.
// ----------------------------------------------------
function TabErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong loading this tab.";
  return (
    <div className="bg-slate-900/50 rounded-xl border border-red-900/40 p-8 text-center">
      <AlertTriangle className="w-12 h-12 text-red-500/60 mx-auto mb-3" />
      <p className="font-bold text-slate-200">Couldn't Load This Tab</p>
      <p className="text-slate-500 text-xs mt-1 max-w-md mx-auto">
        Please try again. If this keeps happening, contact your MAS account manager and
        mention the error below.
      </p>
      <p className="text-red-400/70 text-[10px] mt-2 font-mono break-words max-w-md mx-auto">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Retry
      </button>
    </div>
  );
}

// ----------------------------------------------------
// 📊 PERFORMANCE KPI STRIP — roll-up across this process's scorecards for the
// selected period. Derived entirely from the same portalApi.getKpis() response
// KpiScorecardGrid renders below it; no separate fetch, no fabricated numbers.
// ----------------------------------------------------
function PerformanceKpiStrip({ scorecards }: { scorecards: any[] }) {
  if (!scorecards || scorecards.length === 0) return null;

  const tracked = scorecards.filter((m) => m.achievement_pct != null);
  const avgAchievement = tracked.length > 0
    ? Math.round(tracked.reduce((s, m) => s + m.achievement_pct, 0) / tracked.length)
    : null;
  const redCount = scorecards.filter((m) => m.rag === "red").length;
  const amberCount = scorecards.filter((m) => m.rag === "amber").length;
  const greenCount = scorecards.filter((m) => m.rag === "green").length;

  const items: KpiStripItem[] = [
    {
      key: "tracked",
      label: "Metrics Tracked",
      value: scorecards.length,
      sub: `${greenCount} on target`,
      accent: "cyan",
      icon: <Activity className="w-4 h-4" />,
    },
    {
      key: "achievement",
      label: "Avg. Target Achievement",
      value: avgAchievement != null ? `${avgAchievement}%` : null,
      sub: `${tracked.length} of ${scorecards.length} with a real reading`,
      accent: avgAchievement == null ? "slate" : avgAchievement >= 95 ? "emerald" : avgAchievement >= 80 ? "amber" : "rose",
      icon: <Gauge className="w-4 h-4" />,
    },
    {
      key: "critical",
      label: "Critical Metrics",
      value: redCount,
      sub: "RAG = Red this period",
      accent: redCount === 0 ? "emerald" : "rose",
      icon: <AlertTriangle className="w-4 h-4" />,
    },
    {
      key: "watch",
      label: "Watch List",
      value: amberCount,
      sub: "RAG = Amber this period",
      accent: amberCount === 0 ? "emerald" : "amber",
      icon: <Clock className="w-4 h-4" />,
    },
  ];

  return <PortalKpiStrip items={items} />;
}

// ----------------------------------------------------
// 👔 WORKFORCE TAB — headcount vs. sanctioned mandate + hiring pipeline, from
// process-operations.service.ts's getProcessBusinessHealthForPortal(). Deliberately
// does NOT include revenue/GRN/agent-salary/EBIT/Op% -- that internal cost and
// profitability data is stripped server-side before this ever reaches the client
// portal (see portal.controller.ts's getWorkforce), so there is nothing to hide here.
// ----------------------------------------------------
function WorkforceTab({ data, loading }: { data: any; loading: boolean }) {
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
        <Briefcase className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="font-bold text-slate-200">No Workforce Data</p>
        <p className="text-slate-500 text-xs mt-1">Workforce figures are not available for this process yet.</p>
      </div>
    );
  }

  const hc = data.headcount;
  const hiring = data.hiring;
  const hasMandate = hc?.mandatedHc != null;
  const capacityPct = hasMandate ? Math.round((hc.activeHc / hc.mandatedHc) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-lg">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Active Headcount</p>
          <p className="text-3xl font-extrabold text-blue-400">{hc.activeHc}</p>
          <p className="text-[10px] text-slate-400 font-medium mt-1">
            {hasMandate ? `${capacityPct}% of sanctioned (${hc.mandatedHc})` : "No mandate configured"}
          </p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-lg">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Shortfall</p>
          <p className={`text-3xl font-extrabold ${hc.shortfall ? "text-rose-400" : "text-emerald-400"}`}>
            {hc.shortfall ?? "—"}
          </p>
          <p className="text-[10px] text-slate-400 font-medium mt-1">Below sanctioned mandate</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-lg">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Open Positions</p>
          <p className="text-3xl font-extrabold text-amber-400">{hiring?.openPositions ?? "—"}</p>
          <p className="text-[10px] text-slate-400 font-medium mt-1">
            Across {hiring?.openRequisitions ?? 0} open requisition{hiring?.openRequisitions === 1 ? "" : "s"}
          </p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-lg">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Candidates in Pipeline</p>
          <p className="text-3xl font-extrabold text-cyan-400">{hiring?.candidatesInPipeline ?? "—"}</p>
          <p className="text-[10px] text-slate-400 font-medium mt-1">{hiring?.hiredCount ?? 0} hired to date via requisitions</p>
        </div>
      </div>

      {hc?.reason && (
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-lg px-4 py-3 text-xs text-slate-400">
          {hc.reason}
        </div>
      )}
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
// ✅ GOVERNANCE CHECKLIST TAB VIEW COMPONENT
// Read-only for the client: shows the same completion-vs-required rollup internal ops
// staff record via the governance checklist (analyst/TL/process-manager/branch-head
// cadence activities like floor walks, coaching sessions, QA calibration attendance).
// Backed by governance_activity_master (a real, seeded catalog) + governance_checklist_log
// (the actual completion counts) -- see portal.governance.service.ts.
// ----------------------------------------------------
const GOVERNANCE_LEVEL_LABEL: Record<string, string> = {
  analyst: "Analyst",
  tl: "Team Leader",
  process_manager: "Process Manager",
  branch_head: "Branch Head",
};

function GovernanceTab({ data, loading }: { data: any[]; loading: boolean }) {
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
        <ListChecks className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="font-bold text-slate-200">No Governance Activities Configured</p>
        <p className="text-slate-500 text-xs mt-1">No governance checklist activities are set up for this process yet.</p>
      </div>
    );
  }

  const byLevel = data.reduce((acc, item) => {
    const key = item.level;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, any[]>);

  const RAG_DOT: Record<string, string> = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-rose-500",
  };

  const RAG_BAR: Record<string, string> = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-rose-500",
  };

  const levelOrder = ["analyst", "tl", "process_manager", "branch_head"];

  return (
    <div className="space-y-6">
      {levelOrder.filter(l => byLevel[l]?.length).map(level => (
        <div key={level} className="bg-slate-900/60 border border-slate-800/80 rounded-xl overflow-hidden shadow-xl">
          <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-bold text-white">{GOVERNANCE_LEVEL_LABEL[level] ?? level}</h3>
            </div>
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-bold">
              {byLevel[level].length} Activit{byLevel[level].length !== 1 ? "ies" : "y"}
            </span>
          </div>

          <div className="divide-y divide-slate-800/50">
            {byLevel[level].map((item: any) => (
              <div key={item.activity_id} className="px-5 py-4 flex items-center gap-4">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${RAG_DOT[item.rag]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-slate-200 font-medium text-sm">{item.activity_name}</p>
                    <span className="text-[10px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded capitalize">{item.frequency}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden max-w-xs">
                      <div
                        className={`h-full rounded-full ${RAG_BAR[item.rag]}`}
                        style={{ width: `${Math.min(100, item.completion_pct)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
                      {item.completed_count}/{item.required_count} ({item.completion_pct}%)
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------
// 📡 LIVE DASHBOARD TAB — real-time-ish call/campaign metrics for the named clients
// that have one (Bla Bli Blu, Reginald, Finnable, GS1, GNC, Bella-Vita, Clovia,
// Neemans, Viega, Exicom, DU Digital). Backed by portal.live-dashboard.service.ts's
// getLiveDashboardForPortal(), which reuses the exact same dialler_db / CDR-staging
// queries as the internal ProcessOperationsPage.tsx's "Live Dashboard" view -- minus
// every per-agent/per-analyst row (that stays internal-only, see that file's own
// comment) and minus Billing entirely (MAS's own internal cost/profitability figures
// against this client, never client-facing). data is null when this process has no
// named live dashboard, rendered the same as "not available" rather than an error --
// most processes genuinely don't have one, which is not a fault to report.
// ----------------------------------------------------
function LiveMetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 shadow-lg">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate mb-2">{label}</p>
      <p className="text-2xl font-extrabold text-white tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function LiveDailyTable({ rows, columns }: { rows: any[]; columns: Array<{ key: string; label: string; fmt?: (v: any) => string }> }) {
  if (rows.length === 0) {
    return <p className="text-slate-500 text-sm py-4 text-center">No daily data recorded yet.</p>;
  }
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800">
      <table className="w-full text-xs">
        <thead className="bg-slate-950/40 sticky top-0">
          <tr className="text-slate-500 uppercase text-[10px]">
            {columns.map((c) => (
              <th key={c.key} className={`px-3 py-2 ${c.key === "date" ? "text-left" : "text-right"}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {rows.map((r, i) => (
            <tr key={r.date ?? i}>
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.key === "date" ? "text-slate-300 font-mono" : "text-right text-slate-200"}`}>
                  {c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveDashboardTab({ data, loading }: { data: any; loading: boolean }) {
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
        <Radio className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="font-bold text-slate-200">No Live Dashboard For This Process</p>
        <p className="text-slate-500 text-xs mt-1">
          This tab only carries data for processes with a dialler/campaign live feed configured.
          Not every process has one — this is not an error.
        </p>
      </div>
    );
  }

  const { dashboard, summary, daily, sales } = data;

  // GS1 has its own 4-part shape (overview/email/dataKart/approval), each with
  // its own KPI set and daily trend -- rendered as its own layout rather than
  // forced through the generic summary/daily shape every other dashboard uses.
  if (dashboard === "gs1") {
    const s = summary;
    return (
      <div className="space-y-8">
        <div>
          <h3 className="text-sm font-bold text-white mb-3">Overview</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <LiveMetricCard label="Email Tasks" value={s.overview.emailTasks?.toLocaleString?.() ?? s.overview.emailTasks} />
            <LiveMetricCard label="Email GTIN" value={s.overview.emailGtin?.toLocaleString?.() ?? s.overview.emailGtin} />
            <LiveMetricCard label="Data Kart Tasks" value={s.overview.dataKartTasks?.toLocaleString?.() ?? s.overview.dataKartTasks} />
            <LiveMetricCard label="Data Kart GTIN" value={s.overview.dataKartGtin?.toLocaleString?.() ?? s.overview.dataKartGtin} />
            <LiveMetricCard label="Approval SKU" value={s.overview.approvalSku?.toLocaleString?.() ?? s.overview.approvalSku} />
            <LiveMetricCard label="Audit Errors" value={s.overview.auditErrors?.toLocaleString?.() ?? s.overview.auditErrors} />
          </div>
        </div>
        <div>
          <h3 className="text-sm font-bold text-white mb-3">Email</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <LiveMetricCard label="Tasks Assigned" value={s.email.tasks} />
            <LiveMetricCard label="GTIN Processed" value={s.email.gtin} />
            <LiveMetricCard label="Images Uploaded" value={s.email.images} />
            <LiveMetricCard label="SLA ≤15min %" value={`${Number(s.email.sla15Pct).toFixed(1)}%`} sub="Target ≥ 80%" />
          </div>
          <LiveDailyTable rows={s.email.daily} columns={[
            { key: "date", label: "Date" }, { key: "tasks", label: "Tasks" }, { key: "gtin", label: "GTIN" }, { key: "images", label: "Images" },
          ]} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white mb-3">Data Kart</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <LiveMetricCard label="Data Received" value={s.dataKart.tasks} />
            <LiveMetricCard label="GTIN Count" value={s.dataKart.gtin} />
            <LiveMetricCard label="Within TAT %" value={`${Number(s.dataKart.withinTatPct).toFixed(1)}%`} sub="Target ≥ 80%" />
            <LiveMetricCard label="Avg GTIN/Task" value={Number(s.dataKart.avgGtinPerTask).toFixed(1)} />
          </div>
          <LiveDailyTable rows={s.dataKart.daily} columns={[
            { key: "date", label: "Date" }, { key: "tasks", label: "Tasks" }, { key: "gtin", label: "GTIN" }, { key: "withinTatPct", label: "TAT%", fmt: (v) => `${Number(v).toFixed(1)}%` },
          ]} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white mb-3">Approval</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <LiveMetricCard label="Total SKU" value={s.approval.totalSku} />
            <LiveMetricCard label="Audit Count" value={s.approval.auditCount} />
            <LiveMetricCard label="Audit Errors" value={s.approval.auditErrors} />
            <LiveMetricCard label="Error Rate %" value={`${Number(s.approval.errorRate).toFixed(1)}%`} sub="Target < 5%" />
            <LiveMetricCard label="Unique GCP" value={s.approval.uniqueGcp} />
          </div>
          <LiveDailyTable rows={s.approval.daily} columns={[
            { key: "date", label: "Date" }, { key: "sku", label: "SKU" }, { key: "audits", label: "Audits" }, { key: "errors", label: "Errors" },
          ]} />
        </div>
      </div>
    );
  }

  // Every other dashboard shares the same summary + daily shape (call/campaign
  // volumes, connect/service-level %, AHT, utilisation). Field names differ slightly
  // per dashboard (offered/connected vs totalOffered/totalAnswered), so pick whichever
  // exists rather than assume one naming convention.
  const offered = summary.offered ?? summary.totalOffered ?? summary.tasks ?? null;
  const answeredOrConnected = summary.handled ?? summary.connected ?? summary.totalAnswered ?? null;
  const rate = summary.sl ?? summary.slPct ?? summary.connectPct ?? summary.avgUtilization ?? null;
  const aht = summary.aht ?? null;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {offered != null && <LiveMetricCard label="Calls / Tasks Offered" value={Number(offered).toLocaleString()} />}
        {answeredOrConnected != null && <LiveMetricCard label="Handled / Connected" value={Number(answeredOrConnected).toLocaleString()} />}
        {rate != null && <LiveMetricCard label="Service Level / Connect %" value={`${Number(rate).toFixed(1)}%`} />}
        {aht != null && <LiveMetricCard label="Avg Handle Time" value={aht} />}
      </div>

      {sales && (
        <div>
          <h3 className="text-sm font-bold text-white mb-3">Sales (this process's own order revenue)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <LiveMetricCard label="Orders" value={Number(sales.orders).toLocaleString()} />
            <LiveMetricCard label="Revenue" value={`₹${Number(sales.revenue).toLocaleString("en-IN")}`} />
            <LiveMetricCard label="AOV" value={`₹${Number(sales.aov).toFixed(0)}`} />
            <LiveMetricCard label="Prepaid %" value={`${Number(sales.prepaidPct).toFixed(1)}%`} />
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold text-white mb-3">Day-wise</h3>
        <LiveDailyTable
          rows={daily}
          columns={
            daily?.[0] && "offered" in daily[0]
              ? [
                  { key: "date", label: "Date" }, { key: "offered", label: "Offered" }, { key: "answered", label: "Answered" },
                  { key: "alPct", label: "AL%", fmt: (v) => `${Number(v).toFixed(1)}%` }, { key: "slPct", label: "SL%", fmt: (v) => `${Number(v).toFixed(1)}%` },
                ]
              : [
                  { key: "date", label: "Date" }, { key: "talkTime", label: "Talk Time" }, { key: "utilization", label: "Utilization%", fmt: (v) => `${Number(v).toFixed(1)}%` },
                  { key: "agentCount", label: "Logins" },
                ]
          }
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 📈 OPERATIONS / QUALITY TAB — real process_metric_actual sections from
// process-operations.service.ts's getProcessOperationsForPortal(), the exact same
// engine that backs the internal-staff ProcessOperationsPage.tsx. A metric with no
// reading renders "—", never a fabricated 0 or 100%; a section with no metrics at all
// for this process is simply omitted upstream (already filtered server-side).
// ----------------------------------------------------
function OperationsQualityTab({
  data,
  loading,
  emptyLabel,
  processId,
}: {
  data: { sections: Array<{ key: string; title: string; blurb: string | null; metrics: any[] }> } | null | undefined;
  loading: boolean;
  emptyLabel: string;
  processId: string;
}) {
  const [drilldownMetricKey, setDrilldownMetricKey] = useState<string | null>(null);
  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  const sections = data?.sections ?? [];
  const hasAnyMetrics = sections.some((s) => s.metrics.length > 0);

  if (!hasAnyMetrics) {
    return (
      <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-8 text-center">
        <Gauge className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="font-bold text-slate-200">No {emptyLabel} data yet</p>
        <p className="text-slate-500 text-xs mt-1">
          No {emptyLabel} metrics have landed for this process yet. This tab will populate automatically once a real reading arrives — nothing here is fabricated.
        </p>
      </div>
    );
  }

  function formatValue(m: any): string {
    if (m.value == null) return "—";
    const unit = (m.unit ?? "").toLowerCase();
    if (unit.startsWith("percent")) return `${m.value.toFixed(1)}%`;
    if (unit === "seconds") return `${Math.round(m.value)}s`;
    if (unit === "currency") return `₹${Math.round(m.value).toLocaleString("en-IN")}`;
    return `${m.value}`;
  }

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <div key={section.key}>
          <div className="mb-3">
            <h3 className="text-sm font-bold text-white">{section.title}</h3>
            {section.blurb && <p className="text-xs text-slate-500 mt-0.5">{section.blurb}</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {section.metrics.map((m: any) => {
              const stale = m.staleDays != null && m.staleDays > 3;
              return (
                <button
                  key={m.metricKey}
                  type="button"
                  onClick={() => setDrilldownMetricKey(m.metricKey)}
                  className="text-left bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 shadow-lg hover:border-blue-500/50 hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">
                      {m.label}
                    </p>
                    {m.provisional && (
                      <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        Today
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-extrabold text-white tabular-nums">{formatValue(m)}</p>
                  <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500">
                    <span>{m.targetValue != null ? `Target: ${m.targetValue}${(m.unit ?? "").startsWith("percent") ? "%" : ""}` : "No target set"}</span>
                    {m.latestDate && (
                      <span className={stale ? "text-amber-400 font-semibold" : ""}>
                        {stale ? `${m.staleDays}d stale` : "Current"}
                      </span>
                    )}
                  </div>
                  <p className="text-[9px] text-slate-600 mt-2">Click for formula &amp; history</p>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <MetricDrilldownDialog
        processId={processId}
        metricKey={drilldownMetricKey}
        onClose={() => setDrilldownMetricKey(null)}
      />
    </div>
  );
}

// ----------------------------------------------------
// 🔍 METRIC DRILL-DOWN DIALOG
// Formula, data source, and daily reading history behind one metric tile -- the same
// three pieces of information the internal ProcessOperationsPage.tsx's drill-down shows
// staff, minus agent-level attribution and raw source rows (see
// getMetricDrilldownForPortal's own comment for why those two stay internal-only).
// ----------------------------------------------------
function MetricDrilldownDialog({
  processId,
  metricKey,
  onClose,
}: {
  processId: string;
  metricKey: string | null;
  onClose: () => void;
}) {
  const drilldown = useQuery({
    queryKey: ["portal-metric-drilldown", processId, metricKey],
    queryFn: () => portalApi.getMetricDrilldown(processId, metricKey!),
    enabled: !!metricKey,
  });

  return (
    <Dialog open={!!metricKey} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-slate-900 border-slate-800 text-slate-100">
        {drilldown.isLoading ? (
          <div className="py-16 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          </div>
        ) : drilldown.error || !drilldown.data?.data ? (
          <div className="py-8 text-center">
            <DialogHeader>
              <DialogTitle>No detail available</DialogTitle>
              <DialogDescription>
                No formula or reading history is on record for this metric on this process yet.
              </DialogDescription>
            </DialogHeader>
          </div>
        ) : (
          (() => {
            const d = drilldown.data.data;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{d.metricName}</DialogTitle>
                  <DialogDescription>
                    {d.definition?.formula ? (
                      <span className="font-mono text-xs text-slate-300">{d.definition.formula}</span>
                    ) : (
                      "No formula on record for this metric."
                    )}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-slate-800/50 rounded-lg p-3">
                      <p className="text-slate-500 uppercase text-[10px] font-bold mb-1">Target</p>
                      <p className="text-slate-200 font-semibold">
                        {d.definition?.targetValue != null ? d.definition.targetValue : "Not configured"}
                      </p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-3">
                      <p className="text-slate-500 uppercase text-[10px] font-bold mb-1">Data Source</p>
                      <p className="text-slate-200 font-semibold truncate">
                        {d.source?.sourceName ?? d.source?.sourceCode ?? "Manual entry"}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-slate-500 uppercase text-[10px] font-bold mb-2">Daily Readings</p>
                    {d.readings.length === 0 ? (
                      <p className="text-slate-500 text-sm py-4 text-center">No readings recorded yet.</p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-950/40 sticky top-0">
                            <tr className="text-slate-500 uppercase text-[10px]">
                              <th className="text-left px-3 py-2">Date</th>
                              <th className="text-right px-3 py-2">Value</th>
                              <th className="text-left px-3 py-2">Note</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50">
                            {d.readings.map((r: any) => (
                              <tr key={r.date}>
                                <td className="px-3 py-2 text-slate-300 font-mono">{r.date}</td>
                                <td className="px-3 py-2 text-right text-slate-200 font-semibold">
                                  {r.value != null ? r.value : "—"}
                                </td>
                                <td className="px-3 py-2 text-slate-500 truncate max-w-[160px]">{r.note ?? ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </>
            );
          })()
        )}
      </DialogContent>
    </Dialog>
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

  // sanctioned_strength is null when no workforce_mandate row is configured for this
  // process -- that is a different claim from "sanctioned == headcount", so the ratio
  // and the capacity ring below must render as "not configured", not a fabricated 100%.
  const hasMandate = data.sanctioned_strength != null;
  const actualRatio = hasMandate ? Math.round((data.headcount / data.sanctioned_strength!) * 100) : null;

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            label: "Active Headcount",
            value: data.headcount,
            sub: hasMandate
              ? `${actualRatio}% of sanctioned staff (${data.sanctioned_strength})`
              : "Sanctioned strength not configured",
            color: "text-blue-400",
          },
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
                  {hasMandate && (
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      fill="transparent"
                      stroke="#2563eb"
                      strokeWidth="8"
                      strokeDasharray={301.6}
                      strokeDashoffset={301.6 - (301.6 * Math.min(actualRatio!, 100)) / 100}
                      strokeLinecap="round"
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-2xl font-extrabold ${hasMandate ? "text-white" : "text-slate-600"}`}>
                    {hasMandate ? `${actualRatio}%` : "—"}
                  </span>
                  <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wide">Capacity</span>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center text-xs text-slate-400 border-t border-slate-800/40 pt-3">
            {hasMandate ? (
              <>
                <span className="font-semibold text-white">{data.headcount} Agents</span> on floor vs{" "}
                <span className="font-semibold text-white">{data.sanctioned_strength} sanctioned</span> positions
              </>
            ) : (
              <>
                <span className="font-semibold text-white">{data.headcount} Agents</span> on floor.{" "}
                Sanctioned strength has not been configured for this process yet.
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 🎓 TRAINING COMPLIANCE TAB VIEW COMPONENT
// Aggregate-only, process-scoped rollup from the Quality-Learning Governance feature
// (training_assignment / the shared TAT engine). No individual employee names, codes, or
// per-agent training records are ever included here — see
// portal.training-compliance.service.ts's header for why. compliance_pct and
// avg_completion_hours render "—" (never a fabricated 0) when nothing has been measured yet.
// ----------------------------------------------------
function TrainingComplianceTab({ data, loading }: { data: any; loading: boolean }) {
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
        <GraduationCap className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="font-bold text-slate-200">No Training Activity</p>
        <p className="text-slate-500 text-xs mt-1">No quality-triggered training assignments recorded for this period.</p>
      </div>
    );
  }

  const hasCompliance = data.compliance_pct != null;
  const hasAvgCompletion = data.avg_completion_hours != null;

  const severityColor: Record<string, string> = {
    CRITICAL: "bg-rose-500",
    HIGH: "bg-orange-500",
    MEDIUM: "bg-amber-500",
    LOW: "bg-slate-500",
  };

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            label: "Process Training Compliance",
            value: hasCompliance ? `${data.compliance_pct}%` : "—",
            sub: hasCompliance ? "Assignments completed this period" : "No assignments recorded yet",
            color: "text-emerald-400",
          },
          {
            label: "Pending Mandatory Training",
            value: data.pending_mandatory_count,
            sub: "Agents with training still outstanding",
            color: "text-amber-400",
          },
          {
            label: "TAT Breached",
            value: data.breached_count,
            sub: "Past deadline, still incomplete",
            color: data.breached_count > 0 ? "text-rose-400" : "text-slate-400",
          },
          {
            label: "Avg Time to Complete",
            value: hasAvgCompletion ? `${data.avg_completion_hours}h` : "—",
            sub: hasAvgCompletion ? "From assignment to completion" : "No completions recorded yet",
            color: "text-blue-400",
          },
        ].map((card) => (
          <div key={card.label} className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-lg">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{card.label}</p>
            <p className={`text-3xl font-extrabold ${card.color}`}>{card.value}</p>
            <p className="text-[10px] text-slate-400 font-medium mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Active assignments by severity */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-lg">
        <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-blue-400" /> Active Training by Severity
        </h4>

        {(!data.by_severity || data.by_severity.length === 0) && (
          <p className="text-xs text-slate-500 text-center py-8">No active training assignments this period.</p>
        )}

        {data.by_severity && data.by_severity.length > 0 && (
          <div className="space-y-4">
            {data.by_severity.map((s: any) => {
              const maxCount = Math.max(...data.by_severity.map((x: any) => x.active_count), 1);
              const ratio = Math.round((s.active_count / maxCount) * 100);
              return (
                <div key={s.severity} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-200">{s.severity}</span>
                    <span className="text-slate-400 font-bold">{s.active_count} active</span>
                  </div>
                  <div className="h-2 bg-slate-950 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${severityColor[s.severity] ?? "bg-blue-500"}`}
                      style={{ width: `${ratio}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
  period,
  queryClient,
}: {
  data: any;
  loading: boolean;
  processId: string;
  period: string;
  queryClient: ReturnType<typeof useQueryClient>;
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
      queryClient.invalidateQueries({ queryKey: ["portal-commentary", processId, period] });
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
      queryClient.invalidateQueries({ queryKey: ["portal-commentary", processId, period] });
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
