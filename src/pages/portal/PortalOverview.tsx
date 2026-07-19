import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { portalApi, clearPortalToken } from "@/lib/portalApi";
import { Building2, LogOut } from "lucide-react";
import { formatISTDate } from "@/lib/utils";

const RAG_BORDER = {
  green: "border-l-green-500",
  amber: "border-l-amber-500",
  red: "border-l-red-500",
};
const RAG_DOT = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};
const RAG_VALUE = {
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
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

  function handleLogout() {
    clearPortalToken();
    navigate("/portal/login");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans">
      {/* Header */}
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
              <p className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">Client Operations Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {clientName && (
              <div className="hidden sm:flex items-center gap-2 bg-slate-800/40 border border-slate-800/60 rounded-full px-3 py-1 text-slate-300">
                <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">
                  {clientName.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs font-medium">{clientName}</span>
              </div>
            )}
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
      <div className="max-w-6xl mx-auto px-6 py-8">
        {isLoading ? (
          <div>
            <div className="mb-8">
              <div className="h-8 w-48 bg-slate-800 rounded-lg animate-pulse mb-2" />
              <div className="h-4 w-32 bg-slate-800/60 rounded animate-pulse" />
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
          <div className="flex items-center justify-center min-h-[50vh] text-red-400">
            Failed to load: {(error as Error).message}
          </div>
        ) : processes.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
            <Building2 className="w-16 h-16 text-slate-700 mb-4" />
            <h2 className="text-xl font-bold text-slate-300 mb-2">No Active Processes</h2>
            <p className="text-slate-500 text-sm max-w-xs">
              Your account has no active processes mapped yet. Please contact your MAS operations partner.
            </p>
          </div>
        ) : (
          <div>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-white">Account Overview</h1>
              <p className="text-slate-400 mt-1">
                {processes.length} active process{processes.length !== 1 ? "es" : ""}
              </p>
            </div>

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
        )}
      </div>
    </div>
  );
}
