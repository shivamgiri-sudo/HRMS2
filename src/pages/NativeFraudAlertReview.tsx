/**
 * Payroll HR's queue for fraud alerts raised during candidate onboarding.
 *
 * These alerts already existed and nothing read them: six sat in production
 * with status 'open' and no reviewer, because the endpoints were built and no
 * screen ever called them. That stopped mattering the moment an open critical
 * or high alert began refusing employee creation — without somewhere to clear
 * them, a false positive would strand a real candidate with no way out.
 *
 * Updated: each alert row now expands into a full FraudComparisonPanel showing
 * the face photo grid, name comparison table, document number comparison, and
 * resolution action panel — so Payroll HR can review all evidence in one place
 * before recording a decision.
 */
import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FraudComparisonPanel } from "@/components/ats/FraudComparisonPanel";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  ShieldAlert,
} from "lucide-react";

interface FraudAlert {
  id: string;
  candidate_id: string;
  candidate_name?: string | null;
  matched_candidate_name?: string | null;
  applied_for_branch?: string | null;
  alert_type: string;
  severity: string;
  status: string;
  details?: Record<string, unknown> | string | null;
  created_at?: string | null;
}

interface StatRow {
  alert_type: string;
  status: string;
  count: number;
}

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "under_review", label: "Under Review" },
  { value: "resolved_fraud", label: "Resolved — Fraud" },
  { value: "resolved_false_positive", label: "Resolved — False Positive" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
] as const;

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high:     "bg-orange-100 text-orange-800 border-orange-300",
  medium:   "bg-amber-100 text-amber-800 border-amber-300",
  low:      "bg-slate-100 text-slate-700 border-slate-300",
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-l-red-500",
  high:     "border-l-orange-500",
  medium:   "border-l-amber-400",
  low:      "border-l-slate-300",
};

const PAGE_SIZE = 100; // matches the backend's LIMIT 100

export default function NativeFraudAlertReview() {
  const [alerts, setAlerts]         = useState<FraudAlert[]>([]);
  const [loading, setLoading]        = useState(true);
  const [error, setError]            = useState("");
  // expanded: which candidate_ids are showing the full comparison panel
  const [expanded, setExpanded]      = useState<Set<string>>(new Set());

  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [offset, setOffset]             = useState(0);

  const [stats, setStats] = useState<StatRow[] | null>(null);

  const load = useCallback(async (status: string, off: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ alerts: FraudAlert[] }>(
        `/api/ats/fraud-alerts?status=${encodeURIComponent(status)}&offset=${off}`
      );
      setAlerts(res?.alerts ?? []);
    } catch {
      setError("Could not load the alert queue. Please refresh, or contact IT if it persists.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await hrmsApi.get<{ stats: StatRow[] }>("/api/ats/fraud-alerts/stats");
      setStats(res?.stats ?? []);
    } catch {
      // Non-critical — the summary strip just stays hidden if this fails.
      setStats(null);
    }
  }, []);

  useEffect(() => { void load(statusFilter, offset); }, [load, statusFilter, offset]);
  useEffect(() => { void loadStats(); }, [loadStats]);

  const handleStatusChange = (status: string) => {
    setStatusFilter(status);
    setOffset(0);
  };

  // Group alerts by candidate so one candidate with multiple flags shows one panel
  const candidateAlerts = alerts.reduce<Record<string, FraudAlert[]>>((acc, a) => {
    const key = a.candidate_id;
    (acc[key] ??= []).push(a);
    return acc;
  }, {});

  const toggleExpand = (candidateId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 sm:p-6">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-600 via-rose-600 to-pink-600 text-white p-6 shadow-lg">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute right-24 bottom-0 h-16 w-16 rounded-full bg-red-300/20 blur-xl" />
          <p className="text-xs font-bold uppercase tracking-widest text-red-200">Payroll HR · Security</p>
          <h1 className="mt-1 text-2xl font-bold text-white flex items-center gap-2">
            <ShieldAlert className="h-6 w-6" />
            Fraud Alert Review
          </h1>
          <p className="mt-1 text-sm text-red-100">
            An open <strong>critical</strong> or <strong>high</strong> alert blocks employee creation until cleared.
            Expand each candidate to compare faces, verify document numbers, and record your decision.
          </p>
        </div>

        {/* ── Summary strip — GET /stats, grouped by status across all alert types ── */}
        {stats && stats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(() => {
              const totalFor = (statuses: string[]) =>
                stats
                  .filter(s => statuses.includes(s.status))
                  .reduce((sum, s) => sum + Number(s.count ?? 0), 0);
              const strip = [
                { label: "Open", value: totalFor(["open"]), tone: "text-red-700 bg-red-50 border-red-200" },
                { label: "Under Review", value: totalFor(["under_review"]), tone: "text-amber-700 bg-amber-50 border-amber-200" },
                { label: "Resolved", value: totalFor(["resolved_fraud", "resolved_false_positive"]), tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
                { label: "Dismissed", value: totalFor(["dismissed"]), tone: "text-slate-600 bg-slate-50 border-slate-200" },
              ];
              return strip.map(s => (
                <div key={s.label} className={`rounded-xl border p-3 ${s.tone}`}>
                  <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{s.label}</p>
                  <p className="text-xl font-bold mt-0.5">{s.value}</p>
                </div>
              ));
            })()}
          </div>
        )}

        {/* ── Status filter ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</label>
          <select
            value={statusFilter}
            onChange={e => handleStatusChange(e.target.value)}
            className="rounded-lg border border-slate-300 text-sm px-2.5 py-1.5 bg-white focus:border-blue-400 focus:outline-none"
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-600 p-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading alert queue…
          </div>
        ) : !alerts.length ? (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="pt-5 pb-5 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-700 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-emerald-900">Nothing waiting</p>
                <p className="text-xs text-emerald-700">No onboarding fraud alert is currently open.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          Object.entries(candidateAlerts).map(([candidateId, cAlerts]) => {
            const rep = cAlerts[0];
            const isExpanded = expanded.has(candidateId);
            const maxSeverity = cAlerts.some(a => a.severity === "critical") ? "critical"
                              : cAlerts.some(a => a.severity === "high") ? "high"
                              : cAlerts.some(a => a.severity === "medium") ? "medium" : "low";

            return (
              <div key={candidateId} className={`rounded-xl border border-slate-200 border-l-4 ${SEVERITY_BORDER[maxSeverity]} bg-white shadow-sm overflow-hidden`}>
                {/* Candidate row — click to expand */}
                <button
                  type="button"
                  onClick={() => toggleExpand(candidateId)}
                  className="w-full flex flex-wrap items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                    <span className="font-bold text-slate-900 text-sm">
                      {rep.candidate_name ?? candidateId}
                    </span>
                    {rep.applied_for_branch && (
                      <span className="text-xs text-slate-500">{rep.applied_for_branch}</span>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {cAlerts.map(a => (
                        <Badge key={a.id} className={`border text-[10px] font-bold ${SEVERITY_STYLES[String(a.severity).toLowerCase()] ?? SEVERITY_STYLES.low}`}>
                          {a.alert_type.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {rep.created_at && (
                      <span className="text-xs text-slate-400">{String(rep.created_at).slice(0, 10)}</span>
                    )}
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className={`min-h-[32px] text-xs gap-1 pointer-events-none ${isExpanded ? "bg-blue-50 border-blue-200 text-blue-700" : ""}`}
                    >
                      <span>
                        {isExpanded ? <><ChevronUp className="h-3.5 w-3.5" /> Collapse</> : <><ChevronDown className="h-3.5 w-3.5" /> Review</>}
                      </span>
                    </Button>
                  </div>
                </button>

                {/* Expanded comparison panel */}
                {isExpanded && (
                  <div className="border-t border-slate-200 p-5 bg-slate-50/40">
                    <FraudComparisonPanel
                      candidateId={candidateId}
                      candidateName={rep.candidate_name ?? undefined}
                      showActions
                      onAlertResolved={() => { void load(statusFilter, offset); void loadStats(); }}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* ── Pagination ───────────────────────────────────────────────── */}
        {!loading && alerts.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
              className="text-xs"
            >
              Prev
            </Button>
            <span className="text-xs text-slate-500">Showing from {offset + 1}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={alerts.length < PAGE_SIZE}
              onClick={() => setOffset(o => o + PAGE_SIZE)}
              className="text-xs"
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
