import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Users, Clock, UserCheck, Search,
  RefreshCw, Phone, TrendingUp, AlertCircle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type QueueStatus = "waiting" | "called" | "in_interview" | "completed" | "no_show" | "cancelled";

interface QueueToken {
  id: string;
  token_number: string;
  candidate_id: string;
  candidate_name: string;
  mobile: string;
  applied_role: string;
  branch_name: string;
  branch_display_name: string | null;
  queue_status: QueueStatus;
  position_in_queue: number | null;
  called_at: string | null;
  interview_started_at: string | null;
  interview_completed_at: string | null;
  estimated_wait_time: number | null;
  recruiter_id: string | null;
  recruiter_name: string | null;
  created_at: string;
  skilltest_typing?: number | null;
  skilltest_ai?: number | null;
  skilltest_result?: string | null;
  assessment_percentage?: number | null;
  typing_net_wpm?: number | null;
  typing_accuracy?: number | null;
}

interface QueueMetrics {
  total_waiting: number;
  total_in_interview: number;
  total_completed_today: number;
  average_wait_time: number;
  avg_wait_time: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<QueueStatus, string> = {
  waiting:      "bg-amber-50 text-amber-700 border-amber-200",
  called:       "bg-blue-50 text-blue-700 border-blue-200",
  in_interview: "bg-purple-50 text-purple-700 border-purple-200",
  completed:    "bg-emerald-50 text-emerald-700 border-emerald-200",
  no_show:      "bg-red-50 text-red-700 border-red-200",
  cancelled:    "bg-gray-50 text-gray-700 border-gray-200",
};

const STATUS_LABEL: Record<QueueStatus, string> = {
  waiting:      "Waiting",
  called:       "Called",
  in_interview: "In Interview",
  completed:    "Completed",
  no_show:      "No Show",
  cancelled:    "Cancelled",
};

// Left border accent per status
const STATUS_BORDER: Record<QueueStatus, string> = {
  waiting:      "border-l-amber-400",
  called:       "border-l-blue-400",
  in_interview: "border-l-purple-400",
  completed:    "border-l-emerald-400",
  no_show:      "border-l-red-400",
  cancelled:    "border-l-gray-300",
};

// Pill quick-filter config
const STATUS_PILLS: Array<{ value: QueueStatus | "all"; label: string; activeClass: string }> = [
  { value: "all",          label: "All",          activeClass: "bg-gray-800 text-white border-gray-800" },
  { value: "waiting",      label: "Waiting",      activeClass: "bg-amber-500 text-white border-amber-500" },
  { value: "called",       label: "Called",       activeClass: "bg-blue-500 text-white border-blue-500" },
  { value: "in_interview", label: "In Interview", activeClass: "bg-purple-500 text-white border-purple-500" },
  { value: "completed",    label: "Completed",    activeClass: "bg-emerald-500 text-white border-emerald-500" },
  { value: "no_show",      label: "No Show",      activeClass: "bg-red-500 text-white border-red-500" },
  { value: "cancelled",    label: "Cancelled",    activeClass: "bg-gray-500 text-white border-gray-500" },
];

function formatWaitTime(minutes: number | null): string {
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeWalkinQueueEnhanced() {
  const [tokens, setTokens] = useState<QueueToken[]>([]);
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState<QueueStatus | "all">("all");
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState(() => {
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().slice(0, 10);
  });

  const [allBranches, setAllBranches] = useState<string[]>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load Data ──────────────────────────────────────────────────────────────────

  const loadQueue = async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (branchFilter) params.append("branch", branchFilter);
      if (searchQuery) params.append("search", searchQuery);
      params.append("date", dateFilter);
      const res = await hrmsApi.get<{ success: boolean; data: QueueToken[] }>(
        `/api/ats/queue/live?${params.toString()}`
      );
      setTokens(res.data || []);
    } catch (err: any) {
      if (!silent) setError(err.message || "Failed to load queue");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadMetrics = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: QueueMetrics }>(
        "/api/ats/queue/metrics"
      );
      setMetrics(res.data);
    } catch (err: any) {
      console.error("Failed to load metrics:", err);
    }
  };

  useEffect(() => {
    hrmsApi.get<{ success: boolean; data: Array<{ branch_name?: string; name?: string }> }>("/api/org/branches")
      .then(res => {
        const names = (res.data || [])
          .map(b => b.branch_name || b.name || "")
          .filter(Boolean)
          .sort();
        setAllBranches(names);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadQueue();
    loadMetrics();

    intervalRef.current = setInterval(() => {
      loadQueue(true);
      loadMetrics();
    }, 5000);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [statusFilter, branchFilter, searchQuery, dateFilter]);

  // ── Actions ────────────────────────────────────────────────────────────────────

  const handleCallNext = async (tokenId: string) => {
    try {
      await hrmsApi.post("/api/ats/queue/call-next", { queue_id: tokenId });
      await loadQueue(true);
    } catch (err: any) {
      alert(err.message || "Failed to call candidate");
    }
  };

  const handleMarkNoShow = async (tokenId: string) => {
    try {
      await hrmsApi.post("/api/ats/queue/mark-no-show", { queue_id: tokenId });
      await loadQueue(true);
    } catch (err: any) {
      alert(err.message || "Failed to mark no-show");
    }
  };

  const handleUpdateStatus = async (tokenId: string, status: QueueStatus) => {
    try {
      await hrmsApi.post("/api/ats/queue/update-status", { queue_id: tokenId, status });
      await loadQueue(true);
    } catch (err: any) {
      alert(err.message || "Failed to update status");
    }
  };

  // ── Derived counts for pill quick-filters ──────────────────────────────────────

  const countByStatus = (status: QueueStatus | "all") =>
    status === "all" ? tokens.length : tokens.filter(t => t.queue_status === status).length;

  if (loading && !tokens.length) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col bg-gray-50" style={{ height: "calc(100vh - 64px)" }}>

        {/* ── Top Section ─────────────────────────────────────────────────────── */}
        <div className="bg-white border-b px-4 pt-2.5 pb-2 shrink-0 space-y-2">

          {/* Row 1: Title + metrics chips + auto-refresh — full width */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Title */}
            <div className="shrink-0">
              <p className="text-[10px] text-gray-400 flex items-center gap-1 leading-none mb-0.5">
                <Users className="w-3 h-3" />
                ATS / Queue Management
              </p>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Live Walk-in Queue</h1>
            </div>

            {/* Separator */}
            <div className="w-px h-8 bg-gray-200 shrink-0" />

            {/* Metric chips — flex-1 so they fill available space */}
            <div className="flex items-center gap-2 flex-1 flex-wrap min-w-0">
              {metrics ? (
                <>
                  <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 text-amber-700 font-medium text-[11px] whitespace-nowrap">
                    <Users className="w-3 h-3" />
                    <span>{metrics.total_waiting} In Queue</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-purple-50 border border-purple-200 rounded-full px-2.5 py-1 text-purple-700 font-medium text-[11px] whitespace-nowrap">
                    <Clock className="w-3 h-3" />
                    <span>{metrics.total_in_interview} In Progress</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 text-emerald-700 font-medium text-[11px] whitespace-nowrap">
                    <UserCheck className="w-3 h-3" />
                    <span>{metrics.total_completed_today} Completed</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 text-blue-700 font-medium text-[11px] whitespace-nowrap">
                    <TrendingUp className="w-3 h-3" />
                    <span>Avg Wait {formatWaitTime(metrics.average_wait_time || metrics.avg_wait_time)}</span>
                  </div>
                </>
              ) : (
                <span className="text-xs text-gray-400">Loading metrics…</span>
              )}
            </div>

            {/* Separator */}
            <div className="w-px h-8 bg-gray-200 shrink-0" />

            {/* Auto-refresh indicator */}
            <div className="flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
              <RefreshCw className="w-3 h-3" />
              <span>Auto 5s</span>
            </div>
          </div>

          {/* Row 2: Status pill quick-filters */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUS_PILLS.map(pill => {
              const count = countByStatus(pill.value);
              const isActive = statusFilter === pill.value;
              return (
                <button
                  key={pill.value}
                  onClick={() => setStatusFilter(pill.value)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                    isActive
                      ? pill.activeClass
                      : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {pill.label}
                  <span className={`${isActive ? "bg-white/25" : "bg-gray-100 text-gray-500"} rounded-full px-1.5 py-0 text-[10px] font-bold`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Row 3: Secondary filters + result count */}
          <div className="flex items-center gap-2 flex-wrap pb-0.5">
            <input
              type="date"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="h-7 rounded border border-gray-300 px-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              className="h-7 rounded border border-gray-300 px-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">All Branches</option>
              {allBranches.map(branch => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Name or token..."
                className="h-7 pl-7 pr-3 rounded border border-gray-300 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none w-40"
              />
            </div>
            {/* Result count badge */}
            <span className="ml-auto text-[11px] text-gray-400 font-medium whitespace-nowrap">
              {tokens.length} candidate{tokens.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* ── Scrollable Table ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto p-3">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
              <table className="w-full text-sm min-w-max">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Token</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Candidate</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Role</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Branch</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Status</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Wait</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Typing</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Assessment</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Recruiter</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tokens.map((token) => (
                    <tr
                      key={token.id}
                      className={`hover:bg-gray-50 transition-colors border-l-[3px] ${STATUS_BORDER[token.queue_status] || "border-l-gray-200"}`}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {token.position_in_queue && (
                            <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0">
                              {token.position_in_queue}
                            </span>
                          )}
                          <span className="font-mono text-sm font-medium text-gray-900">
                            {token.token_number}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-sm font-medium text-gray-900 whitespace-nowrap">{token.candidate_name}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3" />
                          {token.mobile}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-sm text-gray-700 whitespace-nowrap">{token.applied_role}</td>
                      <td className="px-3 py-2.5 text-sm text-gray-600 whitespace-nowrap">
                        {token.branch_display_name || token.branch_name}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border whitespace-nowrap ${STATUS_STYLES[token.queue_status] || STATUS_STYLES.waiting}`}>
                          {STATUS_LABEL[token.queue_status] || token.queue_status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-sm text-gray-600 whitespace-nowrap">
                        {formatWaitTime(token.estimated_wait_time)}
                      </td>
                      <td className="px-3 py-2.5 text-sm whitespace-nowrap">
                        {(() => {
                          const wpm = token.typing_net_wpm != null
                            ? token.typing_net_wpm
                            : (token.skilltest_typing != null ? token.skilltest_typing : null);
                          const acc = token.typing_accuracy;
                          if (wpm == null) return <span className="text-gray-400">—</span>;
                          return (
                            <div className="flex flex-col leading-tight">
                              <span className={`font-semibold ${Number(wpm) >= 25 ? "text-emerald-600" : Number(wpm) > 0 ? "text-amber-600" : "text-rose-500"}`}>
                                {Number(wpm).toFixed(0)} WPM
                              </span>
                              {acc != null && (
                                <span className="text-xs text-gray-500">{Number(acc).toFixed(0)}% acc</span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2.5 text-sm whitespace-nowrap">
                        {(() => {
                          const pct = token.assessment_percentage ?? token.skilltest_ai;
                          const result = token.skilltest_result;
                          if (pct == null) return <span className="text-gray-400">—</span>;
                          const isPass = result?.toLowerCase() === "pass";
                          const isFail = result?.toLowerCase() === "fail" || result?.toLowerCase() === "rejected";
                          return (
                            <span className="flex items-center gap-1">
                              <span className="font-medium text-gray-800">{Number(pct).toFixed(1)}%</span>
                              {result && (
                                <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded ${isPass ? "bg-emerald-100 text-emerald-700" : isFail ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                                  {result}
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-gray-600 whitespace-nowrap">
                        {token.recruiter_name || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {token.queue_status === "waiting" && (
                            <button
                              onClick={() => handleCallNext(token.id)}
                              className="px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors whitespace-nowrap"
                            >
                              Call
                            </button>
                          )}
                          {token.queue_status === "called" && (
                            <button
                              onClick={() => handleUpdateStatus(token.id, "in_interview")}
                              className="px-2.5 py-1 bg-purple-600 text-white text-xs font-medium rounded hover:bg-purple-700 transition-colors whitespace-nowrap"
                            >
                              Start
                            </button>
                          )}
                          {token.queue_status === "in_interview" && (
                            <button
                              onClick={() => handleUpdateStatus(token.id, "completed")}
                              className="px-2.5 py-1 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 transition-colors whitespace-nowrap"
                            >
                              Complete
                            </button>
                          )}
                          {(token.queue_status === "waiting" || token.queue_status === "called") && (
                            <button
                              onClick={() => handleMarkNoShow(token.id)}
                              className="px-2.5 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 transition-colors whitespace-nowrap"
                            >
                              No Show
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {tokens.length === 0 && (
                <div className="py-16 text-center">
                  <AlertCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-600 font-medium text-sm">No candidates in queue</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Queue will appear here when candidates register
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
