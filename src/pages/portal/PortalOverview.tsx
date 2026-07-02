import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { portalApi } from "@/lib/portalApi";
import { Loader2 } from "lucide-react";

const RAG_COLORS = { green: "border-green-500 text-green-400", amber: "border-amber-500 text-amber-400", red: "border-red-500 text-red-400" };
const RAG_DOT = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500" };

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

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-red-400">
      Failed to load: {(error as Error).message}
    </div>
  );

  const processes = data?.data ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Account Overview</h1>
          <p className="text-slate-400 mt-1">{processes.length} active process{processes.length !== 1 ? "es" : ""}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {processes.map((p: any) => (
            <div
              key={p.process_id}
              onClick={() => navigate(`/portal/processes/${p.process_id}`)}
              className={`bg-slate-900 border-l-4 ${RAG_COLORS[p.rag as keyof typeof RAG_COLORS]} rounded-lg p-6 cursor-pointer hover:bg-slate-800 transition-colors`}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">{p.process_name}</h2>
                  <p className="text-slate-400 text-sm">{p.client_name}</p>
                </div>
                <div className={`h-3 w-3 rounded-full ${RAG_DOT[p.rag as keyof typeof RAG_DOT]}`} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {p.headline_metrics.map((m: any) => (
                  <div key={m.metric_code} className="text-center">
                    <p className="text-xs text-slate-500 mb-1">{m.metric_code}</p>
                    <p className={`text-lg font-bold ${RAG_COLORS[m.rag as keyof typeof RAG_COLORS]}`}>
                      {m.actual != null ? `${m.actual}${m.unit === "percent" ? "%" : ""}` : "—"}
                    </p>
                    <p className="text-xs text-slate-600">vs {m.target}{m.unit === "percent" ? "%" : ""}</p>
                  </div>
                ))}
              </div>
              {p.last_updated && (
                <p className="text-xs text-slate-600 mt-4">Updated {formatISTDate(p.last_updated)}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
