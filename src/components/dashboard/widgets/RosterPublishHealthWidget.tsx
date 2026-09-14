/**
 * "Has the roster actually been published, and has anyone acknowledged it" — on the
 * dashboard, not three clicks away. Built 2026-08-22 alongside the Roster Insights >
 * Analytics tab; this is the same status-summary endpoint, surfaced where a WFM head or
 * the CEO actually looks first. Self-contained (own fetch) so it drops into either
 * dashboard without threading anything through ReferenceRoleDashboard's data bundle.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronRight, Send } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface RosterStatusSummary {
  totalAssignments: number;
  publishedCount: number;
  unpublishedCount: number;
  byAckStatus: Array<{ status: string; count: number }>;
}

function last7Days() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export function RosterPublishHealthWidget({ compact = false }: { compact?: boolean }) {
  const { from, to } = last7Days();
  const { data, isLoading } = useQuery({
    queryKey: ["roster-publish-health", from, to],
    queryFn: () =>
      hrmsApi.get<RosterStatusSummary>(
        `/api/wfm/roster-imports/status-summary?fromDate=${from}&toDate=${to}`
      ),
    staleTime: 5 * 60_000,
    retry: false,
    throwOnError: false,
  });

  const analyticsHref = "/wfm/roster-insights?tab=analytics";

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
        <div className="h-4 w-40 rounded bg-slate-100" />
        <div className="mt-3 h-8 w-24 rounded bg-slate-50" />
      </div>
    );
  }

  if (!data || data.totalAssignments === 0) {
    return (
      <Link
        to={analyticsHref}
        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-500">No roster assignments in the last 7 days</span>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
      </Link>
    );
  }

  const publishedPct = Math.round((data.publishedCount / data.totalAssignments) * 1000) / 10;
  const acknowledged = data.byAckStatus.find((r) => r.status === "acknowledged")?.count ?? 0;
  const pendingAck = data.byAckStatus.find((r) => r.status === "pending")?.count ?? 0;
  const allPublished = data.unpublishedCount === 0;

  if (compact) {
    return (
      <Link
        to={analyticsHref}
        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {allPublished ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Send className="h-4 w-4 text-amber-500" />}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Roster Published (7d)</p>
            <p className="text-sm font-semibold text-slate-800">
              {publishedPct}% published · {data.unpublishedCount} pending
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
      </Link>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-slate-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Roster Publish &amp; Acknowledge (last 7 days)
          </span>
        </div>
        <span
          className={
            allPublished
              ? "inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700"
              : "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700"
          }
        >
          {publishedPct}% published
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100">
        <div className="px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total assignments</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">{data.totalAssignments.toLocaleString("en-IN")}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Never published</p>
          <p className={`mt-1 text-xl font-extrabold tabular-nums ${data.unpublishedCount > 0 ? "text-amber-600" : "text-slate-900"}`}>
            {data.unpublishedCount.toLocaleString("en-IN")}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Acknowledged</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">
            {acknowledged.toLocaleString("en-IN")} <span className="text-xs font-medium text-slate-400">/ {pendingAck.toLocaleString("en-IN")} pending</span>
          </p>
        </div>
      </div>
      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
        <Link to={analyticsHref} className="text-xs font-semibold text-blue-600 hover:text-blue-800">
          View shrinkage trend, attrition &amp; habitual lateness →
        </Link>
      </div>
    </div>
  );
}
