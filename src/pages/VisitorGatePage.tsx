import { useEffect, useRef, useState } from "react";
import {
  Building2, Calendar, CheckCircle2, Clock, LogIn, LogOut,
  RefreshCw, Search, ShieldCheck, X,
} from "lucide-react";

type Branch = { id: string; branch_name: string };
type GateVisit = {
  id: string;
  visit_number: string;
  visitor_name: string;
  company_name: string | null;
  host_display_name: string | null;
  visit_type: string | null;
  purpose: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: "approved" | "checked_in" | "checked_out";
  checked_in_at: string | null;
  checked_out_at: string | null;
};

type ActionState = {
  visitId: string;
  type: "check_in" | "check_out";
  gateCode: string;
  badgeNumber: string;
  loading: boolean;
  error: string;
};

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_BADGE: Record<GateVisit["status"], string> = {
  approved:    "bg-blue-100 text-blue-700",
  checked_in:  "bg-green-100 text-green-700",
  checked_out: "bg-gray-100 text-gray-500",
};

const STATUS_LABEL: Record<GateVisit["status"], string> = {
  approved:    "Expected",
  checked_in:  "Inside",
  checked_out: "Exited",
};

export default function VisitorGatePage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [visits, setVisits] = useState<GateVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "approved" | "checked_in" | "checked_out">("all");
  const [action, setAction] = useState<ActionState | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [clock, setClock] = useState(new Date());
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load branches once
  useEffect(() => {
    fetch("/api/visitor/public/branches")
      .then(r => r.json())
      .then((j: { success: boolean; data: Branch[] }) => {
        if (j.success) setBranches(j.data);
      })
      .catch(() => {});
  }, []);

  const fetchVisits = async (bid: string, d: string) => {
    if (!bid) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/visitor/public/gate/visits?branch_id=${encodeURIComponent(bid)}&date=${d}`);
      const j = await r.json() as { success: boolean; data: GateVisit[] };
      if (j.success) setVisits(j.data);
    } finally {
      setLoading(false);
    }
  };

  // Fetch on branch/date change
  useEffect(() => {
    if (!branchId) { setVisits([]); return; }
    void fetchVisits(branchId, date);
  }, [branchId, date]);

  // Auto-refresh every 60s
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (!branchId) return;
    refreshTimer.current = setInterval(() => { void fetchVisits(branchId, date); }, 60_000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [branchId, date]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const submitAction = async () => {
    if (!action) return;
    if (!action.gateCode.trim()) {
      setAction(a => a ? { ...a, error: "Gate code is required" } : null);
      return;
    }
    setAction(a => a ? { ...a, loading: true, error: "" } : null);
    const url = action.type === "check_in"
      ? "/api/visitor/public/gate/check-in"
      : "/api/visitor/public/gate/check-out";
    const body: Record<string, string> = {
      visit_id: action.visitId,
      gate_code: action.gateCode.trim(),
    };
    if (action.type === "check_in" && action.badgeNumber.trim()) {
      body.badge_number = action.badgeNumber.trim();
    }
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json() as { success: boolean; message?: string };
      if (!j.success) throw new Error(j.message ?? "Failed");
      showToast(action.type === "check_in" ? "Visitor checked in ✓" : "Visitor checked out ✓", true);
      setAction(null);
      await fetchVisits(branchId, date);
    } catch (err) {
      setAction(a => a ? { ...a, loading: false, error: err instanceof Error ? err.message : "Error" } : null);
    }
  };

  const filtered = visits.filter(v => {
    if (tab !== "all" && v.status !== tab) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        v.visit_number.toLowerCase().includes(q) ||
        v.visitor_name.toLowerCase().includes(q) ||
        (v.company_name ?? "").toLowerCase().includes(q) ||
        (v.host_display_name ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const counts = {
    all: visits.length,
    approved: visits.filter(v => v.status === "approved").length,
    checked_in: visits.filter(v => v.status === "checked_in").length,
    checked_out: visits.filter(v => v.status === "checked_out").length,
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-blue-400" />
          <div>
            <div className="font-bold text-lg leading-tight">MAS Callnet — Visitor Gate Console</div>
            <div className="text-xs text-slate-400">Guard access · No login required</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-300 text-sm font-mono">
          <Clock className="w-4 h-4" />
          {clock.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}
        </div>
      </header>

      <div className="flex-1 p-4 md:p-6 space-y-4 max-w-7xl mx-auto w-full">
        {/* Filters */}
        <div className="bg-white rounded-xl border shadow-sm p-4 flex flex-col md:flex-row gap-3 items-start md:items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1"><Building2 className="w-3 h-3" /> Branch</label>
            <select
              value={branchId}
              onChange={e => setBranchId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select branch —</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.branch_name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1"><Calendar className="w-3 h-3" /> Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1"><Search className="w-3 h-3" /> Search</label>
            <input
              type="text"
              placeholder="Visitor, visit number, company, host…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => { void fetchVisits(branchId, date); }}
            disabled={!branchId || loading}
            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Tabs */}
        {branchId && (
          <div className="flex gap-2 flex-wrap">
            {(["all", "approved", "checked_in", "checked_out"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  tab === t
                    ? "bg-slate-800 text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {t === "all" ? "All" : STATUS_LABEL[t as GateVisit["status"]]}
                <span className="ml-1.5 opacity-70">{counts[t]}</span>
              </button>
            ))}
          </div>
        )}

        {/* Table */}
        {!branchId ? (
          <div className="bg-white rounded-xl border shadow-sm p-12 text-center text-gray-400">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Select a branch to view today's visitor list</p>
          </div>
        ) : loading && visits.length === 0 ? (
          <div className="bg-white rounded-xl border shadow-sm p-12 text-center text-gray-400">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin opacity-40" />
            <p className="text-sm">Loading visitors…</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Visit #</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Visitor</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Host</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Purpose</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Scheduled</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Checked In</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Checked Out</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">
                        No visitors found for this date and filter.
                      </td>
                    </tr>
                  ) : filtered.map(v => (
                    <>
                      <tr
                        key={v.id}
                        className={`${
                          v.status === "checked_in" ? "bg-green-50/40 hover:bg-green-50" :
                          v.status === "approved" ? "hover:bg-blue-50/30" : "hover:bg-gray-50"
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{v.visit_number}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{v.visitor_name}</div>
                          {v.company_name && <div className="text-xs text-gray-400">{v.company_name}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{v.host_display_name ?? "—"}</td>
                        <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate" title={v.purpose ?? undefined}>
                          {v.purpose ?? v.visit_type ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">
                          {fmt(v.scheduled_start)}
                          {v.scheduled_end && <span className="text-gray-300"> – {fmt(v.scheduled_end)}</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[v.status]}`}>
                            {STATUS_LABEL[v.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">{fmt(v.checked_in_at)}</td>
                        <td className="px-4 py-3 text-center text-gray-500 whitespace-nowrap">{fmt(v.checked_out_at)}</td>
                        <td className="px-4 py-3 text-center">
                          {v.status === "approved" && (
                            <button
                              onClick={() => setAction({ visitId: v.id, type: "check_in", gateCode: "", badgeNumber: "", loading: false, error: "" })}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                            >
                              <LogIn className="w-3.5 h-3.5" /> Check In
                            </button>
                          )}
                          {v.status === "checked_in" && (
                            <button
                              onClick={() => setAction({ visitId: v.id, type: "check_out", gateCode: "", badgeNumber: "", loading: false, error: "" })}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                            >
                              <LogOut className="w-3.5 h-3.5" /> Check Out
                            </button>
                          )}
                          {v.status === "checked_out" && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-400">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Exited
                            </span>
                          )}
                        </td>
                      </tr>
                      {/* Inline action form */}
                      {action?.visitId === v.id && (
                        <tr key={`${v.id}-action`} className="bg-slate-50 border-t border-slate-200">
                          <td colSpan={9} className="px-6 py-4">
                            <div className="flex flex-wrap items-end gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                  Gate code <span className="text-red-500">*</span>
                                </label>
                                <input
                                  autoFocus
                                  type="text"
                                  placeholder="e.g. MAIN-GATE"
                                  value={action.gateCode}
                                  onChange={e => setAction(a => a ? { ...a, gateCode: e.target.value } : null)}
                                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              {action.type === "check_in" && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 mb-1">Badge number (optional)</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. B-042"
                                    value={action.badgeNumber}
                                    onChange={e => setAction(a => a ? { ...a, badgeNumber: e.target.value } : null)}
                                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                              )}
                              {action.error && (
                                <p className="text-xs text-red-600 self-end pb-1.5">{action.error}</p>
                              )}
                              <button
                                onClick={() => { void submitAction(); }}
                                disabled={action.loading}
                                className={`px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5 ${
                                  action.type === "check_in" ? "bg-orange-500 hover:bg-orange-600" : "bg-green-600 hover:bg-green-700"
                                }`}
                              >
                                {action.loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                                {action.type === "check_in" ? "Confirm Check In" : "Confirm Check Out"}
                              </button>
                              <button
                                onClick={() => setAction(null)}
                                disabled={action.loading}
                                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t text-xs text-gray-400 flex justify-between">
              <span>Showing {filtered.length} of {visits.length} visits · Auto-refreshes every 60s</span>
              <span>{clock.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })}</span>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white z-50 ${toast.ok ? "bg-green-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
