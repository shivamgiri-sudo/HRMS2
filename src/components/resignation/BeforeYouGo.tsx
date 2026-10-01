import { useState } from "react";
import { ArrowRight, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AchievementsGrid } from "./AchievementsGrid";
import { JourneyHero } from "./JourneyHero";
import { JourneyTimeline } from "./JourneyTimeline";
import { TalkFirstDialog } from "./TalkFirstDialog";
import type { JourneySummary } from "./resignation-types";

/** Reserved-space placeholder while the journey summary loads (no layout jump when it lands). */
export function BeforeYouGoSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading your journey">
      <Skeleton className="h-[260px] w-full rounded-3xl sm:h-[220px]" />
      <Skeleton className="h-[148px] w-full rounded-3xl" />
      <Skeleton className="h-[280px] w-full rounded-3xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[180px] w-full rounded-3xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * Shown first when the employee has no open resignation: their journey, their achievements, and
 * two choices — talk first, or continue to the resignation form.
 */
export function BeforeYouGo({
  summary,
  summaryError,
  onContinue,
}: {
  summary: JourneySummary | null;
  summaryError: string | null;
  onContinue: () => void;
}) {
  const [talkOpen, setTalkOpen] = useState(false);

  return (
    <div className="space-y-5">
      {summary ? (
        <>
          <JourneyHero summary={summary} />
          <DecisionPanel onTalk={() => setTalkOpen(true)} onContinue={onContinue} />
          <JourneyTimeline events={summary.timeline} />
          <AchievementsGrid achievements={summary.achievements} />
        </>
      ) : (
        <>
          {summaryError && (
            <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-600">
              We could not load your journey right now. You can still talk to your manager / HR or continue.
            </p>
          )}
          <DecisionPanel onTalk={() => setTalkOpen(true)} onContinue={onContinue} />
        </>
      )}
      <TalkFirstDialog open={talkOpen} onOpenChange={setTalkOpen} />
    </div>
  );
}

function DecisionPanel({ onTalk, onContinue }: { onTalk: () => void; onContinue: () => void }) {
  return (
    <section
      aria-labelledby="decision-title"
      className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm sm:p-6"
    >
      <h2 id="decision-title" className="text-lg font-bold text-slate-900">
        Before you decide
      </h2>
      <p className="mt-1 text-base leading-relaxed text-slate-700">
        A conversation often helps — a shift, a role, a concern can sometimes be sorted out. Whatever you choose, we
        respect it.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button
          type="button"
          onClick={onTalk}
          className="h-auto min-h-[52px] w-full cursor-pointer whitespace-normal bg-amber-600 text-white shadow-sm transition-colors duration-200 ease-out hover:bg-amber-700"
        >
          <MessagesSquare aria-hidden />
          Talk to my manager / HR first
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onContinue}
          className="h-auto min-h-[52px] w-full cursor-pointer whitespace-normal border-slate-300 bg-white text-slate-800 transition-colors duration-200 ease-out hover:bg-slate-50"
        >
          Continue to resignation
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </section>
  );
}
