import { useEffect, useState } from "react";
import {
  AlertTriangle, Briefcase, Building2, Calendar, CheckCircle2,
  Clock, Loader2, MessageSquare, Shield, User, X,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type TimelineEntry = {
  id: string;
  stage: string;
  action: string;
  action_by_role: string;
  discussion_remarks?: string;
  internal_notes?: string;
  created_at: string;
  actioned_by_name?: string;
};

type ClearanceTask = {
  clearance_area: string;
  task_title: string;
  status: string;
  due_date?: string;
  remarks?: string;
  cleared_at?: string;
};

type ExitFullDetail = {
  id: string;
  employee_name?: string;
  employee_code?: string;
  branch_name?: string;
  process_name?: string;
  department_name?: string;
  designation_name?: string;
  manager_name?: string;
  manager_code?: string;
  exit_type: string;
  exit_sub_type?: string;
  exit_reason_category?: string;
  resignation_reason?: string;
  notice_period_days: number;
  notice_start_date?: string;
  notice_end_date?: string;
  last_working_day_proposed?: string;
  last_working_day_confirmed?: string;
  notice_days_served?: number | null;
  notice_days_remaining?: number | null;
  status: string;
  created_at: string;
  submitted_at?: string;
  manager_actioned_at?: string;
  hr_actioned_at?: string;
  joining_date?: string;
  timeline: TimelineEntry[];
  clearance_tasks: ClearanceTask[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (v?: string | null) => v ? v.slice(0, 10).split("-").reverse().join("/") : "—";
const fmtDateTime = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getFullYear()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-sm font-semibold text-slate-800 capitalize">{value}</span>
    </div>
  );
}

const STAGE_COLORS: Record<string, string> = {
  manager_review: "bg-blue-100 text-blue-700",
  hr_review: "bg-violet-100 text-violet-700",
  admin_review: "bg-amber-100 text-amber-700",
  employee_revoke: "bg-slate-100 text-slate-700",
  hr_revoke: "bg-rose-100 text-rose-700",
};

const CLEARANCE_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  cleared: "bg-emerald-100 text-emerald-700",
  blocked: "bg-red-100 text-red-700",
  waived: "bg-slate-100 text-slate-600",
};

// ─── Main Component ────────────────────────────────────────────────────────────

export function NoticePeriodDrawer({
  exitId,
  onClose,
}: {
  exitId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ExitFullDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    hrmsApi
      .get<{ success: boolean; data: ExitFullDetail }>(`/api/exit/${exitId}/full`)
      .then((res) => setDetail(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [exitId]);

  const managerFeedback = detail?.timeline.filter(
    (t) => t.stage === "manager_review" && t.discussion_remarks
  ) ?? [];
  const hrFeedback = detail?.timeline.filter(
    (t) => t.stage === "hr_review" && (t.discussion_remarks || t.internal_notes)
  ) ?? [];

  const clearedCount = detail?.clearance_tasks.filter((t) => t.status === "cleared").length ?? 0;
  const totalClearance = detail?.clearance_tasks.length ?? 0;

  const noticePct = detail?.notice_period_days && detail.notice_days_served != null
    ? Math.min(100, Math.round((detail.notice_days_served / detail.notice_period_days) * 100))
    : null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-white shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="shrink-0 border-b bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-cyan-200 mb-0.5">
                Notice Period Detail
              </p>
              {loading ? (
                <div className="h-6 w-48 animate-pulse rounded bg-white/20" />
              ) : (
                <h2 className="text-lg font-black text-white">
                  {detail?.employee_name ?? "—"}
                </h2>
              )}
              {!loading && detail && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold text-white capitalize">
                    {detail.status.replace(/_/g, " ")}
                  </span>
                  <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold text-white capitalize">
                    {(detail.exit_type ?? "").replace(/_/g, " ")} · {(detail.exit_sub_type ?? "").replace(/_/g, " ")}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-xl bg-white/20 p-1.5 text-white hover:bg-white/30 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : !detail ? (
            <div className="py-20 text-center text-slate-400">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">Failed to load details.</p>
            </div>
          ) : (
            <>
              {/* Notice Period Progress */}
              {detail.notice_period_days > 0 && (
                <section className="rounded-2xl border-2 border-cyan-200 bg-gradient-to-r from-cyan-50 to-blue-50 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="h-4 w-4 text-cyan-600" />
                    <h3 className="text-sm font-black text-cyan-800 uppercase tracking-wide">Notice Period Progress</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="rounded-xl bg-white/70 p-3 text-center">
                      <p className="text-xs font-semibold text-slate-500">Total Notice</p>
                      <p className="mt-1 text-2xl font-black text-slate-800">{detail.notice_period_days}</p>
                      <p className="text-xs text-slate-400">days</p>
                    </div>
                    <div className="rounded-xl bg-white/70 p-3 text-center">
                      <p className="text-xs font-semibold text-slate-500">Days Served</p>
                      <p className="mt-1 text-2xl font-black text-blue-700">{detail.notice_days_served ?? "—"}</p>
                      <p className="text-xs text-slate-400">days</p>
                    </div>
                    <div className={`rounded-xl p-3 text-center ${
                      (detail.notice_days_remaining ?? 0) <= 7
                        ? "bg-red-100"
                        : (detail.notice_days_remaining ?? 0) <= 14
                        ? "bg-amber-100"
                        : "bg-white/70"
                    }`}>
                      <p className="text-xs font-semibold text-slate-500">Days Remaining</p>
                      <p className={`mt-1 text-2xl font-black ${
                        (detail.notice_days_remaining ?? 0) <= 7 ? "text-red-700"
                        : (detail.notice_days_remaining ?? 0) <= 14 ? "text-amber-700"
                        : "text-slate-800"
                      }`}>
                        {detail.notice_days_remaining ?? "—"}
                      </p>
                      <p className="text-xs text-slate-400">days</p>
                    </div>
                  </div>
                  {noticePct !== null && (
                    <div>
                      <div className="flex justify-between text-xs font-semibold text-cyan-700 mb-1">
                        <span>Progress</span>
                        <span>{noticePct}%</span>
                      </div>
                      <div className="h-3 rounded-full bg-white/70 border border-cyan-200">
                        <div
                          className="h-3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                          style={{ width: `${noticePct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div className="flex items-center gap-1.5 text-cyan-800">
                      <Calendar className="h-3 w-3" />
                      <span>Start: <b>{fmtDate(detail.notice_start_date)}</b></span>
                    </div>
                    <div className="flex items-center gap-1.5 text-cyan-800">
                      <Calendar className="h-3 w-3" />
                      <span>LWD: <b>{fmtDate(detail.last_working_day_confirmed ?? detail.last_working_day_proposed)}</b></span>
                    </div>
                  </div>
                </section>
              )}

              {/* Employee & Exit Details */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <User className="h-4 w-4 text-slate-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Employee Details</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <InfoRow label="Employee Code" value={detail.employee_code ?? "—"} />
                  <InfoRow label="Branch" value={detail.branch_name ?? "—"} />
                  <InfoRow label="Process" value={detail.process_name ?? "—"} />
                  <InfoRow label="Department" value={detail.department_name ?? "—"} />
                  <InfoRow label="Designation" value={detail.designation_name ?? "—"} />
                  <InfoRow label="Joining Date" value={fmtDate(detail.joining_date)} />
                </div>
              </section>

              {/* Manager Info */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Briefcase className="h-4 w-4 text-slate-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Manager</h3>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-black text-sm shrink-0">
                    {(detail.manager_name ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{detail.manager_name ?? "—"}</p>
                    {detail.manager_code && (
                      <p className="text-xs font-mono text-slate-500">{detail.manager_code}</p>
                    )}
                  </div>
                  <div className="ml-auto text-xs text-slate-400">
                    Actioned: {fmtDate(detail.manager_actioned_at)}
                  </div>
                </div>
              </section>

              {/* Resignation Details */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Resignation Details</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <InfoRow label="Raised On" value={fmtDate(detail.submitted_at ?? detail.created_at)} />
                  <InfoRow label="Exit Reason Category" value={(detail.exit_reason_category ?? "—").replace(/_/g, " ")} />
                </div>
                {detail.resignation_reason && (
                  <div className="rounded-xl bg-slate-50 border p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Employee's Reason</p>
                    <p className="text-sm text-slate-700 leading-relaxed">{detail.resignation_reason}</p>
                  </div>
                )}
              </section>

              {/* Manager Feedback */}
              {managerFeedback.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="h-4 w-4 text-blue-500" />
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Manager Feedback</h3>
                  </div>
                  <div className="space-y-3">
                    {managerFeedback.map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-xs font-bold text-blue-700">
                            {entry.actioned_by_name ?? "Manager"} · {entry.action.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-blue-400">{fmtDateTime(entry.created_at)}</span>
                        </div>
                        <p className="text-sm text-slate-700 leading-relaxed">{entry.discussion_remarks}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* HR Feedback */}
              {hrFeedback.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="h-4 w-4 text-violet-500" />
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">HR Feedback</h3>
                  </div>
                  <div className="space-y-3">
                    {hrFeedback.map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-violet-100 bg-violet-50 p-4">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-xs font-bold text-violet-700">
                            {entry.actioned_by_name ?? "HR"} · {entry.action.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-violet-400">{fmtDateTime(entry.created_at)}</span>
                        </div>
                        {entry.discussion_remarks && (
                          <p className="text-sm text-slate-700 leading-relaxed mb-2">{entry.discussion_remarks}</p>
                        )}
                        {entry.internal_notes && (
                          <div className="mt-2 rounded-lg bg-violet-100 px-3 py-2">
                            <p className="text-xs font-bold text-violet-600 mb-1">Internal Note (HR only)</p>
                            <p className="text-sm text-violet-800">{entry.internal_notes}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Full Timeline */}
              {detail.timeline.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="h-4 w-4 text-slate-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Approval Timeline</h3>
                  </div>
                  <div className="relative pl-4 space-y-0">
                    <div className="absolute left-1.5 top-2 bottom-2 w-0.5 bg-slate-200 rounded-full" />
                    {detail.timeline.map((entry, i) => (
                      <div key={entry.id} className="relative flex gap-3 pb-4">
                        <div className={`absolute -left-2.5 mt-0.5 h-4 w-4 rounded-full border-2 border-white flex items-center justify-center ${
                          entry.action === "approved" || entry.action === "notice_confirmed" ? "bg-emerald-500"
                          : entry.action === "rejected" ? "bg-red-500"
                          : "bg-blue-400"
                        }`}>
                          {(entry.action === "approved" || entry.action === "notice_confirmed") && (
                            <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                          )}
                        </div>
                        <div className={`flex-1 rounded-xl border p-3 ${i === detail.timeline.length - 1 ? "bg-slate-50 border-slate-200" : "bg-white"}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${STAGE_COLORS[entry.stage] ?? "bg-slate-100 text-slate-600"}`}>
                                {entry.stage.replace(/_/g, " ")}
                              </span>
                              <span className="text-xs font-bold text-slate-600 capitalize">
                                {entry.action.replace(/_/g, " ")}
                              </span>
                            </div>
                            <span className="text-xs text-slate-400">{fmtDateTime(entry.created_at)}</span>
                          </div>
                          {entry.actioned_by_name && (
                            <p className="mt-1 text-xs text-slate-500">By {entry.actioned_by_name}</p>
                          )}
                          {entry.discussion_remarks && (
                            <p className="mt-2 text-sm text-slate-700 italic">"{entry.discussion_remarks}"</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Clearance Tasks */}
              {detail.clearance_tasks.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-slate-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Clearance Tasks</h3>
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                      clearedCount === totalClearance ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {clearedCount}/{totalClearance} cleared
                    </span>
                  </div>
                  <div className="space-y-2">
                    {detail.clearance_tasks.map((task, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-3 rounded-xl p-3 ${
                          task.status === "cleared" ? "bg-emerald-50 border border-emerald-100" : "bg-slate-50 border border-slate-100"
                        }`}
                      >
                        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${
                          task.status === "cleared" ? "bg-emerald-500" : "bg-slate-300"
                        }`}>
                          {task.status === "cleared" && <CheckCircle2 className="h-3 w-3" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-slate-700">{task.task_title}</p>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold capitalize ${CLEARANCE_STATUS_COLORS[task.status] ?? "bg-slate-100 text-slate-600"}`}>
                              {task.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 capitalize mt-0.5">{task.clearance_area.replace(/_/g, " ")}</p>
                          {task.remarks && <p className="text-xs text-slate-500 mt-1">{task.remarks}</p>}
                        </div>
                        {task.due_date && (
                          <span className="shrink-0 text-xs text-slate-400">{fmtDate(task.due_date)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t bg-slate-50 px-6 py-4 flex items-center justify-end">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
