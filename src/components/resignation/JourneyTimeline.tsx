import { ArrowLeftRight, BadgeCheck, Flag, PartyPopper, Rocket, TrendingUp, Wallet } from "lucide-react";
import { formatDate, type TimelineEvent } from "./resignation-types";

const ICONS: Record<TimelineEvent["type"], { icon: typeof Rocket; tint: string; label: string }> = {
  joining: { icon: Rocket, tint: "bg-emerald-100 text-emerald-800", label: "Joined" },
  confirmation: { icon: BadgeCheck, tint: "bg-teal-100 text-teal-800", label: "Confirmed" },
  promotion: { icon: TrendingUp, tint: "bg-cyan-100 text-cyan-800", label: "Promotion" },
  transfer: { icon: ArrowLeftRight, tint: "bg-sky-100 text-sky-800", label: "Move" },
  increment: { icon: Wallet, tint: "bg-emerald-100 text-emerald-800", label: "Increment" },
  anniversary: { icon: PartyPopper, tint: "bg-amber-100 text-amber-800", label: "Anniversary" },
  milestone: { icon: Flag, tint: "bg-slate-100 text-slate-800", label: "Milestone" },
};

/** Icon timeline of the employee's journey, oldest first, ending at "today". */
export function JourneyTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <section aria-labelledby="journey-timeline-title" className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm sm:p-6">
      <h2 id="journey-timeline-title" className="text-lg font-bold text-slate-900">
        Your journey with us
      </h2>
      {events.length === 0 ? (
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          Your milestones will show up here as your journey grows.
        </p>
      ) : (
        <ol className="mt-4">
          {events.map((event, idx) => {
            const cfg = ICONS[event.type] ?? ICONS.milestone;
            const Icon = cfg.icon;
            const last = idx === events.length - 1;
            return (
              <li key={event.id} className="relative flex gap-4">
                <div className="flex flex-col items-center">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${cfg.tint}`}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  {!last && <span aria-hidden className="w-0.5 flex-1 bg-gradient-to-b from-teal-200 to-slate-200" />}
                </div>
                <div className={`min-w-0 flex-1 ${last ? "pb-1" : "pb-5"} pt-1.5`}>
                  <p className="text-sm font-medium text-slate-600">
                    <span className="sr-only">{cfg.label}, </span>
                    {formatDate(event.date)}
                  </p>
                  <p className="break-words text-base font-semibold leading-snug text-slate-900">{event.title}</p>
                  {event.detail && <p className="mt-0.5 break-words text-sm leading-relaxed text-slate-600">{event.detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
