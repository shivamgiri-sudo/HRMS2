import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  BookOpen,
  CheckCircle2,
  Loader,
  RefreshCcw,
  ShieldAlert,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaderboardEntry {
  rank: number;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  department: string;
  kpi_score: number;
  kpi_template: string;
  period: string;
}

interface Alert {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  alert_type: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
  is_acknowledged: boolean;
  created_at: string;
}

interface CoachingSession {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  coach_name: string;
  session_type: string;
  session_date: string;
  status: "scheduled" | "completed" | "cancelled" | "pending";
  notes: string | null;
}

type Period = "monthly" | "quarterly" | "yearly";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCORE_COLOR = (score: number): string => {
  if (score >= 90) return "text-emerald-600";
  if (score >= 75) return "text-amber-600";
  return "text-red-600";
};

const SCORE_BG = (score: number): string => {
  if (score >= 90) return "bg-emerald-50 text-emerald-700";
  if (score >= 75) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
};

const SEVERITY_COLORS: Record<Alert["severity"], string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high:     "bg-orange-50 text-orange-700 border-orange-200",
  medium:   "bg-amber-50 text-amber-700 border-amber-200",
  low:      "bg-slate-50 text-slate-700 border-slate-200",
  info:     "bg-blue-50 text-blue-700 border-blue-200",
};

const SESSION_STATUS_COLORS: Record<string, string> = {
  scheduled:  "bg-blue-50 text-blue-700",
  completed:  "bg-emerald-50 text-emerald-700",
  cancelled:  "bg-slate-100 text-slate-500",
  pending:    "bg-amber-50 text-amber-700",
};

const RANK_ICONS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function StatCard({
  title,
  value,
  sub,
  icon,
  tone,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
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

function SessionStatusBadge({ status }: { status: string }) {
  const cls = SESSION_STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${cls}`}>
      {status}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NativeQualityDashboard() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [coaching, setCoaching] = useState<CoachingSession[]>([]);
  const [period, setPeriod] = useState<Period>("monthly");
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  // ─── Loaders ────────────────────────────────────────────────────────────────

  const loadAll = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [lbRes, alertsRes, coachRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: LeaderboardEntry[] }>(
          `/api/kpi/leaderboard?period=${period}&family=quality`
        ),
        hrmsApi.get<{ success: boolean; data: Alert[] }>("/api/management/alerts"),
        hrmsApi.get<{ success: boolean; data: CoachingSession[] }>(
          "/api/management/coaching"
        ),
      ]);
      setLeaderboard(lbRes.data ?? []);
      setAlerts(alertsRes.data ?? []);
      setCoaching(coachRes.data ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load Quality Dashboard data";
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [period]);

  // ─── Derived ────────────────────────────────────────────────────────────────

  const qualityAlerts = alerts.filter(
    (a) => a.severity === "critical" || a.severity === "high"
  );
  const unacknowledgedAlerts = qualityAlerts.filter((a) => !a.is_acknowledged);

  const qualityCoaching = coaching.filter(
    (s) => s.session_type === "quality"
  );

  const thisMonth = new Date().toISOString().slice(0, 7);
  const coachingThisMonth = qualityCoaching.filter(
    (s) => s.session_date?.startsWith(thisMonth)
  ).length;

  const totalTracked = leaderboard.length;
  const avgScore =
    totalTracked > 0
      ? Math.round(
          (leaderboard.reduce((sum, e) => sum + (e.kpi_score || 0), 0) / totalTracked) * 10
        ) / 10
      : 0;

  const acknowledgeAlert = async (id: string) => {
    setAcknowledgingId(id);
    try {
      await hrmsApi.post(`/api/management/alerts/${id}/acknowledge`, {});
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, is_acknowledged: true } : a))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Acknowledge failed";
      setMessage(msg);
    } finally {
      setAcknowledgingId(null);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
              Quality Command Center
            </p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Quality Dashboard</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              KPI-based quality indicators, performance alerts, and coaching session tracking.
            </p>
          </div>
          <button
            onClick={() => void loadAll()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {/* Phase Banner */}
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <span>
            <strong>Note:</strong> Full QA audit integration (Call Master / quality scoring) is in
            Phase 7. This dashboard shows KPI-based quality indicators.
          </span>
        </div>

        {/* Error Banner */}
        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Stat Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            title="Active Employees Tracked"
            value={totalTracked}
            icon={<Users className="h-5 w-5" />}
            tone="bg-slate-100 text-slate-700"
          />
          <StatCard
            title="Avg KPI Score"
            value={`${avgScore}%`}
            sub="across all tracked employees"
            icon={<Target className="h-5 w-5" />}
            tone="bg-emerald-50 text-emerald-700"
          />
          <StatCard
            title="Open Alerts"
            value={unacknowledgedAlerts.length}
            sub="critical &amp; high severity"
            icon={<Bell className="h-5 w-5" />}
            tone={unacknowledgedAlerts.length > 0 ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"}
          />
          <StatCard
            title="Coaching Sessions"
            value={coachingThisMonth}
            sub="quality sessions this month"
            icon={<BookOpen className="h-5 w-5" />}
            tone="bg-violet-50 text-violet-700"
          />
        </div>

        {/* KPI Leaderboard */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div>
              <h2 className="flex items-center gap-2 font-black text-slate-950">
                <Trophy className="h-5 w-5 text-amber-500" />
                KPI Leaderboard
              </h2>
              <p className="text-sm text-slate-500">Ranked by KPI score</p>
            </div>
            <div className="flex gap-1.5">
              {(["monthly", "quarterly", "yearly"] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                    period === p
                      ? "bg-slate-950 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="py-16 text-center">
              <Trophy className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="font-semibold text-slate-400">No leaderboard data for this period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Rank", "Employee", "Department", "KPI Template", "Score"].map((h) => (
                      <th key={h} className="p-4 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry) => (
                    <tr
                      key={entry.employee_id}
                      className="border-t hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="p-4">
                        <span className="text-lg">
                          {RANK_ICONS[entry.rank] ?? (
                            <span className="font-bold text-slate-500">#{entry.rank}</span>
                          )}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-slate-950">{entry.employee_name}</div>
                        <div className="font-mono text-xs text-slate-400">
                          {entry.employee_code}
                        </div>
                      </td>
                      <td className="p-4 text-slate-600">{entry.department || "–"}</td>
                      <td className="p-4 text-slate-500">{entry.kpi_template || "–"}</td>
                      <td className="p-4">
                        <span
                          className={`inline-block rounded-full px-3 py-1 text-sm font-black ${SCORE_BG(entry.kpi_score)}`}
                        >
                          {entry.kpi_score}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quality Alerts */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b p-5">
            <div>
              <h2 className="flex items-center gap-2 font-black text-slate-950">
                <ShieldAlert className="h-5 w-5 text-red-500" />
                Quality Alerts
              </h2>
              <p className="text-sm text-slate-500">
                Critical and high severity alerts · {unacknowledgedAlerts.length} unacknowledged
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : qualityAlerts.length === 0 ? (
            <div className="py-14 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-300" />
              <p className="font-semibold text-slate-400">No critical or high alerts. All clear.</p>
            </div>
          ) : (
            <div className="divide-y">
              {qualityAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-start gap-4 px-5 py-4 transition-opacity ${
                    alert.is_acknowledged ? "opacity-50" : ""
                  }`}
                >
                  <div
                    className={`mt-0.5 flex-shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${
                      SEVERITY_COLORS[alert.severity]
                    }`}
                  >
                    {alert.severity}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-bold text-slate-950">{alert.employee_name}</span>
                      <span className="font-mono text-xs text-slate-400">
                        {alert.employee_code}
                      </span>
                      <span className="text-xs text-slate-500 capitalize">
                        · {alert.alert_type?.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{alert.message}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {alert.created_at?.slice(0, 16).replace("T", " ")}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    {alert.is_acknowledged ? (
                      <span className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">
                        <BellOff className="h-3.5 w-3.5" />
                        Acknowledged
                      </span>
                    ) : (
                      <button
                        onClick={() => void acknowledgeAlert(alert.id)}
                        disabled={acknowledgingId === alert.id}
                        className="cursor-pointer inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                      >
                        {acknowledgingId === alert.id ? (
                          <Loader className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Bell className="h-3.5 w-3.5" />
                        )}
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Coaching Sessions */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="flex items-center gap-2 font-black text-slate-950">
              <BookOpen className="h-5 w-5 text-violet-500" />
              Quality Coaching Sessions
            </h2>
            <p className="text-sm text-slate-500">
              Sessions filtered by session_type: quality · {qualityCoaching.length} total
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : qualityCoaching.length === 0 ? (
            <div className="py-14 text-center">
              <BookOpen className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="font-semibold text-slate-400">No quality coaching sessions found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Employee", "Coach", "Session Date", "Status", "Notes"].map((h) => (
                      <th key={h} className="p-4 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {qualityCoaching.map((session) => (
                    <tr
                      key={session.id}
                      className="border-t hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="p-4">
                        <div className="font-bold text-slate-950">{session.employee_name}</div>
                        <div className="font-mono text-xs text-slate-400">
                          {session.employee_code}
                        </div>
                      </td>
                      <td className="p-4 text-slate-700">{session.coach_name || "–"}</td>
                      <td className="p-4 font-mono text-xs text-slate-500">
                        {session.session_date?.slice(0, 10) || "–"}
                      </td>
                      <td className="p-4">
                        <SessionStatusBadge status={session.status} />
                      </td>
                      <td className="p-4 max-w-xs">
                        <p className="truncate text-slate-500">{session.notes || "–"}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
