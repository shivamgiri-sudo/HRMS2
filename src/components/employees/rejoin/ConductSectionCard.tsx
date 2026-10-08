import type { LucideIcon } from "lucide-react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Gavel, Info, ShieldCheck, ShieldX } from "lucide-react";
import { Chip, SectionCard, StatTile } from "./SectionCard";
import { DASH, fmtDate, humanize, severityTone } from "./rejoinReviewFormat";
import type { ConductSection, SectionResult, Tone } from "./rejoinTypes";

const TONE_ICON: Record<Tone | "warn", LucideIcon> = { bad: AlertOctagon, warn: AlertTriangle, neutral: Info, good: CheckCircle2 };

const isClean = (d: ConductSection) =>
  d.warnings.length === 0 &&
  d.pips.length === 0 &&
  !d.disciplinaryFlag.flagged &&
  d.unacknowledgedAlerts === 0 &&
  d.completedCoachingSessions === 0 &&
  d.priorAbscondingExits === 0 &&
  d.priorRejoins === 0 &&
  d.priorRejoinRequests === 0;

/**
 * Warnings, PIPs, HR's disciplinary flag and repeat-leaver history. Severity is always written out next
 * to its icon; colour only reinforces it.
 */
export function ConductSectionCard({ result }: { result: SectionResult<ConductSection> }) {
  return (
    <SectionCard
      id="conduct"
      title="Conduct"
      icon={Gavel}
      result={result}
      isEmpty={isClean}
      emptyText="No warnings, PIPs, disciplinary flag or prior exits on record."
    >
      {(d) => {
        const flag = d.disciplinaryFlag;
        return (
          <>
            {flag.flagged ? (
              <div className="space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <ShieldX className="h-4 w-4 shrink-0" aria-hidden />
                  Disciplinary flag recorded by HR
                  {flag.lifted && (
                    <Chip tone="good" icon={ShieldCheck}>
                      Block lifted by super admin
                    </Chip>
                  )}
                </p>
                <p className="break-words text-xs">
                  {flag.reason ?? DASH} · flagged {fmtDate(flag.date)}
                </p>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
                No disciplinary flag.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
              <StatTile
                label="Active warnings"
                value={d.activeWarnings}
                tone={d.finalWarnings > 0 ? "bad" : d.activeWarnings > 0 ? "warn" : undefined}
                hint={`${d.finalWarnings} final`}
              />
              <StatTile label="Open PIP" value={d.openPip ? "Yes" : "No"} tone={d.openPip ? "bad" : undefined} hint={`${d.pips.length} on record`} />
              <StatTile label="Unacknowledged alerts" value={d.unacknowledgedAlerts} tone={d.unacknowledgedAlerts > 0 ? "warn" : undefined} />
              <StatTile label="Coaching sessions" value={d.completedCoachingSessions} hint="completed" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Prior absconding exits" value={d.priorAbscondingExits} tone={d.priorAbscondingExits > 0 ? "bad" : undefined} />
              <StatTile label="Prior rejoins" value={d.priorRejoins} tone={d.priorRejoins > 0 ? "warn" : undefined} />
              <StatTile label="Rejoin requests approved" value={d.priorRejoinRequests} />
            </div>

            {d.warnings.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-muted-foreground">Warnings</h4>
                <ul className="space-y-1.5">
                  {d.warnings.map((w) => {
                    const tone = severityTone(w.severity);
                    return (
                      <li key={w.id} className="space-y-0.5 border-b border-border/60 pb-1.5 text-sm last:border-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip tone={tone} icon={TONE_ICON[tone]}>
                            <span className="sr-only">Severity: </span>
                            {humanize(w.severity)}
                          </Chip>
                          <span className="font-medium">{humanize(w.category)}</span>
                          <span className="text-xs text-muted-foreground">
                            {fmtDate(w.date)} · {humanize(w.status)}
                          </span>
                        </div>
                        {w.description && <p className="break-words text-xs text-muted-foreground">{w.description}</p>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {d.pips.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-muted-foreground">Performance improvement plans</h4>
                <ul className="space-y-1.5">
                  {d.pips.map((p) => {
                    const open = p.status === "active" || p.status === "extended";
                    return (
                      <li key={p.id} className="space-y-0.5 border-b border-border/60 pb-1.5 text-sm last:border-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip tone={open ? "bad" : "neutral"} icon={open ? AlertTriangle : Info}>
                            {humanize(p.status)}
                          </Chip>
                          <span className="text-xs text-muted-foreground">
                            {fmtDate(p.start)} – {fmtDate(p.end)}
                          </span>
                          {p.outcome && <span className="text-xs">Outcome: {humanize(p.outcome)}</span>}
                        </div>
                        {p.reason && <p className="break-words text-xs text-muted-foreground">{p.reason}</p>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        );
      }}
    </SectionCard>
  );
}
