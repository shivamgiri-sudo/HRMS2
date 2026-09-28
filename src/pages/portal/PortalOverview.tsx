import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { portalApi, clearPortalToken } from "@/lib/portalApi";
import { Building2, LogOut, Activity, AlertTriangle, CheckCircle2, Gauge } from "lucide-react";
import { formatISTDate } from "@/lib/utils";
import { PortalKpiStrip, type KpiStripItem } from "@/components/portal/PortalKpiStrip";
import { PortalRagDonut, type RagDonutSegment } from "@/components/portal/PortalRagDonut";
import { ImpersonationBanner, IMPERSONATION_BANNER_HEIGHT_PX } from "@/components/portal/ImpersonationBanner";
import { getImpersonationInfo } from "@/lib/portalApi";
import { ExportPresentationButton } from "@/components/presentation/ExportPresentationButton";

const RAG_BORDER = {
  green: "border-l-green-500",
  amber: "border-l-amber-500",
  red: "border-l-red-500",
  no_data: "border-l-slate-600",
};
const RAG_DOT = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  no_data: "bg-slate-500",
};
const RAG_VALUE = {
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
  no_data: "text-slate-400",
};

const RAG_COLOR_HEX: Record<string, string> = {
  green: "#10b981",
  amber: "#f59e0b",
  red: "#f43f5e",
  no_data: "#64748b",
};

export default function PortalOverview() {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-overview"],
    queryFn: () => portalApi.getOverview(),
  });

  useEffect(() => {
    if (data?.data?.length === 1) {
      navigate(`/portal/processes/${data.data[0].process_id}`, { replace: true });
    }
  }, [data, navigate]);

  const processes: any[] = data?.data ?? [];
  const clientName = processes[0]?.client_name ?? "";

  // ── Roll-up stats across every process this client user can see ────────────
  // All derived directly from portal.overview.service.ts's per-process RAG/headline
  // metrics — nothing here is fabricated; a process with no configured metrics
  // contributes to "no_data", never to "green".
  const ragCounts = useMemo(() => {
    const counts: Record<string, number> = { green: 0, amber: 0, red: 0, no_data: 0 };
    for (const p of processes) {
      const key = (p.rag as string) in counts ? (p.rag as string) : "no_data";
      counts[key] += 1;
    }
    return counts;
  }, [processes]);

  const allMetrics = useMemo(
    () => processes.flatMap((p) => (p.headline_metrics ?? []).map((m: any) => ({ ...m, process_name: p.process_name }))),
    [processes]
  );

  const metricsAtRisk = useMemo(
    () => allMetrics.filter((m) => m.rag === "red" || m.rag === "amber").sort((a, b) => (a.rag === "red" ? -1 : 1)),
    [allMetrics]
  );

  const avgAchievement = useMemo(() => {
    const tracked = allMetrics.filter((m) => m.achievement_pct != null);
    if (tracked.length === 0) return null;
    return Math.round(tracked.reduce((s, m) => s + m.achievement_pct, 0) / tracked.length);
  }, [allMetrics]);

  const lastUpdated = useMemo(() => {
    const dates = processes.map((p) => p.last_updated).filter(Boolean) as string[];
    if (dates.length === 0) return null;
    return dates.sort().at(-1) ?? null;
  }, [processes]);

  const donutSegments: RagDonutSegment[] = [
    { key: "green", label: "On Track", value: ragCounts.green, color: RAG_COLOR_HEX.green },
    { key: "amber", label: "Monitor", value: ragCounts.amber, color: RAG_COLOR_HEX.amber },
    { key: "red", label: "At Risk", value: ragCounts.red, color: RAG_COLOR_HEX.red },
    { key: "no_data", label: "Not Tracked", value: ragCounts.no_data, color: RAG_COLOR_HEX.no_data },
  ];

  const kpiStripItems: KpiStripItem[] = [
    {
      key: "processes",
      label: "Active Processes",
      value: processes.length || null,
      sub: `${ragCounts.green} on track`,
      accent: "cyan",
      icon: <Activity className="w-4 h-4" />,
    },
    {
      key: "achievement",
      label: "Avg. Target Achievement",
      value: avgAchievement != null ? `${avgAchievement}%` : null,
      sub: `${allMetrics.filter((m) => m.achievement_pct != null).length} metrics tracked`,
      accent: avgAchievement == null ? "slate" : avgAchievement >= 95 ? "emerald" : avgAchievement >= 80 ? "amber" : "rose",
      icon: <Gauge className="w-4 h-4" />,
    },
    {
      key: "at_risk",
      label: "Metrics Needing Attention",
      value: metricsAtRisk.length,
      sub: `${ragCounts.red} critical, ${ragCounts.amber} watch`,
      accent: metricsAtRisk.length === 0 ? "emerald" : "amber",
      icon: <AlertTriangle className="w-4 h-4" />,
    },
    {
      key: "updated",
      label: "Data Refreshed",
      value: lastUpdated ? formatISTDate(lastUpdated) : null,
      sub: "Across all processes",
      accent: "violet",
      icon: <CheckCircle2 className="w-4 h-4" />,
    },
  ];

  // Revokes this session's jti server-side before clearing the local token, so a copied
  // or leaked token can't keep working after the user believes they've signed out.
  // clearPortalToken/navigate still run even if the revoke call fails -- a network
  // failure here must not trap someone in a session they clicked "Sign Out" to leave.
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
      className="min-h-screen bg-slate-950 text-white font-sans"
      style={isImpersonating ? { paddingTop: IMPERSONATION_BANNER_HEIGHT_PX } : undefined}
    >
      {/* Ambient glow accents, matches PortalProcessDashboard's background treatment */}
      <div className="absolute top-0 right-0 w-[400px] h-[300px] bg-cyan-600/5 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-violet-600/5 blur-[100px] pointer-events-none" />

      <ImpersonationBanner />

      {/* Header stays sticky at top-0 (unaffected by the banner, which is `fixed` and
          overlays rather than pushing layout) — the wrapper div below adds top padding
          equal to the banner's height only while impersonating, so the fixed banner never
          overlaps real content. */}
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
              <p className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">Client Operations Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {clientName && (
              <div className="flex items-center gap-2 bg-slate-800/40 border border-slate-800/60 rounded-full px-3 py-1 text-slate-300">
                <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  {clientName.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs font-medium truncate max-w-[100px] sm:max-w-none">{clientName}</span>
              </div>
            )}
            <ExportPresentationButton scope="client" />
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

      {/* Content */}
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {isLoading ? (
          <div>
            <div className="mb-8">
              <div className="h-8 w-48 bg-slate-800 rounded-lg animate-pulse mb-2" />
              <div className="h-4 w-32 bg-slate-800/60 rounded animate-pulse" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-slate-900 border-l-4 border-l-slate-700 rounded-lg p-6 animate-pulse">
                  <div className="h-5 w-40 bg-slate-800 rounded mb-2" />
                  <div className="h-3 w-24 bg-slate-800/60 rounded mb-6" />
                  <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3].map((j) => (
                      <div key={j} className="text-center space-y-1.5">
                        <div className="h-3 w-12 bg-slate-800 rounded mx-auto" />
                        <div className="h-6 w-14 bg-slate-800 rounded mx-auto" />
                        <div className="h-3 w-10 bg-slate-800/60 rounded mx-auto" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          // Previously showed the raw error message with no next step at all -- a client
          // hitting this had no way to know whether to retry, wait, or escalate. There is
          // no dedicated client-support inbox anywhere in this codebase to link to (only
          // internal-facing fallbacks like hr@teammas.in exist, which would misdirect a
          // real client's issue to the wrong team) -- pointing them at their own account
          // manager, the same relationship the empty-state below already uses, is the
          // honest option rather than fabricating a support channel.
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
            <AlertTriangle className="w-16 h-16 text-red-500/60 mb-4" />
            <h2 className="text-xl font-bold text-slate-300 mb-2">Couldn't Load Your Dashboard</h2>
            <p className="text-slate-500 text-sm max-w-md">
              Something went wrong while loading your account overview. Please try refreshing
              the page. If this keeps happening, contact your MAS account manager and mention
              the error below.
            </p>
            <p className="text-red-400/70 text-xs mt-3 font-mono max-w-md break-words">
              {(error as Error).message}
            </p>
          </div>
        ) : processes.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
            <Building2 className="w-16 h-16 text-slate-700 mb-4" />
            <h2 className="text-xl font-bold text-slate-300 mb-2">No Active Processes</h2>
            <p className="text-slate-500 text-sm max-w-xs">
              Your account has no active processes mapped yet. Please contact your MAS account manager.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <div>
              <h1 className="text-3xl font-bold text-white">Account Overview</h1>
              <p className="text-slate-400 mt-1">
                {processes.length} active process{processes.length !== 1 ? "es" : ""}
              </p>
            </div>

            {/* KPI strip — roll-up across every process */}
            <PortalKpiStrip items={kpiStripItems} />

            {/* RAG distribution + at-a-glance attention list */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-slate-900/70 backdrop-blur-md border border-slate-800/80 rounded-xl p-5">
                <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-4">
                  Portfolio Health
                </h3>
                <PortalRagDonut segments={donutSegments} centerLabel="Processes" centerValue={processes.length} />
              </div>

              <div className="lg:col-span-2 bg-slate-900/70 backdrop-blur-md border border-slate-800/80 rounded-xl p-5">
                <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-4">
                  Metrics Needing Attention
                </h3>
                {metricsAtRisk.length === 0 ? (
                  <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium py-6 justify-center">
                    <CheckCircle2 className="w-5 h-5" /> All tracked metrics are on target.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                    {metricsAtRisk.slice(0, 8).map((m, i) => (
                      <div key={`${m.metric_code}-${i}`} className="flex items-center gap-3">
                        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${RAG_DOT[m.rag as keyof typeof RAG_DOT]}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-200 truncate">
                            {m.metric_name || m.metric_code}
                            <span className="text-slate-500 font-normal"> · {m.process_name}</span>
                          </p>
                        </div>
                        <span className={`text-xs font-bold tabular-nums ${RAG_VALUE[m.rag as keyof typeof RAG_VALUE]}`}>
                          {m.actual != null ? `${m.actual}${m.unit === "percent" ? "%" : ""}` : "—"}
                          <span className="text-slate-500 font-normal"> / {m.target}{m.unit === "percent" ? "%" : ""}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Process cards */}
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-4">
                Processes
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {processes.map((p: any) => {
                  const rag = p.rag as keyof typeof RAG_BORDER;
                  return (
                    <div
                      key={p.process_id}
                      onClick={() => navigate(`/portal/processes/${p.process_id}`)}
                      className={`bg-slate-900 border border-slate-800 border-l-4 ${RAG_BORDER[rag] ?? "border-l-slate-600"} rounded-lg p-6 cursor-pointer hover:bg-slate-800/80 transition-all duration-200 hover:-translate-y-0.5 shadow-lg`}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h2 className="text-lg font-semibold text-white">{p.process_name}</h2>
                          <p className="text-slate-400 text-sm">{p.client_name}</p>
                        </div>
                        <div className={`h-3 w-3 rounded-full shadow-md ${RAG_DOT[rag] ?? "bg-slate-500"}`} />
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        {(p.headline_metrics ?? []).map((m: any) => (
                          <div key={m.metric_code} className="text-center">
                            <p className="text-[10px] text-slate-500 mb-1 truncate" title={m.metric_name || m.metric_code}>
                              {m.metric_name || m.metric_code}
                            </p>
                            <p className={`text-lg font-bold ${RAG_VALUE[m.rag as keyof typeof RAG_VALUE] ?? "text-slate-300"}`}>
                              {m.actual != null ? `${m.actual}${m.unit === "percent" ? "%" : ""}` : "—"}
                            </p>
                            <p className="text-[10px] text-slate-600">
                              vs {m.target}{m.unit === "percent" ? "%" : ""}
                            </p>
                          </div>
                        ))}
                      </div>

                      {p.last_updated && (
                        <p className="text-[10px] text-slate-600 mt-4">
                          Updated {formatISTDate(p.last_updated)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
