import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Flag, RefreshCcw, RotateCcw, Search, ShieldCheck, X, XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DisputedAssignment {
  id: string;
  cycle_id: string;
  employee_id: string;
  roster_date: string;
  shift_template_id: string | null;
  is_week_off: number;
  acknowledgement_status: string;
  dispute_reason: string | null;
  dispute_resolved_at: string | null;
  dispute_resolution: string | null;
  employee_code: string;
  first_name: string;
  last_name: string;
  process_id: string;
  week_start_date: string;
  week_end_date: string;
  shift_name: string | null;
  start_time: string | null;
  end_time: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return formatISTDate(iso);
}
function fmtTime(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

// ── Resolve Modal ─────────────────────────────────────────────────────────────

function ResolveModal({
  assignment,
  onClose,
  onSubmit,
  isPending,
}: {
  assignment: DisputedAssignment;
  onClose: () => void;
  onSubmit: (assignmentId: string, resolution: string, newShiftId?: string) => void;
  isPending: boolean;
}) {
  const [resolution, setResolution] = useState("");
  const [newShiftId, setNewShiftId] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <h3 className="font-black text-slate-900">Resolve Dispute</h3>
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 mb-4 space-y-1 text-sm">
          <p><span className="font-bold text-slate-700">Employee:</span> {assignment.first_name} {assignment.last_name} ({assignment.employee_code})</p>
          <p><span className="font-bold text-slate-700">Date:</span> {fmtDate(assignment.roster_date)}</p>
          {assignment.shift_name && (
            <p><span className="font-bold text-slate-700">Shift:</span> {assignment.shift_name} ({fmtTime(assignment.start_time)} – {fmtTime(assignment.end_time)})</p>
          )}
          <p className="mt-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-rose-800">
            <span className="font-bold">Employee's concern:</span> {assignment.dispute_reason ?? "—"}
          </p>
        </div>

        <label className="block text-xs font-bold text-slate-700 mb-1">Resolution note *</label>
        <textarea
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          rows={3}
          placeholder="Explain the outcome (original shift retained / shift updated / exception approved)..."
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-blue-500 focus:outline-none resize-none"
        />

        <label className="block text-xs font-bold text-slate-700 mt-3 mb-1">Change shift (optional — leave blank to retain original)</label>
        <input
          type="text"
          value={newShiftId}
          onChange={(e) => setNewShiftId(e.target.value)}
          placeholder="Shift template ID (from Shift Templates list)"
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-blue-500 focus:outline-none"
        />

        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            disabled={!resolution.trim() || isPending}
            onClick={() => onSubmit(assignment.id, resolution.trim(), newShiftId.trim() || undefined)}
            className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Resolve"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NativeRosterManagerQueue() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [resolveTarget, setResolveTarget] = useState<DisputedAssignment | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const queueQ = useQuery({
    queryKey: ["roster-dispute-queue"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: DisputedAssignment[] }>("/api/roster-gov/manager-review-queue");
      return res.data ?? [];
    },
  });

  const disputes: DisputedAssignment[] = (queueQ.data ?? []).filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.employee_code.toLowerCase().includes(q) ||
      `${d.first_name} ${d.last_name}`.toLowerCase().includes(q) ||
      d.roster_date.includes(q)
    );
  });

  const resolveMutation = useMutation({
    mutationFn: ({
      assignmentId,
      dispute_resolution,
      new_shift_template_id,
    }: {
      assignmentId: string;
      dispute_resolution: string;
      new_shift_template_id?: string;
    }) =>
      hrmsApi.post<{ success: boolean }>(`/api/roster-gov/assignments/${assignmentId}/resolve-dispute`, {
        dispute_resolution,
        new_shift_template_id,
      }),
    onSuccess: () => {
      setResolveTarget(null);
      setNotice({ type: "success", msg: "Dispute resolved. Employee has been notified." });
      void qc.invalidateQueries({ queryKey: ["roster-dispute-queue"] });
    },
    onError: (err: Error) => {
      setNotice({ type: "error", msg: err.message ?? "Failed to resolve dispute." });
    },
  });

  return (
    <DashboardLayout>
      {resolveTarget && (
        <ResolveModal
          assignment={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onSubmit={(id, resolution, newShiftId) =>
            resolveMutation.mutate({ assignmentId: id, dispute_resolution: resolution, new_shift_template_id: newShiftId })
          }
          isPending={resolveMutation.isPending}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <header className="rounded-3xl bg-slate-950 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-rose-300">WFM · Manager Review</p>
          <h1 className="mt-2 text-3xl font-black">Roster Dispute Queue</h1>
          <p className="mt-2 text-sm text-slate-300">
            Review and resolve employee disputes against published roster assignments. All resolutions are audited.
          </p>
        </header>

        {/* Notice */}
        {notice && (
          <div className={`rounded-xl border p-4 text-sm font-semibold flex items-center justify-between ${
            notice.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}>
            <span>{notice.msg}</span>
            <button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee or date..."
              className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            onClick={() => void qc.invalidateQueries({ queryKey: ["roster-dispute-queue"] })}
            className="rounded-xl border p-2.5 text-slate-500 hover:bg-slate-100"
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
          {disputes.length > 0 && (
            <span className="rounded-full bg-rose-600 px-3 py-0.5 text-xs font-black text-white">
              {disputes.length} open
            </span>
          )}
        </div>

        {/* Queue Table */}
        {queueQ.isLoading ? (
          <div className="flex items-center justify-center rounded-3xl border bg-white py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" />
          </div>
        ) : disputes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border bg-white py-20 gap-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <p className="text-sm font-bold text-slate-500">No open disputes in your queue</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-3xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-xs font-black uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Shift</th>
                  <th className="px-4 py-3">Week</th>
                  <th className="px-4 py-3">Dispute Reason</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {disputes.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-900">{d.first_name} {d.last_name}</p>
                      <p className="text-xs text-slate-500">{d.employee_code}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(d.roster_date)}</td>
                    <td className="px-4 py-3">
                      {d.shift_name ? (
                        <div className="flex items-center gap-1 text-slate-700">
                          <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                          <span className="font-medium">{d.shift_name}</span>
                          <span className="text-slate-500 text-xs">({fmtTime(d.start_time)}–{fmtTime(d.end_time)})</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {fmtDate(d.week_start_date)} – {fmtDate(d.week_end_date)}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="text-xs text-rose-700 bg-rose-50 rounded-lg px-2 py-1 line-clamp-2">
                        {d.dispute_reason ?? "No reason provided"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setResolveTarget(d)}
                        className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 whitespace-nowrap"
                      >
                        <Flag className="h-3 w-3" /> Resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Stats */}
        {!queueQ.isLoading && (queueQ.data ?? []).length > 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span>Showing {disputes.length} of {(queueQ.data ?? []).length} total disputes. Resolved disputes are removed from this queue.</span>
          </div>
        )}

        {/* Week-Off Rejection Review — from wfm_roster_assignment lifecycle */}
        <WeekOffReviewSection />
      </div>
    </DashboardLayout>
  );
}

// ── Week-Off Review (new lifecycle) ──────────────────────────────────────────

interface WoReviewItem { id: string; employee_name: string; employee_code: string; roster_date: string; is_week_off: number; final_roster_status: string; employee_rejection_reason: string | null; system_decision_reason: string | null; shift_name: string | null; start_time: string | null; end_time: string | null; week_start_date: string | null; }

function WeekOffReviewSection() {
  const qc = useQueryClient();
  const [actionTarget, setActionTarget] = useState<WoReviewItem | null>(null);
  const [actionType, setActionType] = useState<string>("");
  const [reason, setReason] = useState("");
  const [notice2, setNotice2] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const woQ = useQuery({
    queryKey: ["wfm-weekoff-review"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: WoReviewItem[] }>("/api/wfm/manager/weekoff-review")).data ?? [],
  });

  const actionMut = useMutation({
    mutationFn: ({ assignmentId, action, body }: { assignmentId: string; action: string; body: Record<string, any> }) =>
      hrmsApi.post(`/api/wfm/manager/weekoff-review/${assignmentId}/${action}`, body),
    onSuccess: () => {
      setActionTarget(null); setReason(""); setActionType("");
      setNotice2({ type: "success", msg: "Action completed." });
      void qc.invalidateQueries({ queryKey: ["wfm-weekoff-review"] });
    },
    onError: (e: Error) => setNotice2({ type: "error", msg: e.message ?? "Action failed." }),
  });

  const items: WoReviewItem[] = woQ.data ?? [];

  function doAction() {
    if (!actionTarget || !reason.trim()) return;
    actionMut.mutate({ assignmentId: actionTarget.id, action: actionType, body: { reason: reason.trim() } });
  }

  if (items.length === 0 && !woQ.isLoading) return null;

  return (
    <>
      {/* Action modal */}
      {actionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-slate-900 capitalize">{actionType.replace("-", " ").replace("_", " ")}</h3>
              <button onClick={() => setActionTarget(null)}><X className="h-4 w-4 text-slate-500" /></button>
            </div>
            <div className="rounded-xl bg-slate-50 border p-3 text-sm">
              <p><b>Employee:</b> {actionTarget.employee_name} ({actionTarget.employee_code})</p>
              <p><b>Date:</b> {actionTarget.roster_date}</p>
              {actionTarget.employee_rejection_reason && <p className="mt-1 text-rose-700 text-xs bg-rose-50 rounded-lg p-2">Reason: {actionTarget.employee_rejection_reason}</p>}
            </div>
            <label className="block text-xs font-bold text-slate-700">Reason / resolution note *
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 block w-full rounded-xl border p-3 text-sm resize-none" placeholder="Provide reason for this action..." />
            </label>
            <div className="flex gap-3">
              <button onClick={() => setActionTarget(null)} className="flex-1 rounded-xl border py-2 text-sm font-bold text-slate-700">Cancel</button>
              <button disabled={!reason.trim() || actionMut.isPending} onClick={doAction} className="flex-1 rounded-xl bg-slate-900 py-2 text-sm font-bold text-white disabled:opacity-50">
                {actionMut.isPending ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
        <div className="border-b p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-black text-slate-950">Week-Off Rejection Review</h2>
              <p className="text-sm text-slate-500 mt-1">Employees who rejected their assigned roster. Take action: realign, force-approve, escalate, or reject their request.</p>
            </div>
            {items.length > 0 && <span className="rounded-full bg-amber-600 px-3 py-0.5 text-xs font-black text-white">{items.length} pending</span>}
          </div>
        </div>

        {notice2 && (
          <div className={`mx-5 mt-4 rounded-xl border p-3 text-sm font-semibold ${notice2.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
            {notice2.msg}
          </div>
        )}

        {woQ.isLoading ? (
          <div className="flex justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" /></div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">No pending week-off rejections.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-black uppercase text-slate-500">
                <tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Shift</th><th className="px-4 py-3">Rejection Reason</th><th className="px-4 py-3">System Reason</th><th className="px-4 py-3">Actions</th></tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3"><p className="font-bold">{item.employee_name}</p><p className="text-xs text-slate-500">{item.employee_code}</p></td>
                    <td className="px-4 py-3 whitespace-nowrap">{item.roster_date}</td>
                    <td className="px-4 py-3">{item.shift_name ? `${item.shift_name} (${item.start_time?.slice(0, 5)}–${item.end_time?.slice(0, 5)})` : item.is_week_off ? "Week Off" : "—"}</td>
                    <td className="px-4 py-3 max-w-[200px]"><p className="text-xs text-rose-700 bg-rose-50 rounded-lg px-2 py-1 line-clamp-2">{item.employee_rejection_reason ?? "—"}</p></td>
                    <td className="px-4 py-3 max-w-[160px] text-xs text-slate-500 truncate" title={item.system_decision_reason ?? ""}>{item.system_decision_reason ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => { setActionTarget(item); setActionType("realign"); setReason(""); }} className="flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"><RotateCcw className="h-3 w-3" />Realign</button>
                        <button onClick={() => { setActionTarget(item); setActionType("force-approve"); setReason(""); }} className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100"><ShieldCheck className="h-3 w-3" />Force</button>
                        <button onClick={() => { setActionTarget(item); setActionType("escalate"); setReason(""); }} className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100"><ArrowUpRight className="h-3 w-3" />Escalate</button>
                        <button onClick={() => { setActionTarget(item); setActionType("reject-request"); setReason(""); }} className="flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"><XCircle className="h-3 w-3" />Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
