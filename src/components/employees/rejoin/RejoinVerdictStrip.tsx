import { AlertTriangle, Ban, CheckCircle2, CircleHelp, Info, MinusCircle, ShieldAlert, ShieldCheck, ShieldX, ThumbsDown, ThumbsUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TONE_CLASS, eligibilityLabel, eligibilityTone, ratingLabel, ratingTone } from "./rejoinReviewFormat";
import type { DossierVerdict, RehireVerdict, Tone } from "./rejoinTypes";

const RATING_ICON: Record<string, LucideIcon> = {
  strong: ThumbsUp,
  average: MinusCircle,
  weak: ThumbsDown,
  insufficient_data: CircleHelp,
};

const ELIGIBILITY_ICON: Record<string, LucideIcon> = {
  eligible: ShieldCheck,
  review: ShieldAlert,
  blocked: ShieldX,
};

const REASON_ICON: Record<Tone, LucideIcon> = { good: CheckCircle2, bad: AlertTriangle, neutral: Info };
const REASON_TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-red-700 dark:text-red-400",
  neutral: "text-muted-foreground",
};
const REASON_TONE_LABEL: Record<Tone, string> = { good: "Positive", bad: "Concern", neutral: "Note" };

/**
 * The two judgements side by side: the advisory performance rating (never the decision) and the
 * rehire eligibility the server will enforce on approval. Eligibility is evaluated live by the
 * dossier endpoint, so it can differ from what the requester saw when they raised the request.
 */
export function RejoinVerdictStrip({ verdict, eligibility }: { verdict: DossierVerdict; eligibility: RehireVerdict }) {
  const RatingIcon = RATING_ICON[verdict.rating] ?? CircleHelp;
  const EligIcon = ELIGIBILITY_ICON[eligibility.status] ?? ShieldAlert;
  const blockedReasons = eligibility.reasons.filter((r) => r.severity === "blocked");
  const reviewReasons = eligibility.reasons.filter((r) => r.severity === "review");

  return (
    <Card>
      <CardContent className="grid gap-5 p-4 sm:p-5 lg:grid-cols-2 lg:gap-8">
        <section aria-labelledby="rejoin-verdict-title" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="rejoin-verdict-title" className="text-sm font-semibold">Record rating</h2>
            <span
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", TONE_CLASS[ratingTone(verdict.rating)])}
            >
              <RatingIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Rating: </span>
              {ratingLabel(verdict.rating)}
            </span>
            <span className="text-[11px] text-muted-foreground">Advisory only</span>
          </div>
          {verdict.reasons.length ? (
            <ul className="space-y-1.5">
              {verdict.reasons.map((r, i) => {
                const Icon = REASON_ICON[r.tone] ?? Info;
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", REASON_TONE_TEXT[r.tone])} aria-hidden />
                    <span className="min-w-0 break-words">
                      <span className="sr-only">{REASON_TONE_LABEL[r.tone] ?? "Note"}: </span>
                      {r.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs italic text-muted-foreground">No reasons given.</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            The rating summarises attendance, punctuality, KPI and conduct from the last stint. It is a guide for your
            judgement, not a decision.
          </p>
        </section>

        <section aria-labelledby="rejoin-eligibility-title" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="rejoin-eligibility-title" className="text-sm font-semibold">Rehire eligibility</h2>
            <span
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", TONE_CLASS[eligibilityTone(eligibility.status)])}
            >
              <EligIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Eligibility: </span>
              {eligibilityLabel(eligibility.status)}
            </span>
          </div>
          {eligibility.reasons.length === 0 ? (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
              No eligibility concerns.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {[...blockedReasons, ...reviewReasons].map((r) => (
                <li key={r.code} className={cn("flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm", TONE_CLASS[r.severity === "blocked" ? "bad" : "warn"])}>
                  {r.severity === "blocked" ? <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{r.severity === "blocked" ? "Blocked" : "Review"}:</span> {r.message}{" "}
                    <code className="whitespace-nowrap rounded bg-background/60 px-1 font-mono text-[10px] opacity-80">{r.code}</code>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {eligibility.requiresFreshOnboarding && (
            <p className="text-xs font-medium text-red-700 dark:text-red-300">
              The gap is over 30 days: this person must go through fresh ATS onboarding instead.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Checked live from the exit record now, and checked again by the server when you approve.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
