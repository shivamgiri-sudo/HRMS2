import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import type { RosterRequest } from "./types";

interface Impact {
  blockers: string[]; warnings: string[]; locked: boolean;
  rest: Array<{ employeeId: string; ok: boolean; message: string | null }>;
  sameDayHeadcount: { date: string; processName: string | null; planned: number } | null;
  week: Array<{ employeeId: string; days: Array<{ date: string; shiftName: string | null; isWeekOff: boolean }> }>;
}

/** Label a week row by name where the request knows it (requester / swap counterpart), else "Employee". */
function nameFor(request: RosterRequest, employeeId: string): string {
  if (request.employeeId && employeeId === request.employeeId) return request.employeeName;
  const target = (request.raw as { target_employee_id?: string } | null)?.target_employee_id;
  if (request.kind === "swap" && target && employeeId === target) return request.secondaryName ?? "Employee";
  return "Employee";
}

export function ImpactPanel({ request }: { request: RosterRequest }) {
  const q = useQuery({
    queryKey: ["rr", "impact", request.key],
    queryFn: async () => (await hrmsApi.get<{ data: Impact }>(`/api/roster-requests/impact?kind=${request.kind}&id=${encodeURIComponent(request.id)}`)).data,
  });
  if (q.isLoading) return <div className="p-4 text-sm text-slate-500">Checking roster impact…</div>;
  if (q.isError || !q.data) return <div className="p-4 text-sm text-red-600">Could not load roster impact.</div>;
  const i = q.data;
  return (
    <div className="space-y-4 p-4">
      {i.blockers.map((b) => <div key={b} className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">Blocker: {b}</div>)}
      {i.warnings.map((w) => <div key={w} className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Warning: {w}</div>)}
      {!i.blockers.length && !i.warnings.length ? <div className="rounded border border-green-200 bg-green-50 p-2 text-sm text-green-700">No rule issues found.</div> : null}
      {i.sameDayHeadcount ? (
        <div className="text-sm text-slate-700">
          {i.sameDayHeadcount.processName} on {i.sameDayHeadcount.date}: <b>{i.sameDayHeadcount.planned}</b> rostered
        </div>
      ) : null}
      {i.week.map((w) => (
        <div key={w.employeeId}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {nameFor(request, w.employeeId)} · surrounding days
          </div>
          <div className="flex flex-wrap gap-1">
            {w.days.map((d) => (
              <span key={d.date} className={`rounded border px-2 py-1 text-xs ${d.date === request.date ? "border-blue-500 bg-blue-50" : ""} ${d.isWeekOff ? "text-slate-400" : ""}`}>
                {d.date.slice(5)} · {d.isWeekOff ? "Off" : d.shiftName ?? "—"}
              </span>
            ))}
          </div>
        </div>
      ))}
      {/* /wfm/team-roster exists but reads no date query param, so link without one. */}
      <Link className="inline-block text-sm text-blue-600 underline" to="/wfm/team-roster">Open in roster</Link>
    </div>
  );
}
