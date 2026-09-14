/**
 * A candidate's complete journey, opened from any row on the approvals screen.
 *
 * A Sheet rather than a route, so the branch head keeps their tab, filters and
 * scroll position — they are working through a queue, and losing their place to
 * look at one record is exactly the friction this is meant to remove. The open
 * candidate is mirrored to `?candidate=` so a specific journey can still be
 * linked or reloaded.
 *
 * `gaps` is rendered rather than hidden. If a phase could not be read, saying so
 * is the whole point: an absent section otherwise reads as "this never
 * happened", which is a different and much worse claim.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Ban, BadgeCheck, Briefcase, CalendarClock, CheckCircle2, FileText,
  Loader2, ShieldCheck, UserPlus, Wallet, Wrench,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";

type Phase =
  | "APPLICATION" | "INTERVIEW" | "OFFER" | "PAYROLL"
  | "BRANCH_HEAD" | "BGV" | "EMPLOYEE" | "JOINING_DOCS" | "PROVISIONING";

type JourneyEvent = {
  phase: Phase;
  activity_type: string;
  status: string | null;
  occurred_at: string | null;
  actor_name: string | null;
  source_table: string;
  source_record_id: string | null;
  detail: string | null;
};

type Journey = {
  candidate: Record<string, unknown> | null;
  employee: { id: string; employee_code: string | null } | null;
  phaseSummary: Array<{ phase: Phase; state: "done" | "in_progress" | "not_reached"; at: string | null }>;
  events: JourneyEvent[];
  gaps: string[];
};

const PHASE_META: Record<Phase, { label: string; Icon: typeof FileText; tone: string }> = {
  APPLICATION:  { label: "Application",   Icon: UserPlus,      tone: "text-sky-600 bg-sky-50 border-sky-200" },
  INTERVIEW:    { label: "Interviews",    Icon: Briefcase,     tone: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  OFFER:        { label: "Offer",         Icon: FileText,      tone: "text-violet-600 bg-violet-50 border-violet-200" },
  PAYROLL:      { label: "Payroll",       Icon: Wallet,        tone: "text-amber-600 bg-amber-50 border-amber-200" },
  BRANCH_HEAD:  { label: "Branch Head",   Icon: BadgeCheck,    tone: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  BGV:          { label: "BGV",           Icon: ShieldCheck,   tone: "text-cyan-600 bg-cyan-50 border-cyan-200" },
  EMPLOYEE:     { label: "Employee",      Icon: CheckCircle2,  tone: "text-teal-600 bg-teal-50 border-teal-200" },
  JOINING_DOCS: { label: "Joining docs",  Icon: FileText,      tone: "text-blue-600 bg-blue-50 border-blue-200" },
  PROVISIONING: { label: "Provisioning",  Icon: Wrench,        tone: "text-slate-600 bg-slate-100 border-slate-200" },
};

/**
 * Dates from these tables are not always well formed — one malformed stage_date
 * previously crashed the whole ATS journey tab. Never throw on a bad value.
 */
function safeDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function statusTone(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (/approved|verified|clear|completed|selected|joined|success|actioned|confirmed/.test(s)) {
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }
  if (/reject|fail|discrepan|negative|walkout|no_show/.test(s)) {
    return "bg-red-100 text-red-800 border-red-200";
  }
  if (/pending|initiated|progress|submitted|in_review/.test(s)) {
    return "bg-amber-100 text-amber-800 border-amber-200";
  }
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export function CandidateJourneyDrawer({
  candidateId, open, onClose,
}: {
  candidateId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!candidateId) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await hrmsApi.get<{ data: Journey }>(
        `/api/ats/branch-head-approval/journey/${encodeURIComponent(candidateId)}`,
      );
      setData(r.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load this candidate's journey.");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => { if (open && candidateId) void load(); }, [open, candidateId, load]);

  const cand = data?.candidate as Record<string, string> | null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="text-left">
            {cand?.full_name ?? "Candidate journey"}
          </SheetTitle>
        </SheetHeader>

        {cand && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {cand.candidate_code && <span className="font-mono">{cand.candidate_code}</span>}
            {(cand.branch_name || cand.applied_for_branch) && (
              <span>{cand.branch_name ?? cand.applied_for_branch}</span>
            )}
            {data?.employee?.employee_code && (
              <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
                {data.employee.employee_code}
              </Badge>
            )}
          </div>
        )}

        {loading && (
          <div className="flex h-56 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label="Loading journey" />
          </div>
        )}

        {error && !loading && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Progress rail — where the candidate has actually reached. */}
            <div className="mt-5 flex flex-wrap gap-1.5">
              {data.phaseSummary.map(({ phase, state }) => {
                const meta = PHASE_META[phase];
                const reached = state !== "not_reached";
                return (
                  <span
                    key={phase}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      reached ? meta.tone : "border-dashed border-slate-200 bg-white text-slate-400"
                    }`}
                  >
                    <meta.Icon className="h-3 w-3" aria-hidden="true" />
                    {meta.label}
                  </span>
                );
              })}
            </div>

            {data.events.length === 0 ? (
              <p className="mt-8 text-center text-sm text-slate-500">
                No journey events recorded for this candidate yet.
              </p>
            ) : (
              <ol className="mt-6 space-y-0">
                {data.events.map((e, i) => {
                  const meta = PHASE_META[e.phase] ?? PHASE_META.APPLICATION;
                  const last = i === data.events.length - 1;
                  return (
                    <li key={`${e.source_table}-${e.source_record_id}-${i}`} className="relative flex gap-3 pb-5">
                      {/* Rail */}
                      {!last && (
                        <span className="absolute left-[13px] top-7 h-full w-px bg-slate-200" aria-hidden="true" />
                      )}
                      <span
                        className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${meta.tone}`}
                      >
                        <meta.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <p className="text-sm font-semibold text-slate-900">{e.activity_type}</p>
                          {e.status && (
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusTone(e.status)}`}>
                              {e.status.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                          <CalendarClock className="h-3 w-3" aria-hidden="true" />
                          {safeDate(e.occurred_at)}
                          {e.actor_name && <span>· {e.actor_name}</span>}
                        </p>
                        {e.detail && <p className="mt-1 text-xs text-slate-600">{e.detail}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {data.gaps.length > 0 && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <Ban className="h-3 w-3" aria-hidden="true" /> Not included
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {data.gaps.map((g) => (
                    <li key={g} className="text-xs text-slate-600">• {g}</li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-slate-500">
                  These sources could not be read, so this journey may be incomplete — it does not
                  mean those steps did not happen.
                </p>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default CandidateJourneyDrawer;
