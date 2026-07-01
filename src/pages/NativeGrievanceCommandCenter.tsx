import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, CheckCircle, Clock, EyeOff, FileText, Loader, Lock, RefreshCcw,
  Shield, ShieldAlert, TrendingUp, UserCheck, Users, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { DashboardLoading, FilterField, KpiTile, SelectFilter } from "@/components/command-center/CommandCenterUi";
import { formatISTDate } from "@/lib/utils";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type GrievanceSummary = {
  id: string;
  grievance_code: string;
  category: string;
  subject: string;
  severity: string;
  status: string;
  is_anonymous: boolean;
  escalation_level: number;
  evidence_count: number;
  confidentiality_level: string;
  anti_retaliation_flag: boolean;
  assigned_to?: string;
  assigned_committee?: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
  employee_id?: string;
};

type GrievanceDetail = GrievanceSummary & {
  description_clean?: string;
  investigation_notes?: string;
  resolution_note?: string;
  employee_name?: string;
  safe_employee_id?: string;
  closed_at?: string;
};

type TimelineEntry = {
  id: string;
  action: string;
  actor?: string;
  note?: string;
  created_at: string;
};

type DashboardStats = {
  total_grievances: number;
  open_grievances: number;
  anonymous_count: number;
  critical_count: number;
  escalated_count: number;
  anti_retaliation_count: number;
  avg_resolution_days: number | null;
};

type AgingBuckets = {
  bucket_0_7d: number;
  bucket_8_30d: number;
  bucket_31_90d: number;
  bucket_over_90d: number;
};

type GrievanceCommandCenterData = {
  stats: DashboardStats;
  category_breakdown: { category: string; total: number; open: number }[];
  severity_breakdown: { severity: string; total: number; open: number }[];
  aging: AgingBuckets;
  cases: GrievanceSummary[];
};

// ─── Severity / status config ─────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<string, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-red-100 text-red-700 border-red-300" },
  high:     { label: "High",     cls: "bg-orange-100 text-orange-700 border-orange-300" },
  medium:   { label: "Medium",   cls: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  low:      { label: "Low",      cls: "bg-gray-100 text-gray-600 border-gray-300" },
};

const STATUS_CONFIG: Record<string, string> = {
  submitted:    "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-700",
  escalated:    "bg-red-100 text-red-600",
  resolved:     "bg-green-100 text-green-700",
  closed:       "bg-gray-100 text-gray-500",
};

// ─── SLA helper ───────────────────────────────────────────────────────────────

function getSlaStatus(due_date?: string, status?: string): "overdue" | "due-soon" | null {
  if (!due_date || status === "closed" || status === "resolved") return null;
  const due = new Date(due_date + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "overdue";
  if (diffDays <= 2) return "due-soon";
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NativeGrievanceCommandCenter() {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [stats, setStats]         = useState<DashboardStats | null>(null);
  const [categories, setCategories] = useState<{ category: string; total: number; open: number }[]>([]);
  const [severities, setSeverities] = useState<{ severity: string; total: number; open: number }[]>([]);
  const [aging, setAging]         = useState<AgingBuckets | null>(null);
  const [grievances, setGrievances] = useState<GrievanceSummary[]>([]);
  const [selected, setSelected]   = useState<GrievanceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [timeline, setTimeline]   = useState<TimelineEntry[]>([]);

  // Action state
  const [noteText, setNoteText]   = useState("");
  const [resNote, setResNote]     = useState("");
  const [assignee, setAssignee]   = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [actionWorking, setActionWorking] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus]     = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams({ from, to });
      if (filterStatus)   p.set("status",   filterStatus);
      if (filterSeverity) p.set("severity", filterSeverity);

      const res = await hrmsApi.get<{ success: boolean; data: GrievanceCommandCenterData }>(
        `/api/helpdesk/grievances/command-center?${p}`
      );

      if (res.data?.success) {
        setStats(res.data.data.stats);
        setCategories(res.data.data.category_breakdown ?? []);
        setSeverities(res.data.data.severity_breakdown ?? []);
        setAging(res.data.data.aging);
        setGrievances(res.data.data.cases ?? []);
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [from, to, filterStatus, filterSeverity]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (g: GrievanceSummary) => {
    setDetailLoading(true);
    setActionMsg("");
    setNoteText("");
    setResNote("");
    setAssignee("");
    setTimeline([]);
    try {
      const [detailRes, timelineRes] = await Promise.allSettled([
        hrmsApi.get<{ data: GrievanceDetail }>(`/api/helpdesk/grievances/${g.id}`),
        hrmsApi.get<{ data: TimelineEntry[] }>(`/api/helpdesk/grievances/${g.id}/timeline`),
      ]);
      if (detailRes.status === "fulfilled") setSelected(detailRes.value.data?.data ?? null);
      if (timelineRes.status === "fulfilled") setTimeline(timelineRes.value.data?.data ?? []);
    } catch (e: any) {
      setActionMsg("Failed to load grievance detail");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDrawer = () => { setSelected(null); setTimeline([]); };

  const doAction = async (action: string, body: Record<string, unknown>) => {
    if (!selected) return;
    setActionWorking(true);
    setActionMsg("");
    try {
      await hrmsApi.post(`/api/helpdesk/grievances/${selected.id}/${action}`, body);
      setActionMsg(`${action} successful`);
      await load();
      const [detailRes, timelineRes] = await Promise.allSettled([
        hrmsApi.get<{ data: GrievanceDetail }>(`/api/helpdesk/grievances/${selected.id}`),
        hrmsApi.get<{ data: TimelineEntry[] }>(`/api/helpdesk/grievances/${selected.id}/timeline`),
      ]);
      if (detailRes.status === "fulfilled") setSelected(detailRes.value.data?.data ?? null);
      if (timelineRes.status === "fulfilled") setTimeline(timelineRes.value.data?.data ?? []);
    } catch (e: any) {
      setActionMsg(e.message ?? `${action} failed`);
    } finally {
      setActionWorking(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">

        {/* Confidentiality banner */}
        <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
          <Lock size={16} className="shrink-0" />
          <span>
            <strong>Confidential access.</strong> This command center is restricted to HR and admin roles.
            All grievance views are audit logged. Never disclose identity of anonymous filers.
            Anti-retaliation policy applies.
          </span>
        </div>

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ShieldAlert size={24} className="text-red-500" />
              Grievance Command Center
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Case management, investigation, escalation — HR / Admin only</p>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-60">
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <FilterField label="From" type="date" value={from} onChange={setFrom} focusClass="focus:ring-red-400" />
          <FilterField label="To"   type="date" value={to}   onChange={setTo} focusClass="focus:ring-red-400" />
          <SelectFilter label="Status" value={filterStatus} onChange={setFilterStatus}
            options={["submitted","under_review","escalated","resolved","closed"]} focusClass="focus:ring-red-400" />
          <SelectFilter label="Severity" value={filterSeverity} onChange={setFilterSeverity}
            options={["critical","high","medium","low"]} focusClass="focus:ring-red-400" />
        </div>

        {loading ? (
          <DashboardLoading colorClass="text-red-400" />
        ) : (
          <>
            {/* KPI cards */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                <KpiTile label="Total"         value={stats.total_grievances}       color="text-gray-800" />
                <KpiTile label="Open"          value={stats.open_grievances}        color="text-orange-600" highlight={stats.open_grievances > 0} />
                <KpiTile label="Anonymous"     value={stats.anonymous_count}        color="text-purple-600" />
                <KpiTile label="Critical"      value={stats.critical_count}         color="text-red-600"    highlight={stats.critical_count > 0} />
                <KpiTile label="Escalated"     value={stats.escalated_count}        color="text-red-700"    highlight={stats.escalated_count > 0} />
                <KpiTile label="Anti-Retaliation" value={stats.anti_retaliation_count} color="text-amber-700" />
                <KpiTile label="Avg Res. (d)"  value={stats.avg_resolution_days != null ? `${stats.avg_resolution_days}d` : "—"} color="text-blue-700" />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Category breakdown */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <FileText size={14} className="text-indigo-400" /> By Category
                </h2>
                <ul className="space-y-2">
                  {categories.map(c => (
                    <li key={c.category} className="flex justify-between text-sm">
                      <span className="text-gray-600 capitalize">{c.category.replace(/_/g, " ")}</span>
                      <span className="font-medium text-gray-800">{c.total} <span className="text-xs text-gray-400">({c.open} open)</span></span>
                    </li>
                  ))}
                  {categories.length === 0 && <li className="text-gray-400 text-sm text-center py-2">No data</li>}
                </ul>
              </div>

              {/* Severity breakdown */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-red-400" /> By Severity
                </h2>
                <ul className="space-y-2">
                  {severities.map(s => {
                    const cfg = SEVERITY_CONFIG[s.severity] ?? SEVERITY_CONFIG.low;
                    return (
                      <li key={s.severity} className="flex items-center justify-between text-sm">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${cfg.cls}`}>{cfg.label}</span>
                        <span className="font-medium text-gray-800">{s.total} <span className="text-xs text-gray-400">({s.open} open)</span></span>
                      </li>
                    );
                  })}
                  {severities.length === 0 && <li className="text-gray-400 text-sm text-center py-2">No data</li>}
                </ul>
              </div>

              {/* Aging */}
              {aging && (
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <TrendingUp size={14} className="text-orange-400" /> Open Case Aging
                  </h2>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "0–7 days",  value: aging.bucket_0_7d,    cls: "bg-green-50 text-green-700" },
                      { label: "8–30 days", value: aging.bucket_8_30d,   cls: "bg-yellow-50 text-yellow-700" },
                      { label: "31–90d",    value: aging.bucket_31_90d,  cls: "bg-orange-50 text-orange-700" },
                      { label: ">90 days",  value: aging.bucket_over_90d, cls: "bg-red-50 text-red-700" },
                    ].map(b => (
                      <div key={b.label} className={`rounded-lg p-3 text-center ${b.cls}`}>
                        <div className="text-xl font-bold">{b.value ?? 0}</div>
                        <div className="text-xs">{b.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Case list */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Shield size={14} className="text-red-400" /> Cases ({grievances.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-400 uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Code</th>
                      <th className="px-4 py-3 text-left">Category</th>
                      <th className="px-4 py-3 text-center">Severity</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-center">Flags</th>
                      <th className="px-4 py-3 text-left">Assigned</th>
                      <th className="px-4 py-3 text-left">Due / SLA</th>
                      <th className="px-4 py-3 text-left">Filed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {grievances.map(g => {
                      const sevCfg = SEVERITY_CONFIG[g.severity] ?? SEVERITY_CONFIG.low;
                      const staCls = STATUS_CONFIG[g.status] ?? "bg-gray-100 text-gray-500";
                      const sla = getSlaStatus(g.due_date, g.status);
                      return (
                        <tr key={g.id}
                          onClick={() => openDetail(g)}
                          className="cursor-pointer hover:bg-red-50 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-indigo-700">{g.grievance_code}</td>
                          <td className="px-4 py-3 capitalize text-gray-700">{g.category.replace(/_/g, " ")}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded border ${sevCfg.cls}`}>{sevCfg.label}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${staCls}`}>{g.status.replace(/_/g, " ")}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {g.is_anonymous && (
                                <span title="Anonymous" className="text-purple-500"><EyeOff size={12} /></span>
                              )}
                              {g.anti_retaliation_flag && (
                                <span title="Anti-retaliation flag" className="text-red-500"><AlertTriangle size={12} /></span>
                              )}
                              {g.escalation_level > 0 && (
                                <span title={`Escalated L${g.escalation_level}`} className="text-orange-500 text-xs font-bold">L{g.escalation_level}</span>
                              )}
                              {g.evidence_count > 0 && (
                                <span title={`${g.evidence_count} evidence file(s)`} className="text-blue-500 text-xs font-medium">
                                  📎{g.evidence_count}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {g.assigned_committee ?? g.assigned_to ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-500">{g.due_date ? formatISTDate(g.due_date + "T00:00:00") : "—"}</span>
                              {sla === "overdue" && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300 w-fit">Overdue</span>
                              )}
                              {sla === "due-soon" && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 w-fit">Due Soon</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs">
                            {formatISTDate(g.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                    {grievances.length === 0 && (
                      <tr><td colSpan={8} className="py-10 text-center text-gray-400">No grievances in this period</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Detail drawer */}
        {(selected || detailLoading) && (
          <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-black/40" onClick={closeDrawer} />
            <div className="w-full max-w-lg bg-white shadow-2xl overflow-y-auto p-6 space-y-5">
              {detailLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader size={24} className="animate-spin text-red-400" />
                </div>
              ) : selected ? (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-indigo-600">{selected.grievance_code}</span>
                        {selected.is_anonymous && (
                          <span className="flex items-center gap-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                            <EyeOff size={11} /> Anonymous
                          </span>
                        )}
                        {selected.anti_retaliation_flag && (
                          <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                            <AlertTriangle size={11} /> Anti-Retaliation
                          </span>
                        )}
                        {selected.evidence_count > 0 && (
                          <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                            📎 {selected.evidence_count} evidence
                          </span>
                        )}
                      </div>
                      <h2 className="text-lg font-bold text-gray-900 mt-1">{selected.subject || selected.category}</h2>
                      {selected.employee_name && (
                        <p className="text-sm text-gray-500">{selected.employee_name}</p>
                      )}
                    </div>
                    <button onClick={closeDrawer} className="text-gray-400 hover:text-gray-600">
                      <X size={20} />
                    </button>
                  </div>

                  {/* Confidentiality tag */}
                  <div className={`text-xs px-3 py-1.5 rounded font-medium ${
                    selected.confidentiality_level === "sensitive" ? "bg-red-100 text-red-700" :
                    selected.confidentiality_level === "confidential" ? "bg-orange-100 text-orange-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {selected.confidentiality_level?.toUpperCase()} · {SEVERITY_CONFIG[selected.severity]?.label ?? selected.severity} severity ·
                    {selected.escalation_level > 0 ? ` Escalation L${selected.escalation_level}` : " Not escalated"}
                  </div>

                  {/* Description */}
                  {selected.description_clean && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Description</h3>
                      <p className="text-sm text-gray-700 whitespace-pre-line bg-gray-50 rounded p-3">{selected.description_clean}</p>
                    </div>
                  )}

                  {/* Investigation notes */}
                  {selected.investigation_notes && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Investigation Notes</h3>
                      <p className="text-sm text-gray-700 whitespace-pre-line bg-yellow-50 border border-yellow-100 rounded p-3">{selected.investigation_notes}</p>
                    </div>
                  )}

                  {/* Resolution note */}
                  {selected.resolution_note && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Resolution</h3>
                      <p className="text-sm text-gray-700 bg-green-50 border border-green-100 rounded p-3">{selected.resolution_note}</p>
                    </div>
                  )}

                  {/* Actions — only for open/under review */}
                  {!["closed","resolved"].includes(selected.status) && (
                    <div className="space-y-4 border-t border-gray-100 pt-4">

                      {/* Status transition buttons */}
                      <div className="flex gap-2 flex-wrap">
                        {selected.status === "submitted" && (
                          <button
                            disabled={actionWorking}
                            onClick={() => doAction("status", { status: "under_review" })}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 disabled:opacity-50"
                          >
                            <Clock size={13} /> Mark Under Review
                          </button>
                        )}
                        {(selected.status === "under_review" || selected.status === "submitted") && (
                          <button
                            disabled={actionWorking}
                            onClick={() => doAction("status", { status: "resolved" })}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 disabled:opacity-50"
                          >
                            <CheckCircle size={13} /> Mark Resolved
                          </button>
                        )}
                        <button
                          disabled={actionWorking}
                          onClick={() => doAction("escalate", { reason: "Manual escalation" })}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 text-sm rounded-lg hover:bg-red-200 disabled:opacity-50"
                        >
                          <TrendingUp size={13} /> Escalate
                        </button>
                      </div>

                      {/* Assign to HR */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                          Assign to HR Individual
                        </label>
                        <div className="flex gap-2">
                          <input
                            value={assignee}
                            onChange={e => setAssignee(e.target.value)}
                            placeholder="HR name or employee ID"
                            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                          <button
                            disabled={!assignee.trim() || actionWorking}
                            onClick={() => doAction("assign", { assignee }).then(() => setAssignee(""))}
                            className="flex items-center gap-1.5 px-4 py-2 bg-[#1B6AB5] text-white text-sm rounded-lg disabled:opacity-50 hover:bg-blue-700"
                          >
                            <UserCheck size={13} /> Assign
                          </button>
                        </div>
                      </div>

                      {/* Investigation note */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Add Investigation Note</label>
                        <textarea
                          rows={3}
                          value={noteText}
                          onChange={e => setNoteText(e.target.value)}
                          placeholder="Document findings, interviews conducted, evidence reviewed…"
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        />
                        <button
                          disabled={!noteText.trim() || actionWorking}
                          onClick={() => doAction("investigation-note", { note: noteText })}
                          className="mt-2 px-4 py-1.5 bg-yellow-500 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-yellow-600"
                        >
                          Save Note
                        </button>
                      </div>

                      {/* Close with resolution */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Close Grievance</label>
                        <textarea
                          rows={2}
                          value={resNote}
                          onChange={e => setResNote(e.target.value)}
                          placeholder="Mandatory resolution note…"
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                        />
                        <button
                          disabled={!resNote.trim() || actionWorking}
                          onClick={() => doAction("close", { resolution_note: resNote })}
                          className="mt-2 px-4 py-1.5 bg-green-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-green-700"
                        >
                          Close Case
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Reopen if closed */}
                  {selected.status === "closed" && (
                    <button
                      disabled={actionWorking}
                      onClick={() => doAction("reopen", {})}
                      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 disabled:opacity-50"
                    >
                      Reopen Case
                    </button>
                  )}

                  {actionMsg && (
                    <div className={`text-sm p-2 rounded ${actionMsg.includes("fail") || actionMsg.includes("Failed") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                      {actionMsg}
                    </div>
                  )}

                  {/* Activity Timeline */}
                  {timeline.length > 0 && (
                    <div className="border-t border-gray-100 pt-5">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3 flex items-center gap-1.5">
                        <Users size={13} className="text-indigo-400" /> Activity Timeline
                      </h3>
                      <ol className="space-y-1">
                        {timeline.map((entry, i) => (
                          <li key={entry.id ?? i} className="flex gap-3 text-sm">
                            <div className="flex flex-col items-center pt-1">
                              <div className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                              {i < timeline.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1 min-h-[16px]" />}
                            </div>
                            <div className="pb-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-gray-800 capitalize">{entry.action.replace(/_/g, " ")}</span>
                                {entry.actor && <span className="text-gray-500 text-xs">by {entry.actor}</span>}
                                <span className="text-gray-400 text-xs font-mono">{formatISTDate(entry.created_at)}</span>
                              </div>
                              {entry.note && <p className="text-gray-600 text-xs mt-0.5">{entry.note}</p>}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
