/**
 * QA Audit Dashboard
 * Main page for QA Auditor role — org-wide quality audit, risk matrix, process breakdown, anomalies
 *
 * Auth Gate: QA Auditor role
 * Layout: Header → KPI Cards → Risk Matrix → Process Table → Anomaly List
 */
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AlertTriangle,
  Shield,
  Users,
  Phone,
  Loader2,
  AlertCircle,
} from "lucide-react";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface QAQualityData {
  overall: { avg_quality: number; total_calls: number; compliance_rate: number };
  risk_matrix: { critical: number; at_risk: number; coaching_priority: number };
  process_breakdown: Array<{
    process: string;
    avg_quality: number;
    total_calls: number;
    compliance_rate: number;
    risk_level: string;
  }>;
  anomalies: Array<{
    agent_code: string;
    agent_name: string;
    anomaly_type: string;
    description: string;
    severity: string;
  }>;
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function qualityColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 70) return "text-yellow-600";
  return "text-red-600";
}

function severityBadge(severity: string): string {
  if (severity === "high") return "bg-red-100 text-red-700";
  if (severity === "medium") return "bg-orange-100 text-orange-700";
  return "bg-yellow-100 text-yellow-700";
}

function riskBadge(risk: string): string {
  if (risk === "On Track") return "bg-green-100 text-green-700";
  if (risk === "Critical" || risk === "At Risk") return "bg-red-100 text-red-700";
  return "bg-yellow-100 text-yellow-700";
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function StatSkeleton() {
  return (
    <Card className="p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-slate-200 rounded w-1/2"></div>
        <div className="h-8 bg-slate-200 rounded w-2/3"></div>
      </div>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card className="p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-6 bg-slate-200 rounded w-1/3 mb-4"></div>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 bg-slate-200 rounded"></div>
        ))}
      </div>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QADashboard() {
  const { user } = useAuth();
  const [daysBack, setDaysBack] = useState<7 | 30>(7);

  const { data, isLoading, error } = useQuery<QAQualityData>({
    queryKey: ["qa-quality-audit", daysBack],
    queryFn: () =>
      hrmsApi.get(`/api/qa/quality-audit?daysBack=${daysBack}`).then((r) => r.data),
    enabled: !!user,
  });

  // Auth gate
  if (!user) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-8">

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">QA Audit Dashboard</h1>
            <p className="text-slate-600 mt-1">
              Organisation-wide quality, compliance and risk monitoring
            </p>
          </div>

          {/* Days toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden self-start">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDaysBack(d)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  daysBack === d
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {d === 7 ? "Last 7 days" : "Last 30 days"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Error state ── */}
        {error && (
          <Card className="p-6 border-red-200 bg-red-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-900">Failed to load audit data</h3>
                <p className="text-sm text-red-700 mt-1">
                  Please refresh the page or contact support if the issue persists.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* ── Org-wide KPI cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {isLoading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : data ? (
            <>
              {/* Avg Quality */}
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-2">
                  <Shield className="h-5 w-5 text-slate-500" />
                  <span className="text-sm font-medium text-slate-500">Avg Quality</span>
                </div>
                <p className={`text-3xl font-bold ${qualityColor(data.overall.avg_quality)}`}>
                  {data.overall.avg_quality.toFixed(1)}%
                </p>
              </Card>

              {/* Compliance Rate */}
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-2">
                  <AlertTriangle className="h-5 w-5 text-slate-500" />
                  <span className="text-sm font-medium text-slate-500">Compliance Rate</span>
                </div>
                <p className={`text-3xl font-bold ${qualityColor(data.overall.compliance_rate)}`}>
                  {data.overall.compliance_rate.toFixed(1)}%
                </p>
              </Card>

              {/* Total Calls */}
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-2">
                  <Phone className="h-5 w-5 text-slate-500" />
                  <span className="text-sm font-medium text-slate-500">Total Calls</span>
                </div>
                <p className="text-3xl font-bold text-slate-900">
                  {data.overall.total_calls.toLocaleString()}
                </p>
              </Card>
            </>
          ) : null}
        </div>

        {/* ── Risk Matrix ── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </div>
        ) : data ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-6 bg-red-50 border-red-200">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <span className="text-sm font-semibold text-red-700">Critical</span>
              </div>
              <p className="text-4xl font-bold text-red-700">{data.risk_matrix.critical}</p>
              <p className="text-xs text-red-600 mt-1">Agents requiring immediate action</p>
            </Card>

            <Card className="p-6 bg-orange-50 border-orange-200">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <span className="text-sm font-semibold text-orange-700">At Risk</span>
              </div>
              <p className="text-4xl font-bold text-orange-700">{data.risk_matrix.at_risk}</p>
              <p className="text-xs text-orange-600 mt-1">Agents on the watch list</p>
            </Card>

            <Card className="p-6 bg-yellow-50 border-yellow-200">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-semibold text-yellow-700">Coaching Priority</span>
              </div>
              <p className="text-4xl font-bold text-yellow-700">{data.risk_matrix.coaching_priority}</p>
              <p className="text-xs text-yellow-600 mt-1">Agents flagged for coaching</p>
            </Card>
          </div>
        ) : null}

        {/* ── Process Breakdown table ── */}
        {isLoading ? (
          <TableSkeleton />
        ) : data && data.process_breakdown.length > 0 ? (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Process Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="pb-3 pr-4 font-semibold text-slate-600">Process</th>
                    <th className="pb-3 pr-4 font-semibold text-slate-600 text-right">Avg Quality</th>
                    <th className="pb-3 pr-4 font-semibold text-slate-600 text-right">Total Calls</th>
                    <th className="pb-3 pr-4 font-semibold text-slate-600 text-right">Compliance</th>
                    <th className="pb-3 font-semibold text-slate-600">Risk Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.process_breakdown.map((row) => (
                    <tr key={row.process} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 pr-4 font-medium text-slate-800">{row.process}</td>
                      <td className={`py-3 pr-4 text-right font-semibold ${qualityColor(row.avg_quality)}`}>
                        {row.avg_quality.toFixed(1)}%
                      </td>
                      <td className="py-3 pr-4 text-right text-slate-700">
                        {row.total_calls.toLocaleString()}
                      </td>
                      <td className={`py-3 pr-4 text-right font-semibold ${qualityColor(row.compliance_rate)}`}>
                        {row.compliance_rate.toFixed(1)}%
                      </td>
                      <td className="py-3">
                        <Badge className={`text-xs font-medium ${riskBadge(row.risk_level)}`}>
                          {row.risk_level}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {/* ── Anomaly list ── */}
        {isLoading ? (
          <TableSkeleton />
        ) : data && data.anomalies.length > 0 ? (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Anomalies Detected
              <span className="ml-2 text-sm font-normal text-slate-500">
                ({data.anomalies.length})
              </span>
            </h2>
            <div className="space-y-3">
              {data.anomalies.map((anomaly, idx) => (
                <div
                  key={`${anomaly.agent_code}-${idx}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg border border-slate-200 bg-slate-50"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-slate-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-800">
                        {anomaly.agent_name}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          {anomaly.agent_code}
                        </span>
                      </p>
                      <p className="text-sm text-slate-600 mt-0.5">{anomaly.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-slate-500 hidden sm:inline">
                      {anomaly.anomaly_type}
                    </span>
                    <Badge className={`text-xs font-medium capitalize ${severityBadge(anomaly.severity)}`}>
                      {anomaly.severity}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : data && data.anomalies.length === 0 ? (
          <Card className="p-6 text-center text-slate-500">
            <Shield className="h-8 w-8 mx-auto mb-2 text-green-400" />
            <p className="font-medium">No anomalies detected in this period</p>
          </Card>
        ) : null}

      </div>
    </DashboardLayout>
  );
}
