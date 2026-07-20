import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Users, Clock, UserCheck, UserX, Search, Filter,
  RefreshCw, Phone, TrendingUp, AlertCircle
} from "lucide-react";
import { formatISTTime } from "@/lib/utils";
import { useUserRole } from "@/hooks/useUserRole";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

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
  average_interview_duration: number;
  avg_wait_time: number;
  avg_interview_duration: number;
}

interface OpsRoundEntry {
  candidate_id: string;
  candidate_code: string;
  candidate_name: string;
  mobile: string;
  current_stage: string;
  applied_role: string | null;
  branch_name: string | null;
  skilltest_typing: number | null;
  skilltest_result: string | null;
  assessment_percentage: number | null;
  typing_net_wpm: number | null;
  typing_accuracy: number | null;
  arrived_at: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<QueueStatus, string> = {
  waiting: "bg-amber-50 text-amber-700 border-amber-200",
  called: "bg-blue-50 text-blue-700 border-blue-200",
  in_interview: "bg-purple-50 text-purple-700 border-purple-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  no_show: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-gray-50 text-gray-700 border-gray-200",
};

const STATUS_LABEL: Record<QueueStatus, string> = {
  waiting: "Waiting",
  called: "Called",
  in_interview: "In Interview",
  completed: "Completed",
  no_show: "No Show",
  cancelled: "Cancelled",
};

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  return formatISTTime(iso);
}

function formatWaitTime(minutes: number | null): string {
  if (!minutes) return "-";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
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
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split('T')[0]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ops round tab
  const { data: roleData } = useUserRole();
  const roleKeys = roleData?.roleKeys ?? [];
  const isOpsManager = roleKeys.includes('operations_manager');
  const isRecruiterOrHR = roleKeys.some(r => ['admin', 'hr', 'super_admin', 'recruiter', 'manager'].includes(r));

  const [activeTab, setActiveTab] = useState<'queue' | 'ops_round'>(
    isOpsManager && !isRecruiterOrHR ? 'ops_round' : 'queue'
  );
  const [opsDate, setOpsDate] = useState<string>('');
  const queryClient = useQueryClient();

  const opsRoundQuery = useQuery({
    queryKey: ['ops-round-queue', opsDate],
    queryFn: async () => {
      const params = opsDate ? `?date=${opsDate}` : '';
      const resp = await hrmsApi.get<{ success: boolean; data: OpsRoundEntry[] }>(
        `/api/ats/queue/ops-round${params}`
      );
      return resp.data.data ?? [];
    },
    enabled: activeTab === 'ops_round',
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // ── Load Data ──────────────────────────────────────────────────────────────────

  const loadQueue = async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");

    try {
      // Build query params
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
        '/api/ats/queue/metrics'
      );
      setMetrics(res.data);
    } catch (err: any) {
      console.error("Failed to load metrics:", err);
    }
  };

  useEffect(() => {
    loadQueue();
    loadMetrics();

    // Auto-refresh every 5 seconds
    intervalRef.current = setInterval(() => {
      loadQueue(true);
      loadMetrics();
    }, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [statusFilter, branchFilter, searchQuery, dateFilter]);

  // ── Actions ────────────────────────────────────────────────────────────────────

  const handleCallNext = async (tokenId: string) => {
    try {
      await hrmsApi.post('/api/ats/queue/call-next', { queue_id: tokenId });
      await loadQueue(true);
    } catch (err: any) {
      alert(err.message || "Failed to call candidate");
    }
  };

  const handleMarkNoShow = async (tokenId: string) => {
    try {
      await hrmsApi.post('/api/ats/queue/mark-no-show', { queue_id: tokenId });
      await loadQueue(true);
    } catch (err: any) {
      alert(err.message || "Failed to mark no-show");
    }
  };

  const handleUpdateStatus = async (tokenId: string, status: QueueStatus) => {
    try {
      await hrmsApi.post('/api/ats/queue/update-status', {
        queue_id: tokenId,
        status,
      });
      await loadQueue(true);
    } catch (err: any) {
      alert(err.message || "Failed to update status");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────────

  const branches = Array.from(new Set(tokens.map(t => t.branch_display_name || t.branch_name))).filter(Boolean);

  if (loading && !tokens.length) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'queue' | 'ops_round')}>
        <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
          <TabsList className="h-8">
            {isRecruiterOrHR && <TabsTrigger value="queue" className="text-xs">Live Queue</TabsTrigger>}
            <TabsTrigger value="ops_round" className="text-xs">Ops Round</TabsTrigger>
          </TabsList>
          {activeTab === 'ops_round' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={opsDate}
                onChange={e => setOpsDate(e.target.value)}
                className="h-7 rounded border px-2 text-xs"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void queryClient.invalidateQueries({ queryKey: ['ops-round-queue'] })}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Refresh
              </Button>
            </div>
          )}
        </div>

        {isRecruiterOrHR && (
          <TabsContent value="queue" className="mt-0">
            <div className="p-6 space-y-6">
              {/* Header */}
              <div>
                <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                  <Users className="w-4 h-4" />
                  <span>ATS / Queue Management</span>
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Live Walk-in Queue</h1>
                <p className="text-sm text-gray-600 mt-1">
                  Real-time tracking of candidate walk-ins and interviews
                </p>
              </div>

              {/* Metrics Cards */}
              {metrics && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">In Queue</span>
                      <Users className="w-5 h-5 text-amber-500" />
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{metrics.total_waiting}</p>
                    <p className="text-xs text-gray-500 mt-1">Waiting for interview</p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">In Progress</span>
                      <Clock className="w-5 h-5 text-purple-500" />
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{metrics.total_in_interview}</p>
                    <p className="text-xs text-gray-500 mt-1">Currently interviewing</p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">Completed</span>
                      <UserCheck className="w-5 h-5 text-green-500" />
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{metrics.total_completed_today}</p>
                    <p className="text-xs text-gray-500 mt-1">Today's interviews</p>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">Avg Wait</span>
                      <TrendingUp className="w-5 h-5 text-blue-500" />
                    </div>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatWaitTime(metrics.average_wait_time)}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Average wait time</p>
                  </div>
                </div>
              )}

              {/* Filters */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                    <input
                      type="date"
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as QueueStatus | "all")}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Status</option>
                      <option value="waiting">Waiting</option>
                      <option value="called">Called</option>
                      <option value="in_interview">In Interview</option>
                      <option value="completed">Completed</option>
                      <option value="no_show">No Show</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
                    <select
                      value={branchFilter}
                      onChange={(e) => setBranchFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All Branches</option>
                      {branches.map(branch => (
                        <option key={branch} value={branch}>{branch}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Name or token..."
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Queue Table */}
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          Token
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          Candidate
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          Role
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          Branch
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          Wait Time
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          Typing
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          Assessment
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          Recruiter
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {tokens.map((token) => (
                        <tr key={token.id} className="hover:bg-gray-50">
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              {token.position_in_queue && (
                                <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold">
                                  {token.position_in_queue}
                                </span>
                              )}
                              <span className="font-mono text-sm font-medium text-gray-900">
                                {token.token_number}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {token.candidate_name}
                              </p>
                              <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                                <Phone className="w-3 h-3" />
                                {token.mobile}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-900">
                            {token.applied_role}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-600">
                            {token.branch_display_name || token.branch_name}
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded border ${STATUS_STYLES[token.queue_status] || STATUS_STYLES.waiting}`}>
                              {STATUS_LABEL[token.queue_status] || token.queue_status}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-600">
                            {formatWaitTime(token.estimated_wait_time)}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-700">
                            {(() => {
                              const wpm = token.typing_net_wpm ?? token.skilltest_typing;
                              return wpm != null ? (
                                <span className="font-medium">{Number(wpm).toFixed(0)} WPM</span>
                              ) : <span className="text-gray-400">—</span>;
                            })()}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-700">
                            {(() => {
                              const pct = token.assessment_percentage ?? token.skilltest_ai;
                              const result = token.skilltest_result;
                              if (pct == null) return <span className="text-gray-400">—</span>;
                              const isPass = result?.toLowerCase() === 'pass';
                              const isFail = result?.toLowerCase() === 'fail' || result?.toLowerCase() === 'rejected';
                              return (
                                <span className="flex items-center gap-1">
                                  <span className="font-medium">{Number(pct).toFixed(1)}%</span>
                                  {result && (
                                    <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded ${isPass ? 'bg-emerald-100 text-emerald-700' : isFail ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                      {result}
                                    </span>
                                  )}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-600">
                            {token.recruiter_name || "-"}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              {token.queue_status === "waiting" && (
                                <button
                                  onClick={() => handleCallNext(token.id)}
                                  className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
                                >
                                  Call
                                </button>
                              )}
                              {token.queue_status === "called" && (
                                <button
                                  onClick={() => handleUpdateStatus(token.id, "in_interview")}
                                  className="px-3 py-1 bg-purple-600 text-white text-xs font-medium rounded hover:bg-purple-700 transition-colors"
                                >
                                  Start
                                </button>
                              )}
                              {(token.queue_status === "waiting" || token.queue_status === "called") && (
                                <button
                                  onClick={() => handleMarkNoShow(token.id)}
                                  className="px-3 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 transition-colors"
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
                    <div className="p-8 text-center">
                      <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                      <p className="text-gray-600 font-medium">No candidates in queue</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Queue will appear here when candidates register
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Auto-refresh indicator */}
              <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                <RefreshCw className="w-4 h-4" />
                <span>Auto-refreshing every 5 seconds</span>
              </div>
            </div>
          </TabsContent>
        )}

        <TabsContent value="ops_round" className="mt-0 p-4">
          {opsRoundQuery.isLoading && (
            <div className="flex items-center justify-center py-12 text-sm text-slate-500">Loading...</div>
          )}
          {opsRoundQuery.isError && (
            <div className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              Failed to load ops round candidates.
            </div>
          )}
          {!opsRoundQuery.isLoading && !opsRoundQuery.isError && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-slate-500">
                    <th className="pb-2 text-left font-medium">Candidate</th>
                    <th className="pb-2 text-left font-medium">Applied Role</th>
                    <th className="pb-2 text-left font-medium">Branch</th>
                    <th className="pb-2 text-left font-medium">Assessment</th>
                    <th className="pb-2 text-left font-medium">Typing</th>
                    <th className="pb-2 text-left font-medium">R1 Result</th>
                    <th className="pb-2 text-left font-medium">Stage</th>
                    <th className="pb-2 text-left font-medium">Arrived</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(opsRoundQuery.data ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                        No candidates at Ops Round stage{opsDate ? ` on ${opsDate}` : ' today'}.
                      </td>
                    </tr>
                  ) : (
                    (opsRoundQuery.data ?? []).map((c) => (
                      <tr key={c.candidate_id} className="h-10">
                        <td className="pr-4">
                          <p className="font-medium text-slate-900">{c.candidate_name}</p>
                          <p className="text-xs text-slate-400">{c.candidate_code}</p>
                        </td>
                        <td className="pr-4 text-slate-700">{c.applied_role ?? '—'}</td>
                        <td className="pr-4 text-slate-700">{c.branch_name ?? '—'}</td>
                        <td className="pr-4">
                          {c.assessment_percentage != null ? (
                            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${c.skilltest_result?.toLowerCase() === 'selected' || (c.assessment_percentage >= 60) ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                              {c.assessment_percentage.toFixed(1)}%
                            </span>
                          ) : c.skilltest_typing != null ? (
                            <span className="text-slate-500 text-xs">{c.skilltest_typing}</span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="pr-4">
                          {c.typing_net_wpm != null ? (
                            <div>
                              <span className="font-medium text-slate-800">{Math.round(c.typing_net_wpm)} WPM</span>
                              {c.typing_accuracy != null && (
                                <p className="text-xs text-slate-400">{c.typing_accuracy.toFixed(1)}% acc</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="pr-4">
                          {c.skilltest_result ? (
                            <Badge variant="outline" className="text-xs">{c.skilltest_result}</Badge>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="pr-4">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{c.current_stage}</span>
                        </td>
                        <td className="text-xs text-slate-500">
                          {c.arrived_at ? formatISTTime(c.arrived_at) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
