import { Award, GraduationCap } from "lucide-react";
import { Chip, SectionCard, StatTile } from "./SectionCard";
import { fmtDate, fmtPct, humanize } from "./rejoinReviewFormat";
import type { LearningSection, SectionResult } from "./rejoinTypes";

export function LearningSectionCard({ result }: { result: SectionResult<LearningSection> }) {
  return (
    <SectionCard
      id="learning"
      title="Learning"
      icon={GraduationCap}
      result={result}
      isEmpty={(d) => d.coursesTotal === 0 && d.certifications.length === 0}
      emptyText="No courses or certifications on record."
    >
      {(d) => (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile label="Courses completed" value={`${d.coursesCompleted}/${d.coursesTotal}`} />
            <StatTile label="Avg completion" value={fmtPct(d.avgCompletionPct)} />
            <StatTile label="Certifications" value={d.certifications.length} />
          </div>
          {d.certifications.length > 0 && (
            <ul className="space-y-1.5" aria-label="Certifications">
              {d.certifications.map((c, i) => (
                <li key={`${c.name}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <Award className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 break-words font-medium">{c.name}</span>
                  <Chip>{humanize(c.status)}</Chip>
                  <span className="text-xs text-muted-foreground">
                    Issued {fmtDate(c.issued)}{c.expires ? ` · expires ${fmtDate(c.expires)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  );
}
