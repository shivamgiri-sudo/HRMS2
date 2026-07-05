import { AlertCircle, AlertTriangle, Info, ChevronRight, Zap } from "lucide-react";
import { useState } from "react";

export interface InterventionFlag {
  type: string;
  severity: "critical" | "warning" | "info";
  detail: string;
  action: string;
}

interface InterventionPanelProps {
  flags: InterventionFlag[];
  title?: string;
  collapsible?: boolean;
  className?: string;
}

const SEVERITY_CONFIG = {
  critical: {
    bg: "bg-red-50 border-red-200",
    icon: <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />,
    badge: "bg-red-100 text-red-700 border-red-300",
    label: "Critical",
    titleColor: "text-red-700",
    actionColor: "text-red-600",
  },
  warning: {
    bg: "bg-amber-50 border-amber-200",
    icon: <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />,
    badge: "bg-amber-100 text-amber-700 border-amber-300",
    label: "Warning",
    titleColor: "text-amber-700",
    actionColor: "text-amber-600",
  },
  info: {
    bg: "bg-blue-50 border-blue-200",
    icon: <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />,
    badge: "bg-blue-100 text-blue-700 border-blue-300",
    label: "Info",
    titleColor: "text-blue-700",
    actionColor: "text-blue-600",
  },
} as const;

export function InterventionPanel({
  flags,
  title = "Intervention Required",
  collapsible = true,
  className = "",
}: InterventionPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!flags || flags.length === 0) return null;

  const criticalCount = flags.filter(f => f.severity === "critical").length;
  const warningCount  = flags.filter(f => f.severity === "warning").length;

  // Sort: critical first, then warning, then info
  const sorted = [...flags].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  const panelBorderClass = criticalCount > 0
    ? "border-red-300"
    : warningCount > 0
      ? "border-amber-300"
      : "border-blue-300";

  return (
    <div className={`rounded-2xl border ${panelBorderClass} bg-white shadow-sm overflow-hidden ${className}`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between gap-3 px-4 py-3 ${
          criticalCount > 0 ? "bg-red-50" : warningCount > 0 ? "bg-amber-50" : "bg-blue-50"
        } ${collapsible ? "cursor-pointer select-none" : ""}`}
        onClick={collapsible ? () => setExpanded(e => !e) : undefined}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Zap className={`h-4 w-4 flex-shrink-0 ${criticalCount > 0 ? "text-red-500" : warningCount > 0 ? "text-amber-500" : "text-blue-500"}`} />
          <span className={`text-sm font-bold ${criticalCount > 0 ? "text-red-800" : warningCount > 0 ? "text-amber-800" : "text-blue-800"}`}>
            {title}
          </span>
          <div className="flex items-center gap-1">
            {criticalCount > 0 && (
              <span className="inline-flex items-center rounded-full border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-700">
                {criticalCount} Critical
              </span>
            )}
            {warningCount > 0 && (
              <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-700">
                {warningCount} Warning
              </span>
            )}
          </div>
        </div>
        {collapsible && (
          <ChevronRight className={`h-4 w-4 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""} ${criticalCount > 0 ? "text-red-400" : "text-amber-400"}`} />
        )}
      </div>

      {/* Flags list */}
      {expanded && (
        <div className="divide-y divide-slate-100 p-1">
          {sorted.map((flag, i) => {
            const cfg = SEVERITY_CONFIG[flag.severity];
            return (
              <div key={i} className={`flex gap-3 rounded-xl ${cfg.bg} border m-1 p-3`}>
                {cfg.icon}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                    <span className={`text-xs font-semibold ${cfg.titleColor}`}>
                      {flag.type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-700 leading-relaxed">{flag.detail}</p>
                  <p className={`mt-1 text-xs font-semibold ${cfg.actionColor}`}>
                    → {flag.action}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
