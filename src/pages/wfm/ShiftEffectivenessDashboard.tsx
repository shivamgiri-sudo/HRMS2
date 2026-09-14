/**
 * Shift Effectiveness Dashboard — Phase 5
 *
 * Design System: MAS HRMS Frozen Patterns
 * - GlassCard containers with backdrop-blur
 * - Gradient headers (blue for analytics domain)
 * - Tone color system for performance
 * - Responsive: mobile-first grid
 *
 * Features:
 * 1. Shift-wise adherence comparison
 * 2. Break compliance tracking (break time vs budget)
 * 3. Optimal shift patterns identification
 * 4. Shift-quality correlation
 * 5. Recommendations for shift assignment
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Coffee,
  Lightbulb,
  Moon,
  RefreshCw,
  Star,
  Sun,
  Sunrise,
  Sunset,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

const ALL = "__all__";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShiftEffectiveness {
  shiftId: string;
  shiftName: string;
  shiftTime: string;
  shiftType: "MORNING" | "AFTERNOON" | "EVENING" | "NIGHT" | "SPLIT" | "ROTATIONAL";
  totalEmployees: number;
  metrics: {
    adherencePct: number;
    onTimePct: number;
    qualityAvg: number;
    breakCompliancePct: number;
    avgBreakMinutes: number;
    breakBudget: number;
    productivityScore: number;
  };
  trend: {
    adherence: number;
    quality: number;
  };
  rank: number;
  isOptimal: boolean;
}

interface BreakCompliance {
  overall: {
    compliancePct: number;
    avgBreakMinutes: number;
    budgetMinutes: number;
    overBreakCount: number;
    underBreakCount: number;
  };
  byShift: Array<{
    shiftId: string;
    shiftName: string;
    compliancePct: number;
    avgBreakMinutes: number;
    budgetMinutes: number;
    trend: number;
  }>;
  byProcess: Array<{
    processId: string;
    processName: string;
    compliancePct: number;
    avgExcessMinutes: number;
  }>;
  topViolators: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    avgExcessMinutes: number;
    occurrences: number;
  }>;
}

interface ShiftRecommendation {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  currentShift: string;
  recommendedShift: string;
  reason: string;
  expectedImprovement: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
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

const SHIFT_TYPE_CONFIG = {
  MORNING: { icon: Sunrise, color: "#f59e0b", label: "Morning" },
  AFTERNOON: { icon: Sun, color: "#3b82f6", label: "Afternoon" },
  EVENING: { icon: Sunset, color: "#8b5cf6", label: "Evening" },
  NIGHT: { icon: Moon, color: "#1e3a5f", label: "Night" },
  SPLIT: { icon: Clock, color: "#ec4899", label: "Split" },
  ROTATIONAL: { icon: RefreshCw, color: "#10b981", label: "Rotational" },
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
  trend,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: keyof typeof TONE;
  trend?: number;
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
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold" style={{ color: colors.value }}>{value}</p>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {helper && <p className="text-xs text-slate-500 mt-0.5">{helper}</p>}
      </div>
    </GlassCard>
  );
}

function ShiftCard({ shift }: { shift: ShiftEffectiveness }) {
  const typeConfig = SHIFT_TYPE_CONFIG[shift.shiftType];
  const TypeIcon = typeConfig.icon;
  const adherenceTone = shift.metrics.adherencePct >= 90 ? "green" : shift.metrics.adherencePct >= 75 ? "amber" : "red";

  return (
    <GlassCard className={`overflow-hidden ${shift.isOptimal ? "ring-2 ring-emerald-500 ring-offset-2" : ""}`}>
      {shift.isOptimal && (
        <div className="bg-emerald-500 text-white text-xs font-medium py-1 px-3 flex items-center justify-center gap-1">
          <Star className="h-3 w-3" /> Optimal Shift
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${typeConfig.color}20` }}
          >
            <TypeIcon className="h-6 w-6" style={{ color: typeConfig.color }} />
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-slate-800">{shift.shiftName}</h4>
            <p className="text-xs text-slate-500">{shift.shiftTime}</p>
          </div>
          <Badge variant="outline" className="text-xs">
            #{shift.rank}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="text-center p-2 rounded-lg bg-slate-50">
            <p className={`text-xl font-bold ${TONE[adherenceTone].value === "#15803d" ? "text-emerald-600" : TONE[adherenceTone].value === "#ea580c" ? "text-amber-600" : "text-red-600"}`}>
              {shift.metrics.adherencePct}%
            </p>
            <p className="text-[10px] text-slate-500 uppercase">Adherence</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-slate-50">
            <p className="text-xl font-bold text-blue-600">{shift.metrics.qualityAvg}%</p>
            <p className="text-[10px] text-slate-500 uppercase">Quality</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-slate-50">
            <p className={`text-xl font-bold ${shift.metrics.breakCompliancePct >= 90 ? "text-emerald-600" : shift.metrics.breakCompliancePct >= 75 ? "text-amber-600" : "text-red-600"}`}>
              {shift.metrics.breakCompliancePct}%
            </p>
            <p className="text-[10px] text-slate-500 uppercase">Break Compliance</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-slate-50">
            <p className="text-xl font-bold text-violet-600">{shift.metrics.productivityScore}</p>
            <p className="text-[10px] text-slate-500 uppercase">Productivity</p>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" /> {shift.totalEmployees} employees
          </span>
          <span className="flex items-center gap-1">
            <Coffee className="h-3 w-3" /> {shift.metrics.avgBreakMinutes}/{shift.metrics.breakBudget} min
          </span>
        </div>
      </div>
    </GlassCard>
  );
}

function BreakComplianceCard({
  data,
}: {
  data: BreakCompliance["byShift"][0];
}) {
  const complianceTone = data.compliancePct >= 90 ? "green" : data.compliancePct >= 75 ? "amber" : "red";
  const colors = TONE[complianceTone];
  const overBudget = data.avgBreakMinutes > data.budgetMinutes;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ backgroundColor: colors.iconBg }}
          >
            <Coffee className="h-4 w-4" style={{ color: colors.value }} />
          </div>
          <span className="font-semibold text-slate-800">{data.shiftName}</span>
        </div>
        <Badge style={{ backgroundColor: colors.iconBg, color: colors.value }}>
          {data.compliancePct}%
        </Badge>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Avg Break</span>
          <span className={`font-medium ${overBudget ? "text-red-600" : "text-emerald-600"}`}>
            {data.avgBreakMinutes} min
          </span>
        </div>
        <Progress
          value={(data.avgBreakMinutes / (data.budgetMinutes * 1.5)) * 100}
          className={`h-2 [&>div]:${overBudget ? "bg-red-500" : "bg-emerald-500"}`}
        />
        <div className="flex justify-between text-xs text-slate-500">
          <span>0</span>
          <span className="text-amber-600">Budget: {data.budgetMinutes}m</span>
          <span>{Math.round(data.budgetMinutes * 1.5)}m</span>
        </div>
      </div>
    </GlassCard>
  );
}

function RecommendationCard({ rec }: { rec: ShiftRecommendation }) {
  const confidenceColor = rec.confidence === "HIGH" ? "green" : rec.confidence === "MEDIUM" ? "amber" : "blue";

  return (
    <GlassCard className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 flex-shrink-0">
          <Zap className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-slate-800">{rec.employeeName}</span>
            <span className="text-xs text-slate-500">{rec.employeeCode}</span>
          </div>
          <p className="text-sm text-slate-600 mb-2">
            <span className="text-slate-400">Current:</span> {rec.currentShift} →{" "}
            <span className="font-medium text-blue-600">{rec.recommendedShift}</span>
          </p>
          <p className="text-xs text-slate-500 mb-2">{rec.reason}</p>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-xs">
              <TrendingUp className="h-3 w-3 mr-1" />
              +{rec.expectedImprovement}% expected
            </Badge>
            <Badge
              className="text-xs"
              style={{
                backgroundColor: TONE[confidenceColor].iconBg,
                color: TONE[confidenceColor].value,
              }}
            >
              {rec.confidence} confidence
            </Badge>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function ShiftEffectivenessDashboard() {
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [processFilter, setProcessFilter] = useState(ALL);

  const { data: branchData } = useQuery({
    queryKey: ["shift-effectiveness", "branches"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; branch_name: string }> }>("/api/org/branches"),
  });

  const { data: processData } = useQuery({
    queryKey: ["shift-effectiveness", "processes"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; process_name: string }> }>("/api/org/processes"),
  });

  const { data: shiftsData, isLoading: shiftsLoading } = useQuery({
    queryKey: ["shift-effectiveness", "shifts", branchFilter, processFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (branchFilter !== ALL) params.set("branchId", branchFilter);
      if (processFilter !== ALL) params.set("processId", processFilter);
      return hrmsApi.get<{ shifts: ShiftEffectiveness[] }>(`/api/roster-analytics/shift-effectiveness?${params}`);
    },
  });

  const { data: breakData, isLoading: breakLoading } = useQuery({
    queryKey: ["shift-effectiveness", "breaks", branchFilter, processFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (branchFilter !== ALL) params.set("branchId", branchFilter);
      if (processFilter !== ALL) params.set("processId", processFilter);
      return hrmsApi.get<BreakCompliance>(`/api/roster-analytics/break-compliance?${params}`);
    },
  });

  const { data: recsData } = useQuery({
    queryKey: ["shift-effectiveness", "recommendations", branchFilter, processFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (branchFilter !== ALL) params.set("branchId", branchFilter);
      if (processFilter !== ALL) params.set("processId", processFilter);
      return hrmsApi.get<{ recommendations: ShiftRecommendation[] }>(`/api/roster-analytics/shift-recommendations?${params}`);
    },
  });

  const shifts = shiftsData?.shifts ?? [];
  const breakCompliance = breakData ?? {
    overall: { compliancePct: 0, avgBreakMinutes: 0, budgetMinutes: 0, overBreakCount: 0, underBreakCount: 0 },
    byShift: [],
    byProcess: [],
    topViolators: [],
  };
  const recommendations = recsData?.recommendations ?? [];

  const bestShift = shifts.find((s) => s.isOptimal) ?? shifts[0];
  const avgAdherence = shifts.length > 0 ? Math.round(shifts.reduce((s, sh) => s + sh.metrics.adherencePct, 0) / shifts.length) : 0;
  const avgQuality = shifts.length > 0 ? Math.round(shifts.reduce((s, sh) => s + sh.metrics.qualityAvg, 0) / shifts.length) : 0;

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-4 sm:p-6">
        {/* Header with gradient (blue for analytics domain) */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 p-6 text-white shadow-lg shadow-blue-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <BarChart3 className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Shift Effectiveness Dashboard</h1>
                <p className="text-blue-100 text-sm">Analyze shift performance, break compliance, and optimize assignments</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="w-40 bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Branches</SelectItem>
                  {(branchData?.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={processFilter} onValueChange={setProcessFilter}>
                <SelectTrigger className="w-40 bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="All Processes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Processes</SelectItem>
                  {(processData?.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
          <MetricTile
            label="Shifts Analyzed"
            value={shifts.length}
            helper="Active shifts"
            tone="blue"
            icon={Calendar}
          />
          <MetricTile
            label="Avg Adherence"
            value={`${avgAdherence}%`}
            helper="Across shifts"
            tone={avgAdherence >= 90 ? "green" : avgAdherence >= 75 ? "amber" : "red"}
            icon={Target}
          />
          <MetricTile
            label="Avg Quality"
            value={`${avgQuality}%`}
            helper="Across shifts"
            tone={avgQuality >= 80 ? "green" : avgQuality >= 65 ? "amber" : "red"}
            icon={Star}
          />
          <MetricTile
            label="Break Compliance"
            value={`${breakCompliance.overall.compliancePct}%`}
            helper={`${breakCompliance.overall.avgBreakMinutes}/${breakCompliance.overall.budgetMinutes}m avg`}
            tone={breakCompliance.overall.compliancePct >= 90 ? "green" : breakCompliance.overall.compliancePct >= 75 ? "amber" : "red"}
            icon={Coffee}
          />
          <MetricTile
            label="Over-Break"
            value={breakCompliance.overall.overBreakCount}
            helper="Employees"
            tone={breakCompliance.overall.overBreakCount > 10 ? "red" : "amber"}
            icon={Timer}
          />
          <MetricTile
            label="Recommendations"
            value={recommendations.length}
            helper="Shift changes"
            tone="violet"
            icon={Lightbulb}
          />
        </div>

        <Tabs defaultValue="shifts" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 lg:w-[450px] bg-white/80 backdrop-blur">
            <TabsTrigger value="shifts" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">
              Shifts
            </TabsTrigger>
            <TabsTrigger value="breaks" className="data-[state=active]:bg-amber-500 data-[state=active]:text-white">
              Breaks
            </TabsTrigger>
            <TabsTrigger value="recommendations" className="data-[state=active]:bg-violet-500 data-[state=active]:text-white">
              Recommendations
            </TabsTrigger>
          </TabsList>

          {/* Shifts Tab */}
          <TabsContent value="shifts" className="space-y-4">
            {shiftsLoading ? (
              <GlassCard className="py-12 text-center">
                <div className="animate-pulse">Loading shift data...</div>
              </GlassCard>
            ) : shifts.length === 0 ? (
              <GlassCard className="py-12 text-center">
                <Calendar className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p className="font-medium text-slate-700">No shift data available</p>
              </GlassCard>
            ) : (
              <>
                {/* Best Shift Highlight */}
                {bestShift && (
                  <GlassCard className="p-4 bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
                        <Star className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-emerald-800">Top Performing Shift: {bestShift.shiftName}</h3>
                        <p className="text-sm text-emerald-600">
                          {bestShift.metrics.adherencePct}% adherence • {bestShift.metrics.qualityAvg}% quality • {bestShift.metrics.breakCompliancePct}% break compliance
                        </p>
                      </div>
                    </div>
                  </GlassCard>
                )}

                {/* Shift Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {shifts.map((shift) => (
                    <ShiftCard key={shift.shiftId} shift={shift} />
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          {/* Breaks Tab */}
          <TabsContent value="breaks" className="space-y-4">
            {breakLoading ? (
              <GlassCard className="py-12 text-center">
                <div className="animate-pulse">Loading break data...</div>
              </GlassCard>
            ) : (
              <>
                {/* Break Compliance by Shift */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {breakCompliance.byShift.map((shift) => (
                    <BreakComplianceCard key={shift.shiftId} data={shift} />
                  ))}
                </div>

                {/* Top Violators */}
                {breakCompliance.topViolators.length > 0 && (
                  <GlassCard>
                    <div className="p-4 border-b border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
                          <Timer className="h-5 w-5 text-red-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-800">Break Policy Violators</h3>
                          <p className="text-xs text-slate-500">Employees consistently over break budget</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Employee</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Avg Excess</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Occurrences</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {breakCompliance.topViolators.slice(0, 10).map((v) => (
                            <tr key={v.employeeId} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <div className="font-medium text-slate-800">{v.employeeName}</div>
                                <div className="text-xs text-slate-500">{v.employeeCode}</div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className="text-red-600 font-medium">+{v.avgExcessMinutes} min</span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <Badge variant="destructive">{v.occurrences}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </GlassCard>
                )}
              </>
            )}
          </TabsContent>

          {/* Recommendations Tab */}
          <TabsContent value="recommendations" className="space-y-4">
            {recommendations.length === 0 ? (
              <GlassCard className="py-12 text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-400" />
                <p className="font-medium text-green-700">No shift change recommendations</p>
                <p className="text-sm text-slate-500">Current assignments are optimal</p>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {recommendations.map((rec) => (
                  <RecommendationCard key={rec.employeeId} rec={rec} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
