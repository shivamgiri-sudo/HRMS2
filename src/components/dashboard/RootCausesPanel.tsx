/**
 * RootCausesPanel — Collapsible root-cause analysis panel for Super Admin dashboard.
 * Fetches from GET /api/dashboards/SUPER_ADMIN_DASHBOARD/root-causes
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Loader, AlertTriangle, SearchX, Zap } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface RootCause {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  affected_metric: string;
  suggested_action: string;
  identified_at?: string;
}

const SEVERITY_CONFIG: Record<string, { bg: string; text: string; ring: string; dot: string }> = {
  critical: { bg: "bg-red-50", text: "text-red-900", ring: "ring-red-300", dot: "bg-red-500" },
  high: { bg: "bg-orange-50", text: "text-orange-900", ring: "ring-orange-300", dot: "bg-orange-500" },
  medium: { bg: "bg-amber-50", text: "text-amber-800", ring: "ring-amber-300", dot: "bg-amber-500" },
  low: { bg: "bg-slate-50", text: "text-slate-700", ring: "ring-slate-300", dot: "bg-slate-400" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.low;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold capitalize ring-1 ${cfg.bg} ${cfg.text} ${cfg.ring}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {severity}
    </span>
  );
}

export function RootCausesPanel() {
  const [expanded, setExpanded] = useState(false);

  const { data: causes, isLoading, error } = useQuery<RootCause[], Error>({
    queryKey: ["super-admin", "root-causes"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: RootCause[] }>(
        "/api/dashboards/SUPER_ADMIN_DASHBOARD/root-causes"
      );
      return (res as { success: boolean; data: RootCause[] }).data ?? [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });

  const items = causes ?? [];
  const criticalCount = items.filter((c) => c.severity === "critical" || c.severity === "high").length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:shadow-md">
      {/* Accordion Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors hover:bg-slate-50/50"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-red-50 to-orange-50 p-2.5">
            <Zap className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900">Root Cause Analysis</h3>
            <p className="text-xs text-slate-500">
              {isLoading ? "Loading..." : `${items.length} identified cause${items.length !== 1 ? "s" : ""}`}
              {criticalCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                  {criticalCount} critical/high
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="rounded-lg bg-slate-100 p-1.5 transition-colors group-hover:bg-slate-200">
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-slate-600" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-600" />
          )}
        </div>
      </button>

      {/* Collapsible Body */}
      {expanded && (
        <div className="border-t border-slate-100 px-6 pb-5 pt-4">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span className="font-medium">Failed to load root causes: {error.message}</span>
            </div>
          )}

          {!isLoading && !error && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <SearchX className="mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold text-sm">No root causes identified</p>
              <p className="text-xs mt-1">All metrics are within healthy thresholds</p>
            </div>
          )}

          {!isLoading && !error && items.length > 0 && (
            <div className="space-y-3">
              {items.map((cause) => (
                <div
                  key={cause.id}
                  className="group rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition-all hover:border-slate-200 hover:bg-white hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <h4 className="text-sm font-bold text-slate-900 leading-snug">{cause.title}</h4>
                    <SeverityBadge severity={cause.severity} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Affected Metric
                      </p>
                      <p className="text-xs font-semibold text-slate-700">{cause.affected_metric}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Suggested Action
                      </p>
                      <p className="text-xs font-medium text-slate-600 leading-relaxed">{cause.suggested_action}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
