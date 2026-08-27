import { useCallback, useMemo, useState } from "react";
import { Award, CheckCircle2, Mail, MapPin, Phone, Search, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";

import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";
import {
  ChartCard,
  ChartSkeleton,
  EmptyState,
  FUNNEL_RAMP,
  StatTile,
  num,
} from "@/components/analytics/analytics-kit";

interface JourneyTabProps {
  /** Optional hook so the parent can observe searches. */
  onSearch?: (query: string) => void;
}

const S = (v: unknown) => String(v ?? "").trim();

/**
 * Date rendering that cannot crash the tab.
 *
 * `format(new Date(value))` throws a RangeError on an unparseable value, and
 * date-fns is called inside the render path — one malformed `stage_date` in the
 * API response took the entire Journey tab down with it. Everything here is
 * validated first and falls back to a dash.
 *
 * All timestamps use the same IST helper; the timeline previously mixed
 * local-time date-fns formatting with IST formatting on the same screen, so two
 * dates a few hours apart could appear a day apart.
 */
function safeDate(value: unknown): string {
  const raw = S(value);
  if (!raw) return "—";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "—";
  try {
    return formatISTDate(raw);
  } catch {
    return "—";
  }
}

export function JourneyTab({ onSearch }: JourneyTabProps) {
  const [journeyQuery, setJourneyQuery] = useState("");
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyError, setJourneyError] = useState("");
  const [journey, setJourney] = useState<any>(null);
  const [searchedFor, setSearchedFor] = useState("");

  const runJourney = useCallback(async () => {
    const query = journeyQuery.trim();
    if (!query) {
      toast.error("Enter a candidate ID, name, mobile, email or token");
      return;
    }

    setJourneyLoading(true);
    setJourneyError("");
    setJourney(null);

    try {
      const res = await hrmsApi.get<{ success: boolean; data: any }>(
        `/api/ats-full-parity/journey?query=${encodeURIComponent(query)}`
      );
      setSearchedFor(query);
      onSearch?.(query);

      if (!res.data) setJourneyError(`No candidate matched "${query}".`);
      else setJourney(res.data);
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message || "Search failed";
      setJourneyError(message);
      toast.error("Failed to load candidate journey");
    } finally {
      setJourneyLoading(false);
    }
  }, [journeyQuery, onSearch]);

  const candidate = journey?.candidate ?? {};
  const stageLogs: any[] = journey?.stageLogs ?? [];
  const confirmations: any[] = journey?.confirmations ?? [];

  /**
   * Order the timeline explicitly by date, newest first.
   *
   * "Latest" was previously whatever the API happened to return at index 0,
   * which is only correct while the endpoint sorts — a silent dependency.
   */
  const timeline = useMemo(() => {
    return [...stageLogs].sort((a, b) => {
      const ta = new Date(S(a.stage_date)).getTime();
      const tb = new Date(S(b.stage_date)).getTime();
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });
  }, [stageLogs]);

  /** Minutes → "3d 4h" / "5h 12m" / "18m". Raw minutes are unreadable past an hour or two. */
  const waitingLabel = useMemo(() => {
    const mins = Number(candidate.WaitingMinutes ?? candidate._totalMinutes ?? 0);
    if (!Number.isFinite(mins) || mins <= 0) return "—";
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = Math.round(mins % 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }, [candidate.WaitingMinutes, candidate._totalMinutes]);

  /**
   * Follow-up date, with the implausible ones called out rather than printed straight.
   * Two candidates carry a follow-up dated 2015 — eleven years before the record was created.
   */
  const { followUpLabel, followUpHint } = useMemo(() => {
    if (!candidate.followup_required) return { followUpLabel: "None", followUpHint: "No follow-up flagged" };
    const raw = S(candidate.followup_date);
    if (!raw) return { followUpLabel: "Flagged", followUpHint: "No date set" };
    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) return { followUpLabel: "Flagged", followUpHint: `Unreadable date: ${raw}` };
    const created = new Date(S(candidate.created_at));
    const label = when.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    if (!Number.isNaN(created.getTime()) && when < created) {
      return { followUpLabel: label, followUpHint: "Dated before the candidate existed — check this record" };
    }
    if (when < new Date()) return { followUpLabel: label, followUpHint: "Overdue" };
    return { followUpLabel: label, followUpHint: S(candidate.followup_reason) || "Scheduled" };
  }, [candidate.followup_required, candidate.followup_date, candidate.created_at, candidate.followup_reason]);

  const displayName = S(candidate.FullName) || S(candidate.full_name) || "Unknown";
  const status = S(candidate.Status) || S(candidate.status) || "Pending";
  const statusTone =
    status.toLowerCase() === "selected"
      ? "bg-emerald-100 text-emerald-800"
      : status.toLowerCase() === "rejected"
        ? "bg-rose-100 text-rose-800"
        : "bg-slate-100 text-slate-700";

  return (
    <div className="space-y-4">
      {/* ── Search ──────────────────────────────────────────────────────── */}
      <ChartCard
        title="Candidate Journey"
        subtitle="Search by candidate ID, name, mobile, email or queue token to see the full history."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={journeyQuery}
              onChange={(e) => setJourneyQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runJourney();
              }}
              placeholder="Candidate ID, name, mobile, email or token…"
              className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none transition-colors duration-150 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            onClick={() => void runJourney()}
            disabled={journeyLoading || !journeyQuery.trim()}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-800 disabled:opacity-50"
          >
            {journeyLoading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Searching…
              </>
            ) : (
              <>
                <Search className="h-3.5 w-3.5" />
                Search
              </>
            )}
          </button>
        </div>

        {journeyError && (
          <div role="alert" className="mt-2.5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{journeyError}</span>
          </div>
        )}
      </ChartCard>

      {journeyLoading && <ChartSkeleton height={200} />}

      {journey && !journeyLoading && (
        <>
          {/* ── Profile ─────────────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-lg font-bold text-white">
                  {displayName.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold text-slate-900">{displayName}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                      {S(candidate.CandidateID) || S(candidate.candidate_code) || "no id"}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${statusTone}`}>{status}</span>
                    <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                      {S(candidate.CurrentStage) || S(candidate.current_stage) || "Stage unknown"}
                    </span>
                  </div>
                </div>
              </div>
              {searchedFor && (
                <span className="shrink-0 text-[11px] text-slate-400">Matched “{searchedFor}”</span>
              )}
            </header>

            <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-3">
              {[
                { icon: Phone, label: "Mobile", value: S(candidate.Mobile) || S(candidate.mobile) },
                { icon: Mail, label: "Email", value: S(candidate.Email) || S(candidate.email) },
                { icon: MapPin, label: "Branch", value: S(candidate.Branch) || S(candidate.applied_for_branch) },
              ].map((field) => (
                <div key={field.label} className="flex items-start gap-2.5">
                  <field.icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{field.label}</p>
                    <p className="break-all text-xs font-semibold text-slate-800">{field.value || "—"}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Scores. Quality appeared twice before — once here only. ─── */}
          <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Candidate Quality"
              value={num(Number(candidate._candidateQualityScore ?? 0))}
              denominator={S(candidate._candidateQualityLabel) || "No grade recorded"}
              icon={<Award className="h-4 w-4" />}
            />
            <StatTile
              label="Handling Quality"
              value={num(Number(candidate._handlingQualityScore ?? 0))}
              denominator={S(candidate._handlingQualityLabel) || "No grade recorded"}
              icon={<UserRound className="h-4 w-4" />}
            />
            <StatTile
              label="Role Applied"
              value={S(candidate.RoleApplied) || S(candidate.role_applied) || "—"}
              denominator="Position on the application"
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
            {/*
              Reads the fields the payload actually carries.

              This tile read `candidate.Source ?? candidate.source ?? "Direct"`. Neither key
              exists on the record — the stored column is `sourcing_channel` and the derived one
              is `_source` — so every candidate journey ever looked up fell through to the
              hardcoded literal and reported "Direct". The candidate used to verify this is
              `sourcing_channel: "Reference"`, referred by Khushi. "Direct" is not even one of
              the channels the Sourcing tab of this same page lists.
            */}
            <StatTile
              label="Source"
              value={S(candidate._source) || S(candidate.sourcing_channel) || S(candidate.source_details) || "Not recorded"}
              denominator={S(candidate.referred_by) ? `Referred by ${S(candidate.referred_by)}` : "Sourcing channel"}
            />
          </div>

          {/*
            Fields the endpoint already returns and the card used to drop on the floor. A
            candidate can sit fourteen days in queue with a follow-up flagged and none of it was
            visible here — the recruiter, why they were reassigned, how long the candidate has
            been waiting, whether BGV has started, or that the follow-up date is in 2015.
          */}
          <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Recruiter"
              value={S(candidate.RecruiterAssignedName) || S(candidate.recruiter_assigned_name) || "Unassigned"}
              denominator={S(candidate.assignment_reason) || "Assigned recruiter"}
              icon={<UserRound className="h-4 w-4" />}
            />
            <StatTile
              label="Waiting"
              value={waitingLabel}
              denominator={S(candidate.SLAFlag) === "Yes" ? "SLA breached" : "Within SLA target"}
            />
            <StatTile
              label="BGV"
              value={S(candidate.bgv_status) || "Not started"}
              denominator={S(candidate.offer_status) ? `Offer: ${S(candidate.offer_status)}` : "No offer raised"}
            />
            <StatTile
              label="Follow-up"
              value={followUpLabel}
              denominator={followUpHint}
            />
          </div>

          {/* ── Timeline ────────────────────────────────────────────────── */}
          <ChartCard
            title="Stage Timeline"
            subtitle="Every recorded transition, newest first."
            action={
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                {num(timeline.length)} transition{timeline.length === 1 ? "" : "s"}
              </span>
            }
          >
            {timeline.length === 0 ? (
              <EmptyState
                label="No stage transitions recorded"
                hint="The candidate exists but has no logged movement between stages."
                height={140}
              />
            ) : (
              <ol className="relative space-y-2 pl-6">
                <span className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200" aria-hidden />
                {timeline.map((log, index) => (
                  <li key={`${S(log.to_stage)}-${index}`} className="relative">
                    <span
                      className="absolute -left-[22px] top-3 h-3 w-3 rounded-full border-2 border-white"
                      style={{ backgroundColor: FUNNEL_RAMP[Math.min(index, FUNNEL_RAMP.length - 1)] }}
                      aria-hidden
                    />
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-900">
                            <span>{S(log.from_stage) || "Start"}</span>
                            <span className="text-slate-400">→</span>
                            <span>{S(log.to_stage) || "Unknown"}</span>
                            {index === 0 && (
                              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-800">
                                LATEST
                              </span>
                            )}
                          </p>
                          {S(log.remarks) && <p className="mt-1 text-[11px] text-slate-600">{S(log.remarks)}</p>}
                        </div>
                        <p className="shrink-0 text-[11px] tabular-nums text-slate-500">{safeDate(log.stage_date)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </ChartCard>

          {/* ── Confirmations ───────────────────────────────────────────── */}
          {confirmations.length > 0 && (
            <ChartCard
              title="Confirmations"
              subtitle="Joining intent captured from the candidate."
              action={
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                  {num(confirmations.length)} record{confirmations.length === 1 ? "" : "s"}
                </span>
              }
            >
              <ul className="space-y-2">
                {confirmations.map((conf, index) => (
                  <li key={`${S(conf.process_name)}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900">
                          Will join: <span className="font-semibold">{S(conf.will_join) || "—"}</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-600">Process: {S(conf.process_name) || "—"}</p>
                        {S(conf.hr_query) && (
                          <p className="mt-0.5 text-[11px] text-slate-600">Query: {S(conf.hr_query)}</p>
                        )}
                      </div>
                      <p className="shrink-0 text-[11px] tabular-nums text-slate-500">{safeDate(conf.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </ChartCard>
          )}
        </>
      )}

      {!journey && !journeyLoading && !journeyError && (
        <EmptyState
          label="Search for a candidate to see their journey"
          hint="Any of: candidate ID, name, mobile, email, or queue token."
          height={180}
        />
      )}
    </div>
  );
}
