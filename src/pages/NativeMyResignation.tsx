import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BeforeYouGo, BeforeYouGoSkeleton } from "@/components/resignation/BeforeYouGo";
import { ActivityTrail, RetentionOffers } from "@/components/resignation/ResignationActivity";
import { ResignationForm } from "@/components/resignation/ResignationForm";
import { StatusTracker } from "@/components/resignation/StatusTracker";
import {
  errorMessage,
  normalizeStatus,
  REVERSAL_STATUSES,
  type ApiList,
  type ApiOne,
  type AuditEntry,
  type ExitRequest,
  type JourneySummary,
} from "@/components/resignation/resignation-types";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * My Resignation (route /exit/resignation, page code RESIGNATION_MY_REQUEST).
 *
 *   no open resignation  → "Before you go": journey, achievements, talk-first or continue → form
 *   open resignation     → status tracker (+ withdraw while allowed), retention offers, activity
 *
 * "Open" means any request that was not taken back (withdrawn / revoked / rejected / cancelled);
 * an exited request still shows its completed tracker.
 */
export default function NativeMyResignation() {
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"before" | "form">("before");
  const [notice, setNotice] = useState<string | null>(null);

  const [summary, setSummary] = useState<JourneySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<ApiList<ExitRequest>>("/api/exit/resignation/my");
      setRequests(res.data ?? []);
    } catch (err) {
      setError(errorMessage(err, "Failed to load resignation details"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const openRequest = requests.find((r) => !REVERSAL_STATUSES.has(normalizeStatus(r.status))) ?? null;
  const needsSummary = !loading && !error && !openRequest;

  useEffect(() => {
    if (!needsSummary || summary) return;
    let cancelled = false;
    setSummaryLoading(true);
    hrmsApi
      .get<ApiOne<JourneySummary>>("/api/exit/resignation/me/journey-summary")
      .then((res) => {
        if (!cancelled) setSummary(res.data ?? null);
      })
      .catch((err) => {
        if (!cancelled) setSummaryError(errorMessage(err, "Failed to load your journey"));
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsSummary, summary]);

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-3xl space-y-5 px-0 py-4 sm:px-4 sm:py-8">
        <header>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-900">
            <FileText className="h-6 w-6 text-teal-700" aria-hidden />
            Exit Desk
          </h1>
          <p className="mt-1 text-base text-slate-600">
            {openRequest ? "Track your resignation and its next steps." : "Take a moment to look back before you decide."}
          </p>
        </header>

        {notice && (
          <p role="status" className="flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-base text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            {notice}
          </p>
        )}

        {loading ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-[260px] w-full rounded-3xl" />
            <Skeleton className="h-[148px] w-full rounded-3xl" />
          </div>
        ) : error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" aria-hidden />
            <div>
              <p className="text-base font-semibold text-rose-800">Unable to load your resignation details</p>
              <p className="mt-0.5 text-base text-rose-800">{error}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3 cursor-pointer" onClick={() => void fetchRequests()}>
                Try again
              </Button>
            </div>
          </div>
        ) : openRequest ? (
          <ActiveResignation
            key={openRequest.id}
            request={openRequest}
            onWithdrawn={() => {
              setNotice("Your resignation has been withdrawn. We are glad you are staying.");
              setView("before");
              void fetchRequests();
            }}
          />
        ) : view === "form" ? (
          <ResignationForm
            noticePeriodDays={summary?.notice_period_days ?? 30}
            onBack={() => setView("before")}
            onSubmitted={() => {
              setNotice("Your resignation has been submitted. Your manager and HR have been notified.");
              void fetchRequests();
            }}
          />
        ) : summaryLoading && !summary ? (
          <BeforeYouGoSkeleton />
        ) : (
          <BeforeYouGo
            summary={summary}
            summaryError={summaryError}
            onContinue={() => {
              setNotice(null);
              setView("form");
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

function ActiveResignation({ request, onWithdrawn }: { request: ExitRequest; onWithdrawn: () => void }) {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAuditLoading(true);
    hrmsApi
      .get<ApiList<AuditEntry>>(`/api/exit/resignation/${request.id}/audit`)
      .then((res) => {
        if (!cancelled) setAudit(res.data ?? []);
      })
      .catch((err) => {
        if (!cancelled) setAuditError(errorMessage(err, "Failed to load activity"));
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request.id, request.status]);

  return (
    <div className="space-y-5">
      <StatusTracker request={request} audit={audit} onWithdrawn={onWithdrawn} />
      <RetentionOffers exitId={request.id} />
      <ActivityTrail entries={audit} loading={auditLoading} error={auditError} />
    </div>
  );
}
