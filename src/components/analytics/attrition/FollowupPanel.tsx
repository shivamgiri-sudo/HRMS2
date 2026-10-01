/** Follow-up history + a compact "log outcome" form for one employee. */
import { useState } from "react";
import { MessageSquarePlus, Send } from "lucide-react";
import { toast } from "sonner";
import { getHrmsApiErrorStatus } from "@/lib/hrmsApi";
import { useHubFollowups, useLogFollowup } from "./api";
import { ErrorCard, Shimmer, fmtDate } from "./charts";
import { FOLLOWUP_KINDS, FOLLOWUP_OUTCOMES, type FollowupKind, type FollowupOutcome } from "./types";

export const KIND_LABEL = Object.fromEntries(FOLLOWUP_KINDS.map(k => [k.key, k.label])) as Record<FollowupKind, string>;
export const OUTCOME_LABEL = Object.fromEntries(FOLLOWUP_OUTCOMES.map(k => [k.key, k.label])) as Record<FollowupOutcome, string>;
const OUTCOME_CHIP: Record<FollowupOutcome, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  reached_returning: "bg-emerald-50 text-emerald-700 border-emerald-200",
  reached_resigning: "bg-rose-50 text-rose-700 border-rose-200",
  not_reachable: "bg-amber-50 text-amber-700 border-amber-200",
  improved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  no_change: "bg-orange-50 text-orange-700 border-orange-200",
};
export function OutcomeChip({ outcome }: { outcome: FollowupOutcome }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${OUTCOME_CHIP[outcome] ?? OUTCOME_CHIP.pending}`}>{OUTCOME_LABEL[outcome] ?? outcome}</span>;
}

const sel = "h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300";

export default function FollowupPanel({ employeeId, compact = false, onLogged }: { employeeId: string; compact?: boolean; onLogged?: () => void }) {
  const hist = useHubFollowups(employeeId);
  const log = useLogFollowup();
  const [kind, setKind] = useState<FollowupKind>("absent_outreach");
  const [outcome, setOutcome] = useState<FollowupOutcome>("pending");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    log.mutate(
      { employeeId, kind, outcome, note: note.trim() || undefined },
      {
        onSuccess: () => { toast.success("Logged"); setNote(""); onLogged?.(); },
        onError: (er) => {
          const st = getHrmsApiErrorStatus(er);
          setErr(st === 403 ? "You can only log follow-ups for people in your own scope (your branch or team)." : (er as Error)?.message || "Could not save the follow-up.");
        },
      },
    );
  };

  return (
    <section aria-label="Follow-ups" className="space-y-3">
      <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden /> Follow-ups
      </h4>
      <form onSubmit={submit} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3" aria-label="Log an outcome">
        <div className={`grid gap-2 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2"}`}>
          <label className="block text-[11px] font-semibold text-slate-600">What was done
            <select className={`${sel} mt-1`} value={kind} onChange={e => setKind(e.target.value as FollowupKind)}>
              {FOLLOWUP_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-slate-600">Outcome
            <select className={`${sel} mt-1`} value={outcome} onChange={e => setOutcome(e.target.value as FollowupOutcome)}>
              {FOLLOWUP_OUTCOMES.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-[11px] font-semibold text-slate-600">Note (optional)
          <textarea
            value={note} maxLength={500} rows={2} onChange={e => setNote(e.target.value)} placeholder="What did they say? Any next step?"
            className="mt-1 w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
        </label>
        {err && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-800">{err}</p>}
        <div className="flex items-center justify-between">
          <span className="text-[10px] tabular-nums text-slate-400">{note.length}/500</span>
          <button type="submit" disabled={log.isPending}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 disabled:opacity-60">
            <Send className="h-3 w-3" aria-hidden /> {log.isPending ? "Saving..." : "Log outcome"}
          </button>
        </div>
      </form>

      {hist.isLoading ? <Shimmer className="h-12" /> : hist.error ? <ErrorCard what="the follow-up history" error={hist.error} onRetry={() => hist.refetch()} /> : (
        (hist.data ?? []).length === 0 ? <p className="text-xs text-slate-500">No follow-ups logged yet.</p> : (
          <ul className="space-y-1.5" aria-label="Follow-up history">
            {(hist.data ?? []).map(f => (
              <li key={f.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-800">{KIND_LABEL[f.kind] ?? f.kind}</span>
                  <OutcomeChip outcome={f.outcome} />
                  <span className="ml-auto text-[11px] text-slate-500">{f.createdByName ? `${f.createdByName} · ` : ""}{fmtDate(f.createdAt)}</span>
                </div>
                {f.note && <p className="mt-1 break-words text-xs leading-snug text-slate-600">{f.note}</p>}
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
