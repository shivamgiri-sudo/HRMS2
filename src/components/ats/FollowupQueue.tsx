/**
 * The recruiter's follow-up call queue — "who do I have to ring today?"
 *
 * This deliberately fetches its own data. The page already had a "Follow-ups Due
 * (Next 7 Days)" panel on the Progress tab, but it reads the `analytics` state,
 * which is only populated when someone opens the Branch Analytics tab — so a
 * recruiter who never opens Analytics sees nothing and has no idea a call is due.
 * A work queue that depends on visiting an unrelated tab is not a work queue.
 *
 * Every date decision is the server's. `serverToday` arrives with the payload and
 * is what a logged call is dated with; `days_overdue` is a server-side DATEDIFF.
 * A browser-computed "today" would shift the whole queue by a day across
 * timezones — a known defect class in this repo.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Loader2, Phone, RefreshCw, Users,
} from "lucide-react";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Six of the seven values the server allows (recruiter-hiring.routes.ts,
 * FOLLOWUP_CALL_OUTCOMES). "Rescheduled" is deliberately absent — it is not a
 * call result the recruiter picks here, it is what the Reschedule button sends.
 */
const DONE_OUTCOMES = [
  "Interested",
  "Not Interested",
  "No Response",
  "Already Joined",
  "Declined Offer",
  "Wrong Number",
] as const;

export type FollowupRow = {
  id: string;
  candidate_name: string | null;
  mobile: string | null;
  process_name: string | null;
  position_name: string | null;
  branch_name: string | null;
  recruiter_name_snapshot: string | null;
  recruiter_remarks: string | null;
  activity_date: string | null;
  followup_date: string;
  followup_reason: string | null;
  days_overdue: number;
  last_call_outcome: string | null;
  last_call_date: string | null;
  attempts: number;
};

type FollowupResponse = {
  success: boolean;
  serverToday: string;
  scope: "mine" | "team";
  scopeRequested: "mine" | "team";
  branchResolved: boolean;
  counts: { overdue: number; today: number; upcoming7: number; total: number };
  data: FollowupRow[];
  page: number;
  limit: number;
};

type Win = "due" | "week" | "all";

export function FollowupQueue({
  canSeeTeam,
  onCountsChange,
}: {
  canSeeTeam: boolean;
  onCountsChange?: (dueNow: number) => void;
}) {
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [win, setWin] = useState<Win>("due");
  const [res, setRes] = useState<FollowupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [newDate, setNewDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<FollowupResponse>(
        `/api/ats/recruiter/hiring-activity/followups?scope=${scope}&window=${win}&limit=200`,
      );
      setRes(r);
      onCountsChange?.((r.counts?.overdue ?? 0) + (r.counts?.today ?? 0));
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "Could not load the follow-up queue.");
      setRes(null);
    } finally {
      setLoading(false);
    }
  }, [scope, win, onCountsChange]);

  useEffect(() => { void load(); }, [load]);

  const closeEditor = () => { setOpenRow(null); setOutcome(""); setNotes(""); setNewDate(""); };

  /**
   * Both actions go through the existing log-followup-call endpoint; neither
   * needs a new one. "Rescheduled" is the single outcome that keeps the
   * follow-up open and moves its date, and the server enforces that. There is no
   * "Done" outcome value to send — the recruiter picks what actually happened,
   * because recording a guess as the call result would be a lie in the data.
   */
  const submit = async (row: FollowupRow, mode: "done" | "reschedule") => {
    if (mode === "done" && !outcome) { toast.error("Pick what happened on the call."); return; }
    if (mode === "reschedule" && !newDate) { toast.error("Pick the new follow-up date."); return; }
    setBusyId(row.id);
    try {
      await hrmsApi.post(`/api/ats/recruiter/hiring-activity/${row.id}/log-followup-call`, {
        followup_call_date: res?.serverToday,
        followup_call_outcome: mode === "reschedule" ? "Rescheduled" : outcome,
        followup_call_notes: notes || null,
        followup_rescheduled_to: mode === "reschedule" ? newDate : null,
      });
      toast.success(mode === "reschedule" ? `Moved to ${newDate}` : `Logged: ${outcome}`);
      closeEditor();
      await load();
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "Could not log the call.");
    } finally {
      setBusyId(null);
    }
  };

  const counts = res?.counts ?? { overdue: 0, today: 0, upcoming7: 0, total: 0 };
  const rows = res?.data ?? [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-black text-slate-900">Follow-up calls</h2>
          {counts.overdue > 0 && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-black text-rose-700">
              {counts.overdue} overdue
            </span>
          )}
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-700">
            {counts.today} due today
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canSeeTeam && (
            <div className="flex overflow-hidden rounded-lg border border-slate-200">
              {(["mine", "team"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`cursor-pointer px-3 py-1.5 text-xs font-bold transition-colors ${
                    scope === s ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {s === "mine" ? "Mine" : "Team"}
                </button>
              ))}
            </div>
          )}
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            {([["due", "Due now"], ["week", "Next 7 days"], ["all", "All open"]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setWin(v)}
                className={`cursor-pointer px-3 py-1.5 text-xs font-bold transition-colors ${
                  win === v ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="cursor-pointer rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-50"
            aria-label="Refresh the follow-up queue"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* The server narrows a team request to "mine" when it cannot resolve the
          user's branch. Saying so beats a toggle that silently does nothing. */}
      {res && res.scopeRequested === "team" && res.scope === "mine" && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" />
          Branch scope unavailable for your account — showing your own follow-ups only.
        </div>
      )}

      {loading && !res ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the queue…
        </div>
      ) : rows.length === 0 ? (
        <div className="py-8">
          <EmptyState
            icon={<CheckCircle2 className="h-8 w-8" />}
            title={win === "due" ? "No calls due" : "Nothing scheduled"}
            description={
              win === "due"
                ? "Nothing is overdue and nothing is due today. Mark a follow-up while making an entry and it appears here."
                : "No open follow-ups in this window."
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-bold">Candidate</th>
                <th className="px-4 py-2 font-bold">Mobile</th>
                <th className="px-4 py-2 font-bold">Due</th>
                <th className="px-4 py-2 font-bold">Why</th>
                <th className="px-4 py-2 font-bold">Outcome then</th>
                {scope === "team" && <th className="px-4 py-2 font-bold">Recruiter</th>}
                <th className="px-4 py-2 text-right font-bold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const overdue = row.days_overdue > 0;
                const isToday = row.days_overdue === 0;
                const isOpen = openRow === row.id;
                return (
                  <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-bold text-slate-900">{row.candidate_name || "—"}</div>
                      <div className="text-xs text-slate-500">{row.process_name || row.position_name || "—"}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      {row.mobile ? (
                        <a
                          href={`tel:${row.mobile}`}
                          className="cursor-pointer font-semibold text-slate-700 underline-offset-2 hover:underline"
                        >
                          {row.mobile}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="font-semibold text-slate-800">{row.followup_date}</div>
                      {overdue ? (
                        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-black text-rose-700">
                          <AlertTriangle className="h-3 w-3" />
                          {row.days_overdue}d overdue
                        </span>
                      ) : isToday ? (
                        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-700">
                          <CalendarClock className="h-3 w-3" /> Today
                        </span>
                      ) : (
                        <span className="mt-0.5 inline-block text-[11px] font-semibold text-slate-500">
                          in {Math.abs(row.days_overdue)}d
                        </span>
                      )}
                    </td>
                    <td className="max-w-[220px] px-4 py-2.5 text-xs text-slate-600">
                      {row.followup_reason || <span className="text-slate-400">—</span>}
                      {row.attempts > 0 && (
                        <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                          {row.attempts} earlier attempt{row.attempts === 1 ? "" : "s"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {row.recruiter_remarks || "—"}
                      {row.last_call_outcome && (
                        <div className="text-[11px] text-slate-400">
                          last: {row.last_call_outcome} ({row.last_call_date})
                        </div>
                      )}
                    </td>
                    {scope === "team" && (
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 text-slate-400" />
                          {row.recruiter_name_snapshot || "—"}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      {!isOpen ? (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => { closeEditor(); setOpenRow(row.id); }}
                            className="cursor-pointer rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-slate-700"
                          >
                            Log call
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <select
                            value={outcome}
                            onChange={(e) => setOutcome(e.target.value)}
                            className="h-9 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none focus:border-slate-400"
                          >
                            <option value="">What happened?…</option>
                            {DONE_OUTCOMES.map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                          <input
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Notes (optional)"
                            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none focus:border-slate-400"
                          />
                          <button
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => void submit(row, "done")}
                            className="w-full cursor-pointer rounded-lg bg-emerald-600 px-2 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Done
                          </button>
                          <div className="flex gap-2 border-t border-slate-200 pt-2">
                            <input
                              type="date"
                              value={newDate}
                              min={res?.serverToday}
                              onChange={(e) => setNewDate(e.target.value)}
                              className="h-9 flex-1 cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none focus:border-slate-400"
                            />
                            <button
                              type="button"
                              disabled={busyId === row.id || !newDate}
                              onClick={() => void submit(row, "reschedule")}
                              className="cursor-pointer rounded-lg bg-white px-2 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-300 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Reschedule
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={closeEditor}
                            className="w-full cursor-pointer text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {res && counts.total > rows.length && (
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              Showing {rows.length} of {counts.total} open follow-ups.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
