import { Link } from "react-router-dom";
import { Activity, ArrowRight, ShieldAlert } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

/**
 * RTA Board — retired view.
 *
 * Production data showed the board had gone quiet: attendance_reconciliation_record had no rows
 * after 2026-09-13, all 381 adherence_alert rows were still open (none ever acknowledged), and
 * Push-to-RTA / wfm_rta_exception had never been used. Its reconciliation table also duplicated
 * the punch-based WFM Tracker and could disagree with it for the same person and day.
 *
 * Only this screen is retired. The /api/rta endpoints, the nightly job and shrinkage_daily_snapshot
 * are unchanged: the dashboard live-attendance widgets and the shrinkage reports still read them.
 * The previous page is in git history if the feature is ever revived.
 */
const DESTINATIONS = [
  {
    to: "/wfm/live-tracker",
    title: "WFM Tracker",
    body: "Live attendance from biometric punches: who is in, late or absent right now.",
  },
  {
    to: "/wfm/attendance-integrity?tab=exceptions&status=open",
    title: "Attendance Integrity",
    body: "Open exceptions and mismatches, with actions to resolve or escalate them.",
  },
];

export default function NativeRTABoard() {
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-5 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div>
              <h1 className="text-lg font-bold text-slate-900">The RTA Board has moved</h1>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                This screen is no longer maintained, and its reconciliation figures could differ from the
                live attendance views. Use these instead:
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {DESTINATIONS.map((d) => (
              <Link
                key={d.to}
                to={d.to}
                className="group cursor-pointer rounded-xl border border-slate-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Activity className="h-4 w-4 text-blue-600" aria-hidden="true" />
                  {d.title}
                  <ArrowRight className="ml-auto h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-500">{d.body}</p>
              </Link>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            If a link says you don't have access, ask your manager or WFM to request it for you.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
