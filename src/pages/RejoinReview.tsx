import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Ban, Eye, FileQuestion, Info, RefreshCcw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { getHrmsApiErrorStatus, hrmsApi } from "@/lib/hrmsApi";
import { RejoinHeaderCard } from "@/components/employees/rejoin/RejoinHeaderCard";
import { RejoinVerdictStrip } from "@/components/employees/rejoin/RejoinVerdictStrip";
import { AttendanceSectionCard } from "@/components/employees/rejoin/AttendanceSectionCard";
import { LateComingSectionCard } from "@/components/employees/rejoin/LateComingSectionCard";
import { KpiSectionCard } from "@/components/employees/rejoin/KpiSectionCard";
import { LeaveSectionCard } from "@/components/employees/rejoin/LeaveSectionCard";
import { LearningSectionCard } from "@/components/employees/rejoin/LearningSectionCard";
import { ConductSectionCard } from "@/components/employees/rejoin/ConductSectionCard";
import { ExitFileSectionCard } from "@/components/employees/rejoin/ExitFileSectionCard";
import { PayrollSectionCard } from "@/components/employees/rejoin/PayrollSectionCard";
import { TimelineSectionCard } from "@/components/employees/rejoin/TimelineSectionCard";
import { RejoinDecisionBar } from "@/components/employees/rejoin/RejoinDecisionBar";
import { canDecideRejoin, dossierErrorView, rejoinDossierKey, statusBannerFor } from "@/components/employees/rejoin/rejoinActions";
import { fmtDate } from "@/components/employees/rejoin/rejoinReviewFormat";
import type { Dossier } from "@/components/employees/rejoin/rejoinTypes";

/**
 * Branch head review of one rejoin request: the previous stint on one page, the live eligibility and
 * the decision. HR / admin open the same page read-only (no decision bar).
 */
export default function RejoinReview() {
  const { id = "" } = useParams<{ id: string }>();
  const { roleKeys } = useWorkforceAccess();
  const isBranchHead = canDecideRejoin(roleKeys);

  const query = useQuery({
    queryKey: rejoinDossierKey(id),
    queryFn: async ({ signal }) => {
      const res = await hrmsApi.get<{ success?: boolean; data?: Dossier }>(
        `/api/employees/reactivation/${encodeURIComponent(id)}/dossier`,
        undefined,
        signal,
      );
      if (!res?.data) throw new Error("The server returned no dossier for this request.");
      return res.data;
    },
    enabled: !!id,
    // 403 / 404 will not change on a retry.
    retry: (count, err) => {
      const status = getHrmsApiErrorStatus(err);
      return status !== 403 && status !== 404 && count < 1;
    },
  });

  const dossier = query.data;
  const name = dossier?.sections.header.status === "ok" ? dossier.sections.header.data?.name : null;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-6xl space-y-4 pb-6">
        <div className="space-y-1">
          <Link
            to="/employees/reactivation"
            className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Rejoin requests
          </Link>
          <h1 className="break-words text-xl font-semibold tracking-tight sm:text-2xl">
            Rejoin review{name ? <span className="text-muted-foreground">: {name}</span> : null}
          </h1>
          {dossier && (
            <p className="text-xs text-muted-foreground">
              Record from {fmtDate(dossier.window.start)} to {fmtDate(dossier.window.end)} (the 12 months before the last working
              day). Generated {new Date(dossier.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.
            </p>
          )}
        </div>

        {query.isPending && <ReviewSkeleton />}

        {query.isError && <ReviewError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />}

        {dossier && (
          <>
            <StatusBanner status={dossier.request.status} />
            <RejoinHeaderCard dossier={dossier} />
            <RejoinVerdictStrip verdict={dossier.verdict} eligibility={dossier.eligibility} />

            <div className="grid gap-4 lg:grid-cols-2">
              <AttendanceSectionCard result={dossier.sections.attendance} windowMonths={dossier.window.months} />
              <LateComingSectionCard result={dossier.sections.attendance} windowMonths={dossier.window.months} />
              <KpiSectionCard result={dossier.sections.kpi} />
              <LeaveSectionCard result={dossier.sections.leave} />
              <LearningSectionCard result={dossier.sections.learning} />
              <ConductSectionCard result={dossier.sections.conduct} />
              <ExitFileSectionCard result={dossier.sections.exit} />
              <PayrollSectionCard result={dossier.sections.payroll} />
              <TimelineSectionCard result={dossier.sections.timeline} />
            </div>

            {isBranchHead ? (
              <RejoinDecisionBar dossier={dossier} onRefetch={() => void query.refetch()} />
            ) : (
              <p className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Eye className="h-4 w-4 shrink-0" aria-hidden />
                Read-only: only the branch head can approve or reject this request.
              </p>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatusBanner({ status }: { status: string }) {
  const text = statusBannerFor(status);
  if (!text) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

function ReviewError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  const view = dossierErrorView(error);
  const Icon = view.kind === "forbidden" ? Ban : view.kind === "not_found" ? FileQuestion : AlertTriangle;
  return (
    <Card role="alert">
      <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
        <Icon className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{view.title}</p>
          <p className="break-words text-sm text-muted-foreground">{view.message}</p>
        </div>
        {view.retry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
            <RefreshCcw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden /> Retry
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline">
            <Link to="/employees/reactivation">Back to requests</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the rejoin review">
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        </CardContent>
      </Card>
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-56 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
