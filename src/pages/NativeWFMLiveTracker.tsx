import { useEffect, useMemo, useRef, useState } from "react";
import {
  Coffee, LogOut, Plus, RefreshCcw, Search,
  UserCheck, Users, Activity,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

type AnyRow = Record<string, any>;

const today = () => new Date().toISOString().slice(0, 10);

const fmtTime = (value?: string) => {
  if (!value) return "–";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
};

function Stat({ title, value, sub, icon, tone }: {
  title: string; value: string | number; sub?: string; icon: React.ReactNode; tone: string;
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-500">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const s = status || "Rostered";
  const cls =
    s === "On Break"   ? "bg-amber-50 text-amber-700"   :
    s === "Logged In"  ? "bg-emerald-50 text-emerald-700" :
    s === "Logged Out" ? "bg-slate-100 text-slate-700"   :
    s === "Absent"     ? "bg-rose-50 text-rose-700"      :
                         "bg-blue-50 text-blue-700";
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${cls}`}>{s}</span>;
}

function uniq(values: string[]) {
  return ["All", ...Array.from(new Set(values.filter(Boolean))).sort()];
}

export default function NativeWFMLiveTracker() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [liveData, setLiveData] = useState<{
    date: string;
    sessions: AnyRow[];
    summary: {
      total: number; logged_in: number; logged_out: number;
      absent: number; overall_adherence_pct: number;
    };
  } | null>(null);

  // SSE live summary (overrides liveData.summary when connected)
  const [sseSummary, setSseSummary] = useState<{
    rostered: number | null; logged_in: number | null;
    logged_out: number | null; absent: number | null;
    adherence_pct: number | null;
  } | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const sseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [employees, setEmployees] = useState<AnyRow[]>([]);

  const [search, setSearch] = useState("");
  const [processFilter, setProcessFilter] = useState("All");
  const [branchFilter, setBranchFilter] = useState("All");

  const [assignForm, setAssignForm] = useState({
    employeeId: "", shiftStartTime: "09:00", shiftEndTime: "18:00",
    processName: "", branchName: "",
  });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [liveRes, firstPage] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: any }>(`/api/wfm/live?date=${date}`),
        hrmsApi.get<{ success: boolean; data: AnyRow[]; total?: number }>("/api/employees?limit=200&page=1"),
      ]);
      const allEmployees = [...(firstPage.data ?? [])];
      const pages = Math.ceil(Number(firstPage.total ?? allEmployees.length) / 200);
      for (let page = 2; page <= pages; page += 1) {
        const next = await hrmsApi.get<{ success: boolean; data: AnyRow[] }>(
          `/api/employees?limit=200&page=${page}`
        );
        allEmployees.push(...(next.data ?? []));
      }
      setLiveData(liveRes.data);
      setEmployees(allEmployees);
    } catch (err: any) {
      setMessage(err.message || "Unable to load WFM live tracker.");
    } finally {
      setLoading(false);
    }
  };

  // Load detail table whenever date or user changes
  useEffect(() => { void load(); }, [date, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SSE live summary with polling fallback ─────────────────────────────────
  // EventSource sends the session cookie automatically via withCredentials.
  useEffect(() => {
    setSseSummary(null);

    const url = `/api/rta/live-stream?date=${date}`;
    let es: EventSource | null = null;

    const startPollingFallback = () => {
      setSseConnected(false);
      if (sseTimerRef.current) return;
      sseTimerRef.current = setInterval(() => void load(), 30_000);
    };

    try {
      es = new EventSource(url, { withCredentials: true });

      es.onopen = () => {
        setSseConnected(true);
        if (sseTimerRef.current) {
          clearInterval(sseTimerRef.current);
          sseTimerRef.current = null;
        }
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!data.error) {
            setSseSummary({
              rostered:     data.rostered     ?? null,
              logged_in:    data.logged_in    ?? null,
              logged_out:   data.logged_out   ?? null,
              absent:       data.absent       ?? null,
              adherence_pct: data.adherence_pct ?? null,
            });
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        es?.close();
        setSseConnected(false);
        startPollingFallback();
      };
    } catch {
      startPollingFallback();
    }

    return () => {
      es?.close();
      if (sseTimerRef.current) {
        clearInterval(sseTimerRef.current);
        sseTimerRef.current = null;
      }
      setSseConnected(false);
    };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessions: AnyRow[] = liveData?.sessions ?? [];
  const baseSummary = liveData?.summary ?? {
    total: 0, logged_in: 0, logged_out: 0, absent: 0, overall_adherence_pct: 0,
  };
  // SSE values override the REST summary when available
  const summary = {
    total:                sseSummary?.rostered      ?? baseSummary.total,
    logged_in:            sseSummary?.logged_in     ?? baseSummary.logged_in,
    logged_out:           sseSummary?.logged_out    ?? baseSummary.logged_out,
    absent:               sseSummary?.absent        ?? baseSummary.absent,
    overall_adherence_pct: sseSummary?.adherence_pct ?? baseSummary.overall_adherence_pct,
  };

  const processOptions = useMemo(() => uniq(sessions.map((s) => s.process_name ?? "")), [sessions]);
  const branchOptions  = useMemo(() => uniq(sessions.map((s) => s.branch_name  ?? "")), [sessions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      const text = [s.employee_code, s.employee_name, s.current_status, s.process_name, s.branch_name]
        .join(" ").toLowerCase();
      return (
        (!q || text.includes(q)) &&
        (processFilter === "All" || s.process_name === processFilter) &&
        (branchFilter  === "All" || s.branch_name  === branchFilter)
      );
    });
  }, [sessions, search, processFilter, branchFilter]);

  const logBreak = async (s: AnyRow) => {
    if (!s.login_time) return setMessage("Login required before break.");
    const sessionId = s.session_id ?? s.id;
    try {
      await hrmsApi.post("/api/wfm/sessions/break", { sessionId, breakType: "Break" });
      setMessage("Break logged."); await load();
    } catch (err: any) { setMessage(err.message || "Break log failed."); }
  };

  const assignRoster = async () => {
    if (!assignForm.employeeId) return setMessage("Select an employee.");
    try {
      await hrmsApi.post("/api/wfm/roster/assignments", {
        employeeId: assignForm.employeeId,
        rosterDate: date,
        shiftStartTime: assignForm.shiftStartTime,
        shiftEndTime: assignForm.shiftEndTime,
        processName: assignForm.processName || null,
        branchName: assignForm.branchName  || null,
      });
      setMessage("Employee added to roster.");
      setAssignForm({ employeeId: "", shiftStartTime: "09:00", shiftEndTime: "18:00", processName: "", branchName: "" });
      await load();
    } catch (err: any) { setMessage(err.message || "Roster assignment failed."); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Native WFM</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Live Shift & Break Tracker</h1>
            <p className="mt-2 max-w-5xl text-slate-600">
              Real-time attendance from MySQL backend — break logging, adherence tracking.
            </p>
          </div>
          <button
            disabled={loading}
            onClick={load}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300 cursor-pointer hover:bg-slate-800 transition-colors"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {message && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            {message}
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-5">
          <Stat title="Total Rostered" value={summary.total}           sub="scoped view"    icon={<Users     className="h-5 w-5" />} tone="bg-slate-100 text-slate-700"   />
          <Stat title="On Shift"       value={summary.logged_in}       sub="logged in"      icon={<UserCheck className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
          <Stat title="Absent"         value={summary.absent}          sub="not clocked in" icon={<Users     className="h-5 w-5" />} tone="bg-rose-50 text-rose-700"      />
          <Stat title="Completed"      value={summary.logged_out}      sub="shift ended"    icon={<LogOut    className="h-5 w-5" />} tone="bg-slate-100 text-slate-700"   />
          <Stat title="Adherence %"    value={`${summary.overall_adherence_pct}%`} sub="avg vs required" icon={<Activity className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" />
        </div>

        {/* Filters */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr_180px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employee, status, process…"
                className="h-12 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400"
              />
            </label>
            <select value={processFilter} onChange={(e) => setProcessFilter(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3">
              {processOptions.map((x) => <option key={x}>{x}</option>)}
            </select>
            <select value={branchFilter}  onChange={(e) => setBranchFilter(e.target.value)}  className="rounded-2xl border bg-slate-50 px-4 py-3">
              {branchOptions.map((x)  => <option key={x}>{x}</option>)}
            </select>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3" />
          </div>
        </div>

        {/* Add to Roster */}
        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <h2 className="font-black text-slate-950">Add to Roster</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto]">
            <select
              value={assignForm.employeeId}
              onChange={(e) => setAssignForm({ ...assignForm, employeeId: e.target.value })}
              className="rounded-2xl border px-4 py-3"
            >
              <option value="">Select employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_code} · {e.first_name} {e.last_name ?? ""}
                </option>
              ))}
            </select>
            <input type="time" value={assignForm.shiftStartTime} onChange={(e) => setAssignForm({ ...assignForm, shiftStartTime: e.target.value })} className="rounded-2xl border px-4 py-3" />
            <input type="time" value={assignForm.shiftEndTime}   onChange={(e) => setAssignForm({ ...assignForm, shiftEndTime:   e.target.value })} className="rounded-2xl border px-4 py-3" />
            <input value={assignForm.processName} onChange={(e) => setAssignForm({ ...assignForm, processName: e.target.value })} placeholder="Process" className="rounded-2xl border px-4 py-3" />
            <input value={assignForm.branchName}  onChange={(e) => setAssignForm({ ...assignForm, branchName:  e.target.value })} placeholder="Branch"  className="rounded-2xl border px-4 py-3" />
            <button
              onClick={assignRoster}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 font-bold text-white cursor-pointer hover:bg-slate-800 transition-colors"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>

        {/* Live Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Live Roster Register</h2>
            <p className="text-sm text-slate-500">
              {filtered.length} of {sessions.length} employees · {date}
            </p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-4">Employee</th>
                    <th className="p-4">Branch / Process</th>
                    <th className="p-4">Shift</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Login</th>
                    <th className="p-4">Logout</th>
                    <th className="p-4">Adherence</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        No roster entries for {date}. Add employees above or upload a roster CSV.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((s) => (
                      <tr key={s.employee_id} className="border-t hover:bg-slate-50 transition-colors">
                        <td className="p-4">
                          <div className="font-bold">{s.employee_name}</div>
                          <div className="text-xs text-slate-500">{s.employee_code}</div>
                        </td>
                        <td className="p-4">
                          <div>{s.branch_name || "–"}</div>
                          <div className="text-xs text-slate-500">{s.process_name || "–"}</div>
                        </td>
                        <td className="p-4">
                          <div>{s.shift_start_time || "–"}</div>
                          <div className="text-xs text-slate-500">→ {s.shift_end_time || "–"}</div>
                        </td>
                        <td className="p-4"><StatusBadge status={s.current_status} /></td>
                        <td className="p-4">{fmtTime(s.login_time)}</td>
                        <td className="p-4">{fmtTime(s.logout_time)}</td>
                        <td className="p-4">
                          <span className={
                            (s.adherence_pct ?? 0) >= 90 ? "font-black text-emerald-700" :
                            (s.adherence_pct ?? 0) >= 70 ? "font-bold text-amber-600"   :
                                                            "font-bold text-rose-600"
                          }>
                            {s.adherence_pct ?? 0}%
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => logBreak(s)}
                              disabled={!s.login_time || !!s.logout_time}
                              className="cursor-pointer rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed hover:bg-amber-700 transition-colors"
                            >
                              <Coffee className="inline h-3 w-3 mr-1" />Break
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
