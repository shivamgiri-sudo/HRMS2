import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ──────────────────────────────────────────────────────────────────────

type WalkinStatus = "waiting" | "called" | "in_interview" | "completed" | "no_show";

interface WalkinEntry {
  id: string;
  token_number: string;
  candidate_name: string;
  mobile: string;
  email: string | null;
  applied_role: string | null;
  branch_id: string | null;
  process_id: string | null;
  registered_at: string;
  called_at: string | null;
  status: WalkinStatus;
  notes: string | null;
  recruiter_id: string | null;
}

interface Process {
  id: string;
  process_name: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<WalkinStatus, string> = {
  waiting:      "bg-amber-50 text-amber-700 border-amber-200",
  called:       "bg-blue-50 text-blue-700 border-blue-200",
  in_interview: "bg-purple-50 text-purple-700 border-purple-200",
  completed:    "bg-emerald-50 text-emerald-700 border-emerald-200",
  no_show:      "bg-red-50 text-red-700 border-red-200",
};

const STATUS_LABEL: Record<WalkinStatus, string> = {
  waiting:      "Waiting",
  called:       "Called",
  in_interview: "In Interview",
  completed:    "Completed",
  no_show:      "No Show",
};

const TOKEN_CHIP_BG: Record<WalkinStatus, string> = {
  waiting:      "bg-amber-100 text-amber-800",
  called:       "bg-blue-100 text-blue-800",
  in_interview: "bg-purple-100 text-purple-800",
  completed:    "bg-emerald-100 text-emerald-800",
  no_show:      "bg-red-100 text-red-800",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeWalkinQueue() {
  const [entries, setEntries] = useState<WalkinEntry[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [dateFilter, setDateFilter] = useState(today());

  // Registration form state
  const [regName, setRegName] = useState("");
  const [regMobile, setRegMobile] = useState("");
  const [regRole, setRegRole] = useState("");
  const [regProcess, setRegProcess] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState("");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: WalkinEntry[] }>(
        `/api/jobs/walkin?date=${dateFilter}`
      );
      setEntries(res.data ?? []);
    } catch (err: unknown) {
      if (!silent) setMessage(err instanceof Error ? err.message : "Failed to load queue");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadProcesses = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Process[] }>("/api/process");
      setProcesses(res.data ?? []);
    } catch {
      // processes are optional for the form dropdown
    }
  };

  useEffect(() => {
    void load();
    void loadProcesses();
  }, [dateFilter]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => void load(true), 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [dateFilter]);

  // ── Stats ────────────────────────────────────────────────────────────────────

  const stats = {
    waiting:      entries.filter((e) => e.status === "waiting").length,
    called:       entries.filter((e) => e.status === "called").length,
    in_interview: entries.filter((e) => e.status === "in_interview").length,
    completed:    entries.filter((e) => e.status === "completed").length,
    no_show:      entries.filter((e) => e.status === "no_show").length,
  };

  // ── Actions ──────────────────────────────────────────────────────────────────

  const callNext = async () => {
    const nextWaiting = entries.find((e) => e.status === "waiting");
    if (!nextWaiting) return;
    setActionLoading(`call-${nextWaiting.id}`);
    try {
      await hrmsApi.patch(`/api/jobs/walkin/${nextWaiting.id}/call`, {});
      await load(true);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to call candidate");
    } finally {
      setActionLoading("");
    }
  };

  const updateStatus = async (id: string, status: WalkinStatus) => {
    setActionLoading(id);
    try {
      await hrmsApi.patch(`/api/jobs/walkin/${id}/status`, { status });
      await load(true);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setActionLoading("");
    }
  };

  // ── Registration ─────────────────────────────────────────────────────────────

  const registerWalkin = async () => {
    setRegError("");
    if (!regName.trim()) { setRegError("Name is required"); return; }
    if (!regMobile.trim()) { setRegError("Mobile is required"); return; }
    setRegLoading(true);
    try {
      await hrmsApi.post("/api/jobs/walkin", {
        candidate_name: regName.trim(),
        mobile: regMobile.trim(),
        applied_role: regRole.trim() || undefined,
        process_id: regProcess || undefined,
      });
      setRegName(""); setRegMobile(""); setRegRole(""); setRegProcess("");
      await load(true);
    } catch (err: unknown) {
      setRegError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegLoading(false);
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
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-2xl border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm"
            />
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
          {(["waiting", "called", "in_interview", "completed", "no_show"] as WalkinStatus[]).map((s) => (
            <div key={s} className={`rounded-3xl border p-4 shadow-sm ${STATUS_STYLES[s].replace("border-", "border ").replace("bg-", "bg-")}`}>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{STATUS_LABEL[s]}</p>
              <p className="mt-1 text-2xl font-black">{stats[s]}</p>
            </div>
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

        {/* Walk-in Registration Form */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-bold text-slate-950">Walk-in Registration</h2>
            <p className="text-sm text-slate-500">Register a new walk-in candidate directly.</p>
          </div>
          <div className="p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Full Name *</label>
                <input
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="Candidate name"
                  className="w-full rounded-2xl border bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Mobile *</label>
                <input
                  value={regMobile}
                  onChange={(e) => setRegMobile(e.target.value)}
                  placeholder="10-digit mobile"
                  className="w-full rounded-2xl border bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Applied Role</label>
                <input
                  value={regRole}
                  onChange={(e) => setRegRole(e.target.value)}
                  placeholder="e.g. CSE Agent"
                  className="w-full rounded-2xl border bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Process</label>
                <select
                  value={regProcess}
                  onChange={(e) => setRegProcess(e.target.value)}
                  className="w-full rounded-2xl border bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-blue-400"
                >
                  <option value="">-- Select --</option>
                  {processes.map((p) => (
                    <option key={p.id} value={p.id}>{p.process_name}</option>
                  ))}
                </select>
              </div>
            </div>
            {regError && <p className="mt-2 text-sm font-bold text-rose-600">{regError}</p>}
            <button
              onClick={() => void registerWalkin()}
              disabled={regLoading}
              className="mt-4 rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-400"
            >
              {regLoading ? "Registering..." : "Register Walk-in"}
            </button>
          </div>
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
              <p className="font-semibold">No walk-ins registered for this date.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="p-4">Token</th>
                    <th className="p-4">Candidate</th>
                    <th className="p-4">Applied Role</th>
                    <th className="p-4">Registered</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-t hover:bg-slate-50/60 transition-colors">
                      <td className="p-4">
                        <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-black ${TOKEN_CHIP_BG[e.status]}`}>
                          {e.token_number}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-slate-900">{e.candidate_name}</div>
                        <div className="text-xs text-slate-500">{e.mobile}</div>
                      </td>
                      <td className="p-4 text-slate-600">{e.applied_role ?? "-"}</td>
                      <td className="p-4 text-slate-600">{formatTime(e.registered_at)}</td>
                      <td className="p-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${STATUS_STYLES[e.status]}`}>
                          {STATUS_LABEL[e.status]}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-2">
                          {e.status === "called" && (
                            <button
                              disabled={actionLoading === e.id}
                              onClick={() => void updateStatus(e.id, "in_interview")}
                              className="rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50"
                            >
                              In Interview
                            </button>
                          )}
                          {(e.status === "in_interview" || e.status === "called") && (
                            <button
                              disabled={actionLoading === e.id}
                              onClick={() => void updateStatus(e.id, "completed")}
                              className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Completed
                            </button>
                          )}
                          {e.status === "waiting" && (
                            <button
                              disabled={actionLoading === e.id}
                              onClick={() => void updateStatus(e.id, "no_show")}
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
