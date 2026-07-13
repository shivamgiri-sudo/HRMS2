import { AlertTriangle, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface DataQualityIssue {
  id?: string;
  employee_id: string | null;
  employee_name?: string;
  employee_code?: string;
  issue_type: string;
  severity: "low" | "medium" | "high" | "critical";
  suggested_fix: string;
  detected_at: string;
}

interface DataQualitySummary {
  total_employees: number;
  issues_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  confidence_score: number;
  issues: DataQualityIssue[];
}

interface OrgDataQualityPanelProps {
  data: DataQualitySummary | null;
  isLoading?: boolean;
  onRefresh?: () => void;
}

const SEVERITY_CONFIG = {
  critical: {
    color: "text-red-600",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    icon: XCircle,
    label: "Critical",
  },
  high: {
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
    icon: AlertTriangle,
    label: "High",
  },
  medium: {
    color: "text-yellow-600",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-200",
    icon: AlertCircle,
    label: "Medium",
  },
  low: {
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    icon: AlertCircle,
    label: "Low",
  },
};

export function OrgDataQualityPanel({ data, isLoading = false, onRefresh }: OrgDataQualityPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null);

  if (!data && !isLoading) {
    return null;
  }

  const filteredIssues = selectedSeverity
    ? data?.issues.filter((i) => i.severity === selectedSeverity) ?? []
    : data?.issues ?? [];

  const confidenceColor =
    (data?.confidence_score ?? 100) >= 90
      ? "text-green-600"
      : (data?.confidence_score ?? 100) >= 70
        ? "text-yellow-600"
        : "text-red-600";

  return (
    <div className="w-full max-w-md mb-4 border border-slate-200 rounded-xl bg-white shadow-sm">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50/50 transition-colors rounded-t-xl"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg", data && data.issues_count === 0 ? "bg-green-100" : "bg-orange-100")}>
            {data && data.issues_count === 0 ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-orange-600" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Data Quality</h3>
            {isLoading ? (
              <p className="text-xs text-slate-400">Checking...</p>
            ) : data ? (
              <p className="text-xs text-slate-500">
                <span className={cn("font-bold", confidenceColor)}>{data.confidence_score}%</span> confidence
                {data.issues_count > 0 && (
                  <span className="ml-1">• {data.issues_count} {data.issues_count === 1 ? "issue" : "issues"}</span>
                )}
              </p>
            ) : null}
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && data && !isLoading && (
        <div className="px-4 pb-4 space-y-3">
          {/* Severity summary */}
          {data.issues_count > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {data.critical_count > 0 && (
                <button
                  onClick={() => setSelectedSeverity(selectedSeverity === "critical" ? null : "critical")}
                  className={cn(
                    "px-2 py-1 rounded-md text-xs font-medium transition-all",
                    selectedSeverity === "critical"
                      ? "bg-red-100 text-red-700 border border-red-200"
                      : "bg-red-50 text-red-600 hover:bg-red-100"
                  )}
                >
                  {data.critical_count} Critical
                </button>
              )}
              {data.high_count > 0 && (
                <button
                  onClick={() => setSelectedSeverity(selectedSeverity === "high" ? null : "high")}
                  className={cn(
                    "px-2 py-1 rounded-md text-xs font-medium transition-all",
                    selectedSeverity === "high"
                      ? "bg-orange-100 text-orange-700 border border-orange-200"
                      : "bg-orange-50 text-orange-600 hover:bg-orange-100"
                  )}
                >
                  {data.high_count} High
                </button>
              )}
              {data.medium_count > 0 && (
                <button
                  onClick={() => setSelectedSeverity(selectedSeverity === "medium" ? null : "medium")}
                  className={cn(
                    "px-2 py-1 rounded-md text-xs font-medium transition-all",
                    selectedSeverity === "medium"
                      ? "bg-yellow-100 text-yellow-700 border border-yellow-200"
                      : "bg-yellow-50 text-yellow-600 hover:bg-yellow-100"
                  )}
                >
                  {data.medium_count} Medium
                </button>
              )}
              {data.low_count > 0 && (
                <button
                  onClick={() => setSelectedSeverity(selectedSeverity === "low" ? null : "low")}
                  className={cn(
                    "px-2 py-1 rounded-md text-xs font-medium transition-all",
                    selectedSeverity === "low"
                      ? "bg-blue-100 text-blue-700 border border-blue-200"
                      : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                  )}
                >
                  {data.low_count} Low
                </button>
              )}
            </div>
          )}

          {/* Issues list */}
          {filteredIssues.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {filteredIssues.slice(0, 10).map((issue, idx) => {
                const config = SEVERITY_CONFIG[issue.severity];
                const Icon = config.icon;
                return (
                  <div
                    key={issue.id ?? idx}
                    className={cn(
                      "flex items-start gap-2 p-2 rounded-lg border",
                      config.bgColor,
                      config.borderColor
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5 mt-0.5 flex-shrink-0", config.color)} />
                    <div className="flex-1 min-w-0">
                      {issue.employee_name && (
                        <p className="text-xs font-semibold text-slate-700 truncate">
                          {issue.employee_name} {issue.employee_code && `(${issue.employee_code})`}
                        </p>
                      )}
                      <p className="text-xs text-slate-600 mt-0.5">{issue.suggested_fix}</p>
                    </div>
                  </div>
                );
              })}
              {filteredIssues.length > 10 && (
                <p className="text-xs text-slate-400 text-center py-1">
                  +{filteredIssues.length - 10} more issues
                </p>
              )}
            </div>
          ) : data.issues_count === 0 ? (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
              <p className="text-xs text-green-700">No data quality issues detected!</p>
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-2">No issues match this filter</p>
          )}

          {/* Refresh button */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="w-full px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
            >
              Refresh Quality Check
            </button>
          )}
        </div>
      )}
    </div>
  );
}
