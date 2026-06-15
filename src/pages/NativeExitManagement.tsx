import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Clock, FileText,
  Loader, Plus, RefreshCcw, Search, UserMinus, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type ExitRequest = {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  exit_type: string;
  exit_sub_type: string;
  exit_reason_category?: string;
  resignation_reason?: string;
  last_working_day_proposed?: string;
  last_working_day_confirmed?: string;
  status: string;
  initiated_by: string;
  created_at: string;
};

type Stats = { total: number; pending: number; accepted: number; completed: number };

const STATUS_COLORS: Record<string, string> = {
  draft:            "bg-slate-100 text-slate-700",
  submitted:        "bg-blue-50 text-blue-700",
  manager_review:   "bg-amber-50 text-amber-700",
  hr_review:        "bg-violet-50 text-violet-700",
  admin_review:     "bg-orange-50 text-orange-700",
  accepted:         "bg-emerald-50 text-emerald-700",
  notice_serving:   "bg-cyan-50 text-cyan-700",
  exit_confirmed:   "bg-green-100 text-green-800",
  revoked:          "bg-rose-50 text-rose-700",
  rejected:         "bg-red-50 text-red-700",
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function StatCard({ title, value, icon, tone }: { title: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <div className={`glass-card stat-card rounded-3xl p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

export default function NativeExitManagement() {
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, accepted: 0, completed: 0 });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const [form, setForm] = useState({
    employeeId: "",
    exitType: "voluntary",
    exitSubType: "resignation",
    resignationReason: "",
    lastWorkingDayProposed: "",
  });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [listRes, statsRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: ExitRequest[]; total: number }>(
          `/api/exit?limit=100&page=1${statusFilter !== "all" ? `&status=${statusFilter}` : ""}`
        ),
        hrmsApi.get<{ success: boolean; data: Stats }>("/api/exit/stats"),
      ]);
      setRequests(listRes.data ?? []);
      setStats(statsRes.data ?? { total: 0, pending: 0, accepted: 0, completed: 0 });
    } catch (err: any) {
      setMessage(err?.message || "Unable to load exit requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [statusFilter]);

  const submitRequest = async () => {
    if (!form.employeeId.trim()) return setMessage("Employee ID is required.");
    try {
      await hrmsApi.post("/api/exit", {
        employeeId: form.employeeId.trim(),
        exitType: form.exitType,
        exitSubType: form.exitSubType,
        resignationReason: form.resignationReason || null,
        lastWorkingDayProposed: form.lastWorkingDayProposed || null,
      });
      setShowModal(false);
      setForm({ employeeId: "", exitType: "voluntary", exitSubType: "resignation", resignationReason: "", lastWorkingDayProposed: "" });
      setMessage("Exit request submitted.");
      await load();
    } catch (err: any) { setMessage(err?.message || "Submission failed."); }
  };

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    try {
      await hrmsApi.patch(`/api/exit/${id}/status`, { status, remarks: `Status changed to ${status}` });
      setMessage(`Updated to ${status.replace(/_/g, " ")}.`);
      await load();
    } catch (err: any) { setMessage(err?.message || "Update failed."); }
    finally { setUpdating(null); }
  };

  const STATUSES = ["all", "submitted", "manager_review", "hr_review", "accepted", "notice_serving", "exit_confirmed", "revoked", "rejected"];

  const filtered = requests.filter((r) => {
    const q = search.trim().toLowerCase();
    const text = [r.employee_id, r.employee_name, r.employee_code, r.exit_type, r.exit_sub_type, r.status].join(" ").toLowerCase();
    return (!q || text.includes(q));
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">HR Operations</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Exit Management</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Manage voluntary resignations, involuntary exits, notice periods, and clearance workflows.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              New Exit Request
            </button>
          </div>
        </div>

        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="Total Exits" value={stats.total} icon={<UserMinus className="h-5 w-5" />} tone="bg-slate-100 text-slate-700" />
          <StatCard title="Pending Review" value={stats.pending} icon={<Clock className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" />
          <StatCard title="Accepted / Active" value={stats.accepted} icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
          <StatCard title="Completed Exits" value={stats.completed} icon={<FileText className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
        </div>

        {/* Filters */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee, type, status…"
                className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors cursor-pointer ${
                    statusFilter === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Exit Requests</h2>
            <p className="text-sm text-slate-500">{filtered.length} records</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <UserMinus className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">No exit requests found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Employee", "Type", "Sub-type", "Proposed LWD", "Status", "Initiated By", "Date", "Actions"].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-slate-50/80 transition-colors cursor-pointer">
                      <td className="p-4">
                        <div className="font-bold text-slate-950">{r.employee_name ?? r.employee_id}</div>
                        <div className="text-xs text-slate-500 font-mono">{r.employee_code ?? r.employee_id.slice(0, 8)}</div>
                      </td>
                      <td className="p-4 capitalize text-slate-700">{r.exit_type}</td>
                      <td className="p-4 text-slate-500 capitalize">{r.exit_sub_type?.replace(/_/g, " ")}</td>
                      <td className="p-4 font-mono text-slate-600">{r.last_working_day_proposed ?? "–"}</td>
                      <td className="p-4"><Badge status={r.status} /></td>
                      <td className="p-4 text-slate-500 capitalize">{r.initiated_by}</td>
                      <td className="p-4 font-mono text-xs text-slate-400">{r.created_at?.slice(0, 10)}</td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1">
                          {r.status === "submitted" && (
                            <button
                              onClick={() => updateStatus(r.id, "manager_review")}
                              disabled={updating === r.id}
                              className="cursor-pointer rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                            >
                              Review
                            </button>
                          )}
                          {r.status === "manager_review" && (
                            <button
                              onClick={() => updateStatus(r.id, "hr_review")}
                              disabled={updating === r.id}
                              className="cursor-pointer rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
                            >
                              HR Review
                            </button>
                          )}
                          {r.status === "hr_review" && (
                            <button
                              onClick={() => updateStatus(r.id, "accepted")}
                              disabled={updating === r.id}
                              className="cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                            >
                              Accept
                            </button>
                          )}
                          {r.status === "accepted" && (
                            <button
                              onClick={() => updateStatus(r.id, "notice_serving")}
                              disabled={updating === r.id}
                              className="cursor-pointer rounded-lg bg-cyan-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-cyan-700 transition-colors disabled:opacity-50"
                            >
                              Notice
                            </button>
                          )}
                          {r.status === "notice_serving" && (
                            <button
                              onClick={() => updateStatus(r.id, "exit_confirmed")}
                              disabled={updating === r.id}
                              className="cursor-pointer rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
                            >
                              Confirm Exit
                            </button>
                          )}
                          {!["exit_confirmed", "revoked", "rejected"].includes(r.status) && (
                            <button
                              onClick={() => updateStatus(r.id, "revoked")}
                              disabled={updating === r.id}
                              className="cursor-pointer rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                            >
                              Revoke
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

      {/* New Exit Request Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">New Exit Request</h2>
              <button onClick={() => setShowModal(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Employee ID / UUID</label>
                <input
                  value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                  placeholder="Enter employee UUID"
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Exit Type</label>
                  <select value={form.exitType} onChange={(e) => setForm({ ...form, exitType: e.target.value })} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400">
                    <option value="voluntary">Voluntary</option>
                    <option value="involuntary">Involuntary</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Sub-type</label>
                  <select value={form.exitSubType} onChange={(e) => setForm({ ...form, exitSubType: e.target.value })} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400">
                    {form.exitType === "voluntary" ? (
                      <>
                        <option value="resignation">Resignation</option>
                        <option value="retirement">Retirement</option>
                        <option value="mutual_separation">Mutual Separation</option>
                      </>
                    ) : (
                      <>
                        <option value="termination">Termination</option>
                        <option value="absconding">Absconding</option>
                        <option value="contract_end">Contract End</option>
                        <option value="abandonment">Abandonment</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Proposed Last Working Day</label>
                <input
                  type="date"
                  value={form.lastWorkingDayProposed}
                  onChange={(e) => setForm({ ...form, lastWorkingDayProposed: e.target.value })}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Reason</label>
                <textarea
                  value={form.resignationReason}
                  onChange={(e) => setForm({ ...form, resignationReason: e.target.value })}
                  placeholder="Brief reason for exit…"
                  rows={3}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitRequest}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
