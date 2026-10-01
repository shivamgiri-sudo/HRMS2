import { Briefcase, CalendarDays, MapPin } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AuthedAvatarImage } from "@/components/ui/AuthedAvatarImage";
import { formatDate, initials, type JourneySummary } from "./resignation-types";

/** Gradient hero: who you are and how long you have been with MAS Callnet. */
export function JourneyHero({ summary }: { summary: JourneySummary }) {
  const { profile, tenure } = summary;
  const firstName = profile.first_name ?? profile.name.split(" ")[0];
  const hasTenure = tenure.total_months > 0;

  return (
    <section
      aria-labelledby="journey-hero-title"
      // 700-weight stops keep white text above 4.5:1 across the whole gradient.
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-teal-700 to-cyan-700 p-5 text-white shadow-lg sm:p-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
    >
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-cyan-300/20 blur-2xl" />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        <Avatar className="h-20 w-20 shrink-0 border-4 border-white/40 shadow-md sm:h-24 sm:w-24">
          <AuthedAvatarImage src={profile.photo_url} alt={`Photo of ${profile.name}`} />
          <AvatarFallback className="bg-white/20 text-2xl font-bold text-white">{initials(profile.name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium uppercase tracking-wider text-white/90">Before you go</p>
          <h2 id="journey-hero-title" className="mt-1 break-words text-2xl font-bold leading-tight sm:text-3xl">
            Thank you, {firstName}
          </h2>
          <p className="mt-2 text-base leading-relaxed text-white">
            {hasTenure ? (
              <>
                <span className="font-bold">{tenure.label}</span> with MAS Callnet. Every one of those days mattered.
              </>
            ) : (
              <>You are just getting started with MAS Callnet, and your journey matters to us.</>
            )}
          </p>
        </div>
      </div>

      <dl className="relative mt-5 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3 sm:gap-3">
        <HeroFact icon={<CalendarDays className="h-4 w-4" aria-hidden />} label="Joined" value={formatDate(profile.date_of_joining)} />
        <HeroFact icon={<Briefcase className="h-4 w-4" aria-hidden />} label="Role" value={profile.designation ?? "—"} />
        <HeroFact icon={<MapPin className="h-4 w-4" aria-hidden />} label="Branch" value={profile.branch ?? "—"} />
      </dl>
    </section>
  );
}

function HeroFact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/25 bg-white/15 px-3 py-2.5 backdrop-blur-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-wide text-white/90">{label}</dt>
        <dd className="break-words text-base font-semibold leading-snug text-white">{value}</dd>
      </div>
    </div>
  );
}
