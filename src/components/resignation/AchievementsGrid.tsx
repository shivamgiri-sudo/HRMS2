import { useEffect, useState } from "react";
import { Award, HeartHandshake, Medal, Star } from "lucide-react";
import { formatDate, type AchievementSection, type JourneySummary } from "./resignation-types";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/** Short count-up (≈600 ms, ease-out). Shows the final number at once under reduced motion. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (prefersReducedMotion() || target <= 0) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const duration = 600;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

type CardDef = {
  key: keyof JourneySummary["achievements"];
  title: string;
  icon: typeof Award;
  ribbon: string;
  medal: string;
  empty: string;
};

const CARDS: CardDef[] = [
  { key: "kudos", title: "Kudos received", icon: HeartHandshake, ribbon: "from-emerald-600 to-teal-600", medal: "bg-emerald-100 text-emerald-800", empty: "Kudos from colleagues will appear here." },
  { key: "badges", title: "Badges earned", icon: Award, ribbon: "from-teal-600 to-cyan-600", medal: "bg-teal-100 text-teal-800", empty: "No badges yet — they are on the way." },
  { key: "milestones", title: "Tenure milestones", icon: Medal, ribbon: "from-amber-500 to-amber-600", medal: "bg-amber-100 text-amber-800", empty: "Your first work anniversary is coming up." },
  { key: "recognitions", title: "Recognitions", icon: Star, ribbon: "from-cyan-600 to-sky-600", medal: "bg-cyan-100 text-cyan-800", empty: "Spotlight nominations will appear here." },
];

function AchievementCard({ def, section, points }: { def: CardDef; section: AchievementSection; points?: number }) {
  const count = useCountUp(section.count);
  const Icon = def.icon;
  return (
    <article className="relative flex min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/90 shadow-sm">
      <div aria-hidden className={`h-1.5 w-full bg-gradient-to-r ${def.ribbon}`} />
      <div className="flex items-center gap-3 p-4 pb-2">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${def.medal}`}>
          <Icon className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">{def.title}</h3>
          <p className="text-3xl font-bold tabular-nums leading-tight text-slate-900" aria-label={`${section.count} ${def.title.toLowerCase()}`}>
            {count}
            {typeof points === "number" && points > 0 && (
              <span className="ml-2 align-middle text-sm font-semibold text-slate-600">· {points} pts</span>
            )}
          </p>
        </div>
      </div>
      <div className="flex-1 px-4 pb-4">
        {section.recent.length === 0 ? (
          <p className="text-base leading-relaxed text-slate-600">{def.empty}</p>
        ) : (
          <ul className="space-y-2">
            {section.recent.slice(0, 3).map((item) => (
              <li key={item.id} className="rounded-2xl bg-slate-50 px-3 py-2">
                <p className="break-words text-sm font-semibold text-slate-900">{item.title}</p>
                {item.detail && <p className="line-clamp-2 break-words text-sm leading-relaxed text-slate-600">{item.detail}</p>}
                {item.date && <p className="text-xs font-medium text-slate-600">{formatDate(item.date)}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

/** Certificate-style achievement cards with counts and recent items. */
export function AchievementsGrid({ achievements }: { achievements: JourneySummary["achievements"] }) {
  return (
    <section aria-labelledby="achievements-title">
      <h2 id="achievements-title" className="mb-3 text-lg font-bold text-slate-900">
        What you have achieved
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS.map((def) => (
          <AchievementCard
            key={def.key}
            def={def}
            section={achievements[def.key]}
            points={def.key === "kudos" ? achievements.kudos.points : undefined}
          />
        ))}
      </div>
    </section>
  );
}
