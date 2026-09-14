/**
 * TeamScorecard — KPI summary cards for the Management Dashboard.
 * Shows headcount, utilization %, average quality score, and monthly cost.
 */
import { Users, TrendingUp, Star, DollarSign, Loader, AlertTriangle } from "lucide-react";
import { useTeamOverview } from "@/hooks/useManagementDashboard";

function inrFmt(v: number) {
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)} Cr`;
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(2)} L`;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

function scoreTone(score: number) {
  if (score >= 80) return "bg-emerald-50 text-emerald-700";
  if (score >= 70) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

interface CardProps {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  tone: string;
}

function StatCard({ title, value, sub, icon, tone }: CardProps) {
  return (
    <div className="glass-card stat-card rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-400">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

export function TeamScorecard() {
  const { data, isLoading, error } = useTeamOverview();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        Failed to load team overview: {error.message}
      </div>
    );
  }

  const overview = data ?? { headcount: 0, utilization_pct: 0, avg_quality_score: 0, monthly_cost: 0 };

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title="Headcount"
        value={overview.headcount}
        sub="active employees"
        icon={<Users className="h-5 w-5" />}
        tone="bg-blue-50 text-blue-700"
      />
      <StatCard
        title="Utilization"
        value={`${overview.utilization_pct.toFixed(1)}%`}
        sub="floor availability"
        icon={<TrendingUp className="h-5 w-5" />}
        tone={scoreTone(overview.utilization_pct)}
      />
      <StatCard
        title="Avg Quality Score"
        value={overview.avg_quality_score.toFixed(1)}
        sub={overview.avg_quality_score >= 80 ? "on target" : overview.avg_quality_score >= 70 ? "watch zone" : "below target"}
        icon={<Star className="h-5 w-5" />}
        tone={scoreTone(overview.avg_quality_score)}
      />
      <StatCard
        title="Monthly Cost"
        value={inrFmt(overview.monthly_cost)}
        sub="payroll projection"
        icon={<DollarSign className="h-5 w-5" />}
        tone="bg-violet-50 text-violet-700"
      />
    </div>
  );
}
