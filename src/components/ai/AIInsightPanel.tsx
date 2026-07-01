import React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles,
  RefreshCcw,
  ShieldAlert,
  AlertTriangle,
  Info,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { useAIInsights } from "@/hooks/useAIInsights";
import type { AIInsight, InsightSeverity } from "@/types/ai-insights";

interface AIInsightPanelProps {
  contextType: string;
  data: Record<string, unknown>;
  role?: string;
  title?: string;
  className?: string;
  enabled?: boolean;
}

const severityConfig: Record<
  InsightSeverity,
  { badge: string; icon: React.ReactNode }
> = {
  critical: {
    badge: "bg-red-100 text-red-800",
    icon: <ShieldAlert className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />,
  },
  warning: {
    badge: "bg-amber-100 text-amber-800",
    icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />,
  },
  info: {
    badge: "bg-blue-100 text-blue-800",
    icon: <Info className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />,
  },
  success: {
    badge: "bg-emerald-100 text-emerald-800",
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />,
  },
};

function InsightRow({ insight }: { insight: AIInsight }) {
  const config = severityConfig[insight.severity] ?? severityConfig.info;
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      {config.icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              config.badge
            )}
          >
            {insight.severity}
          </span>
          <p className="text-sm font-semibold text-slate-800 leading-snug">
            {insight.title}
          </p>
        </div>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{insight.body}</p>
        {insight.action_label && insight.action_url && (
          <Link
            to={insight.action_url}
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-600 font-medium hover:text-blue-800 transition-colors"
          >
            {insight.action_label}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

export function AIInsightPanel({
  contextType,
  data,
  role,
  title = "AI Insights",
  className,
  enabled = true,
}: AIInsightPanelProps) {
  const { insights, isLoading, error, refresh } = useAIInsights({
    contextType,
    data,
    role,
    enabled,
  });

  // While data hasn't loaded yet, render nothing to avoid a flash
  if (!enabled) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-white">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <span className="text-[10px] font-medium bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">
            AI
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          title="Refresh AI insights"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40"
        >
          <RefreshCcw
            className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
          />
        </button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="px-4 py-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-3.5 w-3.5 rounded-full mt-0.5 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3 rounded" />
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="h-3 w-5/6 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : error === "rate_limit" ? (
        <div className="px-4 py-3 flex items-center gap-2 text-xs text-blue-700 bg-blue-50">
          <Info className="h-4 w-4 shrink-0 text-blue-500" />
          Daily AI limit reached. Insights will refresh in an hour.
        </div>
      ) : error ? (
        <div className="px-4 py-3 flex items-center gap-2 text-xs text-slate-500 bg-slate-50">
          <Info className="h-4 w-4 shrink-0 text-slate-400" />
          AI insights unavailable right now.
          <button
            onClick={refresh}
            className="ml-auto text-blue-600 font-medium hover:text-blue-800 whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      ) : insights.length === 0 ? null : (
        <div className="divide-y divide-slate-100">
          {insights.map((insight) => (
            <InsightRow key={insight.id} insight={insight} />
          ))}
        </div>
      )}
    </div>
  );
}
