import { Link } from "react-router-dom";
import { Panel } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { arrayAt, asNumber, formatValue } from "../../reference-dashboard-model";
import { buildRecruitmentFunnel } from "../../dashboard-data-contracts";

/**
 * The original ATS-stats datapoints, kept and relabelled truthfully: `total_candidates` is the all-time
 * count of genuine candidates (not "in active pipeline"), and stage rows are disjoint current-stage counts.
 */
export function LegacyAtsPanels({ data }: { data: ReferenceDashboardData }) {
  const a = data.ats as Record<string, unknown>;
  const total = asNumber(a.total_candidates);
  const stages = buildRecruitmentFunnel(a);
  const openCount = asNumber(a.open_positions);
  const open = arrayAt(data.ats, "open_requisitions").slice(0, 6);
  const recent = arrayAt(data.ats, "recent_candidates").concat(arrayAt(data.ats, "pipeline")).slice(0, 6);
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="All-time candidates by current stage" subtitle={`${formatValue(total)} genuine candidates ever registered (all-time, not the live pipeline)`}>
        {total === null ? <p className="py-6 text-center text-sm text-slate-400">Recruitment source unavailable</p> : (
          <div className="space-y-2.5">
            {stages.map((s) => (
              <div key={s.label} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-right text-xs text-slate-500">{s.label}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-3 rounded-full" style={{ width: `${Math.round((s.value / max) * 100)}%`, backgroundColor: s.color }} /></div>
                <span className="w-12 text-xs font-semibold text-slate-800">{formatValue(s.value)}</span>
              </div>
            ))}
            <p className="text-[11px] text-slate-400">Disjoint current-stage buckets: a later stage can exceed an earlier one. Use the funnel above for pass-through.</p>
          </div>
        )}
      </Panel>
      <Panel title="Open positions" subtitle={`${formatValue(openCount ?? open.length)} open seats (approved requisitions, test data excluded)`} bodyClassName="p-0" href="/recruitment/job-requisition">
        {open.length ? <ul className="divide-y divide-slate-100">{open.map((r, i) => <li key={i} className="flex justify-between px-4 py-2.5 text-sm"><span>{String(r.role ?? r.designation ?? r.position ?? "Role")}</span><b>{String(r.openings ?? r.count ?? r.vacancies ?? "")}</b></li>)}</ul>
          : <p className="px-4 py-6 text-center text-sm text-slate-400">{openCount === 0 ? "No open positions" : "See requisition ageing above"}</p>}
      </Panel>
      {recent.length ? (
        <Panel title="Recent pipeline activity" bodyClassName="p-0" className="xl:col-span-2">
          <ul className="divide-y divide-slate-100">{recent.map((r, i) => <li key={i} className="flex justify-between px-4 py-2.5 text-sm"><span>{String(r.candidate_name ?? r.name ?? "Candidate")}</span><span className="text-slate-500">{String(r.stage ?? r.status ?? "")}</span></li>)}</ul>
        </Panel>
      ) : null}
      <div className="xl:col-span-2 flex flex-wrap gap-3 text-sm">
        {[["/ats/candidate-master", "Candidate Pipeline"], ["/ats/walkin-queue", "Walk-in Registry"], ["/ats/offer-approvals", "Offer Approvals"], ["/ats/sourcing-analysis", "ATS Reports"]].map(([h, t]) => <Link key={h} to={h} className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-semibold text-blue-700 hover:bg-slate-50">{t}</Link>)}
      </div>
    </div>
  );
}
