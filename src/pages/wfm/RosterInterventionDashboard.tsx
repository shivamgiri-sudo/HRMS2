/**
 * Roster Intervention Dashboard — Phase 4
 *
 * Design System: MAS HRMS Frozen Patterns
 * - GlassCard containers with backdrop-blur
 * - Gradient headers (violet for HR/intervention domain)
 * - Tone color system for priority levels
 * - Bento grid layout (density 8/10)
 * - Responsive: mobile-first grid
 *
 * Features:
 * 1. Intervention queue for at-risk employees
 * 2. Action tracking (scheduled, completed, outcome)
 * 3. Priority-based sorting (critical, high, medium)
 * 4. Filter by owner (HR, Manager, WFM)
 * 5. Outcome tracking (retained, exited, pending)
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  MessageSquare,
  Phone,
  RefreshCw,
  Shield,
  Target,
  TrendingDown,
  User,
  UserCheck,
  UserMinus,
  Users,
  XCircle,
  Zap,
} from "lucide-react";

const ALL = "__all__";

// ── Types ────────────────────────────────────────────────────────────────────

interface InterventionRecommendation {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  processName: string | null;
  branchName: string | null;
  managerId: string | null;
  managerName: string | null;
  generatedAt: string;
  riskTier: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  predictionScore: number;
  recommendations: Array<{
    priority: "immediate" | "within_48h" | "this_week";
    owner: "hr_admin" | "manager" | "wfm" | "process_head";
    action: string;
    reason: string;
    triggeredBy: string[];
  }>;
  actionTaken: boolean;
  actionTakenAt: string | null;
  actionTakenBy: string | null;
  actionNotes: string | null;
  outcome: "retained" | "exited" | "pending";
  outcomeDate: string | null;
  signals: {
    attendancePct: number | null;
    qualityPct: number | null;
    lateMarks30d: number | null;
    aonDays: number | null;
  };
}

interface InterventionSummary {
  total: number;
  byTier: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number };
  byOutcome: { retained: number; exited: number; pending: number };
  actionRate: number;
  retentionRate: number;
}

/**
 * Shape of a GET .../pending row. The API is snake_case and returns a narrower set of columns
 * than the camelCase interface above describes — the page's type was written against a
 * response nothing ever produced, which is why it needs mapping rather than a rename.
 */
interface PendingInterventionApiRow {
  id: string;
  employee_id: string;
  employee_name: string;
  branch_name: string | null;
  process_name: string | null;
  designation_name: string | null;
  generated_at: string;
  days_since_generated: number;
  risk_tier: string;
  prediction_score: number;
  recommendations: InterventionRecommendation["recommendations"] | string | null;
}

function adaptPendingRow(r: PendingInterventionApiRow): InterventionRecommendation {
  // recommendations is a JSON column; mysql2 hands it back parsed on some drivers and as a
  // string on others, so both are accepted rather than assuming one.
  let recs: InterventionRecommendation["recommendations"] = [];
  try {
    recs = typeof r.recommendations === "string"
      ? JSON.parse(r.recommendations)
      : (r.recommendations ?? []);
  } catch { recs = []; }

  return {
    id: r.id,
    employeeId: r.employee_id,
    // Not selected by the endpoint. Left blank rather than filled with the id, so the column
    // reads as absent instead of as a code that would not match anything.
    employeeCode: "",
    employeeName: r.employee_name,
    processName: r.process_name || null,
    branchName: r.branch_name || null,
    managerId: null,
    managerName: null,
    generatedAt: r.generated_at,
    riskTier: String(r.risk_tier ?? "LOW").toUpperCase() as InterventionRecommendation["riskTier"],
    predictionScore: Number(r.prediction_score ?? 0),
    recommendations: Array.isArray(recs) ? recs : [],
    // /pending selects WHERE action_taken = 0 AND outcome = 'pending', so these are constants
    // for every row it can return — not guesses.
    actionTaken: false,
    actionTakenAt: null,
    actionTakenBy: null,
    actionNotes: null,
    outcome: "pending",
    outcomeDate: null,
    signals: { attendancePct: null, qualityPct: null, lateMarks30d: null, aonDays: null },
  };
}

/** Shape of GET /api/analytics/intervention-recommendations/outcomes -> data. */
interface InterventionOutcomesApi {
  total_generated: number;
  action_taken_count: number;
  retained_count: number;
  exited_count: number;
  pending_count: number;
  retention_success_rate: number;
  avg_days_to_action: number | null;
}

/**
 * The outcomes endpoint carries every figure this page shows EXCEPT the per-tier split — it
 * aggregates by outcome, not by risk tier. byTier is therefore derived from the pending list
 * (see below) rather than invented here, and stays at zero when that list is empty.
 */
function adaptSummary(raw: InterventionOutcomesApi | undefined): InterventionSummary {
  const total = Number(raw?.total_generated ?? 0);
  const actioned = Number(raw?.action_taken_count ?? 0);
  return {
    total,
    byTier: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    byOutcome: {
      retained: Number(raw?.retained_count ?? 0),
      exited: Number(raw?.exited_count ?? 0),
      pending: Number(raw?.pending_count ?? 0),
    },
    actionRate: total > 0 ? Math.round((actioned / total) * 100) : 0,
    retentionRate: Number(raw?.retention_success_rate ?? 0),
  };
}

// ── Design Tokens (MAS HRMS Frozen) ──────────────────────────────────────────

const TONE = {
  blue: { iconBg: "#edf4ff", value: "#0b63e5", border: "#dce8fb" },
  green: { iconBg: "#eaf8ef", value: "#15803d", border: "#d7f0df" },
  amber: { iconBg: "#fff4e8", value: "#ea580c", border: "#fee3c5" },
  red: { iconBg: "#fff0f1", value: "#dc2626", border: "#ffdadd" },
  violet: { iconBg: "#f3efff", value: "#6d28d9", border: "#e6ddff" },
  teal: { iconBg: "#f0fdfa", value: "#0f766e", border: "#99f6e4" },
  slate: { iconBg: "#f1f4f8", value: "#0b1f44", border: "#e3e9f2" },
};

const TIER_CONFIG = {
  CRITICAL: { tone: "red" as const, label: "Critical", icon: AlertTriangle },
  HIGH: { tone: "amber" as const, label: "High", icon: Zap },
  MEDIUM: { tone: "blue" as const, label: "Medium", icon: Target },
  LOW: { tone: "green" as const, label: "Low", icon: Shield },
};

const OWNER_CONFIG = {
  hr_admin: { label: "HR Admin", icon: Users },
  manager: { label: "Manager", icon: User },
  wfm: { label: "WFM", icon: Calendar },
  process_head: { label: "Process Head", icon: Target },
};

const PRIORITY_CONFIG = {
  immediate: { label: "Immediate", color: "text-red-600", bg: "bg-red-50" },
  within_48h: { label: "Within 48h", color: "text-amber-600", bg: "bg-amber-50" },
  this_week: { label: "This Week", color: "text-blue-600", bg: "bg-blue-50" },
};

// ── Subcomponents ────────────────────────────────────────────────────────────

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200 ${className}`}>
      {children}
    </div>
  );
}

function MetricTile({
  label,
  value,
  helper,
  tone = "slate",
  icon: Icon,
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: keyof typeof TONE;
  icon: React.ElementType;
}) {
  const colors = TONE[tone];
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.iconBg }}
        >
          <Icon className="h-5 w-5" style={{ color: colors.value }} />
        </div>
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold" style={{ color: colors.value }}>{value}</p>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {helper && <p className="text-xs text-slate-500 mt-0.5">{helper}</p>}
      </div>
    </GlassCard>
  );
}

function RiskBadge({ tier }: { tier: keyof typeof TIER_CONFIG }) {
  const config = TIER_CONFIG[tier];
  const colors = TONE[config.tone];
  return (
    <Badge
      className="font-bold"
      style={{ backgroundColor: colors.iconBg, color: colors.value, borderColor: colors.border }}
    >
      <config.icon className="h-3 w-3 mr-1" />
      {config.label}
    </Badge>
  );
}

function InterventionCard({
  intervention,
  onAction,
  onViewDetail,
}: {
  intervention: InterventionRecommendation;
  onAction: () => void;
  onViewDetail: () => void;
}) {
  const tierConfig = TIER_CONFIG[intervention.riskTier];
  const colors = TONE[tierConfig.tone];

  return (
    <GlassCard className="overflow-hidden">
      <div
        className="h-1"
        style={{ backgroundColor: colors.value }}
      />
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-slate-800 truncate">{intervention.employeeName}</span>
              <span className="text-xs text-slate-500">{intervention.employeeCode}</span>
              <RiskBadge tier={intervention.riskTier} />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{intervention.processName || "—"}</span>
              <span>•</span>
              <span>{intervention.branchName || "—"}</span>
              {intervention.managerName && (
                <>
                  <span>•</span>
                  <span>Mgr: {intervention.managerName}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold" style={{ color: colors.value }}>
              {intervention.predictionScore}
            </div>
            <div className="text-[10px] text-slate-400 uppercase">Risk Score</div>
          </div>
        </div>

        {/* Signal indicators */}
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 p-2">
            <p className={`text-sm font-bold ${(intervention.signals.attendancePct ?? 100) < 85 ? "text-red-600" : "text-slate-700"}`}>
              {intervention.signals.attendancePct ?? "—"}%
            </p>
            <p className="text-[10px] text-slate-500">Attendance</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2">
            <p className={`text-sm font-bold ${(intervention.signals.qualityPct ?? 100) < 75 ? "text-amber-600" : "text-slate-700"}`}>
              {intervention.signals.qualityPct ?? "—"}%
            </p>
            <p className="text-[10px] text-slate-500">Quality</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2">
            <p className={`text-sm font-bold ${(intervention.signals.lateMarks30d ?? 0) > 5 ? "text-amber-600" : "text-slate-700"}`}>
              {intervention.signals.lateMarks30d ?? "—"}
            </p>
            <p className="text-[10px] text-slate-500">Late (30d)</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2">
            <p className={`text-sm font-bold ${(intervention.signals.aonDays ?? 999) <= 30 ? "text-red-600" : "text-slate-700"}`}>
              {intervention.signals.aonDays ?? "—"}
            </p>
            <p className="text-[10px] text-slate-500">AoN Days</p>
          </div>
        </div>

        {/* Top recommendation */}
        {intervention.recommendations.length > 0 && (
          <div className={`mt-3 p-3 rounded-lg ${PRIORITY_CONFIG[intervention.recommendations[0].priority].bg}`}>
            <div className="flex items-start gap-2">
              <ArrowRight className={`h-4 w-4 mt-0.5 ${PRIORITY_CONFIG[intervention.recommendations[0].priority].color}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${PRIORITY_CONFIG[intervention.recommendations[0].priority].color}`}>
                  {intervention.recommendations[0].action}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Owner: {OWNER_CONFIG[intervention.recommendations[0].owner].label} • {PRIORITY_CONFIG[intervention.recommendations[0].priority].label}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {intervention.outcome === "retained" && (
              <Badge variant="default" className="bg-green-100 text-green-700">
                <UserCheck className="h-3 w-3 mr-1" /> Retained
              </Badge>
            )}
            {intervention.outcome === "exited" && (
              <Badge variant="destructive" className="bg-red-100 text-red-700">
                <UserMinus className="h-3 w-3 mr-1" /> Exited
              </Badge>
            )}
            {intervention.actionTaken && intervention.outcome === "pending" && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                <Clock className="h-3 w-3 mr-1" /> Action Taken
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onViewDetail}>
              View Details
            </Button>
            {!intervention.actionTaken && (
              <Button size="sm" onClick={onAction} className="bg-violet-600 hover:bg-violet-700">
                Take Action
              </Button>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function RosterInterventionDashboard() {
  const [tierFilter, setTierFilter] = useState(ALL);
  const [ownerFilter, setOwnerFilter] = useState(ALL);
  const [outcomeFilter, setOutcomeFilter] = useState<string>("pending");
  const [selectedIntervention, setSelectedIntervention] = useState<InterventionRecommendation | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const queryClient = useQueryClient();

  /*
   * These three called /api/analytics/interventions/*, which nothing serves. The real router is
   * mounted at /api/analytics/intervention-recommendations and exposes /outcomes, /pending and
   * PATCH /:id — different paths, and a different verb for the mutation.
   *
   * Note on what this does and does not fix: the paths are now right, but
   * employee_retention_recommendation holds 0 rows, so the page will honestly show zeros until
   * recommendations are generated. That is a data gap, not a wiring one — the difference being
   * that a 401 from an unserved URL used to be indistinguishable from a genuinely quiet week.
   */
  const { data: summaryData, isError: summaryError } = useQuery({
    queryKey: ["interventions", "summary"],
    queryFn: async () => {
      const raw = await hrmsApi.get<{ data?: InterventionOutcomesApi }>(
        "/api/analytics/intervention-recommendations/outcomes",
      );
      return adaptSummary(raw?.data);
    },
  });

  const { data: interventionsData, isLoading } = useQuery({
    queryKey: ["interventions", "list", tierFilter, ownerFilter, outcomeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      // The API supports `owner` and `limit` only; tier and outcome are filtered client-side
      // below rather than sent as parameters the handler would silently ignore.
      if (ownerFilter !== ALL) params.set("owner", ownerFilter);
      const raw = await hrmsApi.get<{ data?: PendingInterventionApiRow[]; count?: number }>(
        `/api/analytics/intervention-recommendations/pending?${params}`,
      );
      let rows = (raw?.data ?? []).map(adaptPendingRow);
      if (tierFilter !== ALL) rows = rows.filter((r) => r.riskTier === tierFilter);
      // outcomeFilter is deliberately NOT applied: the endpoint already selects
      // `outcome = 'pending'`, so every row it returns has the same outcome and filtering on
      // anything else would blank the list rather than narrow it.
      return { interventions: rows, total: rows.length };
    },
  });

  const markActionMutation = useMutation({
    mutationFn: (data: { id: string; notes: string }) =>
      hrmsApi.patch(`/api/analytics/intervention-recommendations/${data.id}`, { notes: data.notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interventions"] });
      setSelectedIntervention(null);
      setActionNotes("");
    },
  });

  const handleTakeAction = async () => {
    if (!selectedIntervention) return;
    setIsSubmitting(true);
    try {
      await markActionMutation.mutateAsync({ id: selectedIntervention.id, notes: actionNotes });
    } finally {
      setIsSubmitting(false);
    }
  };

  const interventions = interventionsData?.interventions ?? [];
  const summaryBase = summaryData ?? {
    total: 0,
    byTier: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    byOutcome: { retained: 0, exited: 0, pending: 0 },
    actionRate: 0,
    retentionRate: 0,
  };

  /*
   * byTier is counted from the pending rows rather than taken from /outcomes, which aggregates
   * by outcome and carries no tier breakdown. Two honest limits follow, and neither is hidden:
   * these are counts of OPEN interventions (which is what the tiles are labelled), and they
   * reflect the filtered list, so narrowing by owner narrows the tiles with it.
   */
  const summary: InterventionSummary = (() => {
    const byTier = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const row of interventionsData?.interventions ?? []) {
      const tier = String(row.riskTier ?? "").toUpperCase();
      if (tier in byTier) byTier[tier as keyof typeof byTier] += 1;
    }
    return { ...summaryBase, byTier };
  })();

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-violet-50/30 to-purple-50/20 p-4 sm:p-6">
        {/* Header with gradient (violet for intervention/HR domain) */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 p-6 text-white shadow-lg shadow-violet-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <Shield className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Roster Intervention Dashboard</h1>
                <p className="text-violet-100 text-sm">Track and manage retention interventions for at-risk employees</p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["interventions"] })}
              className="bg-white/20 hover:bg-white/30 text-white border-0"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/*
          `summary` falls back to an all-zero default, so a failed request renders as
          "0 critical, 0 pending, 0% action rate" — indistinguishable from a genuinely quiet
          week. On a retention screen that reads as "no one is at risk", which is exactly the
          wrong conclusion to draw from an endpoint that never answered.
        */}
        {summaryError && (
          <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4">
            <p className="font-semibold text-red-900">Intervention summary could not be loaded</p>
            <p className="mt-1 text-sm text-red-800">
              The counts below are placeholders, not a quiet week — no at-risk employees were
              evaluated. Use Refresh above, and report it if it persists.
            </p>
          </div>
        )}

        {/* KPI Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
          <MetricTile
            label="Critical"
            value={summary.byTier.CRITICAL}
            helper="Immediate action"
            tone="red"
            icon={AlertTriangle}
          />
          <MetricTile
            label="High Risk"
            value={summary.byTier.HIGH}
            helper="Within 48 hours"
            tone="amber"
            icon={Zap}
          />
          <MetricTile
            label="Medium Risk"
            value={summary.byTier.MEDIUM}
            helper="This week"
            tone="blue"
            icon={Target}
          />
          <MetricTile
            label="Pending"
            value={summary.byOutcome.pending}
            helper="Awaiting outcome"
            tone="violet"
            icon={Clock}
          />
          <MetricTile
            label="Retained"
            value={summary.byOutcome.retained}
            helper={`${summary.retentionRate}% success`}
            tone="green"
            icon={UserCheck}
          />
          <MetricTile
            label="Action Rate"
            value={`${summary.actionRate}%`}
            helper="Interventions acted on"
            tone="teal"
            icon={CheckCircle2}
          />
        </div>

        {/* Filters */}
        <GlassCard className="mb-6">
          <div className="p-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-medium text-slate-600">Filters:</span>
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Risk Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Tiers</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={ownerFilter} onValueChange={setOwnerFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Owners</SelectItem>
                <SelectItem value="hr_admin">HR Admin</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="wfm">WFM</SelectItem>
                <SelectItem value="process_head">Process Head</SelectItem>
              </SelectContent>
            </Select>
            <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Outcome" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Outcomes</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="retained">Retained</SelectItem>
                <SelectItem value="exited">Exited</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto text-sm text-slate-500">
              {interventions.length} interventions
            </div>
          </div>
        </GlassCard>

        {/* Intervention List */}
        {isLoading ? (
          <GlassCard className="py-12 text-center">
            <div className="animate-pulse">Loading interventions...</div>
          </GlassCard>
        ) : interventions.length === 0 ? (
          <GlassCard className="py-12 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-400" />
            <p className="font-medium text-green-700">No interventions match your filters</p>
            <p className="text-sm text-slate-500 mt-1">Try adjusting your filter criteria</p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {interventions.map((intervention) => (
              <InterventionCard
                key={intervention.id}
                intervention={intervention}
                onAction={() => {
                  setSelectedIntervention(intervention);
                  setActionNotes("");
                }}
                onViewDetail={() => setSelectedIntervention(intervention)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Action Sheet */}
      <Sheet open={!!selectedIntervention} onOpenChange={(open) => !open && setSelectedIntervention(null)}>
        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-violet-600" />
              Intervention Details
            </SheetTitle>
          </SheetHeader>
          {selectedIntervention && (
            <div className="mt-6 space-y-6">
              {/* Employee Info */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
                  <User className="h-6 w-6 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">{selectedIntervention.employeeName}</h3>
                  <p className="text-sm text-slate-500">{selectedIntervention.employeeCode}</p>
                  <p className="text-xs text-slate-400">{selectedIntervention.processName} • {selectedIntervention.branchName}</p>
                </div>
                <div className="ml-auto">
                  <RiskBadge tier={selectedIntervention.riskTier} />
                </div>
              </div>

              {/* Risk Score */}
              <div className="text-center p-4 rounded-xl bg-gradient-to-br from-violet-50 to-purple-50">
                <div className="text-4xl font-bold text-violet-600">{selectedIntervention.predictionScore}</div>
                <div className="text-sm text-slate-500">Attrition Risk Score</div>
              </div>

              {/* Signal Breakdown */}
              <div>
                <h4 className="font-semibold text-slate-700 mb-3">Risk Signals</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-slate-50">
                    <p className="text-lg font-bold text-slate-800">{selectedIntervention.signals.attendancePct ?? "—"}%</p>
                    <p className="text-xs text-slate-500">Attendance (60d)</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50">
                    <p className="text-lg font-bold text-slate-800">{selectedIntervention.signals.qualityPct ?? "—"}%</p>
                    <p className="text-xs text-slate-500">Quality Avg</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50">
                    <p className="text-lg font-bold text-slate-800">{selectedIntervention.signals.lateMarks30d ?? "—"}</p>
                    <p className="text-xs text-slate-500">Late Marks (30d)</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50">
                    <p className="text-lg font-bold text-slate-800">{selectedIntervention.signals.aonDays ?? "—"}</p>
                    <p className="text-xs text-slate-500">Age on Network</p>
                  </div>
                </div>
              </div>

              {/* Recommendations */}
              <div>
                <h4 className="font-semibold text-slate-700 mb-3">Recommended Actions</h4>
                <div className="space-y-2">
                  {selectedIntervention.recommendations.map((rec, i) => {
                    const OwnerIcon = OWNER_CONFIG[rec.owner].icon;
                    return (
                      <div key={i} className={`p-3 rounded-lg ${PRIORITY_CONFIG[rec.priority].bg}`}>
                        <div className="flex items-start gap-2">
                          <OwnerIcon className={`h-4 w-4 mt-0.5 ${PRIORITY_CONFIG[rec.priority].color}`} />
                          <div>
                            <p className={`text-sm font-medium ${PRIORITY_CONFIG[rec.priority].color}`}>{rec.action}</p>
                            <p className="text-xs text-slate-500 mt-1">{rec.reason}</p>
                            <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                              <span>{OWNER_CONFIG[rec.owner].label}</span>
                              <span>•</span>
                              <span>{PRIORITY_CONFIG[rec.priority].label}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Form */}
              {!selectedIntervention.actionTaken && (
                <div className="border-t pt-6">
                  <h4 className="font-semibold text-slate-700 mb-3">Record Action</h4>
                  <Textarea
                    placeholder="Describe the action taken (e.g., scheduled 1:1 meeting, assigned mentor, discussed with manager...)"
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                    rows={3}
                    className="mb-4"
                  />
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setSelectedIntervention(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1 bg-violet-600 hover:bg-violet-700"
                      disabled={!actionNotes.trim() || isSubmitting}
                      onClick={handleTakeAction}
                    >
                      {isSubmitting ? "Saving..." : "Mark Action Taken"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Existing Action */}
              {selectedIntervention.actionTaken && (
                <div className="border-t pt-6">
                  <h4 className="font-semibold text-slate-700 mb-3">Action History</h4>
                  <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                    <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Action Taken
                    </div>
                    <p className="text-sm text-slate-600">{selectedIntervention.actionNotes}</p>
                    <p className="text-xs text-slate-400 mt-2">
                      {selectedIntervention.actionTakenAt && new Date(selectedIntervention.actionTakenAt).toLocaleDateString()}
                    </p>
                  </div>
                  {selectedIntervention.outcome !== "pending" && (
                    <div className={`mt-3 p-4 rounded-lg ${
                      selectedIntervention.outcome === "retained" ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
                    } border`}>
                      <div className={`flex items-center gap-2 font-medium mb-1 ${
                        selectedIntervention.outcome === "retained" ? "text-emerald-700" : "text-red-700"
                      }`}>
                        {selectedIntervention.outcome === "retained" ? (
                          <><UserCheck className="h-4 w-4" /> Employee Retained</>
                        ) : (
                          <><UserMinus className="h-4 w-4" /> Employee Exited</>
                        )}
                      </div>
                      {selectedIntervention.outcomeDate && (
                        <p className="text-xs text-slate-500">
                          Outcome date: {new Date(selectedIntervention.outcomeDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Quick Actions */}
              <div className="border-t pt-6">
                <h4 className="font-semibold text-slate-700 mb-3">Quick Actions</h4>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" className="justify-start gap-2">
                    <Phone className="h-4 w-4" /> Call Employee
                  </Button>
                  <Button variant="outline" size="sm" className="justify-start gap-2">
                    <MessageSquare className="h-4 w-4" /> Send Message
                  </Button>
                  <Button variant="outline" size="sm" className="justify-start gap-2">
                    <Calendar className="h-4 w-4" /> Schedule Meeting
                  </Button>
                  <Button variant="outline" size="sm" className="justify-start gap-2">
                    <TrendingDown className="h-4 w-4" /> View Full 360
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
