import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ──────────────────────────────────────────────────────────────────────

type QueueStatus = "waiting" | "called" | "in_interview" | "completed" | "no_show";

interface QueueEntry {
  id: string;
  token_number: string;
  candidate_id: string;
  candidate_name: string;
  mobile: string;
  email: string | null;
  applied_role: string | null;
  branch_name: string;
  branch_display_name: string | null;
  queue_status: QueueStatus;
  recruiter_id: string | null;
  recruiter_name: string;
  recruiter_employee_code: string;
  created_at: string;
  called_at: string | null;
  interview_started_at: string | null;
  interview_completed_at: string | null;
  position_in_queue: number;
}

interface Branch {
  id: string;
  branch_name: string;
  display_name?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<QueueStatus, string> = {
  waiting:      "bg-amber-50 text-amber-700 border-amber-200",
  called:       "bg-blue-50 text-blue-700 border-blue-200",
  in_interview: "bg-purple-50 text-purple-700 border-purple-200",
  completed:    "bg-emerald-50 text-emerald-700 border-emerald-200",
  no_show:      "bg-red-50 text-red-700 border-red-200",
};

const STATUS_LABEL: Record<QueueStatus, string> = {
  waiting:      "Waiting",
  called:       "Called",
  in_interview: "In Interview",
  completed:    "Completed",
  no_show:      "No Show",
};

const TOKEN_CHIP_BG: Record<QueueStatus, string> = {
  waiting:      "bg-amber-100 text-amber-800",
  called:       "bg-blue-100 text-blue-800",
  in_interview: "bg-purple-100 text-purple-800",
  completed:    "bg-emerald-100 text-emerald-800",
  no_show:      "bg-red-100 text-red-800",
};

const ALL_STATUSES: QueueStatus[] = ["waiting", "called", "in_interview", "completed", "no_show"];

function formatTime(iso: string): string {
  return formatISTTime(iso);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeWalkinQueue() {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [actionLoading, setActionLoading] = useState("");

  // Filters
  const [dateFilter, setDateFilter] = useState(today());
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const buildUrl = () => {
    const params = new URLSearchParams({ date: dateFilter });
    if (branchFilter) params.set("branch", branchFilter);
    if (statusFilter) params.set("status", statusFilter);
    return `/api/ats/queue/live?${params.toString()}`;
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: QueueEntry[] }>(buildUrl());
      setEntries(res.data ?? []);
    } catch (err: unknown) {
      if (!silent) setMessage(err instanceof Error ? err.message : "Failed to load queue");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadBranches = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Branch[] }>(
        "/api/org/branches?active=1"
      );
      setBranches(res.data ?? []);
    } catch {
      // branches are optional for filter
    }
  };

  useEffect(() => {
    void load();
  }, [dateFilter, branchFilter, statusFilter]);

  useEffect(() => {
    void loadBranches();
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => void load(true), 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [dateFilter, branchFilter, statusFilter]);

  // ── Stats ────────────────────────────────────────────────────────────────────

  const stats = {
    waiting:      entries.filter((e) => e.queue_status === "waiting").length,
    called:       entries.filter((e) => e.queue_status === "called").length,
    in_interview: entries.filter((e) => e.queue_status === "in_interview").length,
    completed:    entries.filter((e) => e.queue_status === "completed").length,
    no_show:      entries.filter((e) => e.queue_status === "no_show").length,
  };

  // ── Actions ──────────────────────────────────────────────────────────────────

  const callNext = async () => {
    const nextWaiting = entries.find((e) => e.queue_status === "waiting");
    if (!nextWaiting) return;
    setActionLoading(`call-${nextWaiting.id}`);
    try {
      await hrmsApi.post("/api/ats/queue/call-next", { queue_id: nextWaiting.id });
      await load(true);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to call candidate");
    } finally {
      setActionLoading("");
    }
  };

  const updateStatus = async (id: string, status: QueueStatus) => {
    setActionLoading(id);
    try {
      await hrmsApi.post("/api/ats/queue/update-status", { queue_id: id, status });
      await load(true);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setActionLoading("");
    }
  };

  const markNoShow = async (id: string) => {
    setActionLoading(id);
    try {
      await hrmsApi.post("/api/ats/queue/mark-no-show", { queue_id: id });
      await load(true);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to mark no-show");
    } finally {
      setActionLoading("");
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">ATS</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Walk-in Queue</h1>
            <p className="mt-2 text-slate-600">Reception desk view — manage today's walk-in candidates in real-time.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-2xl border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm"
            />
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="rounded-2xl border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm"
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.branch_name}>
                  {b.display_name || b.branch_name}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-2xl border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm"
            >
              <option value="">All Statuses</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            <button
              onClick={() => void load()}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {message && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
            {message}
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-5">
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
              className={`rounded-3xl border p-4 shadow-sm text-left transition-all ${STATUS_STYLES[s]} ${statusFilter === s ? "ring-2 ring-offset-1 ring-slate-400" : ""}`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{STATUS_LABEL[s]}</p>
              <p className="mt-1 text-2xl font-black">{stats[s]}</p>
            </button>
          ))}
        </div>

        {/* Call Next */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => void callNext()}
            disabled={stats.waiting === 0 || actionLoading.startsWith("call-")}
            className="rounded-2xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {actionLoading.startsWith("call-") ? "Calling..." : `Call Next (${stats.waiting} waiting)`}
          </button>
        </div>

        {/* Queue Board */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-bold text-slate-950">Queue Board</h2>
            <p className="text-sm text-slate-500">Auto-refreshes every 30 seconds.</p>
          </div>
          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading queue...</div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <p className="font-semibold">No candidates in queue for the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="p-4">Token</th>
                    <th className="p-4">Candidate</th>
                    <th className="p-4">Role / Branch</th>
                    <th className="p-4">Recruiter</th>
                    <th className="p-4">Arrived</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-t hover:bg-slate-50/60 transition-colors">
                      <td className="p-4">
                        <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-black ${TOKEN_CHIP_BG[e.queue_status]}`}>
                          {e.token_number}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-slate-900">{e.candidate_name}</div>
                        <div className="text-xs text-slate-500">{e.mobile}</div>
                      </td>
                      <td className="p-4">
                        <div className="text-slate-700">{e.applied_role ?? "-"}</div>
                        <div className="text-xs text-slate-400">{e.branch_display_name || e.branch_name}</div>
                      </td>
                      <td className="p-4">
                        <div className="text-slate-700">{e.recruiter_name}</div>
                        <div className="text-xs text-slate-400">{e.recruiter_employee_code !== "N/A" ? e.recruiter_employee_code : ""}</div>
                      </td>
                      <td className="p-4 text-slate-600">{formatTime(e.created_at)}</td>
                      <td className="p-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${STATUS_STYLES[e.queue_status]}`}>
                          {STATUS_LABEL[e.queue_status]}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-2">
                          {e.queue_status === "called" && (
                            <button
                              disabled={actionLoading === e.id}
                              onClick={() => void updateStatus(e.id, "in_interview")}
                              className="rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50"
                            >
                              In Interview
                            </button>
                          )}
                          {(e.queue_status === "in_interview" || e.queue_status === "called") && (
                            <button
                              disabled={actionLoading === e.id}
                              onClick={() => void updateStatus(e.id, "completed")}
                              className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Completed
                            </button>
                          )}
                          {e.queue_status === "waiting" && (
                            <button
                              disabled={actionLoading === e.id}
                              onClick={() => void markNoShow(e.id)}
                              className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
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
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
