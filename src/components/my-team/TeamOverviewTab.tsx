import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Activity, TrendingUp, IndianRupee,
  ChevronRight, AlertTriangle, ArrowUpRight,
} from "lucide-react";

interface TeamOverview {
  headcount: number;
  utilization_pct: number;
  avg_quality_score: number;
  monthly_cost: number;
}

interface TeamMember {
  id: string;
  employee_code: string;
  full_name: string;
}

interface Alert {
  id: string;
  alert_type: string;
  message: string;
  severity?: "low" | "medium" | "high" | "critical";
}

// ── Stat tile ────────────────────────────────────────────────
interface StatTileProps {
  label: string;
  value: string | number | undefined;
  subtext?: string;
  icon: React.ReactNode;
  gradient: string;
  trend?: "up" | "down" | "neutral";
}

function StatTile({ label, value, subtext, icon, gradient, trend }: StatTileProps) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-5 ${gradient} shadow-sm`}>
      <div className="flex items-start justify-between">
        <div className="rounded-xl bg-white/20 p-2.5 backdrop-blur-sm">
          {icon}
        </div>
        {trend === "up" && <ArrowUpRight className="h-4 w-4 text-white/70" />}
      </div>
      <div className="mt-4">
        <p className="text-2xl font-bold text-white tracking-tight">
          {value !== undefined && value !== null ? value : <span className="text-white/50">—</span>}
        </p>
        <p className="text-sm font-medium text-white/80 mt-0.5">{label}</p>
        {subtext && <p className="text-xs text-white/60 mt-0.5">{subtext}</p>}
      </div>
      {/* Decorative circle */}
      <div className="pointer-events-none absolute -bottom-4 -right-4 h-24 w-24 rounded-full bg-white/10" />
    </div>
  );
}

// ── Avatar initials ───────────────────────────────────────────
function Avatar({ name }: { name: string }) {
  const initials = (name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const hue = name.charCodeAt(0) * 7 % 360;
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white shadow-sm"
      style={{ background: `hsl(${hue},55%,45%)` }}
    >
      {initials}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────
export default function TeamOverviewTab({ onActionsClick }: { onActionsClick: () => void }) {
  const { data: overviewRes, isLoading: overviewLoading } = useQuery({
    queryKey: ["management", "team-overview"],
    queryFn: () => hrmsApi.get<any>("/api/management/team-overview"),
    staleTime: 5 * 60_000,
  });

  const { data: membersRes, isLoading: membersLoading } = useQuery({
    queryKey: ["management", "team-members"],
    queryFn: () => hrmsApi.get<any>("/api/management/team-members"),
    staleTime: 5 * 60_000,
  });

  const { data: alertsRes } = useQuery({
    queryKey: ["management", "alerts", "unack"],
    queryFn: () => hrmsApi.get<any>("/api/management/alerts?acknowledged=false"),
    staleTime: 2 * 60_000,
  });

  const ov = (overviewRes as any)?.data as TeamOverview | undefined;
  const members = ((membersRes as any)?.data ?? []) as TeamMember[];
  const alerts = ((alertsRes as any)?.data ?? []) as Alert[];

  const utilizationPct = ov?.utilization_pct ?? 0;
  const utilizationStatus = utilizationPct >= 90 ? "text-emerald-400" : utilizationPct >= 75 ? "text-amber-400" : "text-rose-400";

  return (
    <div className="space-y-6">
      {/* Alert banner */}
      {alerts.length > 0 && (
        <button
          type="button"
          onClick={onActionsClick}
          className="w-full flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 hover:bg-amber-100 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong>{alerts.length} unacknowledged alert{alerts.length !== 1 ? "s" : ""}</strong> need your attention
          </span>
          <ChevronRight className="h-4 w-4 ml-auto text-amber-500" />
        </button>
      )}

      {/* KPI tiles */}
      {overviewLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="Team Size"
            value={ov?.headcount}
            subtext="Active members"
            icon={<Users className="h-5 w-5 text-white" />}
            gradient="bg-gradient-to-br from-indigo-500 to-indigo-700"
            trend="neutral"
          />
          <StatTile
            label="Utilization"
            value={ov?.utilization_pct != null ? `${ov.utilization_pct}%` : undefined}
            subtext="Attendance rate"
            icon={<Activity className="h-5 w-5 text-white" />}
            gradient={
              utilizationPct >= 90
                ? "bg-gradient-to-br from-emerald-500 to-emerald-700"
                : utilizationPct >= 75
                ? "bg-gradient-to-br from-amber-500 to-amber-700"
                : "bg-gradient-to-br from-rose-500 to-rose-700"
            }
            trend="up"
          />
          <StatTile
            label="Avg KPI Score"
            value={ov?.avg_quality_score != null ? `${ov.avg_quality_score}` : undefined}
            subtext="Team average"
            icon={<TrendingUp className="h-5 w-5 text-white" />}
            gradient="bg-gradient-to-br from-violet-500 to-violet-700"
            trend="up"
          />
          <StatTile
            label="Monthly Cost"
            value={ov?.monthly_cost != null ? `₹${(ov.monthly_cost / 100_000).toFixed(1)}L` : undefined}
            subtext="Last payroll run"
            icon={<IndianRupee className="h-5 w-5 text-white" />}
            gradient="bg-gradient-to-br from-slate-600 to-slate-800"
            trend="neutral"
          />
        </div>
      )}

      {/* Team members grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">
            Team Members
            {members.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-100 px-1.5 text-xs font-bold text-indigo-700">
                {members.length}
              </span>
            )}
          </h3>
        </div>

        {membersLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-[68px] rounded-2xl" />)}
          </div>
        ) : members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <Users className="mx-auto h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No direct reports found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {members.map((m) => (
              <Link
                key={m.id}
                to={`/employees/${m.id}`}
                className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <Avatar name={m.full_name ?? "?"} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate group-hover:text-indigo-700 transition-colors">
                    {m.full_name}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{m.employee_code}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-400 transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
