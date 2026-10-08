import { AlertTriangle, CheckCircle2, Clock, FileX2, Laptop } from "lucide-react";
import { Chip, Fact, SectionCard } from "./SectionCard";
import { DASH, fmtDate, fmtInr, humanize, plural } from "./rejoinReviewFormat";
import type { ExitSection, SectionResult } from "./rejoinTypes";

function noticeText(n: ExitSection["notice"]): string {
  const required = n.requiredDays === null ? DASH : plural(n.requiredDays, "day");
  const served = n.servedDays === null ? DASH : plural(n.servedDays, "day");
  return `${required} required / ${served} served`;
}

/** The latest real exit: how they left, what was settled and what is still open. */
export function ExitFileSectionCard({ result }: { result: SectionResult<ExitSection | null> }) {
  return (
    <SectionCard id="exit" title="Exit file" icon={FileX2} result={result} emptyText="No exit on file.">
      {(x) => {
        const reason = [x.reasonCategory ? humanize(x.reasonCategory) : null, x.reasonText].filter(Boolean).join(" — ");
        const shortfall = x.notice.shortfallDays;
        const clearanceOpen = x.clearance.pending.length > 0;
        return (
          <>
            <dl>
              <Fact label="Exit type">{humanize(x.exitType)}</Fact>
              <Fact label="Sub-type">{humanize(x.subType)}</Fact>
              <Fact label="Reason">{reason || DASH}</Fact>
              {x.abscondingSince && <Fact label="Absconding since">{fmtDate(x.abscondingSince)}</Fact>}
              <Fact label="Last working day">{fmtDate(x.lastWorkingDay)}</Fact>
              <Fact label="Exit status">{humanize(x.status)}</Fact>
              <Fact label="Notice">
                <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                  {noticeText(x.notice)}
                  {shortfall !== null && shortfall > 0 && (
                    <Chip tone="warn" icon={AlertTriangle}>
                      {plural(shortfall, "day")} short
                    </Chip>
                  )}
                </span>
              </Fact>
              <Fact label="Clearance">
                <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                  {x.clearance.total === 0 ? "No checklist" : `${x.clearance.done}/${x.clearance.total} cleared`}
                  {clearanceOpen ? (
                    <Chip tone="warn" icon={Clock}>
                      {x.clearance.pending.length} pending
                    </Chip>
                  ) : x.clearance.total > 0 ? (
                    <Chip tone="good" icon={CheckCircle2}>
                      Complete
                    </Chip>
                  ) : null}
                </span>
              </Fact>
              <Fact label="Full and final">
                {x.ff === null ? (
                  "No F&F calculation"
                ) : (
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                    {fmtInr(x.ff.netPayable)} · {humanize(x.ff.status)}
                    {x.ff.paid ? (
                      <Chip tone="neutral" icon={CheckCircle2}>
                        Paid
                      </Chip>
                    ) : (
                      <Chip tone="neutral" icon={Clock}>
                        Not paid
                      </Chip>
                    )}
                  </span>
                )}
              </Fact>
            </dl>

            {clearanceOpen && (
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-muted-foreground">Clearance pending</h4>
                <ul className="space-y-1 text-sm">
                  {x.clearance.pending.map((p, i) => (
                    <li key={`${p.department}-${i}`} className="break-words">
                      <span className="font-medium">{p.department}</span>
                      {p.remarks && <span className="text-muted-foreground"> — {p.remarks}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {x.assetsHeld.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-muted-foreground">Assets still held</h4>
                <ul className="space-y-1 text-sm">
                  {x.assetsHeld.map((a, i) => (
                    <li key={`${a.name}-${i}`} className="flex flex-wrap items-center gap-2">
                      <Laptop className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 break-words font-medium">{a.name}</span>
                      {a.category && <span className="text-xs text-muted-foreground">{humanize(a.category)}</span>}
                      <span className="text-xs text-muted-foreground">assigned {fmtDate(a.assigned)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        );
      }}
    </SectionCard>
  );
}
