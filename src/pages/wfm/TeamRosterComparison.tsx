/**
 * Team Roster Comparison — Phase 6
 *
 * Design System: MAS HRMS Frozen Patterns
 * - GlassCard containers with backdrop-blur
 * - Gradient headers (emerald for performance domain)
 * - Tone color system for rankings
 * - Responsive: mobile-first grid
 *
 * Features:
 * 1. Manager/Team adherence rankings
 * 2. Process-level comparison
 * 3. Branch-level comparison
 * 4. Head-to-head comparison tool
 * 5. Best practices from top performers
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
  Award,
  BarChart3,
  Building2,
  CheckCircle2,
  Crown,
  Medal,
  RefreshCw,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  User,
  Users,
} from "lucide-react";

const ALL = "__all__";

// ── Types ────────────────────────────────────────────────────────────────────

interface TeamRanking {
  managerId: string;
  managerName: string;
  processName: string | null;
  branchName: string | null;
  teamSize: number;
  metrics: {
    adherencePct: number;
    onTimePct: number;
    qualityAvg: number;
    shrinkagePct: number;
    breakCompliancePct: number;
  };
  trend: number;
  rank: number;
  badge: "GOLD" | "SILVER" | "BRONZE" | null;
}

interface ProcessRanking {
  processId: string;
  processName: string;
  branchName: string | null;
  employeeCount: number;
  metrics: {
    adherencePct: number;
    qualityAvg: number;
    shrinkagePct: number;
  };
  trend: number;
  rank: number;
}

interface BranchRanking {
  branchId: string;
  branchName: string;
  employeeCount: number;
  managerCount: number;
  metrics: {
    adherencePct: number;
    qualityAvg: number;
    shrinkagePct: number;
  };
  trend: number;
  rank: number;
}

interface ComparisonData {
  teams: TeamRanking[];
  processes: ProcessRanking[];
  branches: BranchRanking[];
  insights: string[];
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
  emerald: { iconBg: "#ecfdf5", value: "#059669", border: "#a7f3d0" },
  gold: { iconBg: "#fef9c3", value: "#ca8a04", border: "#fde047" },
  silver: { iconBg: "#f1f5f9", value: "#64748b", border: "#cbd5e1" },
  bronze: { iconBg: "#fed7aa", value: "#c2410c", border: "#fb923c" },
};

const BADGE_CONFIG = {
  GOLD: { icon: Crown, color: TONE.gold, label: "Gold" },
  SILVER: { icon: Medal, color: TONE.silver, label: "Silver" },
  BRONZE: { icon: Award, color: TONE.bronze, label: "Bronze" },
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

function RankBadge({ rank, badge }: { rank: number; badge: "GOLD" | "SILVER" | "BRONZE" | null }) {
  if (badge) {
    const config = BADGE_CONFIG[badge];
    return (
      <div
        className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold"
        style={{ backgroundColor: config.color.iconBg, color: config.color.value }}
      >
        <config.icon className="h-3 w-3" />
        {config.label}
      </div>
    );
  }

  return (
    <Badge variant="outline" className="text-xs font-bold">
      #{rank}
    </Badge>
  );
}

function TeamCard({ team, showDetails = false }: { team: TeamRanking; showDetails?: boolean }) {
  const adherenceTone = team.metrics.adherencePct >= 90 ? "green" : team.metrics.adherencePct >= 75 ? "amber" : "red";

  return (
    <GlassCard className={`overflow-hidden ${team.badge === "GOLD" ? "ring-2 ring-yellow-400 ring-offset-2" : ""}`}>
      {team.badge === "GOLD" && (
        <div className="bg-gradient-to-r from-yellow-400 to-amber-400 text-white text-xs font-medium py-1 px-3 flex items-center justify-center gap-1">
          <Crown className="h-3 w-3" /> Top Performer
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <User className="h-6 w-6 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-slate-800 truncate">{team.managerName}</h4>
            <p className="text-xs text-slate-500 truncate">
              {team.processName || "—"} • {team.branchName || "—"}
            </p>
          </div>
          <RankBadge rank={team.rank} badge={team.badge} />
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center p-2 rounded-lg bg-slate-50">
            <p className={`text-lg font-bold ${TONE[adherenceTone].value === "#15803d" ? "text-emerald-600" : TONE[adherenceTone].value === "#ea580c" ? "text-amber-600" : "text-red-600"}`}>
              {team.metrics.adherencePct}%
            </p>
            <p className="text-[10px] text-slate-500 uppercase">Adherence</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-slate-50">
            <p className="text-lg font-bold text-blue-600">{team.metrics.qualityAvg}%</p>
            <p className="text-[10px] text-slate-500 uppercase">Quality</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-slate-50">
            <p className={`text-lg font-bold ${team.metrics.shrinkagePct <= 10 ? "text-emerald-600" : team.metrics.shrinkagePct <= 15 ? "text-amber-600" : "text-red-600"}`}>
              {team.metrics.shrinkagePct}%
            </p>
            <p className="text-[10px] text-slate-500 uppercase">Shrinkage</p>
          </div>
        </div>

        {showDetails && (
          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
            <div className="text-center">
              <p className="text-sm font-bold text-slate-700">{team.metrics.onTimePct}%</p>
              <p className="text-[10px] text-slate-500">On-Time</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-slate-700">{team.metrics.breakCompliancePct}%</p>
              <p className="text-[10px] text-slate-500">Break Compliance</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Users className="h-3 w-3" /> {team.teamSize} members
          </span>
          <span className={`text-xs font-medium flex items-center gap-1 ${team.trend >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {team.trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {team.trend >= 0 ? "+" : ""}{team.trend}% vs last month
          </span>
        </div>
      </div>
    </GlassCard>
  );
}

function ProcessRow({ process }: { process: ProcessRanking }) {
  const adherenceTone = process.metrics.adherencePct >= 90 ? "green" : process.metrics.adherencePct >= 75 ? "amber" : "red";

  return (
    <div className="p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 flex-shrink-0">
          <Building2 className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">{process.processName}</span>
            {process.rank <= 3 && (
              <Badge variant={process.rank === 1 ? "default" : "secondary"} className="text-xs">
                #{process.rank}
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500">{process.branchName || "All Branches"} • {process.employeeCount} employees</p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className={`text-lg font-bold ${TONE[adherenceTone].value === "#15803d" ? "text-emerald-600" : TONE[adherenceTone].value === "#ea580c" ? "text-amber-600" : "text-red-600"}`}>
              {process.metrics.adherencePct}%
            </p>
            <p className="text-[10px] text-slate-500">Adherence</p>
          </div>
          <div>
            <p className="text-lg font-bold text-blue-600">{process.metrics.qualityAvg}%</p>
            <p className="text-[10px] text-slate-500">Quality</p>
          </div>
          <div>
            <p className={`text-lg font-bold ${process.metrics.shrinkagePct <= 10 ? "text-emerald-600" : "text-amber-600"}`}>
              {process.metrics.shrinkagePct}%
            </p>
            <p className="text-[10px] text-slate-500">Shrinkage</p>
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium ${process.trend >= 0 ? "text-emerald-600" : "text-red-600"}`}>
          {process.trend >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {Math.abs(process.trend)}%
        </div>
      </div>
    </div>
  );
}

function BranchRow({ branch }: { branch: BranchRanking }) {
  const adherenceTone = branch.metrics.adherencePct >= 90 ? "green" : branch.metrics.adherencePct >= 75 ? "amber" : "red";

  return (
    <div className="p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 flex-shrink-0">
          <Building2 className="h-5 w-5 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">{branch.branchName}</span>
            {branch.rank <= 3 && (
              <Badge
                className="text-xs"
                style={{
                  backgroundColor: branch.rank === 1 ? TONE.gold.iconBg : branch.rank === 2 ? TONE.silver.iconBg : TONE.bronze.iconBg,
                  color: branch.rank === 1 ? TONE.gold.value : branch.rank === 2 ? TONE.silver.value : TONE.bronze.value,
                }}
              >
                #{branch.rank}
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500">{branch.employeeCount} employees • {branch.managerCount} managers</p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className={`text-lg font-bold ${TONE[adherenceTone].value === "#15803d" ? "text-emerald-600" : TONE[adherenceTone].value === "#ea580c" ? "text-amber-600" : "text-red-600"}`}>
              {branch.metrics.adherencePct}%
            </p>
            <p className="text-[10px] text-slate-500">Adherence</p>
          </div>
          <div>
            <p className="text-lg font-bold text-blue-600">{branch.metrics.qualityAvg}%</p>
            <p className="text-[10px] text-slate-500">Quality</p>
          </div>
          <div>
            <p className={`text-lg font-bold ${branch.metrics.shrinkagePct <= 10 ? "text-emerald-600" : "text-amber-600"}`}>
              {branch.metrics.shrinkagePct}%
            </p>
            <p className="text-[10px] text-slate-500">Shrinkage</p>
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium ${branch.trend >= 0 ? "text-emerald-600" : "text-red-600"}`}>
          {branch.trend >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {Math.abs(branch.trend)}%
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function TeamRosterComparison() {
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [period, setPeriod] = useState("current");

  const { data: branchData } = useQuery({
    queryKey: ["team-comparison", "branches"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; branch_name: string }> }>("/api/org/branches"),
  });

  const { data: comparisonData, isLoading, refetch } = useQuery({
    queryKey: ["team-comparison", "data", branchFilter, period],
    queryFn: () => {
      const params = new URLSearchParams();
      if (branchFilter !== ALL) params.set("branchId", branchFilter);
      params.set("period", period);
      return hrmsApi.get<ComparisonData>(`/api/roster-analytics/team-comparison?${params}`);
    },
  });

  const data = comparisonData ?? {
    teams: [],
    processes: [],
    branches: [],
    insights: [],
  };

  const topTeams = data.teams.slice(0, 3);
  const avgAdherence = data.teams.length > 0
    ? Math.round(data.teams.reduce((s, t) => s + t.metrics.adherencePct, 0) / data.teams.length)
    : 0;
  const topAdherence = data.teams.length > 0 ? data.teams[0]?.metrics.adherencePct ?? 0 : 0;

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50/30 to-teal-50/20 p-4 sm:p-6">
        {/* Header with gradient (emerald for performance domain) */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 p-6 text-white shadow-lg shadow-emerald-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <Trophy className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Team Roster Comparison</h1>
                <p className="text-emerald-100 text-sm">Compare adherence across managers, processes, and branches</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-36 bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">This Month</SelectItem>
                  <SelectItem value="last">Last Month</SelectItem>
                  <SelectItem value="quarter">This Quarter</SelectItem>
                </SelectContent>
              </Select>
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
            <div className="animate-pulse">Loading comparison data...</div>
          </GlassCard>
        ) : (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <MetricTile
                label="Teams Ranked"
                value={data.teams.length}
                helper="Active managers"
                tone="emerald"
                icon={Users}
              />
              <MetricTile
                label="Avg Adherence"
                value={`${avgAdherence}%`}
                helper="Across all teams"
                tone={avgAdherence >= 85 ? "green" : "amber"}
                icon={Target}
              />
              <MetricTile
                label="Top Adherence"
                value={`${topAdherence}%`}
                helper={topTeams[0]?.managerName || "—"}
                tone="green"
                icon={Star}
              />
              <MetricTile
                label="Processes"
                value={data.processes.length}
                helper="Compared"
                tone="blue"
                icon={Building2}
              />
            </div>

            {/* Top 3 Podium */}
            {topTeams.length >= 3 && (
              <GlassCard className="mb-6 p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-100">
                    <Trophy className="h-5 w-5 text-yellow-600" />
                  </div>
                  <h3 className="font-semibold text-slate-800">Top Performers</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Second place */}
                  <div className="order-2 sm:order-1">
                    <TeamCard team={topTeams[1]} showDetails />
                  </div>
                  {/* First place */}
                  <div className="order-1 sm:order-2 sm:-mt-4">
                    <TeamCard team={topTeams[0]} showDetails />
                  </div>
                  {/* Third place */}
                  <div className="order-3">
                    <TeamCard team={topTeams[2]} showDetails />
                  </div>
                </div>
              </GlassCard>
            )}

            <Tabs defaultValue="teams" className="space-y-4">
              <TabsList className="grid w-full grid-cols-3 lg:w-[400px] bg-white/80 backdrop-blur">
                <TabsTrigger value="teams" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white">
                  Teams
                </TabsTrigger>
                <TabsTrigger value="processes" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                  Processes
                </TabsTrigger>
                <TabsTrigger value="branches" className="data-[state=active]:bg-violet-500 data-[state=active]:text-white">
                  Branches
                </TabsTrigger>
              </TabsList>

              {/* Teams Tab */}
              <TabsContent value="teams" className="space-y-4">
                {data.teams.length === 0 ? (
                  <GlassCard className="py-12 text-center">
                    <Users className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-medium text-slate-700">No team data available</p>
                  </GlassCard>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.teams.slice(3).map((team) => (
                      <TeamCard key={team.managerId} team={team} />
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Processes Tab */}
              <TabsContent value="processes" className="space-y-4">
                <GlassCard>
                  {data.processes.length === 0 ? (
                    <div className="py-12 text-center text-slate-400">No process data</div>
                  ) : (
                    data.processes.map((process) => (
                      <ProcessRow key={process.processId} process={process} />
                    ))
                  )}
                </GlassCard>
              </TabsContent>

              {/* Branches Tab */}
              <TabsContent value="branches" className="space-y-4">
                <GlassCard>
                  {data.branches.length === 0 ? (
                    <div className="py-12 text-center text-slate-400">No branch data</div>
                  ) : (
                    data.branches.map((branch) => (
                      <BranchRow key={branch.branchId} branch={branch} />
                    ))
                  )}
                </GlassCard>
              </TabsContent>
            </Tabs>

            {/* Insights */}
            {data.insights.length > 0 && (
              <GlassCard className="mt-6 p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
                <div className="flex items-center gap-3 mb-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <h3 className="font-semibold text-emerald-800">Best Practices from Top Performers</h3>
                </div>
                <ul className="space-y-2">
                  {data.insights.map((insight, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-emerald-700">
                      <Star className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      {insight}
                    </li>
                  ))}
                </ul>
              </GlassCard>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
