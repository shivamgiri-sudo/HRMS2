/**
 * WFM Capacity Dashboard — Phase 6
 *
 * Design System: MAS HRMS Frozen Patterns
 * - GlassCard containers with backdrop-blur
 * - Gradient headers (indigo for planning domain)
 * - Tone color system for capacity status
 * - Responsive: mobile-first grid
 *
 * Features:
 * 1. Headcount vs Mandate visualization
 * 2. Coverage percentage with gap analysis
 * 3. Hiring demand by process/branch
 * 4. Attrition buffer tracking
 * 5. Shrinkage impact on capacity
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Calculator,
  CheckCircle2,
  Clock,
  GraduationCap,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";

const ALL = "__all__";

// ── Types ────────────────────────────────────────────────────────────────────

interface CapacitySummary {
  overall: {
    mandatedHC: number;
    activeHC: number;
    availableProductionHC: number;
    requiredStaffedHC: number;
    netGap: number;
    hiringDemand: number;
    coveragePct: number;
    riskLevel: "GREEN" | "AMBER" | "RED";
  };
  buffers: {
    shrinkagePct: number;
    attritionBufferPct: number;
    trainingBufferPct: number;
    onNoticePct: number;
  };
  deductions: {
    onNoticeHC: number;
    longLeaveHC: number;
    inTrainingHC: number;
    pipHC: number;
  };
  byProcess: Array<{
    processId: string;
    processName: string;
    mandatedHC: number;
    activeHC: number;
    availableHC: number;
    gap: number;
    coveragePct: number;
    riskLevel: "GREEN" | "AMBER" | "RED";
  }>;
  byBranch: Array<{
    branchId: string;
    branchName: string;
    mandatedHC: number;
    activeHC: number;
    gap: number;
    coveragePct: number;
  }>;
  trend: Array<{
    month: string;
    mandatedHC: number;
    activeHC: number;
    gap: number;
  }>;
}

interface HiringDemand {
  total: number;
  byPriority: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  byProcess: Array<{
    processId: string;
    processName: string;
    demand: number;
    priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    dueDate: string | null;
  }>;
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
  indigo: { iconBg: "#eef2ff", value: "#4f46e5", border: "#c7d2fe" },
};

const RISK_CONFIG = {
  GREEN: { tone: "green" as const, label: "Healthy", icon: CheckCircle2 },
  AMBER: { tone: "amber" as const, label: "At Risk", icon: AlertTriangle },
  RED: { tone: "red" as const, label: "Critical", icon: XCircle },
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

function CapacityGauge({ coverage, risk }: { coverage: number; risk: "GREEN" | "AMBER" | "RED" }) {
  const size = 160;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius;
  const cappedCoverage = Math.min(coverage, 100);
  const offset = circumference - (cappedCoverage / 100) * circumference;

  const riskConfig = RISK_CONFIG[risk];
  const color = TONE[riskConfig.tone].value;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 30} className="overflow-visible">
        <defs>
          <linearGradient id="capacityGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={color} stopOpacity="0.8" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke="url(#capacityGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
        <text x={size / 2} y={size / 2 - 5} textAnchor="middle" fontSize={36} fontWeight="bold" fill={color}>
          {coverage}%
        </text>
        <text x={size / 2} y={size / 2 + 20} textAnchor="middle" fontSize={12} fill="#64748b">
          Coverage
        </text>
      </svg>
      <Badge
        className="mt-2"
        style={{ backgroundColor: TONE[riskConfig.tone].iconBg, color: TONE[riskConfig.tone].value }}
      >
        <riskConfig.icon className="h-3 w-3 mr-1" />
        {riskConfig.label}
      </Badge>
    </div>
  );
}

function FormulaCard({ data }: { data: CapacitySummary }) {
  return (
    <GlassCard className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
          <Calculator className="h-5 w-5 text-indigo-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-800">HC Formula Breakdown</h3>
          <p className="text-xs text-slate-500">BPO industry standard calculation</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Required Staffed HC */}
        <div className="p-3 rounded-lg bg-slate-50">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm text-slate-600">Required Staffed HC</span>
            <span className="text-lg font-bold text-slate-800">{data.overall.requiredStaffedHC}</span>
          </div>
          <p className="text-xs text-slate-400">
            = {data.overall.mandatedHC} × (1 + {data.buffers.shrinkagePct}%) ÷ (1 - {data.buffers.attritionBufferPct}% - {data.buffers.trainingBufferPct}%)
          </p>
        </div>

        {/* Deductions */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded-lg bg-red-50 text-center">
            <p className="text-lg font-bold text-red-600">{data.deductions.onNoticeHC}</p>
            <p className="text-xs text-red-700">On Notice</p>
          </div>
          <div className="p-2 rounded-lg bg-amber-50 text-center">
            <p className="text-lg font-bold text-amber-600">{data.deductions.longLeaveHC}</p>
            <p className="text-xs text-amber-700">Long Leave</p>
          </div>
          <div className="p-2 rounded-lg bg-blue-50 text-center">
            <p className="text-lg font-bold text-blue-600">{data.deductions.inTrainingHC}</p>
            <p className="text-xs text-blue-700">In Training</p>
          </div>
          <div className="p-2 rounded-lg bg-violet-50 text-center">
            <p className="text-lg font-bold text-violet-600">{data.deductions.pipHC}</p>
            <p className="text-xs text-violet-700">On PIP</p>
          </div>
        </div>

        {/* Available Production HC */}
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium text-emerald-700">Available Production HC</span>
            <span className="text-xl font-bold text-emerald-600">{data.overall.availableProductionHC}</span>
          </div>
          <p className="text-xs text-emerald-600">
            = {data.overall.activeHC} - {data.deductions.onNoticeHC} - {data.deductions.longLeaveHC} - {data.deductions.inTrainingHC}
          </p>
        </div>

        {/* Net Gap */}
        <div className={`p-3 rounded-lg ${data.overall.netGap > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"} border`}>
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${data.overall.netGap > 0 ? "text-red-700" : "text-green-700"}`}>
              Net Gap
            </span>
            <span className={`text-xl font-bold flex items-center gap-1 ${data.overall.netGap > 0 ? "text-red-600" : "text-green-600"}`}>
              {data.overall.netGap > 0 ? <MinusCircle className="h-5 w-5" /> : <PlusCircle className="h-5 w-5" />}
              {Math.abs(data.overall.netGap)}
            </span>
          </div>
        </div>

        {/* Hiring Demand */}
        <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-indigo-700">Hiring Demand</span>
            <span className="text-xl font-bold text-indigo-600 flex items-center gap-1">
              <UserPlus className="h-5 w-5" />
              {data.overall.hiringDemand}
            </span>
          </div>
          <p className="text-xs text-indigo-500 mt-1">
            = max(0, Net Gap) + On Notice ({data.deductions.onNoticeHC})
          </p>
        </div>
      </div>
    </GlassCard>
  );
}

function ProcessCapacityRow({ process }: { process: CapacitySummary["byProcess"][0] }) {
  const riskConfig = RISK_CONFIG[process.riskLevel];
  const colors = TONE[riskConfig.tone];

  return (
    <div className="p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ backgroundColor: colors.iconBg }}
          >
            <Building2 className="h-4 w-4" style={{ color: colors.value }} />
          </div>
          <div>
            <span className="font-semibold text-slate-800">{process.processName}</span>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Mandated: {process.mandatedHC}</span>
              <span>•</span>
              <span>Active: {process.activeHC}</span>
              <span>•</span>
              <span>Available: {process.availableHC}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <Badge style={{ backgroundColor: colors.iconBg, color: colors.value }}>
              {process.coveragePct}%
            </Badge>
          </div>
          <div className={`text-right font-bold ${process.gap > 0 ? "text-red-600" : "text-green-600"}`}>
            {process.gap > 0 ? `-${process.gap}` : `+${Math.abs(process.gap)}`}
          </div>
        </div>
      </div>
      <Progress
        value={process.coveragePct}
        className={`h-2 [&>div]:${riskConfig.tone === "green" ? "bg-emerald-500" : riskConfig.tone === "amber" ? "bg-amber-500" : "bg-red-500"}`}
      />
    </div>
  );
}

function TrendChart({ data }: { data: CapacitySummary["trend"] }) {
  if (data.length === 0) return <p className="text-center text-slate-400 py-8">No trend data</p>;

  const maxHC = Math.max(...data.flatMap((d) => [d.mandatedHC, d.activeHC]));
  const height = 120;

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(data.length * 80, 400)} height={height + 50} className="min-w-full">
        {/* Grid */}
        {[0, 25, 50, 75, 100].map((pct) => (
          <line
            key={pct}
            x1={50}
            y1={height - (pct / 100) * height + 10}
            x2={data.length * 80 + 50}
            y2={height - (pct / 100) * height + 10}
            stroke="#e2e8f0"
            strokeDasharray="4"
          />
        ))}

        {/* Mandated line */}
        <polyline
          fill="none"
          stroke="#6366f1"
          strokeWidth={2}
          strokeDasharray="6,3"
          points={data.map((d, i) => `${i * 80 + 70},${height - (d.mandatedHC / maxHC) * height + 10}`).join(" ")}
        />

        {/* Active line */}
        <polyline
          fill="none"
          stroke="#10b981"
          strokeWidth={3}
          points={data.map((d, i) => `${i * 80 + 70},${height - (d.activeHC / maxHC) * height + 10}`).join(" ")}
        />

        {/* Data points */}
        {data.map((d, i) => (
          <g key={d.month}>
            <circle cx={i * 80 + 70} cy={height - (d.activeHC / maxHC) * height + 10} r={5} fill="#10b981" />
            <text x={i * 80 + 70} y={height + 30} fontSize={10} fill="#64748b" textAnchor="middle">
              {d.month.slice(5)}
            </text>
          </g>
        ))}

        {/* Legend */}
        <g transform={`translate(60, ${height + 40})`}>
          <line x1={0} y1={0} x2={20} y2={0} stroke="#10b981" strokeWidth={3} />
          <text x={25} y={4} fontSize={10} fill="#64748b">Active</text>
          <line x1={80} y1={0} x2={100} y2={0} stroke="#6366f1" strokeWidth={2} strokeDasharray="6,3" />
          <text x={105} y={4} fontSize={10} fill="#64748b">Mandated</text>
        </g>
      </svg>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function WFMCapacityDashboard() {
  const [branchFilter, setBranchFilter] = useState(ALL);

  const { data: branchData } = useQuery({
    queryKey: ["capacity", "branches"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; branch_name: string }> }>("/api/org/branches"),
  });

  const { data: capacityData, isLoading, refetch } = useQuery({
    queryKey: ["capacity", "summary", branchFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (branchFilter !== ALL) params.set("branchId", branchFilter);
      return hrmsApi.get<CapacitySummary>(`/api/workforce-mandate/capacity-summary?${params}`);
    },
  });

  const { data: demandData } = useQuery({
    queryKey: ["capacity", "demand", branchFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (branchFilter !== ALL) params.set("branchId", branchFilter);
      return hrmsApi.get<HiringDemand>(`/api/workforce-mandate/hiring-demand?${params}`);
    },
  });

  const capacity = capacityData ?? {
    overall: {
      mandatedHC: 0, activeHC: 0, availableProductionHC: 0, requiredStaffedHC: 0,
      netGap: 0, hiringDemand: 0, coveragePct: 0, riskLevel: "GREEN" as const,
    },
    buffers: { shrinkagePct: 0, attritionBufferPct: 0, trainingBufferPct: 0, onNoticePct: 0 },
    deductions: { onNoticeHC: 0, longLeaveHC: 0, inTrainingHC: 0, pipHC: 0 },
    byProcess: [],
    byBranch: [],
    trend: [],
  };

  const demand = demandData ?? {
    total: 0,
    byPriority: { critical: 0, high: 0, medium: 0, low: 0 },
    byProcess: [],
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-violet-50/20 p-4 sm:p-6">
        {/* Header with gradient (indigo for planning domain) */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 p-6 text-white shadow-lg shadow-indigo-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <Users className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">WFM Capacity Dashboard</h1>
                <p className="text-indigo-100 text-sm">Headcount vs mandate, gap analysis, hiring demand</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="w-44 bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Branches</SelectItem>
                  {(branchData?.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => refetch()}
                className="bg-white/20 hover:bg-white/30 text-white border-0"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <GlassCard className="py-12 text-center">
            <div className="animate-pulse">Loading capacity data...</div>
          </GlassCard>
        ) : (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
              <MetricTile
                label="Mandated HC"
                value={capacity.overall.mandatedHC}
                helper="Client requirement"
                tone="indigo"
                icon={Target}
              />
              <MetricTile
                label="Active HC"
                value={capacity.overall.activeHC}
                helper="On payroll"
                tone="blue"
                icon={Users}
              />
              <MetricTile
                label="Production HC"
                value={capacity.overall.availableProductionHC}
                helper="After deductions"
                tone="green"
                icon={UserCheck}
              />
              <MetricTile
                label="Net Gap"
                value={capacity.overall.netGap}
                helper={capacity.overall.netGap > 0 ? "Understaffed" : "Healthy"}
                tone={capacity.overall.netGap > 0 ? "red" : "green"}
                icon={capacity.overall.netGap > 0 ? UserMinus : UserCheck}
              />
              <MetricTile
                label="Hiring Demand"
                value={capacity.overall.hiringDemand}
                helper="Positions to fill"
                tone="violet"
                icon={UserPlus}
              />
              <MetricTile
                label="On Notice"
                value={capacity.deductions.onNoticeHC}
                helper={`${capacity.buffers.onNoticePct}% of active`}
                tone="amber"
                icon={Clock}
              />
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6">
              {/* Capacity Gauge */}
              <GlassCard className="p-6 flex flex-col items-center justify-center">
                <CapacityGauge coverage={capacity.overall.coveragePct} risk={capacity.overall.riskLevel} />
                <div className="mt-4 grid grid-cols-3 gap-4 w-full text-center">
                  <div>
                    <p className="text-xs text-slate-500">Shrinkage</p>
                    <p className="text-lg font-bold text-slate-700">{capacity.buffers.shrinkagePct}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Attrition Buffer</p>
                    <p className="text-lg font-bold text-slate-700">{capacity.buffers.attritionBufferPct}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Training Buffer</p>
                    <p className="text-lg font-bold text-slate-700">{capacity.buffers.trainingBufferPct}%</p>
                  </div>
                </div>
              </GlassCard>

              {/* Formula Breakdown */}
              <div className="lg:col-span-2">
                <FormulaCard data={capacity} />
              </div>
            </div>

            {/* Process Capacity */}
            <GlassCard className="mb-6">
              <div className="p-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
                    <Building2 className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800">Capacity by Process</h3>
                    <p className="text-xs text-slate-500">Coverage and gap analysis per process</p>
                  </div>
                </div>
              </div>
              {capacity.byProcess.length === 0 ? (
                <div className="py-8 text-center text-slate-400">No process data</div>
              ) : (
                capacity.byProcess.map((process) => (
                  <ProcessCapacityRow key={process.processId} process={process} />
                ))
              )}
            </GlassCard>

            {/* Hiring Demand by Priority */}
            <GlassCard className="mb-6">
              <div className="p-4 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
                      <UserPlus className="h-5 w-5 text-violet-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800">Hiring Demand</h3>
                      <p className="text-xs text-slate-500">Positions to fill by priority</p>
                    </div>
                  </div>
                  <Badge className="text-lg px-4 py-1 bg-violet-100 text-violet-700">
                    {demand.total} total
                  </Badge>
                </div>
              </div>
              <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-red-50 text-center">
                  <p className="text-2xl font-bold text-red-600">{demand.byPriority.critical}</p>
                  <p className="text-xs text-red-700 font-medium">Critical</p>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 text-center">
                  <p className="text-2xl font-bold text-amber-600">{demand.byPriority.high}</p>
                  <p className="text-xs text-amber-700 font-medium">High</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-50 text-center">
                  <p className="text-2xl font-bold text-blue-600">{demand.byPriority.medium}</p>
                  <p className="text-xs text-blue-700 font-medium">Medium</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 text-center">
                  <p className="text-2xl font-bold text-slate-600">{demand.byPriority.low}</p>
                  <p className="text-xs text-slate-700 font-medium">Low</p>
                </div>
              </div>
            </GlassCard>

            {/* Trend Chart */}
            <GlassCard>
              <div className="p-4 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800">6-Month HC Trend</h3>
              </div>
              <div className="p-4">
                <TrendChart data={capacity.trend} />
              </div>
            </GlassCard>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
