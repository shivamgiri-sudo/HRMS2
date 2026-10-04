import { CalendarClock, LogOut, UserRound, XCircle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AuthedAvatarImage } from "@/components/ui/AuthedAvatarImage";
import { Card, CardContent } from "@/components/ui/card";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import { Chip } from "./SectionCard";
import { DASH, fmtDate, fmtTenure, humanize, initials, plural, requestStatusLabel, roleLabel } from "./rejoinReviewFormat";
import type { Dossier } from "./rejoinTypes";

/**
 * Who this is, where they sat, how they left and what is being asked. Identity comes from the header
 * section and the exit facts from the exit section; either can fail on its own, so each half degrades
 * separately and the request facts (always present) still show.
 */
export function RejoinHeaderCard({ dossier }: { dossier: Dossier }) {
  const { request } = dossier;
  const header = dossier.sections.header.status === "ok" ? dossier.sections.header.data : null;
  const headerError = dossier.sections.header.status === "error" ? dossier.sections.header.error : null;
  const exit = dossier.sections.exit.status === "ok" ? dossier.sections.exit.data : null;

  const exitType = exit ? [humanize(exit.exitType), exit.subType ? humanize(exit.subType) : null].filter((s) => s && s !== DASH).join(" · ") : null;
  const exitReason = exit ? [exit.reasonCategory ? humanize(exit.reasonCategory) : null, exit.reasonText].filter(Boolean).join(" — ") : null;

  const facts: { label: string; value: string }[] = [
    { label: "Designation", value: header?.designation ?? DASH },
    { label: "Branch", value: header?.branch ?? DASH },
    { label: "Process", value: header?.process ?? DASH },
    { label: "Manager", value: header?.manager ?? DASH },
    { label: "Tenure", value: fmtTenure(header?.tenureMonths) },
    { label: "Joined", value: fmtDate(header?.dateOfJoining) },
    { label: "Exited", value: fmtDate(header?.dateOfExit ?? exit?.lastWorkingDay) },
    { label: "Exit type", value: exitType || DASH },
  ];

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar className="h-14 w-14 shrink-0">
            {header?.photoUrl && <AuthedAvatarImage src={normalizeMediaUrl(header.photoUrl)} alt={`Photo of ${header.name || "the employee"}`} />}
            <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary">
              {header ? initials(header.name) : <UserRound className="h-6 w-6" aria-hidden />}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            {/* h2: the page owns the h1 ("Rejoin review"). */}
            <h2 className="break-words text-xl font-semibold leading-tight">{header?.name || "Employee"}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {header?.employeeCode && <span className="font-mono">{header.employeeCode}</span>}
              {header?.department && <span>{header.department}</span>}
              {header?.employmentStatus && <span>Status: {header.employmentStatus}</span>}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip icon={CalendarClock}>Request: {requestStatusLabel(request.status)}</Chip>
            </div>
          </div>
        </div>

        {headerError && (
          <p role="alert" className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="break-words">Could not load the employee header. {headerError}</span>
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[11px] font-medium text-muted-foreground">{f.label}</dt>
              <dd className="break-words text-sm font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>

        {exitReason && (
          <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm">
            <LogOut className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 break-words"><span className="font-medium">Exit reason:</span> {exitReason}</span>
          </p>
        )}

        <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[auto_auto_1fr] sm:gap-6">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">Proposed rejoin</p>
            <p className="text-sm font-semibold">{fmtDate(request.proposedJoiningDate)}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">Gap since exit</p>
            <p className="text-sm font-semibold">{plural(request.gapDays, "day")}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">Raised by {roleLabel(request.raisedByRole)}</p>
            <p className="break-words text-sm italic">{request.reason ? `"${request.reason}"` : DASH}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
