import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Users, Clock, UserCheck, Search,
  RefreshCw, Phone, TrendingUp, AlertCircle, Target, X,
} from "lucide-react";
import { formatISTTime } from "@/lib/utils";

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
}

interface QueueMetrics {
  total_waiting: number;
  total_in_interview: number;
  total_completed_today: number;
  average_wait_time: number;
  avg_wait_time: number;
}

interface OpenRequisition {
  id: string;
  requisition_code: string;
  designation_name: string;
  process_name: string | null;
  requested_headcount: number;
  open_positions: number;
  planned_batch_name: string | null;
  planned_batch_no: string | null;
}

const ACTIVE_DRIVE_KEY = "hrms_active_drive_requisition";

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

  // Active drive context — persisted in localStorage
  const [activeDrive, setActiveDrive] = useState<OpenRequisition | null>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_DRIVE_KEY);
      return saved ? (JSON.parse(saved) as OpenRequisition) : null;
    } catch {
      return null;
    }
  });
  const [openRequisitions, setOpenRequisitions] = useState<OpenRequisition[]>([]);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

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
    loadQueue();
    loadMetrics();
    loadOpenRequisitions(branchFilter || undefined);

    intervalRef.current = setInterval(() => {
      loadQueue(true);
      loadMetrics();
    }, 5000);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [statusFilter, branchFilter, searchQuery, dateFilter]);

  // ── Actions ────────────────────────────────────────────────────────────────────

  const loadOpenRequisitions = async (branch?: string) => {
    try {
      const path = branch
        ? `/api/job-requisition/open-for-branch/${encodeURIComponent(branch)}`
        : "/api/job-requisition?approval_status=approved&limit=50";
      const res = await hrmsApi.get<{ success: boolean; data: OpenRequisition[] }>(path);
      setOpenRequisitions(res.data || []);
    } catch {
      setOpenRequisitions([]);
    }
  };

  const selectDrive = (req: OpenRequisition) => {
    setActiveDrive(req);
    localStorage.setItem(ACTIVE_DRIVE_KEY, JSON.stringify(req));
    setShowDrivePicker(false);
  };

  const clearDrive = () => {
    setActiveDrive(null);
    localStorage.removeItem(ACTIVE_DRIVE_KEY);
    setShowDrivePicker(false);
  };

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

  // ── Derived ────────────────────────────────────────────────────────────────────

  const branches = Array.from(
    new Set(tokens.map(t => t.branch_display_name || t.branch_name))
  ).filter(Boolean);

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
      {/* Drive Picker Modal */}
      {showDrivePicker && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Select Today's Hiring Drive</h3>
              <button onClick={() => setShowDrivePicker(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
              {openRequisitions.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No approved active requisitions found.</p>
              ) : (
                openRequisitions.map((req) => (
                  <button
                    key={req.id}
                    onClick={() => selectDrive(req)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border hover:border-blue-400 hover:bg-blue-50 transition-colors ${activeDrive?.id === req.id ? "border-emerald-400 bg-emerald-50" : "border-gray-200"}`}
                  >
                    <div className="font-medium text-sm text-gray-900">{req.designation_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {req.requisition_code}
                      {req.process_name && ` | ${req.process_name}`}
                      {req.planned_batch_name && ` | Batch: ${req.planned_batch_name}`}
                      <span className="ml-1 text-blue-600">{req.open_positions} open</span>
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="p-4 border-t flex justify-between">
              {activeDrive && (
                <button onClick={clearDrive} className="text-sm text-red-500 hover:text-red-700">
                  Clear drive selection
                </button>
              )}
              <button
                onClick={() => setShowDrivePicker(false)}
                className="ml-auto px-4 py-2 text-sm border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page layout: compact top bar, then sticky-header table */}
      <div className="flex flex-col bg-gray-50" style={{ height: "calc(100vh - 64px)" }}>

        {/* ── Top Section ─────────────────────────────────────────────────────── */}
        <div className="bg-white border-b px-4 pt-3 pb-2 shrink-0 space-y-2">

          {/* Row 1: Title + Drive selector */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs text-gray-500 flex items-center gap-1 mb-0.5">
                <Users className="w-3.5 h-3.5" />
                ATS / Queue Management
              </p>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">Live Walk-in Queue</h1>
            </div>

            {/* Drive selector — compact inline */}
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${activeDrive ? "bg-emerald-50 border-emerald-300" : "bg-gray-50 border-gray-200"}`}>
              <Target className={`w-4 h-4 shrink-0 ${activeDrive ? "text-emerald-600" : "text-gray-400"}`} />
              {activeDrive ? (
                <span className="text-emerald-800 font-medium max-w-xs truncate text-xs">
                  {activeDrive.requisition_code} — {activeDrive.designation_name}
                  {activeDrive.process_name && ` | ${activeDrive.process_name}`}
                  <span className="ml-1.5 font-normal text-emerald-600">({activeDrive.open_positions} open)</span>
                </span>
              ) : (
                <span className="text-gray-500 text-xs">No drive selected</span>
              )}
              <button
                onClick={() => { void loadOpenRequisitions(branchFilter || undefined); setShowDrivePicker(true); }}
                className="px-2.5 py-1 text-xs font-medium rounded border bg-white hover:bg-gray-50 border-gray-200 whitespace-nowrap"
              >
                {activeDrive ? "Change" : "Select Drive"}
              </button>
              {activeDrive && (
                <button onClick={clearDrive} className="p-0.5 text-gray-400 hover:text-red-500">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Row 2: Metrics chips */}
          {metrics && (
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 text-amber-700 font-medium">
                <Users className="w-3.5 h-3.5" />
                <span>{metrics.total_waiting} In Queue</span>
              </div>
              <div className="flex items-center gap-1.5 bg-purple-50 border border-purple-200 rounded-full px-3 py-1 text-purple-700 font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>{metrics.total_in_interview} In Progress</span>
              </div>
              <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 text-emerald-700 font-medium">
                <UserCheck className="w-3.5 h-3.5" />
                <span>{metrics.total_completed_today} Completed</span>
              </div>
              <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 text-blue-700 font-medium">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Avg Wait {formatWaitTime(metrics.average_wait_time || metrics.avg_wait_time)}</span>
              </div>
              <div className="ml-auto flex items-center gap-1 text-gray-400">
                <RefreshCw className="w-3 h-3" />
                <span>Auto-refresh 5s</span>
              </div>
            </div>
          )}

          {/* Row 3: Filters */}
          <div className="flex items-center gap-2 flex-wrap pb-1">
            <input
              type="date"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="h-8 rounded border border-gray-300 px-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as QueueStatus | "all")}
              className="h-8 rounded border border-gray-300 px-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="waiting">Waiting</option>
              <option value="called">Called</option>
              <option value="in_interview">In Interview</option>
              <option value="completed">Completed</option>
              <option value="no_show">No Show</option>
            </select>
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              className="h-8 rounded border border-gray-300 px-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">All Branches</option>
              {branches.map(branch => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Name or token..."
                className="h-8 pl-8 pr-3 rounded border border-gray-300 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none w-48"
              />
            </div>
          </div>
        </div>

        {/* ── Scrollable Table ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto p-4">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
              <table className="w-full text-sm min-w-max">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Token</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Candidate</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Branch</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Wait</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Typing</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Assessment</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Recruiter</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tokens.map((token) => (
                    <tr key={token.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900 whitespace-nowrap">{token.candidate_name}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3" />
                          {token.mobile}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{token.applied_role}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {token.branch_display_name || token.branch_name}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border whitespace-nowrap ${STATUS_STYLES[token.queue_status] || STATUS_STYLES.waiting}`}>
                          {STATUS_LABEL[token.queue_status] || token.queue_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {formatWaitTime(token.estimated_wait_time)}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        {(() => {
                          const wpm =
                            (token.typing_net_wpm != null && Number(token.typing_net_wpm) > 0)
                              ? token.typing_net_wpm
                              : (token.skilltest_typing != null && Number(token.skilltest_typing) > 0)
                                ? token.skilltest_typing
                                : null;
                          return wpm != null
                            ? <span className="font-medium text-gray-800">{Number(wpm).toFixed(0)} WPM</span>
                            : <span className="text-gray-400">—</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
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
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {token.recruiter_name || "—"}
                      </td>
                      <td className="px-4 py-3">
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
